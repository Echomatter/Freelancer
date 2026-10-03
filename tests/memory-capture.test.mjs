import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { localDataFixture } from './fixtures/local-data-app.mjs';

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
