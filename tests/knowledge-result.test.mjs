import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { openCodeSourceIdentity } from '../server/data/opencode-warehouse.mjs';
import { createJudgmentRecordEvidence, evidenceDigest } from '../server/data/judgment-record-evidence.mjs';
import { KNOWLEDGE_RESULT_BYTE_LIMIT } from '../server/data/knowledge-result.mjs';

const capturedAt=1700000000123;
async function fixture(t,{members=2,bodySize=100}={}) {
  const f=await localDataFixture({timers:false});t.after(()=>f.close());
  const data=f.app.localData.get();data.initializeFreshRuntime('result-envelope-fixture');
  const source=openCodeSourceIdentity(path.join(f.root,'source-identity.sqlite'));
  const nativeText='Café 日本語 retained envelope';
  const capture=data.recordOpenCodeSnapshot({...source,projectID:f.project.id,projectionSafe:true,
    session:{id:'ses_envelope',parentID:'ses_history',title:'Envelope worker',directory:f.project.directory,time:{created:10,updated:20}},
    messages:[{info:{id:'message-envelope',role:'assistant',model:{providerID:'fixture',modelID:'metadata'}},
      parts:[{id:'part-envelope',type:'text',text:nativeText}]}]});
  assert.equal(data.publishWarehouseDerivationJob({id:capture.derivationJobID,revisionToken:capture.derivationRevisionToken}).published,true);
  data.indexChat(f.project.id,{id:'ses_direct',title:'Direct local envelope',time:{updated:30}},[
    {info:{id:'message-direct',role:'assistant'},parts:[{type:'text',text:'Café 日本語 direct envelope'}]}]);
  const memory=data.pinConversationSnapshot({projectID:f.project.id,sessionID:'ses_envelope',title:'Envelope retained memory',originalPinnedAt:capturedAt-100});
  const job=data.queueMemoryCapture({memoryID:memory.id,projectID:f.project.id,sessionID:'ses_envelope'});
  data.claimMemoryCapture(job.id);
  const memoryText=`Café 日本語 captured envelope ${'x'.repeat(bodySize)}`;
  const saved=data.completeMemoryCapture({jobID:job.id,messages:[{role:'assistant',text:memoryText}],
    members:Array.from({length:members},(_,index)=>({kind:'message',ref:`message:${index}`,revision:`source-revision:${index}`,
      hash:evidenceDigest(`source:${index}`),availability:'available',locator:{id:`message:${index}`,text:'PRIVATE FULL TRANSCRIPT',providerID:'fixture',modelID:'metadata'}})),
    boundary:{status:'partial',capturedAt,attemptedAt:capturedAt+100,messageCount:members,truncated:true},provenance:{sourceSystem:'opencode'}});
  data.addClaim({id:'claim-envelope',predicate:'Café 日本語 envelope claim',value:'Retained observation',origin:'source-reported',
    epistemicState:'supported',observedAt:capturedAt,scope:{projectID:f.project.id},
    evidence:[{id:`memory:${memory.id}@${saved.revision}`,kind:'memory-revision',memoryID:memory.id,revision:saved.revision}]});
  const db=new DatabaseSync(data.filename);
  try {
    db.prepare('INSERT INTO project_registrations(runtime_id,project_id,data) VALUES(?,?,?)').run('result-envelope-fixture',f.project.id,JSON.stringify(f.project));
    const key=process.platform==='win32'?f.project.directory.toLowerCase():f.project.directory;
    const text='Café 日本語 retained file envelope',hash=evidenceDigest(text);
    db.prepare(`INSERT INTO content_sources(source_id,project_key,filename,virtual_path,container_path,extension,source_role,status,
      routing_rank,file_size_bytes,modified_utc,sha256,unit_count,locator_kind,extraction_method,extraction_status,text_chars,word_count,source_identity,revision_identity)
      VALUES(1,?,'envelope.md','envelope.md',?,'.md','current_project_source','current',80,30,?, ?,1,'line','fixture','ok',30,4,'source-envelope','revision-envelope')`)
      .run(key,path.join(f.project.directory,'envelope.md'),new Date(capturedAt-1000).toISOString(),hash);
    db.prepare("INSERT INTO content_units VALUES(1,1,0,'L1','Envelope',?,4,30,?)").run(text,hash);
    db.prepare("INSERT INTO content_units_fts(rowid,project_key,filename,virtual_path,source_role,status,heading,locator,text) VALUES(1,?,'envelope.md','envelope.md','current_project_source','current','Envelope','L1',?)").run(key,text);
    db.prepare("INSERT INTO content_source_revisions VALUES('source-envelope','revision-envelope',?,'envelope.md','{}',?)").run(key,capturedAt);
    db.prepare("INSERT INTO content_unit_revisions VALUES('source-envelope','revision-envelope',0,'L1','Envelope',?,4,30,?)").run(text,hash);
    db.prepare("INSERT INTO content_meta VALUES(?,'built_at_utc',?)").run(key,new Date(capturedAt+1000).toISOString());
  }finally{db.close();}
  return {...f,data,source,capture,memory,saved,memoryBody:`assistant: ${memoryText}`};
}

