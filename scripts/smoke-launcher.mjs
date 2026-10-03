// Real Windows launcher lifecycle with fresh app/native stores and no browser window.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp,mkdir,readFile,writeFile,rm,access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { readRuntimeText } from '../backend/tools/runtime/state-database.mjs';
import { FRESH_RUNTIME_ID } from '../server/runtime-config.mjs';
import { createServer } from 'node:net';
import { seedNativeSmokeDependencies } from './native-smoke-fixture.mjs';

const exec=promisify(execFile);
if (process.platform!=='win32') throw Error('This smoke verifies the Windows PowerShell launcher.');
const root=fileURLToPath(new URL('../',import.meta.url)),state=path.join(root,'backend','.state','webpage');
try { await access(path.join(state,'application.lock')); throw Error('This checkout already has a server lock. Stop its server before the disposable launcher smoke.'); }
catch(error) { if(error.code!=='ENOENT') throw error; }
const temporary=await mkdtemp(path.join(os.tmpdir(),'freelancer-launcher-smoke-'));
const nativeConfig=path.join(temporary,'native-config'),dataRoot=path.join(temporary,'workspace-v2'),projectDirectory=path.join(temporary,'project');
const nativeHome=path.join(temporary,'native-home'),nativeTemp=path.join(temporary,'native-temp');
const portProbe=createServer();
await new Promise((resolve,reject)=>{portProbe.once('error',reject);portProbe.listen(0,'127.0.0.1',resolve);});
const webPort=portProbe.address().port;
await new Promise(resolve=>portProbe.close(resolve));
const inherited=Object.fromEntries(Object.entries(process.env).filter(([key])=>
  /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|TEMP|TMP|USERPROFILE|HOME|APPDATA|LOCALAPPDATA|PROGRAMFILES(?:\(X86\))?|COMSPEC|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i.test(key)));
const env={...inherited,FREELANCER_DATA_HOME:dataRoot,FREELANCER_RUNTIME_DATA_MODE:'unified',FREELANCER_RUNTIME_ID:FRESH_RUNTIME_ID,FREELANCER_WEB_PORT:String(webPort),OPENCODE_CONFIG_DIR:nativeConfig,XDG_CONFIG_HOME:nativeConfig,
  XDG_DATA_HOME:path.join(temporary,'native-data'),XDG_CACHE_HOME:path.join(temporary,'cache'),XDG_STATE_HOME:path.join(temporary,'native-state'),
  OPENCODE_TEST_HOME:nativeHome,HOME:nativeHome,USERPROFILE:nativeHome,
  APPDATA:path.join(nativeHome,'AppData','Roaming'),LOCALAPPDATA:path.join(nativeHome,'AppData','Local'),TEMP:nativeTemp,TMP:nativeTemp};
// The app's usual npm-native lookup uses APPDATA. Keep that directory private
// and let the unchanged PowerShell resolver find the installed executable on PATH.
const nativeExecutable=path.join(process.env.APPDATA||'','npm','node_modules','opencode-ai','bin','opencode.exe');
const pathKey=Object.keys(env).find(key=>key.toUpperCase()==='PATH')||'PATH';
const launchFile=path.join(state,'launch.json');
const run=script=>exec('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts',script),...(script==='stop-web.ps1'?[]:['-NoBrowser'])],{cwd:root,env,timeout:90000,windowsHide:true});
let started=false;
const previousEnv=Object.fromEntries(['FREELANCER_DATA_HOME','FREELANCER_RUNTIME_ID','FREELANCER_RUNTIME_DATA_MODE'].map(key=>[key,process.env[key]]));
const api=async(url,route,body)=>{
  const response=await fetch(new URL('/api/'+route,url),{method:body?'POST':'GET',headers:{'X-Freelancer-Client':'webpage','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
  assert.equal(response.status,200);return response.json();
};
try {
  await access(nativeExecutable);
  env[pathKey]=path.dirname(nativeExecutable)+path.delimiter+(env[pathKey]||'');
  await Promise.all([nativeConfig,projectDirectory,nativeHome,nativeTemp,env.APPDATA,env.LOCALAPPDATA]
    .map(directory=>mkdir(directory,{recursive:true})));
  const sentinel='{"$schema":"https://opencode.ai/config.json","autoupdate":false,"share":"disabled","compaction":{"auto":true,"prune":false,"reserved":4096}}';
  await writeFile(path.join(nativeConfig,'opencode.jsonc'),sentinel);
  await seedNativeSmokeDependencies({fixtureRoot:temporary,appRoot:root,nativeConfig,projectDirectories:[projectDirectory]});
  started=true;
  const first=await run('launch-web.ps1');
  const url=first.stdout.trim().split(/\r?\n/).find(line=>/^http:\/\/127\.0\.0\.1:\d+/.test(line));assert.ok(url);
  const bootstrap=await api(url,'bootstrap');assert.deepEqual(bootstrap.settings.projects,[]);
  const project=await api(url,'projects',{directory:projectDirectory});
  process.env.FREELANCER_DATA_HOME=dataRoot;
  process.env.FREELANCER_RUNTIME_ID=FRESH_RUNTIME_ID;
  process.env.FREELANCER_RUNTIME_DATA_MODE='unified';
  const readLaunch=async()=>JSON.parse(await readRuntimeText(launchFile,'utf8'));
  const launchBefore=await readLaunch();
  assert.equal(launchBefore.appRoot,path.resolve(root));
  const dataBytesBefore=await readFile(path.join(dataRoot,'freelancer.sqlite'));
  assert.equal(dataBytesBefore.subarray(0,15).toString(),'SQLite format 3');
  await run('restart-web.ps1');
  const launchAfter=await readLaunch();
  assert.notEqual(launchAfter.pid,launchBefore.pid);
  assert.equal((await api(launchAfter.url,'bootstrap')).settings.projects[0].id,project.id);
  assert.equal(await readFile(path.join(nativeConfig,'opencode.jsonc'),'utf8'),sentinel);
  await run('stop-web.ps1');started=false;
  await assert.rejects(readRuntimeText(launchFile,'utf8'),{code:'ENOENT'});
  await assert.rejects(access(path.join(state,'application.lock')),{code:'ENOENT'});
  console.log(JSON.stringify({verified:'Windows launcher fresh start, native project registration, restart persistence and graceful shutdown',
    namespace:'workspace-v2',dependencies:'installed-source',nativeConfigSha256:createHash('sha256').update(sentinel).digest('hex'),inference:'not-run',browserWindow:'not-opened'}));
} finally {
  if(started) {
    try { await run('stop-web.ps1'); }
    catch(error) { throw Error(`Launcher smoke could not stop its server; preserved disposable data at ${temporary}: ${error.message}`); }
  }
  const resolved=path.resolve(temporary),parent=path.resolve(os.tmpdir())+path.sep;
  if(!resolved.startsWith(parent)||!path.basename(resolved).startsWith('freelancer-launcher-smoke-')) throw Error('Refusing unexpected smoke cleanup path.');
  await rm(resolved,{recursive:true,force:true,maxRetries:8,retryDelay:200});
  for (const [key,value] of Object.entries(previousEnv)) {
    if(value===undefined) delete process.env[key]; else process.env[key]=value;
  }
}
