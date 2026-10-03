// Disposable native project configuration check. No credentials or inference.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { parse } from 'jsonc-parser';
import { startHost } from '../server/host.mjs';
import { createContextSettings } from '../server/context-settings.mjs';
import { FRESH_RUNTIME_ID, runtimeEnv } from '../server/runtime-config.mjs';
import { assertFreshRuntimeRoot, createLocalDataStore } from '../server/data/store.mjs';

const tempRoot = await mkdtemp(path.join(os.tmpdir(),'freelancer-context-smoke-'));
const root=path.join(tempRoot,'backend'), directory=path.join(tempRoot,'project');
const nativeConfig=path.join(tempRoot,'native-config');
const config={backendRoot:root,opencodePlugins:[],instructions:[],dataRoot:path.join(tempRoot,'user-data'),runtimeID:FRESH_RUNTIME_ID};
const inherited=Object.fromEntries(Object.entries(process.env).filter(([key])=>
  /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|TEMP|TMP|USERPROFILE|HOME|APPDATA|LOCALAPPDATA|PROGRAMFILES(?:\(X86\))?|COMSPEC|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i.test(key)));
const env={...inherited,...runtimeEnv(config),OPENCODE_CONFIG_DIR:nativeConfig,XDG_CONFIG_HOME:nativeConfig,
  XDG_DATA_HOME:path.join(tempRoot,'native-data'),XDG_CACHE_HOME:path.join(tempRoot,'cache'),XDG_STATE_HOME:path.join(tempRoot,'state')};
let host;
try {
  await mkdir(root,{recursive:true}); await mkdir(nativeConfig,{recursive:true}); await mkdir(directory);
  assertFreshRuntimeRoot(config.dataRoot,config.runtimeID);
  const initial=createLocalDataStore(config.dataRoot);
  try {initial.initializeFreshRuntime(config.runtimeID);} finally {initial.close();}
  await writeFile(path.join(nativeConfig,'opencode.json'),JSON.stringify({autoupdate:false,share:'disabled'}));
  // Put sibling options in the same native project file: global deep merge must
  // not mask accidental replacement of the whole project compaction object.
  const projectFile=path.join(directory,'opencode.jsonc');
  await writeFile(projectFile,'{\n  // User compaction policy\n  "compaction": { "auto": true, "prune": false, "reserved": 8192 },\n}\n');
  const project={id:'context-smoke',name:'Isolated context check',directory};
  const start=()=>startHost({backendRoot:root,config,env,
    ...(process.env.FREELANCER_SMOKE_OPENCODE?{executable:process.env.FREELANCER_SMOKE_OPENCODE}:{})});
  host=await start();
  let locked=false;
  const service=createContextSettings({host,project:async()=>project,canRefresh:()=>!locked,setRefreshing:value=>{locked=value;}});
  assert.equal((await service.read(project.id)).autoCompact,true);
  assert.equal((await service.save(project.id,{autoCompact:false})).autoCompact,false);
  const saved=await readFile(projectFile,'utf8');
  assert.deepEqual(parse(saved).compaction,{auto:false,prune:false,reserved:8192});
  assert.match(saved,/User compaction policy/);
  let native=await host.request('/config',{directory});
  assert.equal(native.compaction.auto,false); assert.equal(native.compaction.prune,false); assert.equal(native.compaction.reserved,8192);
  await host.request('/global/dispose',{method:'POST'});
  const stopped=once(host.process,'exit'); host.stop(); await stopped;
  host=await start();
  native=await host.request('/config',{directory});
  assert.equal(native.compaction.auto,false); assert.equal(native.compaction.prune,false); assert.equal(native.compaction.reserved,8192);
  console.log('Disposable OpenCode confirmed project compaction persistence across restart and preserved JSONC comments, pruning and reserved context. No credentials or inference used.');
} finally {
  if (host?.process&&host.process.exitCode===null&&host.process.signalCode===null) {
    await host.request('/global/dispose',{method:'POST',signal:AbortSignal.timeout(5000)}).catch(()=>{});
    const stopped=once(host.process,'exit'); host.stop(); await stopped;
  }
  const resolved=path.resolve(tempRoot),parent=path.resolve(os.tmpdir())+path.sep;
  if(!resolved.startsWith(parent)||!path.basename(resolved).startsWith('freelancer-context-smoke-')) throw Error('Unsafe temporary cleanup path');
  await rm(resolved,{recursive:true,force:true,maxRetries:8,retryDelay:150});
}
