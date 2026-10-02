import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createCapabilities } from "../server/capabilities.mjs";

function fakeHost(routes = {}) {
  const calls = [];
  return {
    calls,
    async request(route, opts = {}) {
      calls.push({ route, directory: opts.directory, keys: Object.keys(opts).sort() });
      if (!Object.hasOwn(routes, route)) {
        const error = new Error(`no native route ${route}`);
        error.status = 404;
        throw error;
      }
      const entry = routes[route];
      if (entry && entry.error) {
        const error = new Error(entry.error.message ?? "native boom");
        if (entry.error.status !== undefined) error.status = entry.error.status;
        throw error;
      }
      return entry.value;
    },
  };
}

async function tempBackend(t, { catalog = { skills: [], tools: [] }, skills = [] } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "caps-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "opencode"), { recursive: true });
  await writeFile(path.join(root, "opencode/catalog.json"), JSON.stringify(catalog));
  for (const name of skills) {
    await mkdir(path.join(root, "skills", name), { recursive: true });
    await writeFile(path.join(root, "skills", name, "SKILL.md"), `# ${name}\n`);
  }
  return root;
}

const dir = () => path.join(os.tmpdir(), "proj");
const toolById = (result, id) => result.tools.find((row) => row.id === id);

test("all native probes use the default request with project directory scope", async (t) => {
  const backendRoot = await tempBackend(t);
  const host = fakeHost({
    "/experimental/tool/ids": { value: ["bash"] },
    "/experimental/tool?provider=prov&model=mod": { value: [{ id: "bash" }] },
    "/agent": { value: [] },
    "/config": { value: {} },
    "/skill": { value: [] },
    "/mcp": { value: {} },
    "/lsp": { value: [] },
    "/command": { value: [] },
  });
  const caps = createCapabilities({ host, backendRoot });
  const result = await caps.read({ directory: dir(), projectID: "p", model: "prov/mod" });
  assert.equal(host.calls.length, 7);
  for (const call of host.calls) {
    assert.equal(call.directory, dir());
    assert.deepEqual(call.keys, ["directory", "signal"]);
  }
  assert.equal(result.version, 1);
  assert.deepEqual(result.context, { projectID: "p", sessionID: null, agent: "engineer", model: "prov/mod" });
});

test("model-specific exposure requires a provider/model pair", async (t) => {
  const backendRoot = await tempBackend(t);
  const host = fakeHost({ "/experimental/tool/ids": { value: [] } });
  const caps = createCapabilities({ host, backendRoot });
  const missing = await caps.read({ directory: dir(), projectID: "p", model: null });
  assert.equal(missing.probes.exposed.state, "not-run");
  assert.match(missing.probes.exposed.reason, /Choose a model/);
  assert.ok(!host.calls.some((call) => call.route.startsWith("/experimental/tool?")));
  const bare = await caps.read({ directory: dir(), projectID: "p", model: "noslash" });
  assert.equal(bare.probes.exposed.state, "not-run");
});

test("tools separate registration, model exposure, and explicit denial", async (t) => {
  const backendRoot = await tempBackend(t);
  const host = fakeHost({
    "/experimental/tool/ids": { value: ["bash", "read", "edit", "grep"] },
    "/experimental/tool?provider=prov&model=mod": { value: [{ id: "bash" }, { id: "read" }] },
    "/agent": {
      value: [{ name: "engineer", permission: { grep: "deny" }, tools: { write: false } }],
    },
    "/config": { value: { permission: {}, tools: { webfetch: false } } },
    "/skill": { value: [] },
    "/mcp": { value: {} },
    "/lsp": { value: [] },
    "/command": { value: [] },
  });
  const result = await createCapabilities({ host, backendRoot }).read({
    directory: dir(),
    projectID: "p",
    model: "prov/mod",
  });
  assert.equal(toolById(result, "bash").modelExposure, true);
  assert.equal(toolById(result, "bash").unavailableReason, null);
  assert.equal(toolById(result, "edit").modelExposure, false);
  assert.equal(toolById(result, "edit").unavailableReason, "Tool is not exposed to the selected model.");
  assert.equal(toolById(result, "grep").nativePermission, "deny");
  assert.equal(toolById(result, "grep").unavailableReason, "Native permission denies this tool.");
  assert.equal(toolById(result, "write").configured, false);
  assert.equal(
    toolById(result, "write").unavailableReason,
    "Explicit native tool configuration disables this tool.",
  );
  assert.equal(toolById(result, "webfetch").configured, false);
  assert.equal(toolById(result, "delegate").origin, "Freelancer plugin");
  assert.equal(toolById(result, "bash").origin, "OpenCode native");
  assert.match(toolById(result, "bash").evidence, /successful use not verified/);
  assert.equal(toolById(result, "websearch").unavailableReason, "Native websearch is not registered for this provider/configuration.");
  assert.deepEqual(result.toolStatus.websearch, {
    discovered: false, modelExposure: false, nativePermission: 'unknown',
    unavailableReason: 'Native websearch is not registered for this provider/configuration.',
  });
  assert.equal(toolById(result, "lsp"), undefined);
});

