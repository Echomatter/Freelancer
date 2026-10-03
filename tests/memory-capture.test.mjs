import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { openCodeSourceIdentity } from '../server/data/opencode-warehouse.mjs';

const initialMessages=()=>[
  {info:{id:'msg_export',role:'user',time:{created:250}},parts:[{type:'text',text:'Original conversation text'}]},
  {info:{id:'msg_tool',role:'assistant'},parts:[{type:'tool',tool:'secret',state:{output:'must not be captured'}}]},
];

async function complete(f,id) {
  for(let i=0;i<300;i++) {
    const memory=await f.api(`memory/item?${new URLSearchParams({id})}`);
    if(memory.job?.status==='completed'||memory.job?.status==='failed') return memory;
    await delay(10);
  }
  throw Error('Capture did not reach a terminal state.');
}

test('pin acknowledgement persists its job before a slow native transcript read',async t=>{
  const f=await localDataFixture({timers:false}); t.after(()=>f.close());
  f.state.messages.ses_history=initialMessages();
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  t.after(()=>release());
  const request=f.host.request.bind(f.host);
  f.host.request=async(route,options)=>{
    if(route==='/session/ses_history/message') await gate;
    return request(route,options);
  };
  const pinned=await f.api('history/pin',{project:f.project.id,session:'ses_history',pinned:true,revision:0},'PUT');
  assert.ok(pinned.pinnedAt); assert.equal(pinned.capture.status,'queued');
  const id=`conversation:${f.project.id}:ses_history`;
  const pending=await f.api(`memory/item?${new URLSearchParams({id,revision:'1'})}`);
  assert.equal(pending.coverage,'metadata_only');assert.equal(pending.capturedAt,null);
  release();
  const captured=await complete(f,id);
  assert.equal(captured.revision,2);assert.equal(captured.messageCount,1);
  assert.equal(captured.messages[0].text,'Original conversation text');
  assert.equal(JSON.stringify(captured).includes('must not be captured'),false);
  assert.equal(captured.originalPinnedAt,pinned.pinnedAt);
  assert.equal((await f.api('memory/search?q=Original&pinnedOnly=true')).results[0].id,id);
});

