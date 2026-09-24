// Native startup/configuration acceptance check; no model inference or provider prompts.
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveRuntimeConfig, runtimeEnv } from '../server/runtime-config.mjs';
import { startHost } from '../server/host.mjs';
import { createApplication } from '../server/application.mjs';
import { startServer } from '../server/http.mjs';
import { readAgentCatalog, retiredAgents } from '../backend/tools/runtime/agent-catalog.mjs';

const config = resolveRuntimeConfig();
Object.assign(process.env, runtimeEnv(config));
const host = await startHost({ backendRoot: config.backendRoot, config });
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
  for (const name of ['reorient', 'search-index', 'sync', 'model-routing', 'record-outcome'])
    assert.ok(skills.some(skill => skill.name === name), `Missing app skill ${name}`);
  const tools = await host.request('/experimental/tool/ids', { directory: config.appRoot });
  for (const name of ['delegate', 'content_index', 'git_project', 'todowrite']) assert.ok(tools.includes(name), `Missing native tool ${name}`);
  const app = createApplication({ backendRoot: config.backendRoot, host, dataRoot: config.dataRoot });
  web = await startServer({ application: app, assets: path.join(config.appRoot, 'dist') });
  const html = await fetch(web.url).then(r => r.text());
  assert.match(html, /<div id="root"/);
  const script = html.match(/src="([^"]+\.js)"/);
  assert.ok(script, 'Built frontend asset missing');
  assert.equal((await fetch(web.url + script[1])).status, 200);
  const bootstrap = await fetch(web.url + '/api/bootstrap', { headers: { 'X-Freelancer-Client': 'webpage' } });
  assert.equal(bootstrap.status, 200);
  assert.ok((await bootstrap.json()).settings.workflows.some(w => w.mode === 'build'));
  console.log('Native app-local startup, one named-agent catalog (main + delegated profiles), five skills, tools, built UI assets and bootstrap API verified; no inference requested.');
} finally {
  if (web) { web.server.closeAllConnections(); await new Promise(resolve => web.server.close(resolve)); }
  host.stop();
}
