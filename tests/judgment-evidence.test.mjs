import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createLocalDataStore } from '../server/data/store.mjs';
import { createJudgmentEvidenceResolver } from '../server/data/judgment-evidence.mjs';
import { stableEvidenceJSON } from '../server/data/judgment-record-evidence.mjs';

async function fixture(t) {
  const root=await mkdtemp(path.join(os.tmpdir(),'freelancer-judgment-evidence-')),store=createLocalDataStore(root);
  const db=new DatabaseSync(store.filename),resolve=createJudgmentEvidenceResolver(db);
  t.after(async()=>{db.close();store.close();await rm(root,{recursive:true,force:true});});
  return {store,db,resolve};
}
const hash=value=>createHash('sha256').update(value).digest('hex');

test('authored notes and pinned snapshots produce exact bounded immutable revision evidence',async t=>{
  const {store,resolve}=await fixture(t);
  const memory=store.createMemory({id:'note-日本語',kind:'note',title:'Authored note',body:'A retained literal café observation.',provenance:{actor:'author'},source:{projectID:'p'}});
  store.setMemoryPin({id:memory.id,pinned:true,expectedRevision:0});
  const snapshot=store.createMemory({id:'conversation:p:session',kind:'conversation_snapshot',title:'Pinned transcript',body:'Captured message text.',
    source:{system:'opencode',projectID:'p',sessionID:'session'},boundary:{status:'complete'},members:[{kind:'text',ref:'message-a',revision:'captured-r1'}]});
  store.setMemoryPin({id:snapshot.id,pinned:true,expectedRevision:0});
  assert.deepEqual(resolve(resolve.packet({domain:'memories',id:snapshot.id,revision:1})),{resolved:true,evidenceCount:1,candidateCount:1});
  const first=resolve.packet({domain:'memories',id:memory.id,revision:1,query:'café'});
  assert.deepEqual(first.candidateIDs,[memory.id]);
  assert.equal(first.evidenceRefs[0].bodySha256,hash('A retained literal café observation.'));
  assert.equal(first.evidenceRefs[0].revisionID,store.getMemory(memory.id,1).revision.revision_id);
  assert.deepEqual(resolve(first),{resolved:true,evidenceCount:1,candidateCount:1});
  store.reviseMemory({id:memory.id,expectedRevision:1,body:'Changed observation.',provenance:{actor:'author'}});
  // The old revision body remains readable, but changing current metadata
  // invalidates the previous packet and its cache key until it is retrieved.
  assert.throws(()=>resolve(first),/exact stored revision/);
  const retained=resolve.packet({domain:'memories',id:memory.id,revision:1});
  assert.equal(retained.state.evidence[0].text,'A retained literal café observation.');
  const latest=resolve.packet({domain:'memories',id:memory.id});
  assert.equal(latest.evidenceRefs[0].revision,2);
  assert.notEqual(first.evidenceRefs[0].recordSha256,latest.evidenceRefs[0].recordSha256);
  store.forgetMemory({id:memory.id});
  assert.throws(()=>resolve(retained),/forgotten/);
  assert.throws(()=>resolve.assertReferences(latest),/forgotten/);
  assert.throws(()=>resolve.packet({domain:'memories',id:memory.id,revision:1}),/forgotten/);
});

test('claim packets retain origin, epistemic state, scope and provenance while rejecting changed source hashes',async t=>{
  const {store,db,resolve}=await fixture(t);
  const memory=store.createMemory({id:'source-note',kind:'note',title:'Observation',body:'Source says blue.',provenance:{actor:'human'}});
  const claim=store.addClaim({id:'claim-blue',predicate:'has blue paint',value:'blue',origin:'user-stated',epistemicState:'supported',scope:{projectID:'p'},
    actor:'human',method:'authored',evidence:[{id:`memory:${memory.id}@1`,kind:'memory',memoryID:memory.id,memoryRevision:1,relation:'supports'}]});
  const packet=resolve.packet({domain:'facts',id:claim.id});
  assert.equal(packet.evidenceRefs[0].claimID,claim.id);
  assert.match(packet.state.evidence[0].text,/user-stated|supported|projectID|authored/);
  assert.deepEqual(resolve.assertReferences(packet),{resolved:true,evidenceCount:1,candidateCount:1});
  db.prepare('UPDATE claims SET scope_json=? WHERE claim_id=?').run('{"projectID":"other"}',claim.id);
  assert.throws(()=>resolve(packet),/current metadata/);
  const changed=resolve.packet({domain:'facts',id:claim.id});
  assert.notEqual(packet.evidenceRefs[0].recordSha256,changed.evidenceRefs[0].recordSha256);
  db.prepare('UPDATE memory_item_revisions SET body=? WHERE memory_id=? AND revision=1').run('Source says red.',memory.id);
  assert.throws(()=>resolve(changed),/source hashes/);
  const sourceChanged=resolve.packet({domain:'facts',id:claim.id});
  assert.notEqual(changed.evidenceRefs[0].recordSha256,sourceChanged.evidenceRefs[0].recordSha256);
  store.correctClaim({id:claim.id,epistemicState:'disputed',evidence:[{id:'human-correction',detail:'Contrary observation.'}]});
  assert.throws(()=>resolve(sourceChanged),/current metadata/);
  const historical=resolve.packet({domain:'facts',id:claim.id});
  assert.match(historical.state.evidence[0].text,/superseded/);
  store.forgetMemory({id:memory.id});
  assert.throws(()=>resolve(historical),/forgotten/);
});

