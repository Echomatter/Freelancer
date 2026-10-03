// Real Windows launcher lifecycle with fresh app/native stores and no browser window.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp,mkdir,readFile,readdir,writeFile,rm,access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { readRuntimeText } from '../backend/tools/runtime/state-database.mjs';
import { FRESH_RUNTIME_ID } from '../server/runtime-config.mjs';
import { createServer } from 'node:net';
import { seedNativeSmokeDependencies } from './native-smoke-fixture.mjs';

const exec=promisify(execFile);
export function parseLauncherSmokeOptions(args) {
  const options={coldDependencies:false,help:false};
  for (const argument of args) {
    if (argument==='--cold-dependencies' && !options.coldDependencies) options.coldDependencies=true;
    else if (argument==='--help' && !options.help) options.help=true;
    else throw Error(`Unknown or repeated launcher smoke argument: ${argument}`);
  }
  return options;
}

export function launcherDescendantWalk(rootPID,{maxDescendants=4096}={}) {
  assert.ok(Number.isInteger(rootPID)&&rootPID>0&&rootPID<=2147483647,'Expected a positive process ID');
  assert.ok(Number.isInteger(maxDescendants)&&maxDescendants>0&&maxDescendants<=4096,'Invalid descendant bound');
  // $rows is a single snapshot supplied by the caller. Explicit queue/visited
  // collections avoid PowerShell's @($empty.Property) producing @($null).
  return `
$seen=[System.Collections.Generic.HashSet[int]]::new()
[void]$seen.Add(${rootPID})
$pending=[System.Collections.Generic.Queue[int]]::new()
$pending.Enqueue(${rootPID})
$found=[System.Collections.Generic.List[object]]::new()
while ($pending.Count -gt 0) {
  $parentID=$pending.Dequeue()
  foreach ($row in $rows) {
    if ([int]$row.ParentProcessId -ne $parentID) { continue }
    $childID=[int]$row.ProcessId
    if ($childID -le 0 -or -not $seen.Add($childID)) { continue }
    if ($found.Count -ge ${maxDescendants}) { throw 'Launcher process descendant limit exceeded.' }
    $found.Add($row)
    $pending.Enqueue($childID)
  }
}
ConvertTo-Json -InputObject @($found.ToArray()) -Compress`;
}

