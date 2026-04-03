import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function normalizeBaseUrl(value) {
  const normalized = String(value || "").trim().replace(/\/+$/u, "");
  return normalized || null;
}

function normalizeTarget(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || "local-static";
}

function normalizeRelPath(value) {
  const normalized = String(value || "").trim().replaceAll("\\", "/").replace(/^\/+/u, "");
  if (!normalized) {
    throw new Error("publication_file_path_required");
  }
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`publication_file_path_invalid:${value}`);
  }
  return segments.join("/");
}

export function parsePublishDatapackArgs(argv, env = process.env) {
  const options = {
    apiBaseUrl: normalizeBaseUrl(env.CRAFTER8_API_BASE_URL),
    userId: normalizeOptionalString(env.CRAFTER8_USER_ID),
    userToken: normalizeOptionalString(env.CRAFTER8_USER_TOKEN),
    manifestPath: "community-datapack.manifest.json",
    registryPath: "community-datapacks.json",
    target: normalizeTarget(env.CRAFTER8_PUBLICATION_TARGET || "local-static"),
    cwd: process.cwd(),
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--api-base-url") {
      options.apiBaseUrl = normalizeBaseUrl(next);
      index += 1;
      continue;
    }
    if (arg === "--user-id") {
      options.userId = normalizeOptionalString(next);
      index += 1;
      continue;
    }
    if (arg === "--user-token") {
      options.userToken = normalizeOptionalString(next);
      index += 1;
      continue;
    }
    if (arg === "--manifest") {
      options.manifestPath = next;
      index += 1;
      continue;
    }
    if (arg === "--registry") {
      options.registryPath = next;
      index += 1;
      continue;
    }
    if (arg === "--target") {
      options.target = normalizeTarget(next);
      index += 1;
      continue;
    }
    if (arg === "--cwd") {
      options.cwd = next ? path.resolve(next) : process.cwd();
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

export function printPublishDatapackUsage() {
  console.log(`crafter8 publish datapack

Usage:
  crafter8 publish datapack [--api-base-url <url>] [--user-id <id>] [--user-token <token>] [--manifest <file>] [--registry <file>] [--target <local-static|cloudflare-r2>] [--json]

Examples:
  crafter8 publish datapack --api-base-url https://staging-api.crafter8.app --user-id usr_123 --user-token ... --target cloudflare-r2
  crafter8 publish datapack --target local-static
`);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();
  const body = rawText ? JSON.parse(rawText) : null;
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${url} failed: HTTP ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

export async function buildPublicationFiles({ cwd, manifest }) {
  const sourceRoot = path.resolve(cwd, String(manifest?.publish?.sourceRoot || manifest?.payloadRoot || "."));
  const publishEntries = Array.isArray(manifest?.publish?.entries) ? manifest.publish.entries : [];
  const files = [];
  for (const publishEntry of publishEntries) {
    const fromPath = path.resolve(sourceRoot, String(publishEntry?.from || ""));
    const targetPath = normalizeRelPath(publishEntry?.to);
    const rawContent = await fs.readFile(fromPath);
    files.push({
      path: targetPath,
      sizeBytes: rawContent.byteLength,
      sha256: createHash("sha256").update(rawContent).digest("hex"),
      encoding: "base64",
      content: rawContent.toString("base64"),
      rawContent,
    });
  }
  return files;
}

function buildObjectKey(prefix, relPath) {
  return `${String(prefix || "").replace(/\/+$/u, "")}/${normalizeRelPath(relPath)}`;
}

function guessContentType(filePath) {
  const normalized = String(filePath || "").toLowerCase();
  if (normalized.endsWith(".json")) return "application/json";
  if (normalized.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (normalized.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (normalized.endsWith(".csv")) return "text/csv; charset=utf-8";
  return "application/octet-stream";
}

async function uploadFilesToGrant(upload, files) {
  const client = new S3Client({
    region: "auto",
    endpoint: upload.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: upload.credentials?.accessKeyId,
      secretAccessKey: upload.credentials?.secretAccessKey,
      sessionToken: upload.credentials?.sessionToken,
    },
  });

  for (const file of files) {
    await client.send(
      new PutObjectCommand({
        Bucket: upload.bucket,
        Key: buildObjectKey(upload.prefix, file.path),
        Body: file.rawContent,
        ContentType: guessContentType(file.path),
      }),
    );
  }
}

export async function publishDatapack(rawOptions) {
  const options = {
    ...rawOptions,
    cwd: rawOptions?.cwd ? path.resolve(rawOptions.cwd) : process.cwd(),
  };
  if (!options.apiBaseUrl) {
    throw new Error("Crafter8 API base URL is required. Pass --api-base-url or set CRAFTER8_API_BASE_URL.");
  }
  if (!options.userId || !options.userToken) {
    throw new Error("Crafter8 user credentials are required. Pass --user-id/--user-token or set CRAFTER8_USER_ID and CRAFTER8_USER_TOKEN.");
  }
  if (options.target !== "local-static" && options.target !== "cloudflare-r2") {
    throw new Error(`Unsupported datapack publication target: ${options.target}`);
  }

  const manifestPath = path.resolve(options.cwd, options.manifestPath || "community-datapack.manifest.json");
  const registryPath = path.resolve(options.cwd, options.registryPath || "community-datapacks.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const registryRows = JSON.parse(await fs.readFile(registryPath, "utf8"));
  if (!Array.isArray(registryRows) || registryRows.length === 0) {
    throw new Error(`${registryPath} did not contain any datapacks.`);
  }
  const registryEntry = registryRows[0];
  const files = await buildPublicationFiles({ cwd: options.cwd, manifest });

  const headers = {
    "content-type": "application/json",
    "x-user-id": options.userId,
    "x-user-token": options.userToken,
  };

  const created = await requestJson(`${options.apiBaseUrl}/api/publications/datapacks/sessions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      target: options.target,
      manifest,
      registryEntry,
      files: files.map((file) => ({
        path: file.path,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
      })),
    }),
  });

  const session = created?.data?.session;
  const upload = created?.data?.upload ?? null;
  if (!session?.publicationId || !session?.finalizePath) {
    throw new Error("Crafter8 backend did not return a valid datapack publication session.");
  }

  let finalizeBody = {
    files: files.map((file) => ({
      path: file.path,
      encoding: file.encoding,
      content: file.content,
    })),
  };

  if (options.target === "cloudflare-r2") {
    if (!upload || upload.method !== "s3-temporary-credentials") {
      throw new Error("Crafter8 backend did not return a Cloudflare R2 upload grant.");
    }
    await uploadFilesToGrant(upload, files);
    finalizeBody = {};
  }

  const finalized = await requestJson(`${options.apiBaseUrl}${session.finalizePath}`, {
    method: "POST",
    headers,
    body: JSON.stringify(finalizeBody),
  });

  return {
    publicationId: finalized?.data?.session?.publicationId,
    target: options.target,
    slug: finalized?.data?.session?.slug,
    version: finalized?.data?.session?.version,
    payloadBaseUrl: finalized?.data?.session?.payloadBaseUrl,
    session: finalized?.data?.session ?? null,
  };
}
