import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseLauncherSmokeOptions,launcherDescendantWalk,readDescendants,launcherSmokeAPI } from '../scripts/smoke-launcher.mjs';
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
