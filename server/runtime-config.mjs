/** Resolve Freelancer paths while leaving OpenCode's native config and data paths alone. */
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertLocalStoragePath } from '../shared/local-storage-path.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FRESH_RUNTIME_ID = "freelancer-workspace-v2";

/**
 * Resolve the application root. Priority:
 *   1. FREELANCER_APP_ROOT env var (explicit override for the launcher or testing)
 *   2. Parent of server/ directory (the source tree root)
 */
export function resolveAppRoot() {
  if (process.env.FREELANCER_APP_ROOT) {
    const root = path.resolve(process.env.FREELANCER_APP_ROOT);
    return root;
  }
  return path.resolve(here, "..");
}

/**
 * Build the full runtime configuration from a given appRoot.
 * Exported separately for testing with arbitrary roots.
 */
export function buildRuntimeConfig(appRoot) {
  const backendRoot = path.join(appRoot, "backend");
  const opencodeConfigDir = path.join(backendRoot, "opencode");
  return {
    appRoot,
    dataRoot: resolveDataRoot(),
    runtimeID: FRESH_RUNTIME_ID,
    backendRoot,
    opencodeConfigDir,
  };
}

/**
 * Convenience: resolved config for the current invocation.
 */
export function resolveRuntimeConfig() {
  return buildRuntimeConfig(resolveAppRoot());
}

/**
 * Return only Freelancer-owned runtime variables. OpenCode resolves its own
 * global config, custom config paths, credentials and native data locations.
 */
export function runtimeEnv(config) {
  const c = config || resolveRuntimeConfig();
  return {
    FREELANCER_RUNTIME_ROOT: c.backendRoot,
    FREELANCER_NODE: process.execPath,
    FREELANCER_DATA_HOME: c.dataRoot,
    FREELANCER_RUNTIME_DATA_MODE: "unified",
    FREELANCER_RUNTIME_ID: c.runtimeID ?? FRESH_RUNTIME_ID,
  };
}

/** Resolve a fresh per-user Freelancer namespace; an explicit override is honored as-is. */
export function resolveDataRoot(env = process.env, platform = process.platform, home = os.homedir()) {
  let directory;
  if (env.FREELANCER_DATA_HOME) {
    if (!path.isAbsolute(env.FREELANCER_DATA_HOME)) throw Error("FREELANCER_DATA_HOME must be an absolute path.");
    directory = path.resolve(env.FREELANCER_DATA_HOME);
  } else if (platform === "win32") directory = path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Freelancer", "workspace-v2");
  else if (platform === "darwin") directory = path.join(home, "Library", "Application Support", "Freelancer", "workspace-v2");
  else directory = path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "freelancer", "workspace-v2");
  // Other-platform calls are path previews used by fixtures, not storage opens.
  // Actual consumers always validate the host filesystem before using SQLite.
  if (platform === process.platform) assertLocalStoragePath(directory);
  else if (platform === 'win32') assertLocalStoragePath(directory,{platform,inspectFilesystem:false});
  return directory;
}