export async function readDescendants(rootPID,{env,cwd,execImpl=exec}={}) {
  // Query identity fields once. Native command lines can contain authentication;
  // they are deliberately absent from both the inventory and JSON receipt.
  const script="$ErrorActionPreference='Stop'\n$rows=@(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name | Select-Object ProcessId,ParentProcessId,Name)\n"+launcherDescendantWalk(rootPID);
  const {stdout}=await execImpl('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{env,cwd,timeout:10000,windowsHide:true});
  const rows=JSON.parse(stdout);
  assert.ok(Array.isArray(rows),'Expected descendant identity array');
  return rows;
}

export async function launcherSmokeAPI(url,route,body,{fetchImpl=fetch,report=event=>console.log(JSON.stringify(event))}={}) {
  const method=body?'POST':'GET';
  const name='/api/'+route.split('?')[0];
  const startedAt=Date.now(),timeoutMs=60000;
  report({stage:'launcher-api-starting',route:name,method,timeoutMs});
  try {
    const response=await fetchImpl(new URL('/api/'+route,url),{method,
      headers:{'X-Freelancer-Client':'webpage','Content-Type':'application/json'},
      body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeoutMs)});
    report({stage:'launcher-api-responded',route:name,method,status:response.status,durationMs:Date.now()-startedAt});
    assert.equal(response.status,200);
    return await response.json();
  } catch (error) {
    report({stage:'launcher-api-failed',route:name,method,timeoutMs,durationMs:Date.now()-startedAt,error:error.name});
    throw error;
  }
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

export async function runLauncherSmoke({coldDependencies=false}={}) {
if (process.platform!=='win32') throw Error('This smoke verifies the Windows PowerShell launcher.');
const root=fileURLToPath(new URL('../',import.meta.url)),state=path.join(root,'backend','.state','webpage');
try { await access(path.join(state,'application.lock')); throw Error('This checkout already has a server lock. Stop its server before the disposable launcher smoke.'); }
catch(error) { if(error.code!=='ENOENT') throw error; }
const sourcesBefore=await sourceFingerprint(root);
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
let proof;
let configWritten=false;
const dependencies=coldDependencies?'cold-unseeded':'installed-source';
const sentinel='{"$schema":"https://opencode.ai/config.json","autoupdate":false,"share":"disabled","compaction":{"auto":true,"prune":false,"reserved":4096}}';
const recordedProcesses=new Set();
const rememberProcessTree=async pid=>{
  assert.ok(Number.isInteger(pid)&&pid>0,'Launcher must report its actual server PID');
  recordedProcesses.add(pid);
  const descendants=await readDescendants(pid,{env,cwd:root});
  for (const row of descendants) recordedProcesses.add(row.ProcessId);
  console.log(JSON.stringify({stage:'launcher-owned-processes',serverPID:pid,
    descendants:descendants.map(row=>({pid:row.ProcessId,parentPID:row.ParentProcessId,name:row.Name}))}));
  assert.ok(descendants.some(row=>/^opencode.*\.exe$/i.test(row.Name)),'Launcher must own an actual native OpenCode process');
};
const assertProcessesClosed=async()=>{
  const deadline=Date.now()+10000;
  while (true) {
    const running=[...recordedProcesses].filter(pid=>{
      try { process.kill(pid,0); return true; }
      catch(error) { if(error.code==='ESRCH') return false; throw error; }
    });
    if (!running.length) return;
    assert.ok(Date.now()<deadline,`Fixture processes are still running: ${running.join(', ')}`);
    await new Promise(resolve=>setTimeout(resolve,100));
  }
};
const previousEnv=Object.fromEntries(['FREELANCER_DATA_HOME','FREELANCER_RUNTIME_ID','FREELANCER_RUNTIME_DATA_MODE'].map(key=>[key,process.env[key]]));
const api=launcherSmokeAPI;
try {
  await access(nativeExecutable);
  env[pathKey]=path.dirname(nativeExecutable)+path.delimiter+(env[pathKey]||'');
  await Promise.all([nativeConfig,projectDirectory,nativeHome,nativeTemp,env.APPDATA,env.LOCALAPPDATA]
    .map(directory=>mkdir(directory,{recursive:true})));
  await writeFile(path.join(nativeConfig,'opencode.jsonc'),sentinel);
  configWritten=true;
  if (!coldDependencies) await seedNativeSmokeDependencies({fixtureRoot:temporary,appRoot:root,nativeConfig,projectDirectories:[projectDirectory]});
  console.log(JSON.stringify({stage:'launcher-smoke-starting',dependencies,launcherTimeoutMs:90000,apiTimeoutMs:60000}));
  started=true;
  const first=await run('launch-web.ps1');
  process.env.FREELANCER_DATA_HOME=dataRoot;
  process.env.FREELANCER_RUNTIME_ID=FRESH_RUNTIME_ID;
  process.env.FREELANCER_RUNTIME_DATA_MODE='unified';
  const readLaunch=async()=>JSON.parse(await readRuntimeText(launchFile,'utf8'));
  const launchBefore=await readLaunch();
  assert.equal(launchBefore.appRoot,path.resolve(root));
  await rememberProcessTree(launchBefore.pid);
  const url=first.stdout.trim().split(/\r?\n/).find(line=>/^http:\/\/127\.0\.0\.1:\d+/.test(line));assert.ok(url);
  const bootstrap=await api(url,'bootstrap');assert.deepEqual(bootstrap.settings.projects,[]);
  const project=await api(url,'projects',{directory:projectDirectory});
  const capabilities=await api(url,`capabilities?project=${encodeURIComponent(project.id)}&agent=engineer`);
  assert.equal(capabilities.probes.ids.state,'observed','Native inventory must be observed');
  for (const name of ['delegate','content_index','git_project','knowledge','todowrite','goal_checkpoint'])
    assert.ok(capabilities.tools.some(tool=>tool.id===name&&tool.discovered===true),`Missing actual native tool ${name}`);
  const dataBytesBefore=await readFile(path.join(dataRoot,'freelancer.sqlite'));
  assert.equal(dataBytesBefore.subarray(0,15).toString(),'SQLite format 3');
  await run('restart-web.ps1');
  const launchAfter=await readLaunch();
  assert.notEqual(launchAfter.pid,launchBefore.pid);
  await rememberProcessTree(launchAfter.pid);
  assert.equal((await api(launchAfter.url,'bootstrap')).settings.projects[0].id,project.id);
  assert.equal(await readFile(path.join(nativeConfig,'opencode.jsonc'),'utf8'),sentinel);
  await run('stop-web.ps1');started=false;
  await assert.rejects(readRuntimeText(launchFile,'utf8'),{code:'ENOENT'});
  await assert.rejects(access(path.join(state,'application.lock')),{code:'ENOENT'});
  await assertProcessesClosed();
  assert.equal(await readFile(path.join(nativeConfig,'opencode.jsonc'),'utf8'),sentinel);
  assert.deepEqual(await sourceFingerprint(root),sourcesBefore,'Launcher smoke changed source inputs');
  proof={verified:'Windows launcher fresh start, native shared tools, project registration, restart persistence and actual process shutdown',
    namespace:'workspace-v2',dependencies,nativeConfigSha256:createHash('sha256').update(sentinel).digest('hex'),source:sourcesBefore,
    processIDs:[...recordedProcesses].sort((a,b)=>a-b),processesClosed:true,inference:'not-run',browserWindow:'not-opened'};
} finally {
  if(started) {
    try { await run('stop-web.ps1'); }
    catch(error) { throw Error(`Launcher smoke could not stop its server; preserved disposable data at ${temporary}: ${error.message}`); }
  }
  await assertProcessesClosed();
  await assert.rejects(access(launchFile),{code:'ENOENT'});
  await assert.rejects(access(path.join(state,'application.lock')),{code:'ENOENT'});
  if (configWritten) assert.equal(await readFile(path.join(nativeConfig,'opencode.jsonc'),'utf8'),sentinel,`Native config changed; preserved disposable data at ${temporary}`);
  assert.deepEqual(await sourceFingerprint(root),sourcesBefore,`Source inputs changed; preserved disposable data at ${temporary}`);
  const resolved=path.resolve(temporary),parent=path.resolve(os.tmpdir())+path.sep;
  if(!resolved.startsWith(parent)||!path.basename(resolved).startsWith('freelancer-launcher-smoke-')) throw Error('Refusing unexpected smoke cleanup path.');
  try { await rm(resolved,{recursive:true,force:true,maxRetries:8,retryDelay:200}); }
  finally {
    for (const [key,value] of Object.entries(previousEnv)) {
      if(value===undefined) delete process.env[key]; else process.env[key]=value;
    }
  }
  console.log(JSON.stringify({stage:'launcher-smoke-cleanup',processIDs:[...recordedProcesses].sort((a,b)=>a-b),
    processesClosed:true,launchRecordRemoved:true,lockRemoved:true,nativeConfigUnchanged:configWritten?true:'not-written',sourceUnchanged:true,temporaryDataRemoved:true}));
}
console.log(JSON.stringify({...proof,temporaryDataRemoved:true}));
}

if (process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const options=parseLauncherSmokeOptions(process.argv.slice(2));
  if (options.help) console.log('Usage: node scripts/smoke-launcher.mjs [--cold-dependencies]\nDefault: installed source dependencies. Cold mode: no dependency seeding; existing 90s launcher and 60s API deadlines.');
  else await runLauncherSmoke(options);
}