const fields=['resultID','type','originalSourceRef','sourceRevision','observedAt','capturedAt','indexedAt','matchReasons','evidenceStatus','claimStatus','coverage','modelText'];
const common=row=>Object.fromEntries(fields.map(key=>[key,row[key]]));
test('all four domains return applicable per-hit metadata through common HTTP and read-only CLI envelopes',async t=>{
  const f=await fixture(t);
  for(const domain of ['files','conversations','memories','facts']) {
    const input={domain,query:'日本語 envelope',projectID:f.project.id,limit:1};
    const found=await f.app.knowledgeQuery.query(input),hit=found.results[0];
    assert.ok(hit,domain);
    for(const field of fields) assert.ok(Object.hasOwn(hit,field),`${domain}.${field} is returned, not merely derivable`);
    assert.match(hit.resultID,/^[a-z-]+:[a-f0-9]{64}$/);assert.ok(hit.id);
    assert.ok(hit.modelText.length>0&&hit.modelText.length<=2000);
    assert.equal(hit.matchReasons[0].kind,'fts-terms');
    assert.ok(hit.matchReasons.some(reason=>reason.name==='projectID'&&reason.value===f.project.id));
    assert.ok(hit.sourceRevision.id||hit.evidenceStatus==='unavailable');assert.ok(hit.originalSourceRef.kind);
    for(const field of ['observedAt','capturedAt','indexedAt']) assert.ok(hit[field]===null||Number.isFinite(hit[field]));
    const actual=await f.api('knowledge',{operation:'query',...input});assert.deepEqual(actual,found);
    const route={files:'index/search',conversations:'history/search',memories:'memory/search'}[domain];
    if(route) {
      const ui=await f.api(`${route}?${new URLSearchParams({q:input.query,project:f.project.id,limit:'1'})}`);
      assert.deepEqual(common(ui.results[0]),common(hit),`${domain} UI preserves common per-hit metadata`);
    }
    const cli=spawnSync(process.execPath,['scripts/knowledge.mjs','query',domain,input.query,'--project-id',f.project.id,
      '--data-home',path.dirname(f.data.filename),'--runtime-id','result-envelope-fixture','--limit','1'],{encoding:'utf8'});
    assert.equal(cli.status,0,cli.stderr);assert.deepEqual(JSON.parse(cli.stdout),found);
  }
  const file=(await f.app.knowledgeQuery.query({domain:'files',query:'envelope'})).results[0];
  assert.equal(file.capturedAt,capturedAt);assert.equal(file.indexedAt,capturedAt+1000);assert.equal(file.evidenceStatus,'retained');
  assert.equal(file.sourceUpdatedAt,capturedAt-1000);
  const original=(await f.app.knowledgeQuery.query({domain:'conversations',query:'message-envelope'})).results[0];
  assert.equal(original.matchReasons[0].kind,'exact-id');assert.equal(original.originalSourceRef.messageID,'message-envelope');
  assert.equal(original.sourceRevision.hash,f.capture.snapshotRevisionSha256);
  f.data.recordOpenCodeSnapshot({...f.source,projectID:f.project.id,projectionSafe:true,
    session:{id:'ses_envelope',title:'Changed pending source',directory:f.project.directory,time:{updated:9999}},
    messages:[{info:{id:'message-envelope',role:'assistant'},parts:[{id:'part-envelope',type:'text',text:'Changed source'}]}]});
  assert.deepEqual((await f.app.knowledgeQuery.query({domain:'conversations',query:'message-envelope'})).results[0],original,'unpublished native changes do not relabel old captured/indexed evidence');
  const direct=(await f.app.knowledgeQuery.query({domain:'conversations',query:'message-direct'})).results[0];
  assert.equal(direct.sourceRevision.hash,null);assert.equal(direct.capturedAt,null);assert.equal(direct.observedAt,null);
  assert.equal(direct.evidenceStatus,'unavailable');assert.ok(direct.indexedAt);
});