test('current evidence references invalidate cache matches when claim state or provenance changes',async t=>{
  const {store,db,resolve}=await fixture(t);
  const claim=store.addClaim({id:'cache-claim',predicate:'observed size',origin:'human-authored',epistemicState:'unverified',evidence:[{id:'manual-note',detail:'Size=5'}]});
  store.createJudgmentDefinition({id:'relevance',version:1,questionID:'relevance',primitive:'check',question:'Does the record concern size?',criteria:{}});
  const packet=resolve.packet({domain:'facts',id:claim.id,query:'size'});
  const run={definitionID:'relevance',definitionVersion:1,stateHash:hash(stableEvidenceJSON(packet.state)),candidateIDs:packet.candidateIDs,evidenceRefs:packet.evidenceRefs,
    requestedProvider:'typesafe',requestedModel:'jev-test',reportedProvider:'typesafe',reportedModel:'jev-test',status:'ok',results:[{questionID:'relevance',answer:{probabilityYes:0.9}}]};
  const receipt=store.recordJudgmentRun(run);
  assert.equal(store.findCachedJudgment(run).status,'hit');
  db.prepare('UPDATE claims SET epistemic_state=? WHERE claim_id=?').run('disputed',claim.id);
  assert.throws(()=>resolve.assertReferences(packet),/exact stored revision/);
  const changed=resolve.packet({domain:'facts',id:claim.id,query:'size'});
  assert.equal(store.findCachedJudgment({...run,stateHash:hash(stableEvidenceJSON(changed.state)),evidenceRefs:changed.evidenceRefs}).status,'miss');
  assert.equal(store.findCachedJudgment(run).status,'miss','old exact keys cannot reuse changed evidence');
  assert.equal(store.judgmentHistory()[0].runID,receipt.runID,'historical receipt remains inspectable');
  db.prepare('UPDATE claim_evidence SET evidence_json=? WHERE claim_id=?').run('{"id":"manual-note","detail":"Size=7"}',claim.id);
  assert.throws(()=>resolve(changed),/current metadata/);
});

test('record evidence rejects invented IDs, hashes, text and invalid packet bounds',async t=>{
  const {store,resolve}=await fixture(t);
  const memory=store.createMemory({id:'long-note',kind:'note',title:'Long observation',body:'界'.repeat(50_000)});
  const packet=resolve.packet({domain:'memories',id:memory.id});
  assert.equal(packet.state.evidence[0].text.length,20_000);
  assert.equal(packet.evidenceRefs[0].bodySha256,hash('界'.repeat(50_000)));
  assert.ok(Buffer.byteLength(stableEvidenceJSON(packet),'utf8')<100_000);
  for (const changes of [{candidateID:'invented'},{memoryID:'invented'},{bodySha256:'a'.repeat(64)},{recordSha256:'b'.repeat(64)},{revision:999}]) {
    const ref={...packet.evidenceRefs[0],...changes};
    assert.throws(()=>resolve({candidateIDs:[ref.candidateID],evidenceRefs:[ref],state:{evidence:[{...ref,text:packet.state.evidence[0].text}]}}));
  }
  assert.throws(()=>resolve({...packet,state:{evidence:[{...packet.state.evidence[0],text:'Invented passage'}]}}),/exact stored revision/);
  assert.throws(()=>resolve.packet({domain:'files',id:memory.id}),/memories or facts/);
  assert.throws(()=>resolve.packet({domain:'memories',id:memory.id,revision:0}),/positive/);
  assert.throws(()=>resolve.packet({domain:'facts',id:'missing'}),/missing/);
  assert.throws(()=>resolve.packet({domain:'memories',id:memory.id,query:'x'.repeat(201)}),/200 characters/);
});

test('claim evidence cycles and missing typed source revisions are rejected without invented replacements',async t=>{
  const {store,db,resolve}=await fixture(t);
  const claim=store.addClaim({id:'cyclic',predicate:'cyclic assertion',origin:'human-authored',epistemicState:'unverified',evidence:[{id:'self',kind:'claim-record',claimID:'cyclic'}]});
  assert.throws(()=>resolve.packet({domain:'facts',id:claim.id}),/cyclic/);
  db.prepare('UPDATE claim_evidence SET evidence_json=? WHERE claim_id=?').run('{"id":"memory:missing@1","kind":"memory","memoryID":"missing","memoryRevision":1}',claim.id);
  assert.throws(()=>resolve.packet({domain:'facts',id:claim.id}),/missing or forgotten/);
});
