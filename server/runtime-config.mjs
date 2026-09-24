import os from "node:os";
/**
 * Startup migration: resolves all runtime paths from source location.
 * No packaged layout, no freelancer-root.txt locator, no global toolkit leakage.
 *
 * OPENCODE_CONFIG_DIR points to the local backend/opencode directory.
 * XDG_CONFIG_HOME is set under backend/.state so retired global toolkit plugins
 * don't load. XDG_DATA_HOME is preserved for native auth/session storage.
 * FREELANCER_RUNTIME_ROOT is exposed to local plugins and tools.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

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
  // Put app-scoped config under backend/.state so global toolkit plugins
  // (which live under the user's global XDG_CONFIG_HOME) are never loaded.
  const xdgConfigHome = path.join(backendRoot, ".state");
  // Preserve native OpenCode auth/session storage in the user's real data dir.
  const defaultDataHome = path.join(
    process.env.USERPROFILE || process.env.HOME || "",
    ".local",
    "share",
  );
  const xdgDataHome = process.env.XDG_DATA_HOME || defaultDataHome;

  return {
    appRoot,
    dataRoot: resolveDataRoot(),
    backendRoot,
    opencodeConfigDir,
    xdgConfigHome,
    xdgDataHome,
  };
}

/**
 * Convenience: resolved config for the current invocation.
 */
export function resolveRuntimeConfig() {
  return buildRuntimeConfig(resolveAppRoot());
}

/**
 * Return the env-var overrides that must be passed to any child process
 * (OpenCode server, PowerShell scripts, etc.) so they use this app's
 * isolated config and see the correct runtime root.
 */
export function runtimeEnv(config) {
  const c = config || resolveRuntimeConfig();
  return {
    FREELANCER_RUNTIME_ROOT: c.backendRoot,
    FREELANCER_NODE: process.execPath,
    FREELANCER_DATA_HOME: c.dataRoot,
    OPENCODE_CONFIG_DIR: c.opencodeConfigDir,
    OPENCODE_CONFIG: path.join(c.opencodeConfigDir, 'opencode.jsonc'),
    XDG_CONFIG_HOME: c.xdgConfigHome,
    XDG_DATA_HOME: c.xdgDataHome,
  };
}

/** New QOL data only. Existing runtime JSON and native data stay in place. */
export function resolveDataRoot(env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.FREELANCER_DATA_HOME) {
    if (!path.isAbsolute(env.FREELANCER_DATA_HOME)) throw Error("FREELANCER_DATA_HOME must be an absolute path.");
    return path.resolve(env.FREELANCER_DATA_HOME);
  }
  if (platform === "win32") return path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Freelancer");
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "Freelancer");
  return path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "freelancer");
}
