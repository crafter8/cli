import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import process from "node:process";

const require = createRequire(import.meta.url);

export function printBuildUsage() {
  console.log(`crafter8 build

Usage:
  crafter8 build --entry <file> [sdk build options...]

Examples:
  crafter8 build --entry ./crafter8.mjs --out-dir ./dist
  crafter8 build --entry ./crafter8.mjs --emit-community-datapack --publication-dir .
`);
}

export function runBuildCommand(args) {
  const buildEntrypoint = require.resolve("@crafter8/sdk/build");
  const result = spawnSync(process.execPath, [buildEntrypoint, ...args], {
    stdio: "inherit",
    env: process.env,
  });
  if (typeof result.status === "number") {
    return result.status;
  }
  if (result.error) {
    throw result.error;
  }
  return 1;
}
