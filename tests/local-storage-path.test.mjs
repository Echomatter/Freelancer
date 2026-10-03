import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, realpath, rm, symlink } from 'node:fs/promises';
import { assertLocalStoragePath, canonicalStoragePath, storagePathContains, windowsStorageVolumeType } from '../shared/local-storage-path.mjs';
import { resolveDataRoot, FRESH_RUNTIME_ID } from '../server/runtime-config.mjs';
import { assertFreshRuntimeRoot, createLocalDataStore } from '../server/data/store.mjs';
import { unifiedConfig, withUnifiedDatabase } from '../backend/tools/runtime/unified-database.mjs';
import { readRestoreRecoveryState } from '../server/data/recovery.mjs';
import { createIndexJobState } from '../server/data/index-job-state.mjs';
import { publishProjectIndex } from '../backend/tools/runtime/publish-index.mjs';

const missing = () => { throw Object.assign(Error('Missing'), { code:'ENOENT' }); };
const lexicalWindows = { platform:'win32', inspectFilesystem:false };

test('Windows storage rejects UNC, extended UNC, NT UNC and device network namespaces before filesystem access', () => {
  for (const location of ['\\\\server\\share\\data', '//server/share/data', '\\\\?\\UNC\\server\\share\\data',
    '\\\\.\\UNC\\server\\share\\data', '\\??\\UNC\\server\\share\\data',
    '\\\\?\\GLOBALROOT\\Device\\Mup\\server\\share', '\\\\.\\LanmanRedirector\\server\\share']) {
    assert.throws(() => assertLocalStoragePath(location, { platform:'win32',
      resolveRealpath:() => assert.fail('Network paths must not be read.') }), /local filesystem/);
  }
});

test('local Windows drive and volume device namespaces remain valid storage paths', () => {
  for (const location of ['C:\\Data', '\\\\?\\C:\\Data', '\\\\.\\C:\\Data', '\\??\\C:\\Data'])
    assert.equal(assertLocalStoragePath(location,lexicalWindows), 'C:\\Data');
  const volume='\\\\?\\Volume{11111111-1111-1111-1111-111111111111}\\Data';
  assert.equal(assertLocalStoragePath(volume,lexicalWindows),volume);
  assert.throws(() => assertLocalStoragePath('C:Data',lexicalWindows),/absolute/);
});

test('canonical network aliases are rejected even when the supplied path is a mapped drive', () => {
  assert.throws(() => assertLocalStoragePath('Z:\\future\\data', { platform:'win32',
    resolveRealpath:value => value==='Z:\\' ? '\\\\server\\share\\' : missing() }), /local filesystem/);
  assert.throws(() => assertLocalStoragePath('C:\\alias\\data', { platform:'win32',
    resolveRealpath:() => '\\\\?\\UNC\\server\\share\\data' }), /local filesystem/);
});

test('native Windows volume observations reject unresolved mapped drives, unknown roots and probe failure',()=>{
  for (const type of [0,1,4]) assert.throws(()=>assertLocalStoragePath('Z:\\warehouse',{
    platform:'win32',resolveRealpath:value=>value,volumeCache:new Map(),readWindowsVolume:root=>{
      assert.equal(root,'Z:\\'); return type;
    }}),type===4?/mapped network volume/:/unavailable or unknown/);
  assert.throws(()=>assertLocalStoragePath('Z:\\warehouse',{
    platform:'win32',resolveRealpath:value=>value,volumeCache:new Map(),readWindowsVolume:()=>{
      throw Error('Bounded native probe failed');
    }}),/Bounded native probe failed/);
});

test('Windows volume observations cache per canonical drive for the process, including fail-closed results',()=>{
  let calls=0;
  const options={platform:'win32',resolveRealpath:value=>value,volumeCache:new Map(),
    readWindowsVolume:root=>{calls++;return root.toLowerCase()==='c:\\'?3:4;}};
  assert.equal(assertLocalStoragePath('C:\\warehouse',options),'C:\\warehouse');
  assert.equal(assertLocalStoragePath('c:\\warehouse\\database',options),'c:\\warehouse\\database');
  assert.equal(calls,1);
  assert.throws(()=>assertLocalStoragePath('Z:\\warehouse',options),/mapped network volume/);
  assert.equal(calls,2);
  assert.throws(()=>assertLocalStoragePath('Z:\\warehouse',options),/mapped network volume/);
  assert.equal(calls,2,'Failed locality remains cached and fail closed.');
  assert.equal(assertLocalStoragePath('C:\\warehouse',{...options,inspectVolume:false}),'C:\\warehouse',
    'Internal workers still validate paths without a redundant volume subprocess.');
});

