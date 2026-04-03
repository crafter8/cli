import process from "node:process";
import {
  clearCliProfiles,
  getCliConfigPath,
  loadCliConfig,
  normalizeBaseUrl,
  normalizeOptionalString,
  removeCliProfile,
  selectCliProfile,
  upsertCliProfile,
} from "./config.js";
import { requestJson } from "./http.js";

export function parseLoginArgs(argv, env = process.env) {
  const options = {
    apiBaseUrl: normalizeBaseUrl(env.CRAFTER8_API_BASE_URL),
    displayName: normalizeOptionalString(env.CRAFTER8_DISPLAY_NAME),
    userId: normalizeOptionalString(env.CRAFTER8_USER_ID),
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
    if (arg === "--display-name") {
      options.displayName = normalizeOptionalString(next);
      index += 1;
      continue;
    }
    if (arg === "--user-id") {
      options.userId = normalizeOptionalString(next);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

export function parseWhoamiArgs(argv, env = process.env) {
  const options = {
    apiBaseUrl: normalizeBaseUrl(env.CRAFTER8_API_BASE_URL),
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
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

export function parseLogoutArgs(argv, env = process.env) {
  const options = {
    apiBaseUrl: normalizeBaseUrl(env.CRAFTER8_API_BASE_URL),
    all: false,
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
    if (arg === "--all") {
      options.all = true;
      continue;
    }
    if (arg === "--api-base-url") {
      options.apiBaseUrl = normalizeBaseUrl(next);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

export function printLoginUsage() {
  console.log(`crafter8 login

Usage:
  crafter8 login --display-name <name> [--api-base-url <url>] [--user-id <id>] [--json]

Examples:
  crafter8 login --api-base-url https://staging-api.crafter8.app --display-name "Leo"
  crafter8 login --display-name "External Creator" --user-id creator-123
`);
}

export function printWhoamiUsage() {
  console.log(`crafter8 whoami

Usage:
  crafter8 whoami [--api-base-url <url>] [--json]

Examples:
  crafter8 whoami
  crafter8 whoami --api-base-url https://staging-api.crafter8.app
`);
}

export function printLogoutUsage() {
  console.log(`crafter8 logout

Usage:
  crafter8 logout [--api-base-url <url>] [--all] [--json]

Examples:
  crafter8 logout
  crafter8 logout --api-base-url https://staging-api.crafter8.app
  crafter8 logout --all
`);
}

function buildAuthHeaders(profile) {
  return {
    "x-user-id": profile.userId,
    "x-user-token": profile.userToken,
  };
}

export async function login(rawOptions, env = process.env) {
  const config = await loadCliConfig(env);
  const fallbackProfile = selectCliProfile(config, rawOptions?.apiBaseUrl);
  const apiBaseUrl = normalizeBaseUrl(rawOptions?.apiBaseUrl) || fallbackProfile?.apiBaseUrl || null;
  const displayName =
    normalizeOptionalString(rawOptions?.displayName) ||
    normalizeOptionalString(fallbackProfile?.displayName) ||
    null;
  const userId = normalizeOptionalString(rawOptions?.userId);

  if (!apiBaseUrl) {
    throw new Error("Crafter8 API base URL is required. Pass --api-base-url or set CRAFTER8_API_BASE_URL.");
  }
  if (!displayName) {
    throw new Error("Crafter8 display name is required. Pass --display-name or set CRAFTER8_DISPLAY_NAME.");
  }

  const response = await requestJson(`${apiBaseUrl}/api/auth/users/register/v1`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...(userId ? { userId } : {}),
      displayName,
    }),
  });

  const profileUserId = normalizeOptionalString(response.body?.data?.userId);
  const profileDisplayName = normalizeOptionalString(response.body?.data?.displayName) || displayName;
  const userToken = normalizeOptionalString(response.headers.get("x-user-token"));

  if (!profileUserId || !userToken) {
    throw new Error("Crafter8 backend did not return a usable user session.");
  }

  const stored = await upsertCliProfile(
    {
      apiBaseUrl,
      userId: profileUserId,
      userToken,
      displayName: profileDisplayName,
      updatedAt: new Date().toISOString(),
    },
    env,
  );

  return {
    apiBaseUrl: stored.profile.apiBaseUrl,
    userId: stored.profile.userId,
    displayName: stored.profile.displayName,
    configPath: stored.configPath,
  };
}

export async function whoami(rawOptions, env = process.env) {
  const config = await loadCliConfig(env);
  const profile = selectCliProfile(config, rawOptions?.apiBaseUrl);
  if (!profile) {
    throw new Error(
      `No saved Crafter8 login found. Run "crafter8 login" first. Expected config path: ${getCliConfigPath(env)}`,
    );
  }

  const response = await requestJson(`${profile.apiBaseUrl}/api/session/v1`, {
    method: "GET",
    headers: buildAuthHeaders(profile),
  });

  const session = response.body?.data?.session ?? null;
  return {
    apiBaseUrl: profile.apiBaseUrl,
    userId: session?.userId || profile.userId,
    displayName: session?.displayName || session?.userDisplayName || profile.displayName,
    authProvider: session?.authProvider || null,
    hostApiVersion: session?.hostApiVersion || null,
    session,
    configPath: getCliConfigPath(env),
  };
}

export async function resolveCliProfileForApi(rawApiBaseUrl, env = process.env) {
  const config = await loadCliConfig(env);
  return selectCliProfile(config, rawApiBaseUrl);
}

export async function logout(rawOptions, env = process.env) {
  if (rawOptions?.all) {
    const cleared = await clearCliProfiles(env);
    return {
      removed: true,
      all: true,
      apiBaseUrl: null,
      userId: null,
      configPath: cleared.configPath,
    };
  }

  const removed = await removeCliProfile(rawOptions?.apiBaseUrl, env);
  return {
    removed: removed.removed,
    all: false,
    apiBaseUrl: removed.profile?.apiBaseUrl ?? normalizeBaseUrl(rawOptions?.apiBaseUrl),
    userId: removed.profile?.userId ?? null,
    configPath: removed.configPath,
  };
}
