import test from "node:test";
import assert from "node:assert/strict";
import { createHost, hostEnvironment } from "../server/host.mjs";
import { buildRuntimeConfig } from "../server/runtime-config.mjs";

test("native host overlays Freelancer plugins without replacing user OpenCode settings or MCP", () => {
  const config = buildRuntimeConfig("F:\\Freelancer");
  const native = { model: "native/provider-model", mcp: { existing: { type: "remote", url: "https://example.invalid/mcp" } }, plugin: ["native-plugin"] };
  const env = hostEnvironment(config, { OPENCODE_CONFIG_CONTENT: JSON.stringify(native), XDG_CONFIG_HOME: "F:\\NativeConfig", XDG_DATA_HOME: "F:\\NativeData" });
  assert.equal(env.FREELANCER_RUNTIME_ROOT, config.backendRoot);
  assert.equal(env.FREELANCER_DATA_HOME, config.dataRoot);
  assert.equal(env.FREELANCER_RUNTIME_DATA_MODE, 'unified');
  assert.equal(env.FREELANCER_RUNTIME_ID, 'freelancer-workspace-v2');
  assert.equal(env.XDG_CONFIG_HOME, "F:\\NativeConfig");
  assert.equal(env.XDG_DATA_HOME, "F:\\NativeData");
  assert.deepEqual(JSON.parse(env.OPENCODE_CONFIG_CONTENT).mcp, native.mcp);
  assert.equal(JSON.parse(env.OPENCODE_CONFIG_CONTENT).model, native.model);
  assert.ok(JSON.parse(env.OPENCODE_CONFIG_CONTENT).plugin.includes("native-plugin"));
  assert.ok(JSON.parse(env.OPENCODE_CONFIG_CONTENT).plugin.some(value => value.endsWith("/delegation.ts")));
  for (const name of ['content-index', 'knowledge'])
    assert.ok(JSON.parse(env.OPENCODE_CONFIG_CONTENT).plugin.some(value => value.endsWith(`/${name}.ts`)));
  assert.ok(JSON.parse(env.OPENCODE_CONFIG_CONTENT).instructions.some(value => value.endsWith("WORKSTYLE.md")));
  assert.equal(Object.hasOwn(env, "OPENCODE_CONFIG_DIR"), false);
  assert.equal(Object.hasOwn(env, "OPENCODE_CONFIG"), false);
});

test("native host preserves provider error details, status and stable code", async () => {
  const host = createHost({
    url: "http://127.0.0.1:4096",
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: { message: "Provider is unavailable" } }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
  });
  await assert.rejects(host.request("/session"), (error) => {
    assert.equal(error.message, "Provider is unavailable");
    assert.equal(error.status, 503);
    assert.equal(error.code, "OPENCODE_HTTP_503");
    return true;
  });
});

test("native host falls back to a bounded status message for malformed errors", async () => {
  const host = createHost({
    url: "http://127.0.0.1:4096",
    fetchImpl: async () => new Response("not json", { status: 401 }),
  });
  await assert.rejects(host.request("/provider"), (error) => {
    assert.equal(error.message, "OpenCode request failed (401)");
    assert.equal(error.status, 401);
    assert.equal(error.code, "OPENCODE_HTTP_401");
    return true;
  });
});
