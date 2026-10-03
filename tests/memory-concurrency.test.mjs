import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createLocalDataStore } from '../server/data/store.mjs';
import { localDataFixture } from './fixtures/local-data-app.mjs';

const worker = fileURLToPath(new URL('./fixtures/memory-concurrency-worker.mjs', import.meta.url));
const run = (root, operation, input) => new Promise((resolve,reject) => {
  const child = spawn(process.execPath, [worker,root,operation,JSON.stringify(input)], { windowsHide:true,stdio:['ignore','pipe','pipe'] });
  let output='',diagnostics='',timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;child.kill();},10000);
  child.stdout.on('data',value=>{output+=value.toString();}); child.stderr.on('data',value=>{diagnostics+=value.toString();});
  child.on('error',error=>{clearTimeout(timer);reject(error);});
  child.on('close',code=>{clearTimeout(timer); if(timedOut)reject(Error('Graph fixture process timed out.')); else if(code!==0)reject(Error(diagnostics||`Graph fixture process exited ${code}`)); else {try {resolve(JSON.parse(output));}catch(error){reject(error);}}});
});
async function fixture(t) {
  const root=await mkdtemp(path.join(os.tmpdir(),'freelancer-graph-concurrency-')),store=createLocalDataStore(root);
  t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  return {root,store};
}
const successful = rows => { for(const row of rows) assert.equal(row.ok,true,JSON.stringify(row)); return rows.map(row=>row.value); };

test('separate SQLite connections serialize duplicate entities, claims and relations without duplicating canonical rows', {timeout:20000}, async t=>{
  const {root,store}=await fixture(t);
  const entities=successful(await Promise.all(Array.from({length:6},(_,index)=>run(root,'createEntity',{type:'system',name:index%2?'  OPENCode  ':'OpenCode',aliases:['native engine']}))));
  assert.equal(new Set(entities.map(row=>row.id)).size,1); assert.equal(entities.filter(row=>row.created).length,1);
  const nativeID=entities[0].id,appID=store.createEntity({type:'application',name:'Freelancer'}).id;
  const claims=successful(await Promise.all(Array.from({length:6},(_,index)=>run(root,'addClaim',{subjectEntityID:nativeID,predicate:'owns provider authentication',
    origin:'source-reported',epistemicState:'supported',method:'concurrent retained source',scope:{projectID:'fixture'},evidence:[{id:`retained:${index}`,relation:'supports'}]}))));
  assert.equal(new Set(claims.map(row=>row.id)).size,1); assert.equal(claims.filter(row=>row.created).length,1);
  assert.equal(store.readClaim(claims[0].id).evidence.length,6,'duplicate claim creation merges all independent evidence atomically');
  const relations=successful(await Promise.all(Array.from({length:6},()=>run(root,'addRelation',{from:appID,type:'executes through',to:nativeID,validFrom:1000,validTo:2000,provenance:{source:'retained architecture'}}))));
  assert.equal(new Set(relations.map(row=>row.id)).size,1); assert.equal(relations.filter(row=>row.created).length,1);
  assert.equal(store.listRelations().length,1); assert.equal(store.relationHistory({id:relations[0].id}).length,1);
  const db=new DatabaseSync(store.filename,{readOnly:true});
  try {assert.equal(db.prepare('SELECT count(*) AS n FROM entities').get().n,2);assert.equal(db.prepare('SELECT count(*) AS n FROM claims').get().n,1);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);}
  finally {db.close();}
});

test('concurrent claim corrections retain exactly one winner and reject stale state with 409', {timeout:10000}, async t=>{
  const {root,store}=await fixture(t);
  store.addClaim({id:'claim:concurrent',predicate:'Native configuration owner',value:'undecided',origin:'user-stated',epistemicState:'unverified',evidence:[{id:'retained:original'}]});
  const outcomes=await Promise.all(['OpenCode','Freelancer','Other'].map(value=>run(root,'correctClaim',{id:'claim:concurrent',expectedEpistemicState:'unverified',value,
    epistemicState:'supported',method:'explicit concurrent correction',evidence:[{id:`retained:${value}`}]})));
  assert.equal(outcomes.filter(row=>row.ok).length,1);
  for(const loser of outcomes.filter(row=>!row.ok)) assert.equal(loser.status,409,JSON.stringify(loser));
  const current=store.searchClaims({query:'Native configuration owner'}).results;
  assert.equal(current.length,1); assert.equal(store.readClaim('claim:concurrent').epistemicState,'superseded');
  assert.equal(store.searchClaims({query:'Native configuration owner',includeHistorical:true}).results.length,2);
});

test('concurrent memory and relation revision writes preserve one winner and the exact historical values', {timeout:10000}, async t=>{
  const {root,store}=await fixture(t);
  store.createMemory({id:'memory:concurrent',kind:'note',title:'Concurrent authored note',body:'Original retained value'});
  const revisions=await Promise.all(['First correction','Second correction','Third correction'].map(body=>run(root,'reviseMemory',{id:'memory:concurrent',expectedRevision:1,body})));
  assert.equal(revisions.filter(row=>row.ok).length,1); for(const loser of revisions.filter(row=>!row.ok))assert.equal(loser.status,409,JSON.stringify(loser));
  assert.equal(store.getMemory('memory:concurrent').revision.revision,2);assert.equal(store.getMemory('memory:concurrent',1).revision.body,'Original retained value');
  const a=store.createEntity({type:'system',name:'A'}).id,b=store.createEntity({type:'system',name:'B'}).id;
  const relation=store.addRelation({from:a,type:'supports',to:b,validFrom:1000,validTo:2000,provenance:{version:1}});
  const corrections=await Promise.all([2,3,4].map(version=>run(root,'reviseRelation',{id:relation.id,expectedRevision:1,validFrom:2000,validTo:3000,provenance:{version}})));
  assert.equal(corrections.filter(row=>row.ok).length,1);for(const loser of corrections.filter(row=>!row.ok))assert.equal(loser.status,409,JSON.stringify(loser));
  const history=store.relationHistory({id:relation.id});assert.equal(history.length,2);assert.deepEqual(history[1].provenance,{version:1});
  assert.equal(store.listRelations({asOf:999}).length,0);
  assert.equal(store.listRelations({asOf:1000})[0].revision,1);
  assert.equal(store.listRelations({asOf:1999})[0].revision,1);
  assert.equal(store.listRelations({asOf:2000})[0].revision,2);
  assert.equal(store.listRelations({asOf:3000}).length,0,'validTo is exclusive');
  store.deleteRelation({id:relation.id});
  assert.equal(store.listRelations().length,0);assert.equal(store.listRelations({asOf:1500})[0].revision,1,'historical edge remains after current deletion');
  assert.equal(store.listRelations({asOf:Date.now()}).length,0,'retraction blocks historical edge resurrection after its recorded operation');
  assert.throws(()=>store.listRelations({asOf:'yesterday'}),/as-of time/);
});

test('relation validity as-of queries use the same guarded HTTP read contract', async t=>{
  const f=await localDataFixture({timers:false});t.after(()=>f.close());
  const data=f.app.localData.get(),from=data.createEntity({type:'system',name:'HTTP source'}).id,to=data.createEntity({type:'system',name:'HTTP destination'}).id;
  const relation=data.addRelation({from,type:'supports',to,validFrom:1000,validTo:2000});
  const visible=await f.api('knowledge',{operation:'relations',id:from,asOf:1500});
  assert.equal(visible.relations[0].id,relation.id);
  assert.deepEqual((await f.api('knowledge',{operation:'relations',id:from,asOf:2000})).relations,[]);
});