test('refresh retains exact revisions and records active/unknown/missing boundaries independently from pin state',async t=>{
  const f=await localDataFixture({timers:false}); t.after(()=>f.close());
  f.state.messages.ses_history=initialMessages();
  f.state.status.ses_history={type:'busy'};
  await f.api('history/pin',{project:f.project.id,session:'ses_history',pinned:true,revision:0},'PUT');
  const id=`conversation:${f.project.id}:ses_history`;
  const initial=await complete(f,id);
  assert.equal(initial.coverage,'incomplete');assert.equal(initial.boundary.active,true);
  f.state.messages.ses_history=[{info:{id:'msg_new',role:'user',time:{created:900}},parts:[{type:'text',text:'Changed source café 日本語'}]}];
  f.state.status={};
  await f.api('memory/refresh',{id});
  const refreshed=await complete(f,id);
  assert.equal(refreshed.revision,3);assert.equal(refreshed.coverage,'complete');
  const sourceCapturedAt=refreshed.capturedAt;
  const old=await f.api(`memory/item?${new URLSearchParams({id,revision:String(initial.revision)})}`);
  assert.equal(old.snapshotHash,initial.snapshotHash);assert.equal(old.messages[0].text,'Original conversation text');
  f.state.unavailable=true;
  await f.api('memory/refresh',{id});
  const unknown=await complete(f,id);
  assert.equal(unknown.coverage,'unknown_source');assert.ok(unknown.pinnedAt);
  assert.equal(unknown.messages.length,1);assert.equal(unknown.messages[0].text,'Changed source café 日本語');
  assert.equal(unknown.members[0].availability,'unknown_source');
  assert.equal(unknown.capturedAt,sourceCapturedAt);
  assert.ok(unknown.boundary.attemptedAt>=sourceCapturedAt);
  assert.ok(unknown.boundary.snapshotCreatedAt>=unknown.boundary.attemptedAt);
  assert.equal(unknown.job.status,'completed');
  f.state.unavailable=false;
  const request=f.host.request.bind(f.host);
  f.host.request=async(route,options)=>{
    if(route==='/session/ses_history/message') throw Object.assign(Error('Native conversation was deleted.'),{status:404});
    return request(route,options);
  };
  await f.api('memory/refresh',{id});
  const missing=await complete(f,id);
  assert.equal(missing.coverage,'missing_source');assert.ok(missing.pinnedAt);
  assert.equal(missing.messages.length,1);assert.equal(missing.messages[0].text,'Changed source café 日本語');
  assert.equal(missing.members[0].availability,'missing_source');
  assert.equal(missing.capturedAt,sourceCapturedAt);
  assert.ok(missing.boundary.attemptedAt>unknown.boundary.attemptedAt);
  assert.equal(missing.job.status,'completed');
  for(const failure of [
    Object.assign(Error('Native authorization expired.'),{status:401}),
    Object.assign(Error('Native server failed.'),{status:500}),
    {nonArray:true},
  ]) {
    f.host.request=async(route,options)=>{
      if(route==='/session/ses_history/message') {
        if(failure.nonArray) return {unexpected:'not a message array'};
        throw failure;
      }
      return request(route,options);
    };
    await f.api('memory/refresh',{id});
    const uncertain=await complete(f,id);
    assert.equal(uncertain.coverage,'unknown_source');
    assert.equal(uncertain.messages[0].text,'Changed source café 日本語');
    assert.equal(uncertain.capturedAt,sourceCapturedAt);
  }
  await f.api('history/pin',{project:f.project.id,session:'ses_history',pinned:false,revision:1},'PUT');
  assert.equal((await f.api(`memory/item?${new URLSearchParams({id})}`)).pinnedAt,null);
  assert.equal((await f.api('memory/search?q=&pinnedOnly=true')).results.length,0);
  assert.ok(await f.api(`memory/item?${new URLSearchParams({id,revision:'3'})}`));
});

test('capture restart resumes the durable read job without sending work; forgotten evidence cannot be restored by a late capture',async t=>{
  const f=await localDataFixture({timers:false});t.after(()=>f.close());
  const db=f.app.localData.get();
  const item=db.createMemory({kind:'conversation_snapshot',title:'Deferred snapshot',body:'',source:{projectID:f.project.id,sessionID:'ses_history'}});
  const job=db.queueMemoryCapture({memoryID:item.id,projectID:f.project.id,sessionID:'ses_history'});
  assert.equal(db.queueMemoryCapture({memoryID:item.id,projectID:f.project.id,sessionID:'ses_history'}).id,job.id);
  assert.ok(db.claimMemoryCapture(job.id));assert.equal(db.claimMemoryCapture(job.id),null);
  assert.equal(db.resumeMemoryCaptures()[0].id,job.id);
  db.claimMemoryCapture(job.id);
  db.forgetMemory({id:item.id});
  assert.throws(()=>db.completeMemoryCapture({jobID:job.id,messages:[],members:[],boundary:{},provenance:{}}),/changed during capture/);
  assert.equal(db.getMemory(item.id),null);
  assert.equal(f.calls.some(call=>call.options?.method==='POST'&&call.route.includes('prompt')),false);
});

