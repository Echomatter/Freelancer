// Native startup/configuration acceptance check; no model inference or provider prompts.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { createStore } from '../server/store.mjs';
import { resolveRuntimeConfig, runtimeEnv } from '../server/runtime-config.mjs';
import { startHost } from '../server/host.mjs';
import { createApplication } from '../server/application.mjs';
import { startServer } from '../server/http.mjs';
import { readAgentCatalog, retiredAgents } from '../backend/tools/runtime/agent-catalog.mjs';
import { createCapabilities } from '../server/capabilities.mjs';

const config = resolveRuntimeConfig();
Object.assign(process.env, runtimeEnv(config));
const host = await startHost({ backendRoot: config.backendRoot, config });
// Bootstrap must never migrate a running installation's application settings.
// Native configuration is real; application/SQLite stores are disposable.
const smokeRoot = await mkdtemp(path.join(os.tmpdir(), 'freelancer-native-smoke-'));
let web;
try {
  const agents = await host.request('/agent', { directory: config.appRoot });
  const catalog = await readAgentCatalog(config.backendRoot);
  for (const { id: name } of catalog.agents) {
    const agent = agents.find(agent => agent.name === name);
    assert.ok(agent, `Missing native agent ${name}`);
    assert.equal(agent.mode, "all", `${name} must support main and delegated work`);
    assert.equal(agent.model, undefined, "Native profiles must not pin the selected assignment model");
    const todo = agent.permission.filter(rule => ['*', 'todowrite'].includes(rule.permission) && rule.pattern === '*').at(-1);
    assert.equal(todo?.action, 'allow', `${name} should support native todos by default`);
  }
  for (const name of retiredAgents) assert.ok(!agents.some(a => a.name === name), `Retired profile remains selectable: ${name}`);
  const skills = await host.request('/skill', { directory: config.appRoot });
  for (const name of ['reorient', 'search-index', 'model-routing', 'record-outcome', 'pursue-goal', 'debug', 'verify', 'browser-verify', 'playwright', 'web-research', 'remember', 'reason-through', 'docs-research', 'bounded-judgment', 'typesafe-ai', 'review', 'handoff'])
    assert.ok(skills.some(skill => skill.name === name), `Missing app skill ${name}`);
  const tools = await host.request('/experimental/tool/ids', { directory: config.appRoot });
  for (const name of ['delegate', 'content_index', 'git_project', 'todowrite', 'goal_checkpoint']) assert.ok(tools.includes(name), `Missing native tool ${name}`);
  const capabilities = await createCapabilities({ host, backendRoot: config.backendRoot }).read({
    directory: config.appRoot, projectID: 'native-smoke', agent: 'engineer',
  });
  assert.equal(capabilities.probes.ids.state, 'observed');
  assert.equal(capabilities.probes.exposed.state, 'not-run', 'smoke does not select or invoke a model');
  assert.ok(capabilities.tools.find(row => row.id === 'delegate').discovered);
  assert.ok(capabilities.skills.find(row => row.name === 'verify').discovered);
  for (const name of ['playwright', 'fetch', 'memory', 'sequential-thinking', 'context7', 'jev']) {
    const service = capabilities.mcp.find(row => row.name === name);
    assert.ok(service, `Missing native shared MCP configuration: ${name}`);
    assert.equal(service.status, 'connected', `Native MCP connection did not start: ${name}`);
  }
  console.log(JSON.stringify({ nativeCapabilityInspection: { tools: capabilities.tools.filter(row => row.discovered).length,
    skills: capabilities.skills.length, mcp: capabilities.mcp.map(row => ({ name: row.name, status: row.status })),
    probes: capabilities.probes } }));
  const app = createApplication({ backendRoot: config.backendRoot, host, store: createStore(smokeRoot), dataRoot: path.join(smokeRoot, 'data') });
  web = await startServer({ application: app, assets: path.join(config.appRoot, 'dist') });
  const html = await fetch(web.url).then(r => r.text());
  assert.match(html, /<div id="root"/);
  const script = html.match(/src="([^"]+\.js)"/);
  assert.ok(script, 'Built frontend asset missing');
  assert.equal((await fetch(web.url + script[1])).status, 200);
  const bootstrap = await fetch(web.url + '/api/bootstrap', { headers: { 'X-Freelancer-Client': 'webpage' } });
  assert.equal(bootstrap.status, 200);
  assert.ok((await bootstrap.json()).settings.agents.some(agent => agent.id === 'engineer'));
  console.log('Native app-local startup, named-agent catalog, seventeen catalogued shared skills, sanitized capability inventory, goal checkpoint tool, built UI assets and bootstrap API verified; no inference requested.');
} finally {
  if (web) { web.server.closeAllConnections(); await new Promise(resolve => web.server.close(resolve)); }
  host.stop();
  await rm(smokeRoot, { recursive: true, force: true });
}