test('ordinary and exact memory queries share bounded metadata without materializing full capture readers',async t=>{
  const f=await fixture(t,{members:5000,bodySize:900000});
  const getMemory=f.data.getMemory;f.data.getMemory=()=>{throw Error('Full reader must not run for a result card');};
  const regular=(await f.app.knowledgeQuery.query({domain:'memories',query:'日本語 envelope'})).results[0];
  const exact=(await f.app.knowledgeQuery.query({domain:'memories',query:f.memory.id})).results[0];
  f.data.getMemory=getMemory;
  assert.equal(regular.resultID,exact.resultID);assert.deepEqual(regular.sourceRevision,exact.sourceRevision);
  assert.equal(regular.revision,exact.revision);assert.equal(regular.revisionID,f.saved.revisionID);
  assert.equal(regular.bodySha256,evidenceDigest(f.memoryBody));assert.equal(regular.sourceRevision.hash,regular.bodySha256);
  assert.equal(regular.body.length,240);assert.equal(regular.bodyTruncated,true);
  assert.equal(regular.sourceRefs.length,32);assert.equal(regular.sourceRefCount,5000);assert.equal(regular.sourceRefsTruncated,true);
  assert.equal(regular.originalSourceRef.membersTruncated,true);assert.equal(regular.originalSourceRef.memberCount,5000);
  assert.equal(regular.messageCount,5000);assert.equal(regular.coverage,'partial');assert.equal(regular.capturedAt,capturedAt);
  assert.equal(regular.boundary.attemptedAt,capturedAt+100);assert.equal(regular.evidenceStatus,'retained');
  assert.ok(regular.pinRevision>=0&&regular.archiveRevision>=0);
  assert.equal(JSON.stringify(regular).includes('PRIVATE FULL TRANSCRIPT'),false);
  assert.ok(JSON.stringify(regular).length<50000,'a huge captured reader has a bounded result card');
  f.data.reviseMemory({id:f.memory.id,expectedRevision:f.saved.revision,body:'A new exact retained revision'});
  const changed=(await f.app.knowledgeQuery.query({domain:'memories',query:f.memory.id})).results[0];
  assert.notEqual(changed.resultID,regular.resultID);assert.notEqual(changed.sourceRevision.hash,regular.sourceRevision.hash);
  assert.equal(changed.capturedAt,null,'an authored revision does not invent a source capture date');
});

