import test from "node:test";
import assert from "node:assert/strict";
import { createHost, hostEnvironment } from "../server/host.mjs";
import { buildRuntimeConfig } from "../server/runtime-config.mjs";

test("native host forwards the content-index data root to chat tools", () => {
  const config = buildRuntimeConfig("F:\\Freelancer");
  const env = hostEnvironment(config, {});
  assert.equal(env.FREELANCER_RUNTIME_ROOT, config.backendRoot);
  assert.equal(env.FREELANCER_DATA_HOME, config.dataRoot);
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
