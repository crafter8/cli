import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { isEntrypointInvocation, parseCliRoute, runCli } from "../cli.js";
import { buildPublicationFiles, parsePublishDatapackArgs } from "../lib/publishDatapack.js";

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