test('claim query hashes match canonical retained evidence and bounded failures keep claims visible and statuses unchanged',async t=>{
  const f=await fixture(t);
  const db=new DatabaseSync(f.data.filename,{readOnly:true});
  let expected;
  try{expected=createJudgmentRecordEvidence(db).claim('claim-envelope').ref.recordSha256;}finally{db.close();}
  const known=(await f.app.knowledgeQuery.query({domain:'facts',query:'claim-envelope'})).results[0];
  assert.equal(known.recordSha256,expected);assert.equal(known.sourceRevision.hash,expected);
  assert.equal(known.claimStatus,'supported');assert.equal(known.evidenceStatus,'retained');assert.equal(known.matchReasons[0].kind,'exact-id');
  f.data.addClaim({id:'claim-missing',predicate:'Missing typed envelope',origin:'source-reported',epistemicState:'supported',
    evidence:[{id:'memory:missing@1',kind:'memory-revision',memoryID:'missing',revision:1}]});
  const missing=(await f.app.knowledgeQuery.query({domain:'facts',query:'claim-missing'})).results[0];
  assert.equal(missing.id,'claim-missing');assert.equal(missing.epistemicState,'supported');assert.equal(missing.claimStatus,'supported');
  assert.equal(missing.recordSha256,null);assert.equal(missing.hashUnavailableReason,'source-unavailable');assert.equal(missing.evidenceStatus,'unavailable');
  f.data.addClaim({id:'claim-oversized',predicate:'Oversized opaque envelope',origin:'user-stated',epistemicState:'unverified',
    evidence:Array.from({length:250},(_,index)=>({id:`opaque:${index}`,description:'x'.repeat(20000)}))});
  f.data.addClaim({id:'claim-nested',predicate:'Nested oversized envelope',origin:'source-reported',epistemicState:'disputed',
    evidence:[{id:'nested-source',kind:'claim-record',claimID:'claim-oversized'}]});
  for(const id of ['claim-oversized','claim-nested']) {
    const hit=(await f.app.knowledgeQuery.query({domain:'facts',query:id})).results[0];
    assert.equal(hit.id,id);assert.equal(hit.recordSha256,null);assert.equal(hit.hashUnavailableReason,'hash-work-limit');
    assert.equal(hit.evidenceStatus,'hash-limit');assert.ok(hit.modelText.length<=2000);
  }
  const oversized=(await f.app.knowledgeQuery.query({domain:'facts',query:'claim-oversized'})).results[0];
  assert.equal(oversized.sourceRefCount,250);assert.equal(oversized.sourceRefs.length,32);assert.equal(oversized.sourceRefsTruncated,true);
  assert.ok(oversized.evidence.every(ref=>ref.summaryTruncated));assert.ok(JSON.stringify(oversized).length<20000);
});

