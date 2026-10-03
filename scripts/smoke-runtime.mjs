// Native startup/configuration acceptance using disposable native/app stores.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createStore } from '../server/store.mjs';
import { resolveRuntimeConfig, runtimeEnv } from '../server/runtime-config.mjs';
import { startHost } from '../server/host.mjs';
import { createApplication } from '../server/application.mjs';
import { startServer } from '../server/http.mjs';
import { readAgentCatalog, retiredAgents } from '../backend/tools/runtime/agent-catalog.mjs';
import { createCapabilities } from '../server/capabilities.mjs';
import { assertFreshRuntimeRoot, createLocalDataStore } from '../server/data/store.mjs';
import { observeStorageDriver } from '../backend/tools/runtime/storage-diagnostics.mjs';
import { withUnifiedDatabase } from '../backend/tools/runtime/unified-database.mjs';
import { seedNativeSmokeDependencies } from './native-smoke-fixture.mjs';

export function parseRuntimeSmokeOptions(args) {
  const options={coldDependencies:false,help:false};
  for (const argument of args) {
    if (argument==='--cold-dependencies' && !options.coldDependencies) options.coldDependencies=true;
    else if (argument==='--help' && !options.help) options.help=true;
    else throw Error(`Unknown or repeated runtime smoke argument: ${argument}`);
  }
  return options;
}

