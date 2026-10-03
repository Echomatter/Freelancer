// Native startup/configuration acceptance using disposable native/app stores.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createStore } from '../server/store.mjs';
import { resolveRuntimeConfig, runtimeEnv } from '../server/runtime-config.mjs';
import { startHost } from '../server/host.mjs';
import { createApplication } from '../server/application.mjs';
import { startServer } from '../server/http.mjs';
import { readAgentCatalog, retiredAgents } from '../backend/tools/runtime/agent-catalog.mjs';
import { createCapabilities } from '../server/capabilities.mjs';
import { assertFreshRuntimeRoot, createLocalDataStore } from '../server/data/store.mjs';

const baseConfig = resolveRuntimeConfig();
const smokeRoot = await mkdtemp(path.join(os.tmpdir(), 'freelancer-native-smoke-'));
const config = { ...baseConfig, dataRoot:path.join(smokeRoot, 'data') };
const directory = path.join(smokeRoot, 'project');
const nativeConfig = path.join(smokeRoot, 'native-config');
// Keep OS launch variables, excluding provider credentials and caller config overrides.
const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|TEMP|TMP|USERPROFILE|HOME|APPDATA|LOCALAPPDATA|PROGRAMFILES(?:\(X86\))?|COMSPEC|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i.test(key)));
const env = { ...inherited, ...runtimeEnv(config), OPENCODE_CONFIG_DIR:nativeConfig,
  XDG_CONFIG_HOME:nativeConfig, XDG_DATA_HOME:path.join(smokeRoot,'native-data'),
  XDG_CACHE_HOME:path.join(smokeRoot,'cache'), XDG_STATE_HOME:path.join(smokeRoot,'state') };
let host, web, app;
try {
  await mkdir(nativeConfig, {recursive:true}); await mkdir(directory);
  await writeFile(path.join(nativeConfig,'opencode.jsonc'), '{"autoupdate":false,"share":"disabled"}');
  assertFreshRuntimeRoot(config.dataRoot, config.runtimeID);
  const initialData = createLocalDataStore(config.dataRoot);
  try { initialData.initializeFreshRuntime(config.runtimeID); }
  finally { initialData.close(); }
  Object.assign(process.env, runtimeEnv(config));
  host = await startHost({backendRoot:config.backendRoot,config,env,
    ...(process.env.FREELANCER_SMOKE_OPENCODE ? {executable:process.env.FREELANCER_SMOKE_OPENCODE} : {})});
  const agents = await host.request('/agent', {directory});
  const catalog = await readAgentCatalog(config.backendRoot);
  for (const {id:name} of catalog.agents) {
    const agent = agents.find(agent=>agent.name===name);
    assert.ok(agent, `Missing native agent ${name}`);
    assert.equal(agent.mode,'all', `${name} must support main and delegated work`);
    assert.equal(agent.model,undefined,'Native profiles must not pin the selected assignment model');
    const todo = agent.permission.filter(rule=>['*','todowrite'].includes(rule.permission)&&rule.pattern==='*').at(-1);
    assert.equal(todo?.action,'allow',`${name} should support native todos by default`);
  }
  for (const name of retiredAgents) assert.ok(!agents.some(agent=>agent.name===name),`Retired profile remains selectable: ${name}`);
  const skills = await host.request('/skill',{directory});
  for (const name of ['reorient','search-index','model-routing','record-outcome','pursue-goal','debug','verify','browser-verify','playwright','web-research','remember','reason-through','docs-research','bounded-judgment','typesafe-ai','review','handoff'])
    assert.ok(skills.some(skill=>skill.name===name),`Missing app skill ${name}`);
  const tools = await host.request('/experimental/tool/ids',{directory});
  for (const name of ['delegate','content_index','git_project','knowledge','todowrite','goal_checkpoint'])
    assert.ok(tools.includes(name),`Missing native tool ${name}`);
  const capabilities = await createCapabilities({host,backendRoot:config.backendRoot}).read({directory,projectID:'native-smoke',agent:'engineer'});
  assert.equal(capabilities.probes.ids.state,'observed');
  assert.equal(capabilities.probes.exposed.state,'not-run','smoke does not select or invoke a model');
  assert.ok(capabilities.tools.find(row=>row.id==='delegate').discovered);
  assert.ok(capabilities.skills.find(row=>row.name==='verify').discovered);
  assert.ok(Array.isArray(capabilities.mcp),'native MCP inventory must be available');
  assert.ok(capabilities.mcp.every(service=>service.origin==='OpenCode native MCP'
    &&typeof service.name==='string'&&typeof service.status==='string'));
  assert.equal(capabilities.mcp.length,0,'a vanilla native store has no optional user MCP integrations');
  app = createApplication({backendRoot:config.backendRoot,host,store:createStore(config.backendRoot),dataRoot:config.dataRoot});
  web = await startServer({application:app,assets:path.join(config.appRoot,'dist')});
  const html = await fetch(web.url).then(response=>response.text());
  assert.match(html,/<div id="root"/);
  const script = html.match(/src="([^"]+\.js)"/);
  assert.ok(script,'Built frontend asset missing');
  assert.equal((await fetch(web.url+script[1])).status,200);
  const bootstrap = await fetch(web.url+'/api/bootstrap',{headers:{'X-Freelancer-Client':'webpage'}});
  assert.equal(bootstrap.status,200);
  assert.ok((await bootstrap.json()).settings.agents.some(agent=>agent.id==='engineer'));
  console.log('Disposable native startup, unified runtime registration, named agents, shared skills/tools, empty optional MCP inventory, built UI assets and bootstrap verified. No user credentials, provider sign-in or model inference used.');
} finally {
  if (web) {web.server.closeAllConnections(); await new Promise(resolve=>web.server.close(resolve));}
  try {await app?.store.flush();} catch {}
  app?.modelRatings?.close(); app?.localData?.close();
  if (host?.process&&host.process.exitCode===null&&host.process.signalCode===null) {
    await host.request('/global/dispose',{method:'POST',signal:AbortSignal.timeout(5000)}).catch(()=>{});
    const stopped = once(host.process,'exit'); host.stop();
    await stopped;
  }
  const resolved=path.resolve(smokeRoot), parent=path.resolve(os.tmpdir())+path.sep;
  if (!resolved.startsWith(parent)||!path.basename(resolved).startsWith('freelancer-native-smoke-')) throw Error('Unsafe temporary cleanup path');
  await rm(resolved,{recursive:true,force:true,maxRetries:8,retryDelay:150});
}
