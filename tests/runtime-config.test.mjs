/**
 * Focused tests for server/runtime-config.mjs – fresh data root and ownership boundaries.
 *
 * Tests:
 *   - resolveAppRoot: FREELANCER_APP_ROOT override vs. __dirname fallback
 *   - buildRuntimeConfig: app and backend paths
 *   - runtimeEnv: only Freelancer-owned env vars
 *   - Fresh namespace: no lookup of the former Freelancer data folder
 *   - Failure: missing runtime root detection
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAppRoot, buildRuntimeConfig, runtimeEnv, resolveDataRoot } from "../server/runtime-config.mjs";

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
});

test("Windows gets a clean Freelancer namespace without inspecting the former data root", () => {
  assert.equal(resolveDataRoot({ LOCALAPPDATA: "C:\\Users\\Test\\AppData\\Local" }, "win32", "C:\\Users\\Test"),
    path.join("C:\\Users\\Test\\AppData\\Local", "Freelancer", "workspace-v2"));
});

test('other-platform data-root previews retain path math without inspecting a foreign filesystem',()=>{
  assert.equal(resolveDataRoot({},'darwin','/Users/example'),
    path.join('/Users/example','Library','Application Support','Freelancer','workspace-v2'));
  assert.equal(resolveDataRoot({},'linux','/home/example'),
    path.join('/home/example','.local','share','freelancer','workspace-v2'));
});

// ── runtimeEnv ────────────────────────────────────────────────────────

test("runtimeEnv returns Freelancer-owned paths and leaves native OpenCode configuration alone", () => {
  const cfg = buildRuntimeConfig("F:\\Freelancer");
  const env = runtimeEnv(cfg);
  assert.equal(env.FREELANCER_RUNTIME_ROOT, cfg.backendRoot);
  assert.equal(env.FREELANCER_DATA_HOME, cfg.dataRoot);
  assert.equal(env.FREELANCER_RUNTIME_DATA_MODE, 'unified');
  assert.equal(env.FREELANCER_RUNTIME_ID, 'freelancer-workspace-v2');
  for (const key of ['OPENCODE_CONFIG', 'OPENCODE_CONFIG_DIR', 'OPENCODE_CONFIG_CONTENT', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'FREELANCER_MCP_MEMORY_FILE'])
    assert.equal(Object.hasOwn(env, key), false, `${key} remains under native configuration ownership`);
});

test('retired app LSP choices do not manage native runtime flags', () => {
  const cfg = buildRuntimeConfig("F:/Freelancer");
  for (const nativeLspToolEnabled of [true, false, undefined]) {
    const env = runtimeEnv(cfg, { nativeLspToolEnabled });
    assert.equal(Object.hasOwn(env, 'OPENCODE_EXPERIMENTAL_LSP_TOOL'), false);
  }
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