async function sourceFingerprint(root) {
  const files=['package.json','package-lock.json'];
  async function collect(directory) {
    for (const entry of (await readdir(path.join(root,directory),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      if (['.state','node_modules'].includes(entry.name)) continue;
      const relative=path.join(directory,entry.name);
      if (entry.isDirectory()) await collect(relative);
      else if (entry.isFile()) files.push(relative);
    }
  }
  await collect('backend');
  const hash=createHash('sha256');
  for (const file of files.sort()) hash.update(file).update('\0').update(await readFile(path.join(root,file))).update('\0');
  return {sha256:hash.digest('hex'),files:files.length};
}

export async function runRuntimeSmoke({coldDependencies=false}={}) {
const baseConfig = resolveRuntimeConfig();
const sourcesBefore=await sourceFingerprint(baseConfig.appRoot);
const smokeRoot = await mkdtemp(path.join(os.tmpdir(), 'freelancer-native-smoke-'));
const config = { ...baseConfig, dataRoot:path.join(smokeRoot, 'data') };
const directory = path.join(smokeRoot, 'project');
const nativeConfig = path.join(smokeRoot, 'native-config');
const nativeHome = path.join(smokeRoot, 'native-home');
const nativeTemp = path.join(smokeRoot, 'native-temp');
// Keep OS launch variables, excluding provider credentials and caller config overrides.
const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|TEMP|TMP|USERPROFILE|HOME|APPDATA|LOCALAPPDATA|PROGRAMFILES(?:\(X86\))?|COMSPEC|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i.test(key)));
const env = { ...inherited, ...runtimeEnv(config), OPENCODE_CONFIG_DIR:nativeConfig,
  XDG_CONFIG_HOME:nativeConfig, XDG_DATA_HOME:path.join(smokeRoot,'native-data'),
  XDG_CACHE_HOME:path.join(smokeRoot,'cache'), XDG_STATE_HOME:path.join(smokeRoot,'state'),
  OPENCODE_TEST_HOME:nativeHome, HOME:nativeHome, USERPROFILE:nativeHome,
  APPDATA:path.join(nativeHome,'AppData','Roaming'), LOCALAPPDATA:path.join(nativeHome,'AppData','Local'),
  TEMP:nativeTemp, TMP:nativeTemp };
let host, web, app, nativeClosed;
let proof;
let configWritten=false;
const dependencies=coldDependencies?'cold-unseeded':'installed-source';
const sentinel='{"$schema":"https://opencode.ai/config.json","autoupdate":false,"share":"disabled"}';
const previousEnv=Object.fromEntries(Object.keys(runtimeEnv(config)).map(key=>[key,process.env[key]]));
try {
  await Promise.all([nativeConfig,directory,nativeHome,nativeTemp,env.APPDATA,env.LOCALAPPDATA]
    .map(folder=>mkdir(folder,{recursive:true})));
  await writeFile(path.join(nativeConfig,'opencode.jsonc'),sentinel);
  configWritten=true;
  if (!coldDependencies) await seedNativeSmokeDependencies({fixtureRoot:smokeRoot,appRoot:config.appRoot,nativeConfig,projectDirectories:[directory]});
  console.log(JSON.stringify({stage:'native-smoke-starting',dependencies,hostRequestTimeoutMs:90000,apiTimeoutMs:60000}));
  assertFreshRuntimeRoot(config.dataRoot, config.runtimeID);
  const initialData = createLocalDataStore(config.dataRoot);
  try { initialData.initializeFreshRuntime(config.runtimeID); }
  finally { initialData.close(); }
  Object.assign(process.env, runtimeEnv(config));
  const nodeDriver=observeStorageDriver(config.backendRoot);
  host = await startHost({backendRoot:config.backendRoot,config,env,
    ...(process.env.FREELANCER_SMOKE_DIAGNOSTICS==='1' ? {diagnostics:event=>console.log(JSON.stringify(event))} : {}),
    ...(process.env.FREELANCER_SMOKE_OPENCODE ? {executable:process.env.FREELANCER_SMOKE_OPENCODE} : {})});
  // Observe close before any native API request: exit alone does not establish
  // that the child's pipe handles have closed on Windows.
  nativeClosed=new Promise(resolve=>host.process.once('close',(code,signal)=>resolve({code,signal})));
  console.log('Native smoke: disposable OpenCode server started.');
  const agents = await host.request('/agent', {directory});
  console.log('Native smoke: named agent catalog loaded.');
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
  const nativeDriver=withUnifiedDatabase({dataHome:config.dataRoot,runtimeID:config.runtimeID},false,db=>
    db.prepare("SELECT data FROM operational_records WHERE collection='storage-drivers' AND id='bun:sqlite'").get());
  assert.ok(nativeDriver,'Native plugin must record its actual embedded Bun SQLite facilities.');
  console.log(JSON.stringify({storageDrivers:[nodeDriver,JSON.parse(nativeDriver.data)]}));
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
  const html = await fetch(web.url,{signal:AbortSignal.timeout(60000)}).then(response=>response.text());
  assert.match(html,/<div id="root"/);
  const script = html.match(/src="([^"]+\.js)"/);
  assert.ok(script,'Built frontend asset missing');
  assert.equal((await fetch(web.url+script[1],{signal:AbortSignal.timeout(60000)})).status,200);
  const bootstrap = await fetch(web.url+'/api/bootstrap',{headers:{'X-Freelancer-Client':'webpage'},signal:AbortSignal.timeout(60000)});
  assert.equal(bootstrap.status,200);
  assert.ok((await bootstrap.json()).settings.agents.some(agent=>agent.id==='engineer'));
  assert.equal(await readFile(path.join(nativeConfig,'opencode.jsonc'),'utf8'),sentinel);
  proof={verified:'Disposable native startup, unified runtime registration, named agents, actual shared skills/tools, empty optional MCP inventory, built UI assets and bootstrap',
    dependencies,nativeVersion:host.nativeVersion,nativeConfigSha256:createHash('sha256').update(sentinel).digest('hex'),source:sourcesBefore,
    inference:'not-run',providerSignIn:'not-run'};
} finally {
  if (web) {web.server.closeAllConnections(); await new Promise(resolve=>web.server.close(resolve));}
  await app?.indexJobs?.close();
  await app?.history?.close();
  try {await app?.store.flush();} catch {}
  await app?.modelRatings?.close();
  await app?.gitProjects?.close();
  app?.localData?.close();
  if (host?.process&&host.process.exitCode===null&&host.process.signalCode===null) {
    await host.request('/global/dispose',{method:'POST',signal:AbortSignal.timeout(5000)}).catch(()=>{});
    if (host.process.exitCode===null&&host.process.signalCode===null) {
      host.stop();
    }
  }
  if (nativeClosed) await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error(`Native fixture process close could not be confirmed; preserved disposable data at ${smokeRoot}`)),10000);
    nativeClosed.then(value=>{clearTimeout(timeout);resolve(value);});
  });
  if (host?.process) assert.ok(host.process.exitCode!==null||host.process.signalCode!==null,'Native fixture process has not exited');
  if (configWritten) assert.equal(await readFile(path.join(nativeConfig,'opencode.jsonc'),'utf8'),sentinel,`Native config changed; preserved disposable data at ${smokeRoot}`);
  assert.deepEqual(await sourceFingerprint(config.appRoot),sourcesBefore,`Source inputs changed; preserved disposable data at ${smokeRoot}`);
  const resolved=path.resolve(smokeRoot), parent=path.resolve(os.tmpdir())+path.sep;
  if (!resolved.startsWith(parent)||!path.basename(resolved).startsWith('freelancer-native-smoke-')) throw Error('Unsafe temporary cleanup path');
  try { await rm(resolved,{recursive:true,force:true,maxRetries:8,retryDelay:150}); }
  finally {
    for (const [key,value] of Object.entries(previousEnv)) {
      if (value===undefined) delete process.env[key]; else process.env[key]=value;
    }
  }
  console.log(JSON.stringify({stage:'native-smoke-cleanup',nativePID:host?.process?.pid??null,processCloseConfirmed:Boolean(nativeClosed),
    nativeConfigUnchanged:configWritten?true:'not-written',sourceUnchanged:true,temporaryDataRemoved:true}));
}
console.log(JSON.stringify({...proof,processesClosed:true,temporaryDataRemoved:true}));
}

if (process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const options=parseRuntimeSmokeOptions(process.argv.slice(2));
  if (options.help) console.log('Usage: node scripts/smoke-runtime.mjs [--cold-dependencies]\nDefault: installed source dependencies. Cold mode: no dependency seeding; existing 90s host request deadline.');
  else await runRuntimeSmoke(options);
}
