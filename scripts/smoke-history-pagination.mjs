// Real native pagination, using only disposable empty conversations. No inference.
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { startHost } from '../server/host.mjs';
import { createHistoryService } from '../server/history.mjs';
import { createLocalDataStore } from '../server/data/store.mjs';
import { FRESH_RUNTIME_ID, runtimeEnv } from '../server/runtime-config.mjs';
import { seedNativeSmokeDependencies } from './native-smoke-fixture.mjs';

const fixtureRoot=await mkdtemp(path.join(os.tmpdir(),'freelancer-history-pagination-'));
const backendRoot=path.join(fixtureRoot,'backend'),directory=path.join(fixtureRoot,'project'),nativeConfig=path.join(fixtureRoot,'native-config');
const nativeHome=path.join(fixtureRoot,'native-home'),nativeTemp=path.join(fixtureRoot,'native-temp');
const config={backendRoot,dataRoot:path.join(fixtureRoot,'data'),runtimeID:FRESH_RUNTIME_ID,opencodePlugins:[],instructions:[]};
const inherited=Object.fromEntries(Object.entries(process.env).filter(([key])=>
  /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|TEMP|TMP|USERPROFILE|HOME|APPDATA|LOCALAPPDATA|PROGRAMFILES(?:\(X86\))?|COMSPEC|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i.test(key)));
const env={...inherited,...runtimeEnv(config),OPENCODE_CONFIG_DIR:nativeConfig,XDG_CONFIG_HOME:nativeConfig,
  XDG_DATA_HOME:path.join(fixtureRoot,'native-data'),XDG_CACHE_HOME:path.join(fixtureRoot,'cache'),XDG_STATE_HOME:path.join(fixtureRoot,'state'),
  OPENCODE_TEST_HOME:nativeHome,HOME:nativeHome,USERPROFILE:nativeHome,
  APPDATA:path.join(nativeHome,'AppData','Roaming'),LOCALAPPDATA:path.join(nativeHome,'AppData','Local'),TEMP:nativeTemp,TMP:nativeTemp};
let host,history,store;
const stop=async()=>{
  if(!host?.process||host.process.exitCode!==null||host.process.signalCode!==null)return;
  await host.request('/global/dispose',{method:'POST',signal:AbortSignal.timeout(5000)}).catch(()=>{});
  const exited=once(host.process,'exit');host.stop();await exited;
};
const start=()=>startHost({backendRoot,config,env,
  ...(process.env.FREELANCER_SMOKE_OPENCODE?{executable:process.env.FREELANCER_SMOKE_OPENCODE}:{})});
