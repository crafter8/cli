import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function normalizeBaseUrl(value) {
  const normalized = String(value || "").trim().replace(/\/+$/u, "");
  return normalized || null;
}

export function createEmptyCliConfig() {
  return {
    version: 1,
    defaultProfile: null,
    profiles: {},
  };
}

export function getCliConfigPath(env = process.env) {
  const explicitPath = normalizeOptionalString(env.CRAFTER8_CLI_CONFIG_PATH);
  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  if (process.platform === "win32") {
    const appDataDir = normalizeOptionalString(env.APPDATA);
    if (appDataDir) {
      return path.join(appDataDir, "Crafter8", "config.json");
    }
  }

  const xdgConfigHome = normalizeOptionalString(env.XDG_CONFIG_HOME);
  if (xdgConfigHome) {
    return path.join(xdgConfigHome, "crafter8", "config.json");
  }

  return path.join(os.homedir(), ".crafter8", "config.json");
}

function sanitizeProfile(rawProfile) {
  const apiBaseUrl = normalizeBaseUrl(rawProfile?.apiBaseUrl);
  if (!apiBaseUrl) {
    return null;
  }
  const userId = normalizeOptionalString(rawProfile?.userId);
  const userToken = normalizeOptionalString(rawProfile?.userToken);
  if (!userId || !userToken) {
    return null;
  }
  return {
    apiBaseUrl,
    userId,
    userToken,
    displayName: normalizeOptionalString(rawProfile?.displayName),
    updatedAt: normalizeOptionalString(rawProfile?.updatedAt) || new Date().toISOString(),
  };
}

export async function loadCliConfig(env = process.env) {
  const configPath = getCliConfigPath(env);
  try {
    const rawText = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(rawText);
    const config = createEmptyCliConfig();
    const defaultProfile = normalizeBaseUrl(parsed?.defaultProfile);
    const profileEntries = Object.entries(parsed?.profiles && typeof parsed.profiles === "object" ? parsed.profiles : {});

    for (const [key, value] of profileEntries) {
      const sanitized = sanitizeProfile({ ...value, apiBaseUrl: value?.apiBaseUrl || key });
      if (sanitized) {
        config.profiles[sanitized.apiBaseUrl] = sanitized;
      }
    }

    if (defaultProfile && config.profiles[defaultProfile]) {
      config.defaultProfile = defaultProfile;
    } else {
      const firstProfile = Object.keys(config.profiles)[0] || null;
      config.defaultProfile = firstProfile;
    }

    return config;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return createEmptyCliConfig();
    }
    throw error;
  }
}

export async function saveCliConfig(config, env = process.env) {
  const configPath = getCliConfigPath(env);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return configPath;
}

export function selectCliProfile(config, apiBaseUrl = null) {
  const normalizedBaseUrl = normalizeBaseUrl(apiBaseUrl);
  if (normalizedBaseUrl) {
    return config?.profiles?.[normalizedBaseUrl] ?? null;
  }

  const defaultProfileKey = normalizeBaseUrl(config?.defaultProfile);
  if (defaultProfileKey && config?.profiles?.[defaultProfileKey]) {
    return config.profiles[defaultProfileKey];
  }

  const firstProfile = Object.values(config?.profiles || {})[0];
  return firstProfile ?? null;
}

export async function upsertCliProfile(profile, env = process.env) {
  const sanitized = sanitizeProfile(profile);
  if (!sanitized) {
    throw new Error("cli_profile_invalid");
  }

  const config = await loadCliConfig(env);
  config.profiles[sanitized.apiBaseUrl] = sanitized;
  config.defaultProfile = sanitized.apiBaseUrl;
  const configPath = await saveCliConfig(config, env);
  return {
    configPath,
    profile: sanitized,
    config,
  };
}
