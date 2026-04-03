#!/usr/bin/env node

import { realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { printBuildUsage, runBuildCommand } from "./lib/build.js";
import { login, parseLoginArgs, parseWhoamiArgs, printLoginUsage, printWhoamiUsage, whoami } from "./lib/auth.js";
import {
  parsePublishDatapackArgs,
  printPublishDatapackUsage,
  publishDatapack,
} from "./lib/publishDatapack.js";

function printUsage() {
  console.log(`crafter8

Usage:
  crafter8 build [sdk build options...]
  crafter8 login [login options...]
  crafter8 whoami [whoami options...]
  crafter8 publish datapack [publish options...]

Commands:
  build               Build a Crafter8 declaration entry
  login               Create and store a Crafter8 CLI session
  whoami              Show the active Crafter8 CLI session
  publish datapack    Publish a datapack through Crafter8 backend
`);
}

export function parseCliRoute(argv) {
  const [command, subcommand, ...rest] = argv;
  return {
    command: command || "",
    subcommand: subcommand || "",
    rest,
  };
}

export async function runCli(argv = process.argv.slice(2)) {
  const route = parseCliRoute(argv);

  if (!route.command || route.command === "--help" || route.command === "-h") {
    printUsage();
    return 0;
  }

  if (route.command === "--version" || route.command === "-v") {
    const pkg = await import("./package.json", { with: { type: "json" } });
    console.log(pkg.default.version);
    return 0;
  }

  if (route.command === "build") {
    const buildArgs = [route.subcommand, ...route.rest].filter(Boolean);
    if (buildArgs.includes("--help") || buildArgs.includes("-h")) {
      printBuildUsage();
      return 0;
    }
    return runBuildCommand(buildArgs);
  }

  if (route.command === "login") {
    const options = parseLoginArgs([route.subcommand, ...route.rest].filter(Boolean));
    if (options.help) {
      printLoginUsage();
      return 0;
    }
    const result = await login(options);
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  if (route.command === "whoami") {
    const options = parseWhoamiArgs([route.subcommand, ...route.rest].filter(Boolean));
    if (options.help) {
      printWhoamiUsage();
      return 0;
    }
    const result = await whoami(options);
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  if (route.command === "publish" && route.subcommand === "datapack") {
    const options = parsePublishDatapackArgs(route.rest);
    if (options.help) {
      printPublishDatapackUsage();
      return 0;
    }
    const result = await publishDatapack(options);
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  throw new Error(`Unknown command: ${argv.join(" ")}`);
}

export function isEntrypointInvocation(argvPath = process.argv[1]) {
  const normalizedArgvPath = typeof argvPath === "string" ? argvPath.trim() : "";
  if (!normalizedArgvPath) {
    return false;
  }

  const currentFilePath = fileURLToPath(import.meta.url);
  try {
    return realpathSync(normalizedArgvPath) === realpathSync(currentFilePath);
  } catch {
    return path.resolve(normalizedArgvPath) === path.resolve(currentFilePath);
  }
}

const isEntrypoint = isEntrypointInvocation();
if (isEntrypoint) {
  runCli().then(
    (code) => {
      process.exit(code);
    },
    (error) => {
      console.error(`[crafter8] Failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
