import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parse } from 'jsonc-parser';
import { createContextSettings } from '../server/context-settings.mjs';
import { configureContextSettings } from '../backend/tools/runtime/context-settings.mjs';

async function fixture(t) {
  const root=await mkdtemp(path.join(os.tmpdir(),'freelancer-context-setting-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const directory=path.join(root,'project'); await mkdir(directory);
  const file=path.join(directory,'opencode.jsonc');
  const original='{\n  // Native project policy\n  "compaction": { "auto": true, "prune": false, "reserved": 8192 },\n  "permission": { "edit": "ask" },\n}\n';
  await writeFile(file,original);
  const project={id:'project',directory};
  const state={status:{},questions:[],permissions:[],disposing:0,locked:false,override:null};
  const host={request:async route=>{
    if(route==='/instance/dispose'){state.disposing++;return true;}
    if(route==='/agent')return [];
    if(route==='/config')return state.override??parse(await readFile(file,'utf8'));
    if(route==='/session/status')return state.status;
    if(route==='/question')return state.questions;
    if(route==='/permission')return state.permissions;
    throw Error('Unexpected native route');
  }};
  const service=createContextSettings({host,project:async()=>project,
    canRefresh:()=>!state.locked,setRefreshing:value=>{state.locked=value;}});
  return {root,directory,file,original,project,state,service};
}
test('native compaction save preserves project JSONC siblings and does not consult old app preferences',async t=>{
  const f=await fixture(t);
  assert.equal((await f.service.read(f.project.id)).autoCompact,true);
  assert.deepEqual(await f.service.save(f.project.id,{autoCompact:false}),{saved:true,autoCompact:false});
  const saved=await readFile(f.file,'utf8');
  assert.match(saved,/Native project policy/);
  assert.deepEqual(parse(saved),{compaction:{auto:false,prune:false,reserved:8192},permission:{edit:'ask'}});
  assert.equal((await f.service.read(f.project.id)).autoCompact,false);
  const native={compaction:{auto:true,prune:true}};
  await configureContextSettings(native,{contextSettings:{project:{autoCompact:false}}},f.directory);
  assert.deepEqual(native,{compaction:{auto:true,prune:true}});
});
test('busy, unknown native state, pending decisions and invalid values leave native config bytes unchanged',async t=>{
  const f=await fixture(t);
  for(const type of ['busy','retry','unknown']){
    f.state.status={session:{type}};
    await assert.rejects(f.service.save(f.project.id,{autoCompact:false}),/running chats/);
  }
  f.state.status={};
  for(const field of ['questions','permissions']){
    f.state[field]=[{id:'pending'}];
    await assert.rejects(f.service.save(f.project.id,{autoCompact:false}),/pending decisions/);
    f.state[field]=[];
  }
  await assert.rejects(f.service.save(f.project.id,{autoCompact:'false'}),/on or off/);
  assert.equal(await readFile(f.file,'utf8'),f.original);
  assert.equal(f.state.disposing,0);assert.equal(f.state.locked,false);
});
test('failed native confirmation restores exact previous config bytes and releases refresh lock',async t=>{
  const f=await fixture(t);
  f.state.override={compaction:{auto:true}};
  await assert.rejects(f.service.save(f.project.id,{autoCompact:false}),/previous OpenCode project config was restored/);
  assert.equal(await readFile(f.file,'utf8'),f.original);
  assert.equal(f.state.locked,false);assert.equal(f.state.disposing,2);
  f.state.locked=true;
  await assert.rejects(f.service.save(f.project.id,{autoCompact:false}),/current setup/);
  assert.equal(f.state.disposing,2);
});