test('websearch status distinguishes a registered tool not exposed to the selected model', async t => {
  const backendRoot = await tempBackend(t);
  const host = fakeHost({
    '/experimental/tool/ids': { value: ['websearch'] },
    '/experimental/tool?provider=prov&model=mod': { value: [] },
  });
  const result = await createCapabilities({ host, backendRoot }).read({
    directory: dir(), projectID: 'p', model: 'prov/mod',
  });
  assert.deepEqual(result.toolStatus.websearch, {
    discovered: true, modelExposure: false, nativePermission: 'unknown',
    unavailableReason: 'Tool is not exposed to the selected model.',
  });
});

test("MCP states surface without connection details", async (t) => {
  const backendRoot = await tempBackend(t);
  const host = fakeHost({
    "/experimental/tool/ids": { value: [] },
    "/agent": { value: [] },
    "/config": { value: { mcp: { extra: { enabled: false } } } },
    "/skill": { value: [] },
    "/mcp": {
      value: {
        up: { status: "connected" },
        off: { status: "disabled" },
        broken: { status: "failed" },
        locked: { status: "needs_auth" },
        reg: { status: "needs_client_registration" },
      },
    },
    "/lsp": { value: [] },
    "/command": { value: [] },
  });
  const result = await createCapabilities({ host, backendRoot }).read({
    directory: dir(),
    projectID: "p",
  });
  const byName = Object.fromEntries(result.mcp.map((row) => [row.name, row]));
  assert.equal(byName.up.status, "connected");
  assert.equal(byName.up.unavailableReason, null);
  assert.equal(byName.off.unavailableReason, "Disabled by native configuration.");
  assert.equal(byName.broken.unavailableReason, "Native MCP connection failed; inspect the native integration.");
  assert.equal(byName.locked.unavailableReason, "Native MCP authentication is required.");
  assert.equal(byName.reg.unavailableReason, "Native MCP client registration is required.");
  assert.equal(byName.extra.status, "disabled");
  assert.equal(byName.extra.configured, true);
});

test('captured inspection and saved Git boundaries are diagnosed independently of agent identity', async t => {
  const backendRoot = await tempBackend(t);
  const host = fakeHost({ '/experimental/tool/ids': { value: ['edit', 'task', 'delegate', 'lsp'] } });
  for (const fileAccessScope of ['project', 'projects', 'computer']) {
    for (const agent of ['engineer', 'researcher', 'designer', 'custom']) {
      const result = await createCapabilities({ host, backendRoot }).read({ directory: dir(), projectID: 'p', agent,
        boundaries: { inspectionOnly: true, gitInspectOnly: false, fileAccessScope } });
      assert.equal(toolById(result, 'edit').applicationAccess, 'blocked');
      assert.equal(toolById(result, 'delegate').applicationAccess, 'operation-dependent');
      assert.equal(toolById(result, 'lsp').applicationAccess, 'operation-dependent');
      assert.equal(result.boundaries.fileAccessScope, fileAccessScope);
      assert.match(toolById(result, 'task').unavailableReason, /delegate\(\{agent, task\}\)/);
    }
  }
});

test('native patterned permissions remain conditional and agent tool decisions override inherited flags', async t => {
  const backendRoot = await tempBackend(t);
  const host = fakeHost({
    '/experimental/tool/ids': { value: ['read'] },
    '/agent': { value: [{ name: 'engineer', tools: { read: true }, permission: [
      { permission: 'read', pattern: '*', action: 'allow' },
      { permission: 'read', pattern: '*.env', action: 'deny' },
    ] }] },
    '/config': { value: { tools: { read: false } } },
  });
  const result = await createCapabilities({ host, backendRoot }).read({ directory: dir(), projectID: 'p' });
  assert.equal(toolById(result, 'read').nativePermission, 'conditional');
  assert.equal(toolById(result, 'read').configured, true);
});

