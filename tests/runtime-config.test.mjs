/**
 * Focused tests for server/runtime-config.mjs – startup migration path resolution.
 *
 * Tests:
 *   - resolveAppRoot: FREELANCER_APP_ROOT override vs. __dirname fallback
 *   - buildRuntimeConfig: backendRoot, opencodeConfigDir, xdgConfigHome, xdgDataHome
 *   - runtimeEnv: correct env-var map
 *   - Isolation: XDG_CONFIG_HOME never falls through to the user's global ~/.config
 *   - Failure: missing runtime root detection
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAppRoot, buildRuntimeConfig, runtimeEnv } from "../server/runtime-config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// ── resolveAppRoot ────────────────────────────────────────────────────

test("resolveAppRoot returns parent of server/ when FREELANCER_APP_ROOT is unset", () => {
  const saved = process.env.FREELANCER_APP_ROOT;
  try {
    delete process.env.FREELANCER_APP_ROOT;
    const root = resolveAppRoot();
    // Should be the repo root (parent of tests/)
    assert.equal(path.resolve(root), repoRoot);
  } finally {
    if (saved !== undefined) process.env.FREELANCER_APP_ROOT = saved;
    else delete process.env.FREELANCER_APP_ROOT;
  }
});

test("resolveAppRoot uses FREELANCER_APP_ROOT when set", () => {
  const saved = process.env.FREELANCER_APP_ROOT;
  try {
    const customRoot = path.resolve("Custom", "AppRoot");
    process.env.FREELANCER_APP_ROOT = customRoot;
    const root = resolveAppRoot();
    assert.equal(root, customRoot);
  } finally {
    if (saved !== undefined) process.env.FREELANCER_APP_ROOT = saved;
    else delete process.env.FREELANCER_APP_ROOT;
  }
});

// ── buildRuntimeConfig ────────────────────────────────────────────────

test("buildRuntimeConfig resolves paths relative to appRoot", () => {
  const appRoot = "F:\\Freelancer";
  const cfg = buildRuntimeConfig(appRoot);
  assert.equal(cfg.appRoot, appRoot);
  assert.equal(cfg.backendRoot, path.join(appRoot, "backend"));
  assert.equal(cfg.opencodeConfigDir, path.join(appRoot, "backend", "opencode"));
  assert.equal(cfg.xdgConfigHome, path.join(appRoot, "backend", ".state"));
});

test("buildRuntimeConfig never uses the user's global ~/.config for XDG_CONFIG_HOME", () => {
  const cfg = buildRuntimeConfig("F:\\Freelancer");
  // Must be under backend/.state, NOT ~/.config
  assert.ok(
    cfg.xdgConfigHome.includes(path.join("backend", ".state")),
    `Expected XDG_CONFIG_HOME under backend/.state but got: ${cfg.xdgConfigHome}`,
  );
  assert.ok(
    !cfg.xdgConfigHome.includes(".config"),
    `XDG_CONFIG_HOME must not include .config (global config leakage): ${cfg.xdgConfigHome}`,
  );
});

test("buildRuntimeConfig preserves XDG_DATA_HOME from env", () => {
  const saved = process.env.XDG_DATA_HOME;
  try {
    process.env.XDG_DATA_HOME = "F:\\MyData";
    const cfg = buildRuntimeConfig("F:\\Freelancer");
    assert.equal(cfg.xdgDataHome, "F:\\MyData");
  } finally {
    if (saved !== undefined) process.env.XDG_DATA_HOME = saved;
    else delete process.env.XDG_DATA_HOME;
  }
});

test("buildRuntimeConfig provides a default XDG_DATA_HOME when env is unset", () => {
  const saved = process.env.XDG_DATA_HOME;
  try {
    delete process.env.XDG_DATA_HOME;
    const cfg = buildRuntimeConfig("F:\\Freelancer");
    // Should end with .local/share
    assert.ok(
      cfg.xdgDataHome.endsWith(path.join(".local", "share")),
      `Default XDG_DATA_HOME should end with .local/share, got: ${cfg.xdgDataHome}`,
    );
  } finally {
    if (saved !== undefined) process.env.XDG_DATA_HOME = saved;
    else delete process.env.XDG_DATA_HOME;
  }
});

// ── runtimeEnv ────────────────────────────────────────────────────────

test("runtimeEnv returns app-owned config and native data paths", () => {
  const cfg = buildRuntimeConfig("F:\\Freelancer");
  const env = runtimeEnv(cfg);
  assert.equal(env.FREELANCER_RUNTIME_ROOT, cfg.backendRoot);
  assert.equal(env.OPENCODE_CONFIG_DIR, cfg.opencodeConfigDir);
  assert.equal(env.XDG_CONFIG_HOME, cfg.xdgConfigHome);
  assert.equal(env.XDG_DATA_HOME, cfg.xdgDataHome);
});

test("runtimeEnv FREELANCER_RUNTIME_ROOT points to backend, not app root", () => {
  const env = runtimeEnv(buildRuntimeConfig("F:\\Freelancer"));
  assert.ok(
    env.FREELANCER_RUNTIME_ROOT.endsWith(path.sep + "backend"),
    `FREELANCER_RUNTIME_ROOT should be backend dir, got: ${env.FREELANCER_RUNTIME_ROOT}`,
  );
});

// ── Failure detection ─────────────────────────────────────────────────

test("buildRuntimeConfig does not validate existence – caller must check", () => {
  // runtime-config itself is pure path math; existence checks happen at
  // the call sites (delegation.ts, content_index.ts, host.mjs).
  const appRoot = path.resolve("Nonexistent", "Path");
  const cfg = buildRuntimeConfig(appRoot);
  assert.equal(cfg.backendRoot, path.join(appRoot, "backend"));
});

// ── Local skill paths (backend opencode config) ───────────────────────

test("opencodeConfigDir contains the local opencode config directory", () => {
  const cfg = buildRuntimeConfig("F:\\Freelancer");
  assert.ok(cfg.opencodeConfigDir.endsWith(path.join("backend", "opencode")));
});
