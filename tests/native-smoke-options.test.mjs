import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseLauncherSmokeOptions,launcherDescendantWalk,readDescendants,launcherSmokeAPI,observeLauncherStartup } from '../scripts/smoke-launcher.mjs';
import { parseRuntimeSmokeOptions } from '../scripts/smoke-runtime.mjs';

const exec=promisify(execFile);
for (const [name,parse] of [['launcher',parseLauncherSmokeOptions],['runtime',parseRuntimeSmokeOptions]]) {
  test(`${name} smoke defaults to installed dependencies and selects cold mode explicitly`,()=>{
    assert.deepEqual(parse([]),{coldDependencies:false,help:false});
    assert.deepEqual(parse(['--cold-dependencies']),{coldDependencies:true,help:false});
    assert.deepEqual(parse(['--cold-dependencies','--help']),{coldDependencies:true,help:true});
  });
  test(`${name} smoke rejects unknown, valued, repeated and timeout arguments`,()=>{
    for (const args of [['--unknown'],['--cold-dependencies=true'],['--cold-dependencies','--cold-dependencies'],['--help','--help'],['--timeout','180000']])
      assert.throws(()=>parse(args),/Unknown or repeated/);
  });
  test(`${name} smoke help and invalid options exit before launching native processes`,async()=>{
    const script=fileURLToPath(new URL(`../scripts/smoke-${name}.mjs`,import.meta.url));
    const {stdout}=await exec(process.execPath,[script,'--help'],{timeout:15000,windowsHide:true});
    assert.match(stdout,/Usage:/);
    assert.match(stdout,/--cold-dependencies/);
    assert.match(stdout,/90s/);
    assert.doesNotMatch(stdout,/smoke-starting|verified/);
    await assert.rejects(exec(process.execPath,[script,'--unknown'],{timeout:15000,windowsHide:true}),error=>{
      assert.match(error.stderr,/Unknown or repeated/);
      assert.doesNotMatch(error.stdout,/smoke-starting|verified/);
      return error.code===1;
    });
  });
}

test('launcher descendant reader and API receipts preserve deadlines and omit private inputs',async()=>{
  let calls=0;
  const env={PATH:'fixture-path'};
  const rows=await readDescendants(1752,{env,cwd:'fixture-root',execImpl:async(command,args,options)=>{
    calls++;
    assert.equal(command,'powershell.exe');
    const script=args.at(-1);
    assert.equal((script.match(/Get-CimInstance/g)||[]).length,1);
    assert.match(script,/-Property ProcessId,ParentProcessId,Name/);
    assert.doesNotMatch(script,/CommandLine|Environment|\$env:/i);
    assert.match(script,/HashSet\[int\].*\n\[void\]\$seen\.Add\(1752\)/);
    assert.equal(options.timeout,10000);
    assert.equal(options.windowsHide,true);
    assert.equal(options.env,env);
    return {stdout:'[{"ProcessId":2,"ParentProcessId":1752,"Name":"opencode.exe"}]'};
  }});
  assert.equal(calls,1);
  assert.deepEqual(rows,[{ProcessId:2,ParentProcessId:1752,Name:'opencode.exe'}]);
  for (const rootPID of [0,-1,'1752',NaN,2147483648]) assert.throws(()=>launcherDescendantWalk(rootPID),/positive process ID/);
  const receipts=[];
  const failure=new DOMException('fixture-only-secret','TimeoutError');
  await assert.rejects(launcherSmokeAPI('http://user:fixture-only-secret@127.0.0.1:49156',
    'projects?project=fixture-only-secret',{directory:'fixture-only-secret'},{report:event=>receipts.push(event),fetchImpl:async(_url,options)=>{
      assert.equal(receipts[0].stage,'launcher-api-starting','Receipt must precede the actual request');
      assert.equal(receipts[0].timeoutMs,60000);
      assert.ok(options.signal instanceof AbortSignal);
      throw failure;
    }}),error=>error===failure);
  assert.deepEqual(receipts.map(event=>[event.stage,event.route,event.method]),[
    ['launcher-api-starting','/api/projects','POST'],['launcher-api-failed','/api/projects','POST'],
  ]);
  assert.equal(receipts[1].error,'TimeoutError');
  assert.doesNotMatch(JSON.stringify(receipts),/fixture-only-secret|49156|directory|http:/);
});