test('source hash work and returned metadata have separate page budgets without losing searchable hits',async t=>{
  const f=await fixture(t);
  for(let index=0;index<6;index++) f.data.createMemory({id:`hash-budget-${index}`,kind:'note',title:'Memory hash budget',
    body:`memoryhashbudget 日本語 ${'x'.repeat(900000)}`,source:{projectID:f.project.id}});
  const hashes=await f.app.knowledgeQuery.query({domain:'memories',query:'memoryhashbudget',limit:200});
  assert.equal(hashes.results.length,6);
  assert.ok(hashes.results.some(row=>row.bodySha256===null));
  for(const row of hashes.results.filter(row=>row.bodySha256===null)) {
    assert.equal(row.bodyHashUnavailableReason,'hash-work-limit');assert.equal(row.sourceRevision.hash,null);
    const exact=(await f.app.knowledgeQuery.query({domain:'memories',query:row.id})).results[0];
    assert.ok(exact.bodySha256);assert.equal(exact.resultID,row.resultID,'hash availability cannot change exact revision identity');
  }
  for(let index=0;index<50;index++) f.data.createMemory({id:`metadata-budget-${index}`,kind:'note',title:'Metadata budget',
    body:'metadatapagebudget 日本語',source:{projectID:f.project.id},
    members:Array.from({length:32},(_,ordinal)=>({kind:'recorded',ref:`ref:${ordinal}:${'r'.repeat(1980)}`,availability:'unknown_source'}))});
  const result=await f.app.knowledgeQuery.query({domain:'memories',query:'metadatapagebudget',limit:200});
  assert.equal(result.results.length,50);
  assert.ok(Buffer.byteLength(JSON.stringify(result.results),'utf8')<=KNOWLEDGE_RESULT_BYTE_LIMIT);
  assert.equal(result.page.metadataTruncated,true);
  assert.ok(result.results.some(row=>row.metadataTruncated));
  for(const row of result.results) {
    assert.equal(row.originalSourceRef.memberCount,32);assert.equal(row.sourceRefCount,32);
    assert.equal(row.sourceRefsTruncated,true);assert.equal(row.originalSourceRef.membersTruncated,true);
    assert.ok(row.resultID);assert.equal(row.evidenceStatus,'unknown_source');
  }
  const oversized='identifier'.repeat(40000);
  f.data.createMemory({id:'oversized-reference-memory',kind:'note',title:'Oversized reference',body:'oversizedreference 日本語',
    members:[{kind:'message',ref:'source-ref',revision:oversized,hash:oversized,locator:{id:oversized,text:'Unbounded reader-only content'}}]});
  const limited=(await f.app.knowledgeQuery.query({domain:'memories',query:'oversized-reference-memory'})).results[0];
  assert.equal(limited.sourceRefCount,1);assert.equal(limited.sourceRefs.length,1);
  assert.equal(limited.sourceRefs[0].summaryTruncated,true);assert.equal(limited.sourceRefsTruncated,true);
  assert.equal(limited.bodySha256,evidenceDigest('oversizedreference 日本語'));
  assert.ok(JSON.stringify(limited).length<10000,'oversized stored identifiers are omitted before reference JSON aggregation');
  const full=f.data.getMemory(limited.id);
  assert.equal(full.members[0].revision,oversized);assert.equal(full.members[0].hash,oversized);assert.equal(full.members[0].locator.id,oversized);
  assert.equal(full.revision.body,'oversizedreference 日本語','metadata bounds never rewrite retained data');
  f.data.addClaim({id:'oversized-scope-claim',predicate:'oversizedscope 日本語',origin:'user-stated',epistemicState:'unverified',
    scope:{projectID:f.project.id,detail:'s'.repeat(1200000)},evidence:[{id:'authored:scope'}]});
  const scoped=(await f.app.knowledgeQuery.query({domain:'facts',query:'oversized-scope-claim'})).results[0];
  assert.equal(scoped.scopeTruncated,true);assert.equal(scoped.projectID,f.project.id);
  assert.ok(JSON.stringify(scoped).length<20000);assert.equal(f.data.readClaim(scoped.id).scope.detail.length,1200000);
});

test('omitted claim scopes flag the page and oversized or structured project identifiers cannot defeat the result budget',async t=>{
  const f=await fixture(t);
  for(const [id,projectID] of [['scope-project-too-long','日'.repeat(400000)],['scope-project-object',{value:'x'.repeat(1200000)}]]) {
    f.data.addClaim({id,predicate:'scopelimitneedle',scope:{projectID,detail:'s'.repeat(1200000)},
      origin:'user-stated',epistemicState:'unverified',evidence:[{id:'authored:scope'}]});
    const found=await f.app.knowledgeQuery.query({domain:'facts',query:id});
    assert.equal(found.results.length,1);
    const hit=found.results[0];
    assert.equal(hit.scopeTruncated,true);
    assert.equal(found.page.metadataTruncated,true);
    assert.equal(hit.projectID,null);
    assert.equal(hit.scope.projectID,null);
    assert.ok(Buffer.byteLength(JSON.stringify(found.results),'utf8')<=KNOWLEDGE_RESULT_BYTE_LIMIT);
    assert.deepEqual(f.data.readClaim(id).scope.projectID,projectID,'query bounds never change the retained scope');
  }
});
