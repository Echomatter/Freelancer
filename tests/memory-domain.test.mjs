import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createLocalDataStore } from '../server/data/store.mjs';

async function fixture(t) {
  const root=await mkdtemp(path.join(os.tmpdir(),'freelancer-memory-domain-'));
  const store=createLocalDataStore(root);
  t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  return {root,store};
}

test('schema 19 migrates active relation snapshots and maintains claim FTS from entity/evidence text',async t=>{
  const db=new DatabaseSync(':memory:');
  t.after(()=>db.close());
  const schema=await readFile(new URL('../server/data/schema.sql',import.meta.url),'utf8');
  db.exec(schema.slice(0,schema.indexOf('CREATE TABLE entity_relation_revisions')));
  db.prepare('INSERT INTO entities VALUES(?,?,?,?,?,?)').run('a','node','Alpha','alpha',1,1);
  db.prepare('INSERT INTO entities VALUES(?,?,?,?,?,?)').run('b','node','Beta','beta',1,1);
  db.prepare('INSERT INTO entity_relations VALUES(?,?,?,?,?,?)').run('legacy-edge','a','links','b','{}',123);
  const claimInsert=db.prepare('INSERT INTO claims VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  claimInsert.run('claim-a','a','records blue archive','b',null,'source-reported','migration-test','supported','{"projectID":"p"}',null,null,null,1,null,'test','jev','jev-v1');
  db.exec(await readFile(new URL('../server/data/migration-19.sql',import.meta.url),'utf8'));
  const migrated=db.prepare('SELECT relation_id,revision,valid_from,operation FROM entity_relation_revisions').get();
  assert.deepEqual([migrated.relation_id,migrated.revision,migrated.valid_from,migrated.operation],['legacy-edge',1,123,'created']);
  db.prepare('INSERT INTO entity_aliases VALUES(?,?,?,?,?)').run('a','Nebula Workshop','nebula workshop','fixture',2);
  assert.equal(db.prepare(`SELECT claim_id FROM claims_search_fts WHERE claims_search_fts MATCH ?`).get('"Nebula Workshop"').claim_id,'claim-a');
  db.prepare('INSERT INTO claim_evidence VALUES(?,?,?,?,?)').run('claim-a','evidence-1','supports','{"text":"distinctive cyan proof"}',3);
  assert.equal(db.prepare(`SELECT claim_id FROM claims_search_fts WHERE claims_search_fts MATCH ?`).get('"distinctive cyan"').claim_id,'claim-a');
  db.prepare('DELETE FROM claim_evidence WHERE claim_id=?').run('claim-a');
  assert.equal(db.prepare(`SELECT count(*) AS n FROM claims_search_fts WHERE claims_search_fts MATCH ?`).get('"distinctive cyan"').n,0);
});

test('relation revisions retain temporal validity and audited optimistic edits/deletes',async t=>{
  const {store}=await fixture(t);
  const from=store.createEntity({type:'service',name:'Warehouse'}),to=store.createEntity({type:'format',name:'SQLite'});
  const added=store.addRelation({from:from.id,to:to.id,type:'stores',provenance:{source:'manual'},validFrom:100,actor:'tester'});
  assert.equal(added.revision,1);
  assert.deepEqual(store.listRelations({entityID:from.id})[0],{
    id:added.id,fromEntityID:from.id,type:'stores',toEntityID:to.id,provenance:{source:'manual'},
    createdAt:store.listRelations()[0].createdAt,revision:1,validFrom:100,validTo:null,
  });
  const revised=store.reviseRelation({id:added.id,expectedRevision:1,type:'indexes',provenance:{source:'review'},validFrom:150,validTo:300,actor:'reviewer',reason:'corrected interval'});
  assert.deepEqual(revised,{id:added.id,revision:2,updated:true,validFrom:150,validTo:300});
  assert.throws(()=>store.reviseRelation({id:added.id,expectedRevision:1,type:'stale'}),/changed/);
  assert.equal(store.listRelations({entityID:from.id})[0].type,'indexes');
  assert.deepEqual(store.relationHistory({id:added.id}).map(row=>[row.revision,row.operation,row.validFrom,row.validTo]),[
    [2,'revised',150,300],[1,'created',100,null],
  ]);
  assert.deepEqual(store.deleteRelation({id:added.id,actor:'tester',reason:'withdrawn'}),{id:added.id,deleted:true});
  const deleted=store.relationHistory({id:added.id})[0];
  assert.equal(deleted.operation,'retracted');assert.equal(deleted.revision,3);assert.equal(deleted.actor,'tester');assert.equal(deleted.reason,'withdrawn');
  assert.deepEqual(store.listRelations({entityID:from.id}),[]);
});

test('entity deletion records relation retractions before cascade and leaves durable relation history',async t=>{
  const {store}=await fixture(t);
  const from=store.createEntity({type:'node',name:'Temporary A'}),to=store.createEntity({type:'node',name:'Temporary B'});
  const relation=store.addRelation({from:from.id,to:to.id,type:'depends-on'});
  assert.deepEqual(store.deleteEntity({id:from.id,actor:'cleanup',reason:'fixture removed'}),{id:from.id,deleted:true,relationsDeleted:1});
  const history=store.relationHistory({id:relation.id});
  assert.equal(history[0].operation,'retracted');assert.equal(history[0].actor,'cleanup');
  assert.equal(history[0].reason,'fixture removed');
});

test('archive and restore are reversible and distinct from forget and unpin; source deletion preserves memory',async t=>{
  const {store}=await fixture(t);
  const memory=store.createMemory({kind:'note',title:'Retained evidence',body:'Durable source observation.',source:{projectID:'project-a'},
    members:[{kind:'content-unit',ref:'source-1/revision-1#unit-0',revision:'revision-1',locator:{line:1}}]});
  const db=new DatabaseSync(store.filename);
  db.prepare(`INSERT INTO content_sources(source_id,project_key,filename,virtual_path,container_path,extension,source_role,status,
    routing_rank,file_size_bytes,modified_utc,sha256,unit_count,locator_kind,extraction_method,extraction_status,text_chars,word_count,source_identity,revision_identity)
    VALUES(1,'project-a','notes.md','notes.md','notes.md','.md','project','current',1,10,'now','hash',1,'line','test','ok',10,2,'source-1','revision-1')`).run();
  db.prepare(`INSERT INTO content_units(source_id,unit_no,locator,heading,text,word_count,char_count,sha256) VALUES(1,0,'L1','Evidence','retained source observation',3,27,'unit-hash')`).run();
  db.prepare('DELETE FROM content_sources WHERE source_id=1').run();
  db.close();
  assert.equal(store.getMemory(memory.id).revision.body,'Durable source observation.');
  assert.equal(store.getMemory(memory.id).members[0].ref,'source-1/revision-1#unit-0');
  assert.deepEqual(store.archiveMemory({id:memory.id,expectedRevision:0,actor:'user',reason:'out of active use'}),
    {id:memory.id,archived:true,changed:true,archiveRevision:1});
  assert.equal(store.getMemory(memory.id).status,'archived');
  assert.throws(()=>store.restoreMemory({id:memory.id,expectedRevision:0}),{status:409});
  assert.deepEqual(store.restoreMemory({id:memory.id,expectedRevision:1,reason:'needed again'}),
    {id:memory.id,restored:true,changed:true,archiveRevision:2});
  assert.equal(store.getMemory(memory.id).status,'active');
  assert.equal(store.forgetMemory({id:memory.id,reason:'remove permanently'}).forgotten,true);
  assert.equal(store.getMemory(memory.id),null);
});

test('claim search uses durable FTS, shared token/phrase matching and filters before result limit',async t=>{
  const {store}=await fixture(t);
  const subject=store.createEntity({type:'system',name:'Primary node'}),object=store.createEntity({type:'system',name:'Archive format'});
  const current=store.addClaim({subjectEntityID:subject.id,objectEntityID:object.id,predicate:'emits deep blue archive path',
    origin:'source-reported',method:'fixture',epistemicState:'supported',scope:{projectID:'target-project'},
    modelProvider:'jev',modelID:'jev-v1',evidence:[{id:'source:a',detail:'distinctive cobalt observation'}]});
  store.addAlias(subject.id,'Violet Observatory');
  const other=store.addClaim({predicate:'emits deep blue archive path',origin:'user-stated',epistemicState:'disputed',
    scope:{projectID:'other-project'},evidence:[{id:'source:b',detail:'distinctive cobalt observation'}]});
  const aliasHit=store.searchClaims({query:'Violet Observatory',projectID:'target-project',limit:1});
  assert.deepEqual(aliasHit.results.map(row=>row.id),[current.id]);
  assert.equal(store.searchClaims({query:'blue archive',phrase:true,projectID:'target-project'}).results[0].id,current.id);
  assert.equal(store.searchClaims({query:'cobalt distinctive',projectID:'target-project',origin:'source-reported',epistemicState:'supported',model:'jev-v1',modelProvider:'jev'}).results[0].id,current.id);
  assert.equal(store.searchClaims({query:'cobalt distinctive',projectID:'target-project',origin:'user-stated'}).results.length,0);
  assert.equal(store.searchClaims({query:'cobalt distinctive',projectID:'other-project',epistemicState:'disputed'}).results[0].id,other.id);
  store.correctClaim({id:current.id,expectedEpistemicState:'supported',predicate:'emits no blue archive path',epistemicState:'disputed',
    evidence:[{id:'source:c',detail:'correction evidence'}],reason:'new source'});
  const active=store.searchClaims({query:'Violet Observatory',projectID:'target-project'});
  assert.equal(active.results.some(row=>row.id===current.id),false);
  const history=store.searchClaims({query:'Violet Observatory',projectID:'target-project',includeHistorical:true});
  assert.equal(history.results.some(row=>row.id===current.id),true);
  assert.equal(history.results.length,2,'prior and correcting claims remain searchable as separate records');
});