test('launcher startup observer records only the fresh lock owner and its native descendants',async()=>{
  let clock=0,settled=false,lockReads=0;
  const captured=[];
  const observation=await observeLauncherStartup({
    timeoutMs:1000,pollMs:10,now:()=>clock,
    sleep:async duration=>{clock+=duration;},
    readLock:async()=>++lockReads===1?null:{pid:4321,nonce:'fresh-lock-nonce'},
    readDescendants:async pid=>{
      assert.equal(pid,4321);
      settled=true;
      return [
        {ProcessId:9876,ParentProcessId:4321,Name:'opencode.exe'},
        {ProcessId:2222,ParentProcessId:9876,Name:'worker.exe'},
        {ProcessId:3333,ParentProcessId:9999,Name:'unrelated.exe'},
      ];
    },
    isSettled:()=>settled,onIdentity:identity=>captured.push(identity.pid),
  });
  assert.deepEqual(observation.processIDs,[4321,9876,2222]);
  assert.equal(observation.serverPID,4321);
  assert.equal(observation.nativeObserved,true);
  assert.equal(observation.launchSettled,true);
  assert.deepEqual(captured,[4321,9876,2222]);
});

test('launcher startup observer reports missing process identities as unobserved within its bound',async()=>{
  let clock=0;
  const observation=await observeLauncherStartup({
    timeoutMs:300,pollMs:100,now:()=>clock,
    sleep:async duration=>{clock+=duration;},
    readLock:async()=>null,readDescendants:async()=>[],isSettled:()=>false,
  });
  assert.deepEqual(observation.processIDs,[]);
  assert.equal(observation.serverPID,null);
  assert.equal(observation.nativeObserved,false);
  assert.equal(observation.timedOut,true);
  assert.ok(clock<=300);
  await assert.rejects(observeLauncherStartup({readLock:async()=>null,readDescendants:async()=>[],isSettled:()=>false,timeoutMs:10001}),/10 second bound/);
});

test('launcher startup observer stops waiting when launch exits before a lock appears',async()=>{
  const observation=await observeLauncherStartup({
    timeoutMs:1000,pollMs:10,readLock:async()=>null,readDescendants:async()=>[],isSettled:()=>true,
  });
  assert.deepEqual(observation.processIDs,[]);
  assert.equal(observation.launchSettled,true);
  assert.equal(observation.timedOut,false);
});

const walkFixture=async(rows,options)=>{
  const input=JSON.stringify(rows).replaceAll("'","''");
  const script=`$ErrorActionPreference='Stop'\n$rows='${input}' | ConvertFrom-Json\n`+launcherDescendantWalk(1752,options);
  return exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{timeout:10000,windowsHide:true});
};

test('PowerShell 5.1 descendant walk terminates for empty and leaf inventories',{skip:process.platform!=='win32'},async()=>{
  assert.deepEqual(JSON.parse((await walkFixture([])).stdout),[]);
  const leaf=[{ProcessId:1752,ParentProcessId:99,Name:'node.exe'}];
  assert.deepEqual(JSON.parse((await walkFixture(leaf)).stdout),[]);
});

test('PowerShell 5.1 descendant walk excludes root cycles, duplicates and unrelated processes',{skip:process.platform!=='win32'},async()=>{
  const rows=[
    {ProcessId:1752,ParentProcessId:1752,Name:'node.exe'},
    {ProcessId:2,ParentProcessId:1752,Name:'opencode.exe'},
    {ProcessId:3,ParentProcessId:2,Name:'node.exe'},
    {ProcessId:3,ParentProcessId:2,Name:'node.exe'},
    {ProcessId:4,ParentProcessId:3,Name:'worker.exe'},
    {ProcessId:1752,ParentProcessId:4,Name:'node.exe'},
    {ProcessId:9,ParentProcessId:99,Name:'unowned.exe'},
  ];
  const found=JSON.parse((await walkFixture(rows)).stdout);
  assert.deepEqual(found.map(row=>row.ProcessId),[2,3,4]);
});

test('PowerShell 5.1 descendant walk rejects over-bound trees instead of truncating identity receipts',{skip:process.platform!=='win32'},async()=>{
  const rows=[
    {ProcessId:2,ParentProcessId:1752,Name:'opencode.exe'},
    {ProcessId:3,ParentProcessId:2,Name:'node.exe'},
    {ProcessId:4,ParentProcessId:3,Name:'node.exe'},
  ];
  await assert.rejects(walkFixture(rows,{maxDescendants:2}),error=>{
    assert.match(error.stderr,/descendant limit exceeded/);
    return error.code===1;
  });
});