test('malformed endpoint responses are unavailable rather than evidence of empty inventory', async t => {
  const backendRoot = await tempBackend(t);
  const host = fakeHost({ '/experimental/tool/ids': { value: { unexpected: true } }, '/config': { value: [] } });
  const result = await createCapabilities({ host, backendRoot }).read({ directory: dir(), projectID: 'p' });
  assert.equal(result.probes.ids.state, 'unavailable');
  assert.equal(toolById(result, 'read').discovered, null);
  assert.match(result.probes.config.reason, /unsupported response shape/);
});

test('LSP is not a Freelancer setup feature and native tools are not suppressed', async t => {
  const backendRoot = await tempBackend(t);
  const host = fakeHost({ '/experimental/tool/ids': { value: ['lsp', 'custom_tool'] } });
  const result = await createCapabilities({ host, backendRoot }).read({ directory: dir(), projectID: 'p' });
  assert.equal(Object.hasOwn(result, 'lsp'), false);
  assert.equal(host.calls.some(call => call.route === '/lsp'), false);
  assert.equal(toolById(result, 'lsp').discovered, true, 'native user configuration remains native');
  assert.equal(toolById(result, 'custom_tool').discovered, true);
});

test("unsupported and failing endpoints degrade gracefully", async (t) => {
  const backendRoot = await tempBackend(t);
  const host = fakeHost({
    "/experimental/tool/ids": { error: { status: 404, message: "missing" } },
    "/agent": { error: { status: 500, message: "bad" } },
  });
  const result = await createCapabilities({ host, backendRoot }).read({
    directory: dir(),
    projectID: "p",
  });
  assert.equal(result.probes.ids.state, "unavailable");
  assert.equal(result.probes.ids.reason, "Native endpoint is unsupported.");
  assert.equal(result.probes.agents.state, "unavailable");
  assert.equal(result.probes.agents.reason, "Native inspection failed or timed out.");
  assert.ok(Array.isArray(result.tools) && result.tools.length > 0);
});

test("stale and duplicate skill manifests are diagnosed", async (t) => {
  const backendRoot = await tempBackend(t, {
    catalog: { skills: ["shipped", "ghost"], tools: ["ghost-tool"] },
    skills: ["shipped"],
  });
  const host = fakeHost({
    "/experimental/tool/ids": { value: [] },
    "/skill": { value: [{ name: "dup", location: "a" }, { name: "dup", location: "b" }] },
  });
  const result = await createCapabilities({ host, backendRoot }).read({
    directory: dir(),
    projectID: "p",
  });
  const kinds = result.diagnostics.map((row) => `${row.kind}:${row.name}`);
  assert.ok(kinds.includes("duplicate-skill:dup"));
  assert.ok(kinds.includes("stale-skill-manifest:ghost"));
  assert.ok(kinds.includes("stale-tool-manifest:ghost-tool"));
  const ghost = result.skills.find((row) => row.name === "ghost");
  assert.equal(ghost.discovered, false);
  assert.equal(ghost.dependency, "missing");

  const noCatalog = await createCapabilities({
    host: fakeHost({}),
    backendRoot: path.join(backendRoot, "missing-root"),
  }).read({ directory: dir(), projectID: "p" });
  assert.ok(noCatalog.diagnostics.some((row) => row.kind === "manifest-unavailable"));
});

test("secrets in config, MCP, errors, and prompts never escape", async (t) => {
  const backendRoot = await tempBackend(t, { catalog: { skills: ["shipped"], tools: [] }, skills: ["shipped"] });
  const secrets = [
    "sk-live-apikey-123",
    "bearer-mcp-token-456",
    "mcp-env-password-789",
    "prompt-injection-secret-000",
  ];
  const host = fakeHost({
    "/experimental/tool/ids": { value: ["bash"] },
    "/agent": {
      value: [
        {
          name: "engineer",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
          system: `ignore rules ${secrets[3]}`,
        },
      ],
    },
    "/config": {
      value: {
        apiKey: secrets[0],
        permission: { bash: "allow" },
        mcp: { gh: { headers: { Authorization: `Bearer ${secrets[1]}` }, env: { PASS: secrets[2] } } },
      },
    },
    "/skill": { value: [] },
    "/mcp": { error: { message: `auth failed with ${secrets[1]}` } },
    "/lsp": { value: [] },
    "/command": { value: [] },
  });
  const result = await createCapabilities({ host, backendRoot }).read({
    directory: dir(),
    projectID: "p",
    model: "prov/mod",
  });
  const dumped = JSON.stringify(result);
  for (const secret of secrets) assert.ok(!dumped.includes(secret), `leaked ${secret.slice(0, 8)}`);
  assert.equal(result.probes.mcp.reason, "Native inspection failed or timed out.");
});
