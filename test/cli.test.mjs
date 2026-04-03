import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { isEntrypointInvocation, parseCliRoute, runCli } from "../cli.js";
import { login, parseLoginArgs, whoami } from "../lib/auth.js";
import { loadCliConfig } from "../lib/config.js";
import { buildPublicationFiles, parsePublishDatapackArgs, publishDatapack } from "../lib/publishDatapack.js";

test("parseCliRoute separates command and subcommand", () => {
  assert.deepEqual(parseCliRoute(["publish", "datapack", "--target", "cloudflare-r2"]), {
    command: "publish",
    subcommand: "datapack",
    rest: ["--target", "cloudflare-r2"],
  });
});

test("isEntrypointInvocation resolves npm bin symlinks back to cli.js", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "crafter8-cli-link-"));
  try {
    const symlinkPath = path.join(tmpDir, "crafter8");
    await fs.symlink(path.resolve("cli.js"), symlinkPath);
    assert.equal(isEntrypointInvocation(symlinkPath), true);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("parsePublishDatapackArgs reads defaults and env", () => {
  const options = parsePublishDatapackArgs([], {
    CRAFTER8_API_BASE_URL: "https://api.example.test/",
    CRAFTER8_USER_ID: "usr_123",
    CRAFTER8_USER_TOKEN: "tok_123",
    CRAFTER8_PUBLICATION_TARGET: "cloudflare-r2",
  });

  assert.equal(options.apiBaseUrl, "https://api.example.test");
  assert.equal(options.userId, "usr_123");
  assert.equal(options.userToken, "tok_123");
  assert.equal(options.target, "cloudflare-r2");
  assert.equal(options.manifestPath, "community-datapack.manifest.json");
  assert.equal(options.registryPath, "community-datapacks.json");
});

test("runCli forwards full build arg list after the build command", async (t) => {
  const originalArgv = process.argv.slice();
  const originalExit = process.exit;
  const originalLog = console.log;
  const originalError = console.error;

  let exitCode = null;
  const stdout = [];
  const stderr = [];
  process.argv = [process.execPath, path.resolve("cli.js")];
  process.exit = (code) => {
    exitCode = code;
  };
  console.log = (...args) => {
    stdout.push(args.join(" "));
  };
  console.error = (...args) => {
    stderr.push(args.join(" "));
  };

  try {
    const code = await runCli(["build", "--help"]);
    assert.equal(code, 0);
    assert.equal(exitCode, null);
    assert.ok(stdout.some((line) => line.includes("crafter8 build")));
    assert.deepEqual(stderr, []);
  } finally {
    process.argv = originalArgv;
    process.exit = originalExit;
    console.log = originalLog;
    console.error = originalError;
  }
});

test("buildPublicationFiles reads publish entries with sizes and hashes", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "crafter8-cli-test-"));
  try {
    await fs.mkdir(path.join(tmpDir, "data"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "data", "manifest.json"), JSON.stringify({ ok: true }), "utf8");
    await fs.writeFile(path.join(tmpDir, "data", "items.json"), JSON.stringify([{ id: "item-1" }]), "utf8");

    const files = await buildPublicationFiles({
      cwd: tmpDir,
      manifest: {
        payloadRoot: "data",
        publish: {
          sourceRoot: "data",
          entries: [
            { from: "manifest.json", to: "manifest.json" },
            { from: "items.json", to: "items.json" },
          ],
        },
      },
    });

    assert.equal(files.length, 2);
    assert.equal(files[0].path, "manifest.json");
    assert.equal(typeof files[0].sizeBytes, "number");
    assert.equal(files[0].sha256.length, 64);
    assert.equal(typeof files[0].content, "string");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("login stores credentials and whoami uses the saved profile", async () => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const rawBody = await new Promise((resolve) => {
      let data = "";
      req.on("data", (chunk) => {
        data += String(chunk);
      });
      req.on("end", () => resolve(data));
    });

    if (req.method === "POST" && req.url === "/api/auth/users/register/v1") {
      requests.push({
        method: req.method,
        url: req.url,
        body: JSON.parse(rawBody || "{}"),
      });
      res.statusCode = 201;
      res.setHeader("content-type", "application/json");
      res.setHeader("x-user-token", "tok_test_login");
      res.end(JSON.stringify({ data: { userId: "usr_login", displayName: "Test Login" }, meta: {}, warnings: [] }));
      return;
    }

    if (req.method === "GET" && req.url === "/api/session/v1") {
      requests.push({
        method: req.method,
        url: req.url,
        headers: {
          userId: req.headers["x-user-id"],
          userToken: req.headers["x-user-token"],
        },
      });
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          data: {
            session: {
              authenticated: true,
              userId: "usr_login",
              displayName: "Test Login",
              authProvider: "user",
              hostApiVersion: "1.0.0",
            },
          },
          meta: {},
          warnings: [],
        }),
      );
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "crafter8-cli-auth-"));
  const env = {
    ...process.env,
    CRAFTER8_CLI_CONFIG_PATH: path.join(tmpDir, "config.json"),
  };

  try {
    const parsed = parseLoginArgs(["--api-base-url", `${baseUrl}/`, "--display-name", "Test Login", "--user-id", "usr_login"]);
    assert.equal(parsed.apiBaseUrl, baseUrl);

    const loginResult = await login(parsed, env);
    assert.equal(loginResult.apiBaseUrl, baseUrl);
    assert.equal(loginResult.userId, "usr_login");

    const savedConfig = await loadCliConfig(env);
    assert.equal(savedConfig.defaultProfile, baseUrl);
    assert.equal(savedConfig.profiles[baseUrl]?.userToken, "tok_test_login");

    const whoamiResult = await whoami({}, env);
    assert.equal(whoamiResult.userId, "usr_login");
    assert.equal(whoamiResult.displayName, "Test Login");

    assert.deepEqual(requests[0], {
      method: "POST",
      url: "/api/auth/users/register/v1",
      body: {
        userId: "usr_login",
        displayName: "Test Login",
      },
    });
    assert.deepEqual(requests[1], {
      method: "GET",
      url: "/api/session/v1",
      headers: {
        userId: "usr_login",
        userToken: "tok_test_login",
      },
    });
  } finally {
    server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("publishDatapack falls back to saved login credentials", async () => {
  const server = http.createServer(async (req, res) => {
    const rawBody = await new Promise((resolve) => {
      let data = "";
      req.on("data", (chunk) => {
        data += String(chunk);
      });
      req.on("end", () => resolve(data));
    });

    if (req.method === "POST" && req.url === "/api/auth/users/register/v1") {
      res.statusCode = 201;
      res.setHeader("content-type", "application/json");
      res.setHeader("x-user-token", "tok_publish");
      res.end(JSON.stringify({ data: { userId: "usr_publish", displayName: "Publish User" }, meta: {}, warnings: [] }));
      return;
    }

    if (req.method === "POST" && req.url === "/api/publications/datapacks/sessions") {
      assert.equal(req.headers["x-user-id"], "usr_publish");
      assert.equal(req.headers["x-user-token"], "tok_publish");
      const parsedBody = JSON.parse(rawBody || "{}");
      assert.equal(parsedBody.target, "local-static");
      assert.equal(parsedBody.files.length, 2);
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          data: {
            session: {
              publicationId: "pub_123",
              slug: "example-pack",
              version: "0.1.0",
              finalizePath: "/api/publications/datapacks/sessions/pub_123/finalize",
            },
          },
          meta: {},
          warnings: [],
        }),
      );
      return;
    }

    if (req.method === "POST" && req.url === "/api/publications/datapacks/sessions/pub_123/finalize") {
      assert.equal(req.headers["x-user-id"], "usr_publish");
      assert.equal(req.headers["x-user-token"], "tok_publish");
      const parsedBody = JSON.parse(rawBody || "{}");
      assert.equal(parsedBody.files.length, 2);
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          data: {
            session: {
              publicationId: "pub_123",
              slug: "example-pack",
              version: "0.1.0",
              payloadBaseUrl: "http://example.test/community-datapacks/example-pack/0.1.0",
            },
          },
          meta: {},
          warnings: [],
        }),
      );
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "crafter8-cli-publish-auth-"));
  const env = {
    ...process.env,
    CRAFTER8_CLI_CONFIG_PATH: path.join(tmpDir, "config.json"),
  };

  try {
    await fs.mkdir(path.join(tmpDir, "data"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "data", "manifest.json"), JSON.stringify({ id: "manifest" }), "utf8");
    await fs.writeFile(path.join(tmpDir, "data", "items.json"), JSON.stringify([{ id: "item-1" }]), "utf8");
    await fs.writeFile(
      path.join(tmpDir, "community-datapack.manifest.json"),
      JSON.stringify({
        payloadRoot: "data",
        publish: {
          sourceRoot: "data",
          entries: [
            { from: "manifest.json", to: "manifest.json" },
            { from: "items.json", to: "items.json" },
          ],
        },
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(tmpDir, "community-datapacks.json"),
      JSON.stringify([
        {
          slug: "example-pack",
          version: "0.1.0",
        },
      ]),
      "utf8",
    );

    await login(
      {
        apiBaseUrl: baseUrl,
        displayName: "Publish User",
        userId: "usr_publish",
      },
      env,
    );

    const result = await publishDatapack({
      cwd: tmpDir,
      target: "local-static",
      manifestPath: "community-datapack.manifest.json",
      registryPath: "community-datapacks.json",
      env,
    });

    assert.equal(result.publicationId, "pub_123");
    assert.equal(result.slug, "example-pack");
    assert.equal(result.version, "0.1.0");
  } finally {
    server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