test('unavailable-source marker stays within the member bound and reports capped retained evidence',async t=>{
  const f=await localDataFixture({timers:false});t.after(()=>f.close());
  const id=`conversation:${f.project.id}:ses_history`,capturedAt=123456;
  const members=Array.from({length:5000},(_,ordinal)=>({kind:'message',ref:`native/${ordinal}`,revision:`sha-${ordinal}`,
    locator:{ordinal,role:'user',text:`retained message ${ordinal}`,messageID:`message-${ordinal}`},availability:'retained'}));
  f.app.localData.get().createMemory({id,kind:'conversation_snapshot',title:'Large retained conversation',
    body:members.map(member=>`user: ${member.locator.text}`).join('\n\n'),source:{projectID:f.project.id,sessionID:'ses_history'},
    boundary:{status:'complete',capturedAt,sourceMessageCount:5000,messageCount:5000},members});
  const request=f.host.request.bind(f.host);
  f.host.request=async(route,options)=>{
    if(route==='/session/ses_history/message') throw Object.assign(Error('Deleted.'),{status:404});
    return request(route,options);
  };
  await f.api('memory/refresh',{id});
  const missing=await complete(f,id);
  assert.equal(missing.coverage,'missing_source');
  assert.equal(missing.members.length,5000);
  assert.equal(missing.members[0].availability,'missing_source');
  assert.equal(missing.messages.length,4999);
  assert.equal(missing.messages.at(-1).messageID,'message-4998');
  assert.equal(missing.boundary.truncated,true);
  assert.equal(missing.boundary.messageCount,4999);
  assert.equal(missing.boundary.capturedAt,capturedAt);
});

test('authored memory pins reject stale revisions even after unpin and share Unicode search with the UI adapter',async t=>{
  const f=await localDataFixture({timers:false});t.after(()=>f.close());
  const saved=await f.api('knowledge',{operation:'remember',projectID:f.project.id,title:'Unicode memory',body:'Café 日本語 durable evidence'});
  await f.api('knowledge',{operation:'pin',id:saved.id,pinned:true,expectedRevision:0});
  await f.api('knowledge',{operation:'pin',id:saved.id,pinned:false,expectedRevision:1});
  await assert.rejects(f.api('knowledge',{operation:'pin',id:saved.id,pinned:true,expectedRevision:0}),/changed/);
  const ui=await f.api('memory/search?q='+encodeURIComponent('Café 日本語'));
  const native=await f.api('knowledge',{operation:'search',query:'Café 日本語',projectID:f.project.id});
  assert.deepEqual(ui.results.map(row=>row.id),native.items.map(row=>row.id));
  assert.equal((await f.api(`memory/item?id=${saved.id}`)).pinRevision,2);
});

test('newer retained warehouse content is indicated without rewriting pinned or historical memory or reading native sources',async t=>{
  const f=await localDataFixture({timers:false});t.after(()=>f.close());
  f.state.messages.ses_history=[{info:{id:'msg_retained',role:'user'},parts:[{type:'text',text:'Original curated source.'}]}];
  await f.api('history/pin',{project:f.project.id,session:'ses_history',pinned:true,revision:0},'PUT');
  const id=`conversation:${f.project.id}:ses_history`, original=await complete(f,id), data=f.app.localData.get();
  const before=data.getMemory(id), source=openCodeSourceIdentity(f.nativeFile);
  assert.match(before.revision.provenance.sourceSnapshotRevisionSha256,/^[a-f0-9]{64}$/);
  assert.equal(original.sourceUpdates.state,'unchanged-retained');
  const capture=(origin,text,projectID=f.project.id)=>data.recordOpenCodeSnapshot({...origin,projectID,
    session:f.state.sessions.find(row=>row.id==='ses_history'),
    messages:[{info:{id:'msg_retained',role:'user'},parts:[{type:'text',text}]}],projectionSafe:true});
  capture(openCodeSourceIdentity(f.nativeFile+'-other'),'Other origin must not count.');
  capture(source,'Other project must not count.','another-project');
  let calls=f.calls.length;
  assert.equal((await f.app.history.readMemory(id)).sourceUpdates.state,'unchanged-retained');
  assert.equal(f.calls.length,calls);
  // Same native session header/time, different retained message revision.
  capture(source,'Newly retained warehouse content.');
  calls=f.calls.length;
  const changed=await f.app.history.readMemory(id,original.revision);
  assert.equal(changed.sourceUpdates.state,'newer-retained');assert.equal(changed.sourceUpdates.changedSources,1);
  assert.equal(changed.sourceUpdates.liveSource,'not-checked');assert.equal(f.calls.length,calls);
  assert.equal(changed.revision,original.revision);assert.equal(changed.snapshotHash,original.snapshotHash);
  assert.equal(changed.pinnedAt,original.pinnedAt);assert.equal(changed.pinRevision,original.pinRevision);
  assert.equal(changed.messages[0].text,'Original curated source.');
  assert.deepEqual(data.getMemory(id),before,'A source comparison must not revise memory, membership, origin or pin state.');
  f.state.unavailable=true;
  assert.equal((await f.app.history.readMemory(id)).sourceUpdates.state,'newer-retained','Retained comparison works while native OpenCode is offline.');
});