const read=(route,options={})=>host.request(route,{directory,signal:AbortSignal.timeout(15_000),...options});
try {
  await Promise.all([backendRoot,directory,nativeConfig,nativeHome,nativeTemp,env.APPDATA,env.LOCALAPPDATA]
    .map(folder=>mkdir(folder,{recursive:true})));
  await writeFile(path.join(nativeConfig,'opencode.jsonc'),' {"autoupdate":false,"share":"disabled"}\n');
  await seedNativeSmokeDependencies({fixtureRoot,appRoot:fileURLToPath(new URL('..',import.meta.url)),nativeConfig,projectDirectories:[backendRoot,directory]});
  store=createLocalDataStore(config.dataRoot);store.initializeFreshRuntime(config.runtimeID);
  host=await start();
  const health=await read('/global/health');assert.equal(health.version,'1.18.31');
  const sessions=[];
  for(let index=0;index<5;index++)sessions.push(await read('/session',{method:'POST',body:{title:`Pagination fixture ${index}`,
    ...(index===2?{parentID:sessions[0].id}:{})}}));
  await read(`/session/${sessions[1].id}`,{method:'PATCH',body:{time:{archived:1000}}});
  const nativeFilename=await host.databasePath();
  await stop();
  const nativeResolved=await realpath(nativeFilename),rootResolved=await realpath(fixtureRoot);
  const relative=path.relative(rootResolved,nativeResolved);
  if(!relative||relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw Error('Pagination fixture native database escaped its disposable root.');
  // Force a deterministic equal-time group only in this stopped, fixture-owned
  // native database. Production reads use the actual native HTTP API below.
  const native=new DatabaseSync(nativeResolved);
  try {
    const columns=new Set(native.prepare('PRAGMA table_info(session)').all().map(row=>row.name));
    for(const column of ['id','time_updated'])assert.ok(columns.has(column),`Unsupported native session schema: ${column}`);
    native.exec('BEGIN IMMEDIATE');
    try {
      for(let index=0;index<sessions.length;index++)
        assert.equal(native.prepare('UPDATE session SET time_updated=? WHERE id=?').run(index===0?900:index===4?700:800,sessions[index].id).changes,1);
      native.exec('COMMIT');
    } catch(error) {native.exec('ROLLBACK');throw error;}
  } finally {native.close();}
  host=await start();
  const latest=await read('/session?limit=2'),startOne=await read('/session?limit=2&start=1');
  assert.deepEqual(startOne.map(row=>row.id),latest.map(row=>row.id),'Native start is not an offset.');
  const lowerBound=await read('/session?limit=100&start=800');
  assert.ok(lowerBound.length>=3);assert.ok(lowerBound.every(row=>row.time.updated>=800));
  const newest=await read('/experimental/session?archived=true&limit=2',{responseMetadata:true});
  assert.equal(newest.metadata['x-next-cursor'],'800');
  const older=await read('/experimental/session?archived=true&limit=100&cursor=800');
  assert.deepEqual(older.map(row=>row.id),[sessions[4].id]);
  const siblings=await read('/experimental/session?archived=true&limit=100&start=800&cursor=801',{responseMetadata:true});
  assert.equal(siblings.metadata['x-next-cursor'],null);assert.equal(siblings.body.length,3);
  assert.ok(siblings.body.every(row=>row.time.updated===800));
  assert.ok(siblings.body.some(row=>row.id===sessions[1].id&&row.time.archived===1000));
  assert.ok(siblings.body.some(row=>row.id===sessions[2].id&&row.parentID===sessions[0].id));
  const project={id:'native-pagination-project',name:'Native pagination fixture',directory};
  const app={store:{async read(){return {projects:[project]};}},async project(){return project;},indexJobs:null};
  history=createHistoryService({app,host:{...host,request:(route,options)=>read(route,options)},backendRoot,dataRoot:config.dataRoot,localData:{get:()=>store}});
  const captured=await history.backfillOpenCode({projectID:project.id,pageSize:2,signal:AbortSignal.timeout(30_000)});
  assert.equal(captured.results[0].status,'complete',JSON.stringify(captured.results[0]));
  assert.equal(captured.results[0].capturedSessions,5);assert.equal(captured.results[0].cursor,null);
  for(const session of sessions)assert.equal(store.readOpenCodeSession({projectID:project.id,sessionID:session.id}).status,'ok');
  assert.equal(store.openCodeCoverage()[0].sessions,5);
  assert.ok(store.searchChats(sessions[4].id,{project:project.id}).some(hit=>hit.session===sessions[4].id));
  assert.ok((await history.searchChats(sessions[4].id,{project:project.id})).results.some(hit=>hit.session===sessions[4].id));
  console.log('OpenCode 1.18.31 native HTTP confirmed start as an inclusive updated-time lower bound, exclusive experimental cursor, x-next-cursor, archived/child inclusion, durable pageSize=2 capture of every equal-time sibling, and common search retrieval of the oldest backfilled conversation. Fixture timestamps were set only while its disposable native database was stopped. Installed dependencies; no credentials or model inference.');
} finally {
  await history?.close();store?.close();await stop();
  const resolved=path.resolve(fixtureRoot),temporary=path.resolve(os.tmpdir())+path.sep;
  if(!resolved.toLowerCase().startsWith(temporary.toLowerCase())||!path.basename(resolved).startsWith('freelancer-history-pagination-'))throw Error('Unsafe native pagination fixture cleanup path.');
  await rm(resolved,{recursive:true,force:true,maxRetries:8,retryDelay:150});
}