test('the native Windows C drive is observed as local with the bounded PowerShell 5.1 probe',
  {skip:process.platform!=='win32'},()=>{
    const observed=windowsStorageVolumeType('C:\\');
    assert.ok([2,3,5,6].includes(observed),`Native C drive type ${observed} is local.`);
    assert.equal(assertLocalStoragePath('C:\\'),'C:\\');
  });

test('Windows containment resolves existing ancestors, case aliases and local device drive prefixes', () => {
  const resolveRealpath=value => {
    const normalized=value.toLowerCase().replace(/^\\\\\?\\/, '');
    if (normalized==='c:\\data' || normalized==='c:\\alias') return '\\\\?\\C:\\Data';
    if (normalized==='c:\\') return 'C:\\';
    return missing();
  };
  const options={platform:'win32',resolveRealpath};
  assert.equal(storagePathContains('C:\\Data','c:\\DATA\\backup',options),true);
  assert.equal(storagePathContains('C:\\Data','C:\\alias\\future\\backup',options),true);
  assert.equal(storagePathContains('C:\\Data','C:\\Data-other\\backup',options),false);
  assert.equal(storagePathContains('C:\\Data','C:\\other\\backup',options),false);
});

test('physical containment can compare offline UNC backup bundles without allowing live network SQLite',()=>{
  const options={platform:'win32',resolveRealpath:value=>value};
  assert.equal(storagePathContains('\\\\server\\share\\backup','\\\\?\\UNC\\SERVER\\share\\backup\\restore',options),true);
  assert.equal(storagePathContains('C:\\Data','\\\\server\\share\\backup',options),false);
});

test('POSIX storage rejects known remote filesystems and propagates inspection errors', () => {
  for (const type of [0x6969,0x517b,0xff534d42,0x5346414f,0x73757245,0xc36400,0x1021997])
    assert.throws(() => assertLocalStoragePath('/data',{platform:'linux',resolveRealpath:value=>value,
      readFilesystem:()=>({type})}),/network mount/);
  assert.equal(assertLocalStoragePath('/data',{platform:'linux',resolveRealpath:value=>value,
    readFilesystem:()=>({type:0xef53})}),'/data');
  for (const code of ['EACCES','EPERM','ELOOP','EIO'])
    assert.throws(() => canonicalStoragePath('/data',{platform:'linux',resolveRealpath:()=>{
      throw Object.assign(Error(code),{code}); }}),{code});
});

test('physical containment follows a directory alias without treating a sibling prefix as a child',async t=>{
  const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'freelancer-storage-path-')));
  t.after(()=>rm(root,{recursive:true,force:true,maxRetries:8,retryDelay:150}));
  const actual=path.join(root,'data'),alias=path.join(root,'alias');
  await mkdir(actual); await symlink(actual,alias,process.platform==='win32'?'junction':'dir');
  assert.equal(storagePathContains(actual,path.join(alias,'missing','bundle')),true);
  assert.equal(storagePathContains(actual,path.join(root,'data-other','bundle')),false);
  assert.equal(assertLocalStoragePath(path.join(alias,'missing')),path.join(alias,'missing'));
});

test('direct Windows store, read-only, native unified, recovery and publisher paths reject network storage',
  {skip:process.platform!=='win32'},()=>{
    const dataHome='\\\\invalid-storage-host\\share\\warehouse';
    const database=path.join(dataHome,'freelancer.sqlite');
    for (const action of [
      ()=>resolveDataRoot({FREELANCER_DATA_HOME:dataHome}),
      ()=>assertFreshRuntimeRoot(dataHome,FRESH_RUNTIME_ID),
      ()=>createLocalDataStore(dataHome),
      ()=>createLocalDataStore(dataHome,{readOnly:true}),
      ()=>unifiedConfig({FREELANCER_RUNTIME_DATA_MODE:'unified',FREELANCER_RUNTIME_ID:FRESH_RUNTIME_ID,FREELANCER_DATA_HOME:dataHome}),
      ()=>withUnifiedDatabase({dataHome,runtimeID:FRESH_RUNTIME_ID},false,()=>assert.fail('No connection permitted')),
      ()=>withUnifiedDatabase({dataHome,runtimeID:FRESH_RUNTIME_ID},true,()=>assert.fail('No connection permitted')),
      ()=>readRestoreRecoveryState(dataHome),
      ()=>createIndexJobState(database,FRESH_RUNTIME_ID).read(),
      ()=>publishProjectIndex(database,database,'project'),
    ]) assert.throws(action,/local filesystem/);
  });