test('legacy captured message refs compare retained changes while unavailable or failed comparisons remain unknown',async t=>{
  const f=await localDataFixture({timers:false});t.after(()=>f.close());
  const data=f.app.localData.get(), source=openCodeSourceIdentity(f.nativeFile), session=f.state.sessions[0];
  const messages=text=>[{info:{id:'msg_legacy',role:'user'},parts:[{type:'text',text}]}];
  data.recordOpenCodeSnapshot({...source,projectID:f.project.id,session,messages:messages('Legacy retained original.'),projectionSafe:true});
  const ref=data.openCodeMessageRefs({sourceSystemID:source.sourceSystemID,projectID:f.project.id,sessionID:session.id}).messages[0];
  const saved=data.createMemory({kind:'conversation_snapshot',title:'Legacy evidence',body:'Legacy retained original.',
    source:{projectID:f.project.id,sessionID:session.id},provenance:{sourceSystem:source.sourceSystemID},
    boundary:{status:'complete',capturedAt:Date.now(),sourceUpdatedAt:session.time.updated},
    members:[{kind:'message',ref:`${source.sourceSystemID}/${f.project.id}/${session.id}/${ref.messageID}@${ref.revisionSha256}`,
      revision:ref.revisionSha256,locator:{role:'user',text:'Legacy retained original.'},availability:'retained'}]});
  assert.equal((await f.app.history.readMemory(saved.id)).sourceUpdates.state,'unchanged-retained');
  data.recordOpenCodeSnapshot({...source,projectID:f.project.id,session,messages:messages('Legacy retained changed.'),projectionSafe:true});
  assert.equal((await f.app.history.readMemory(saved.id)).sourceUpdates.state,'newer-retained');
  const missing=data.createMemory({kind:'conversation_snapshot',title:'Unknown source',body:'Historical text stays.',
    source:{projectID:f.project.id,sessionID:'ses_absent'},provenance:{sourceSystem:source.sourceSystemID},boundary:{status:'unknown_source'}});
  const unknown=await f.app.history.readMemory(missing.id);
  assert.equal(unknown.sourceUpdates.state,'unknown');assert.equal(unknown.coverage,'unknown_source');assert.equal(unknown.body,'Historical text stays.');
  const analyze=data.analyze;
  data.analyze=async()=>{throw Error('Local analysis unavailable.');};
  try {
    const failed=await f.app.history.readMemory(saved.id);
    assert.equal(failed.sourceUpdates.state,'unknown');assert.equal(failed.sourceUpdates.reason,'local-comparison-unavailable');
    assert.equal(failed.body,'Legacy retained original.');assert.equal(failed.coverage,'complete');
  } finally {data.analyze=analyze;}
});

