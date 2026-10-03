// Disposable startup diagnostics. No model inference or user configuration changes.
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { startHost } from '../server/host.mjs';
import { resolveRuntimeConfig, runtimeEnv } from '../server/runtime-config.mjs';
import { createLocalDataStore } from '../server/data/store.mjs';
import { withUnifiedDatabase } from '../backend/tools/runtime/unified-database.mjs';
import { seedNativeSmokeDependencies } from './native-smoke-fixture.mjs';

const seed = process.argv.includes('--seed-dependencies');
const nativeOnly = process.argv.includes('--native-only');
const emptyPlugin = process.argv.includes('--empty-plugin');
const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-native-diagnostic-'));
const logfile = path.join(os.tmpdir(), `freelancer-native-diagnostic-${randomUUID()}.jsonl`);
const config = { ...resolveRuntimeConfig(), dataRoot: path.join(root, 'data') };
if(nativeOnly) {config.opencodePlugins=[];config.instructions=[];}
if(emptyPlugin) {config.opencodePlugins=[path.join(root,'empty-plugin.ts')];config.instructions=[];}
const directory = path.join(root, 'project'), native = path.join(root, 'native-config');
const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|TEMP|TMP|USERPROFILE|HOME|APPDATA|LOCALAPPDATA|PROGRAMFILES(?:\(X86\))?|COMSPEC|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i.test(name)));
const env = { ...inherited, ...runtimeEnv(config), OPENCODE_CONFIG_DIR: native,
  XDG_CONFIG_HOME: native, XDG_DATA_HOME: path.join(root, 'native-data'), XDG_CACHE_HOME: path.join(root, 'cache'), XDG_STATE_HOME: path.join(root, 'state') };
let host;
const events = [];
const diagnostics = event => { events.push(event); appendFileSync(logfile, JSON.stringify(event) + '\n'); };
console.log(JSON.stringify({ log: logfile, fixtureRoot:root,seedDependencies: seed,nativeOnly,emptyPlugin }));
try {
  await mkdir(directory); await mkdir(native);
  await writeFile(path.join(native, 'opencode.jsonc'), '{"autoupdate":false,"share":"disabled"}');
  if(emptyPlugin) await writeFile(config.opencodePlugins[0],'export default async () => ({});\n');
  if (seed) {
    await seedNativeSmokeDependencies({fixtureRoot:root,appRoot:config.appRoot,nativeConfig:native,projectDirectories:[directory]});
  }
  const store = createLocalDataStore(config.dataRoot);
  try { store.initializeFreshRuntime(config.runtimeID); } finally { store.close(); }
  host = await startHost({ backendRoot: config.backendRoot, config, env, diagnostics });
  const agents = await host.request('/agent', { directory, signal: AbortSignal.timeout(45_000) });
  console.log(JSON.stringify({ stage: 'agent-ready', agents: agents.length }));
  const tools = await host.request('/experimental/tool/ids', { directory, signal: AbortSignal.timeout(10_000) });
  console.log(JSON.stringify({ stage: 'tools-ready', tools }));
  const drivers=withUnifiedDatabase({dataHome:config.dataRoot,runtimeID:config.runtimeID},false,(db,runtimeID)=>
    db.prepare("SELECT data FROM operational_records WHERE runtime_id=? AND collection='storage-drivers' ORDER BY id").all(runtimeID).map(row=>JSON.parse(row.data)));
  console.log(JSON.stringify({stage:'storage-drivers',drivers}));
} catch (error) {
  console.log(JSON.stringify({ stage: 'failed', error: error.name, message: error.message }));
  process.exitCode = 1;
} finally {
  const dependencies=await Promise.all([native,path.join(native,'opencode'),path.join(directory,'.opencode')].map(async destination=>{
    const pkg=await readFile(path.join(destination,'package.json'),'utf8').then(JSON.parse).catch(()=>null);
    const lock=await readFile(path.join(destination,'package-lock.json'),'utf8').then(JSON.parse).catch(()=>null);
    const modules=await readdir(path.join(destination,'node_modules')).catch(()=>null);
    return {directory:path.relative(root,destination),declared:pkg?Object.keys(pkg.dependencies??{}):null,
      locked:lock?Object.keys(lock.packages?.['']?.dependencies??{}):null,moduleEntries:modules?.length??null};
  }));
  console.log(JSON.stringify({stage:'dependency-files',dependencies}));
  if (host) {
    const exited = once(host.process, 'exit'); host.stop();
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000).unref())]);
  }
  const resolved = path.resolve(root), temporary = path.resolve(os.tmpdir()) + path.sep;
  if (!resolved.toLowerCase().startsWith(temporary.toLowerCase()) || !path.basename(resolved).startsWith('freelancer-native-diagnostic-'))
    throw Error('Diagnostic cleanup target is outside its disposable directory.');
  await rm(root, { recursive: true, force: true });
  const output = events.filter(event => event.stage === 'output').flatMap(event => event.text.split(/\r?\n/)).filter(Boolean);
  console.log(JSON.stringify({ log: logfile, stages: events.filter(event => event.stage !== 'output'), lastNativeLines: output.slice(-8) }));
}
