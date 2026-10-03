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

test('optional host diagnostics report request stages without request bodies or credentials', async () => {
  const events=[];
  const host=createHost({url:'http://127.0.0.1:4096',password:'private-password',diagnostics:event=>events.push(event),
    fetchImpl:async()=>new Response('{}',{status:200,headers:{'Content-Type':'application/json'}})});
  await host.request('/config',{method:'PATCH',body:{apiKey:'private-key'}});
  assert.deepEqual(events.map(event=>event.stage),['request-started','request-responded']);
  assert.equal(events[1].status,200);
  assert.ok(events[1].durationMs>=0);
  assert.doesNotMatch(JSON.stringify(events),/private-password|private-key|Authorization|body/);
  const failed=createHost({url:'http://127.0.0.1:4096',diagnostics:event=>events.push(event),fetchImpl:async()=>{throw new DOMException('Cancelled','AbortError');}});
  await assert.rejects(failed.request('/agent'),{name:'AbortError'});
  assert.equal(events.at(-1).stage,'request-failed');
  assert.equal(events.at(-1).error,'AbortError');
});

test('native host optionally exposes only x-next-cursor metadata and preserves ordinary JSON callers', async () => {
  const rows=[{id:'ses_fixture',time:{updated:800}}];
  const host=createHost({url:'http://127.0.0.1:4096',fetchImpl:async()=>new Response(JSON.stringify(rows),{
    headers:{'Content-Type':'application/json','x-next-cursor':'800','set-cookie':'private-cookie','authorization':'private-value'},
  })});
  assert.deepEqual(await host.request('/experimental/session'),rows);
  assert.deepEqual(await host.request('/experimental/session',{responseMetadata:true}),{body:rows,metadata:{'x-next-cursor':'800'}});
  const empty=createHost({url:'http://127.0.0.1:4096',fetchImpl:async()=>new Response(null,{status:204})});
  assert.equal(await empty.request('/session/fixture'),null);
  assert.deepEqual(await empty.request('/session/fixture',{responseMetadata:true}),{body:null,metadata:{'x-next-cursor':null}});
});