test('file-backed memory compares exact retained source revisions and keeps missing or oversized bindings unknown',async t=>{
  const f=await localDataFixture({timers:false});t.after(()=>f.close());
  const data=f.app.localData.get(), db=new DatabaseSync(data.filename), sourceID='source:retained-file';
  const sha=text=>createHash('sha256').update(text).digest('hex'), original=sha('original'), current=sha('current');
  try {
    db.prepare(`INSERT INTO content_sources(project_key,filename,virtual_path,container_path,extension,source_role,status,routing_rank,
      file_size_bytes,modified_utc,sha256,unit_count,locator_kind,extraction_method,extraction_status,text_chars,word_count,source_identity,revision_identity)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(f.directory,'evidence.txt','evidence.txt',f.directory,'.txt','document','active',1,
        8,new Date().toISOString(),original,1,'lines','text','ok',8,1,sourceID,original);
    db.prepare('INSERT INTO content_source_revisions VALUES(?,?,?,?,?,?)').run(sourceID,original,f.directory,'evidence.txt','{}',Date.now());
    const memory=data.createMemory({kind:'note',title:'Curated file note',body:'Keep the originally selected evidence.',source:{projectID:f.project.id},
      members:[{kind:'content-unit',ref:sourceID,revision:original,availability:'retained'}]});
    const before=data.getMemory(memory.id), calls=f.calls.length;
    assert.equal((await f.app.history.readMemory(memory.id)).sourceUpdates.state,'unchanged-retained');
    db.prepare('INSERT INTO content_source_revisions VALUES(?,?,?,?,?,?)').run(sourceID,current,f.directory,'evidence.txt','{}',Date.now());
    db.prepare('UPDATE content_sources SET revision_identity=?,sha256=? WHERE source_identity=?').run(current,current,sourceID);
    assert.equal((await f.app.history.readMemory(memory.id)).sourceUpdates.state,'newer-retained');
    db.prepare('DELETE FROM content_sources WHERE source_identity=?').run(sourceID);
    const unknown=await f.app.history.readMemory(memory.id);
    assert.equal(unknown.sourceUpdates.state,'unknown');assert.equal(unknown.status,'active');
    assert.equal(unknown.members[0].availability,'retained');assert.deepEqual(data.getMemory(memory.id),before);assert.equal(f.calls.length,calls);
    const oversized=data.createMemory({kind:'note',title:'Oversized binding',body:'Its exact evidence remains retained.',
      members:[{kind:'content-unit',ref:sourceID,revision:'x'.repeat(20_000),availability:'retained'}]});
    const bounded=await f.app.history.readMemory(oversized.id);
    assert.equal(bounded.sourceUpdates.state,'unknown');assert.equal(bounded.sourceUpdates.truncated,true);
    assert.equal(bounded.members[0].revision.length,20_000,'Comparison bounds must not truncate the exact retained reader.');
  } finally {db.close();}
});

test('unbound authored notes skip analytics while imported and unbound snapshots remain unknown without native reads',async t=>{
  const f=await localDataFixture({timers:false});t.after(()=>f.close());
  const data=f.app.localData.get(), calls=f.calls.length;
  const note=data.createMemory({kind:'note',title:'Plain authored note',body:'No source binding to compare.'});
  const imported=data.createMemory({kind:'conversation_snapshot',title:'Imported evidence',body:'Imported retained text.',
    source:{projectID:f.project.id,sessionID:'imported-conversation'},provenance:{sourceSystem:'imported'}});
  const unbound=data.createMemory({kind:'conversation_snapshot',title:'Unbound evidence',body:'Historical retained text.'});
  const analyze=data.analyze;let analyzed=0;
  data.analyze=async()=>{analyzed++;throw Error('An unbound memory must not open an analytics worker.');};
  try {
    assert.equal((await f.app.history.readMemory(note.id)).sourceUpdates.state,'not-applicable');
    for (const memory of [imported,unbound]) {
      const read=await f.app.history.readMemory(memory.id);
      assert.equal(read.sourceUpdates.state,'unknown');assert.equal(read.sourceUpdates.liveSource,'not-checked');
      assert.equal(read.sourceUpdates.unknownSources,1);assert.equal(read.body,data.getMemory(memory.id).revision.body);
    }
    assert.equal(analyzed,0);assert.equal(f.calls.length,calls);
  } finally {data.analyze=analyze;}
});
