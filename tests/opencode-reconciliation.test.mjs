import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLocalDataStore } from '../server/data/store.mjs';
import { openCodeSnapshotProof, openCodeSourceIdentity } from '../server/data/opencode-warehouse.mjs';
import { localDataFixture } from './fixtures/local-data-app.mjs';

const message = (id,text) => ({info:{id,role:'assistant',time:{created:100}},parts:[{id:`${id}-part`,type:'text',text}]});

test('warehouse reconciles absent current messages only from a complete archived-session snapshot and keeps old revisions', async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),'freelancer-opencode-reconcile-'));
  const store=createLocalDataStore(root);
  t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  const source=openCodeSourceIdentity('C:/fixture/opencode.db');
  const projectID='registered-project';
  const archived={id:'ses_reconcile',title:'Archived conversation',directory:'C:/fixture',time:{created:10,updated:200,archived:200}};
  const original=[message('msg_keep','keep'),message('msg_later_removed','removed later')];
  store.recordOpenCodeSnapshot({...source,projectID,session:archived,messages:original});

  const partial=store.recordOpenCodeSnapshot({...source,projectID,session:archived,messages:[original[0]],snapshotCompleteness:'partial'});
  assert.equal(partial.reconciled,false);
  assert.equal(partial.messagesRemoved,0);
  assert.equal(store.readOpenCodeSession({projectID,sessionID:archived.id,sourceSystemID:source.sourceSystemID}).messages.length,2);

  const completeMessages=[original[0]];
  const proof=openCodeSnapshotProof(archived,completeMessages);
  assert.ok(proof);
  const complete=store.recordOpenCodeSnapshot({...source,projectID,session:archived,messages:completeMessages,
    snapshotCompleteness:'complete',snapshotProof:proof});
  assert.equal(complete.reconciled,true);
  assert.equal(complete.messagesRemoved,1);
  const current=store.readOpenCodeSession({projectID,sessionID:archived.id,sourceSystemID:source.sourceSystemID});
  assert.deepEqual(current.messages.map(row=>row.messageID),['msg_keep']);
  const refs=store.openCodeMessageRefs({projectID,sessionID:archived.id,sourceSystemID:source.sourceSystemID});
  assert.deepEqual(refs.messages.map(({messageID,revisionSha256})=>({messageID,revisionSha256})),
    current.messages.map(({messageID,revisionSha256})=>({messageID,revisionSha256})));
  assert.equal(Object.hasOwn(refs.messages[0],'info'),false,'reference listing does not duplicate message payloads');
  const db=new (await import('node:sqlite')).DatabaseSync(store.filename,{readOnly:true});
  try {
    assert.equal(db.prepare(`SELECT count(*) n FROM opencode_message_revisions WHERE source_system_id=? AND project_id=? AND session_id=? AND message_id=?`)
      .get(source.sourceSystemID,projectID,archived.id,'msg_later_removed').n,1,'removed current messages keep immutable captured revisions');
  } finally { db.close(); }
});

test('active, partial, and mismatched-header snapshots cannot reconcile warehouse rows', async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),'freelancer-opencode-partial-'));
  const store=createLocalDataStore(root);
  t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  const source=openCodeSourceIdentity('C:/fixture/opencode.db'),projectID='registered-project';
  const active={id:'ses_active',title:'Active conversation',directory:'C:/fixture',time:{created:10,updated:100}};
  const messages=[message('msg_one','one'),message('msg_two','two')];
  store.recordOpenCodeSnapshot({...source,projectID,session:active,messages});
  assert.equal(openCodeSnapshotProof(active,messages),null);
  assert.throws(()=>store.recordOpenCodeSnapshot({...source,projectID,session:active,messages:[messages[0]],snapshotCompleteness:'complete',
    snapshotProof:{kind:'opencode-archived-session-messages',sessionID:active.id,archivedAt:100,messageCount:1,messageIDsSha256:'0'.repeat(64)}}),/complete archived-session/);
  assert.equal(store.readOpenCodeSession({projectID,sessionID:active.id,sourceSystemID:source.sourceSystemID}).messages.length,2);
  const archived={...active,time:{...active.time,archived:150}};
  const validProof=openCodeSnapshotProof(archived,[messages[0]]);
  assert.throws(()=>store.recordOpenCodeSnapshot({...source,projectID,session:archived,messages:[messages[0]],snapshotCompleteness:'complete',
    snapshotProof:{...validProof,archivedAt:149}}),/complete archived-session/);
  assert.equal(store.readOpenCodeSession({projectID,sessionID:active.id,sourceSystemID:source.sourceSystemID}).messages.length,2);
});

test('repeated attachment and measured usage snapshots deduplicate while changed native references retain new revisions', async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),'freelancer-opencode-attachments-')),store=createLocalDataStore(root);
  t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  const source=openCodeSourceIdentity('C:/fixture/attachment-opencode.db'),projectID='attachment-project';
  const session={id:'ses_attachments',title:'Native attachment metadata',directory:'C:/fixture',time:{created:10,updated:200}};
  const messages=[{info:{id:'msg_attachments',role:'assistant',providerID:'fixture',modelID:'reported-model',cost:0.25,
    tokens:{input:20,output:7,cache:{read:2,write:0}}},parts:[
    {id:'part_file',type:'file',mime:'image/png',filename:'fixture.png',url:'data:image/png;base64,ZmFrZQ==',
      source:{type:'file',path:'C:/fixture/fixture.png',text:{value:'fixture.png',start:0,end:11},access_token:'never-store'}},
    {id:'part_step',type:'step-finish',reason:'stop',cost:0.25,tokens:{input:20,output:7}},
    {id:'part_text',type:'text',text:'The source attachment was provided.'},
  ]}];
  const first=store.recordOpenCodeSnapshot({...source,projectID,session,messages});
  assert.equal(first.messageRevisionsAdded,1);
  assert.equal(store.recordOpenCodeSnapshot({...source,projectID,session,messages}).messageRevisionsAdded,0);
  let current=store.readOpenCodeSession({projectID,sessionID:session.id});
  assert.equal(current.messages.length,1);
  const attachment=current.messages[0].parts.find(part=>part.type==='file');
  assert.equal(attachment.source.path,'C:/fixture/fixture.png');
  assert.match(attachment.referenceSha256,/^[a-f0-9]{64}$/);
  assert.equal(attachment.availability,'metadata-only');
  assert.equal(attachment.payloadBytes,null,'uncaptured attachment bytes are unknown, not claimed empty');
  assert.equal(current.messages[0].info.tokens.input,20);
  assert.equal(current.messages[0].parts.find(part=>part.type==='step-finish').cost,0.25);
  assert.doesNotMatch(JSON.stringify(current),/never-store|ZmFrZQ|access_token/);
  const changed=structuredClone(messages);changed[0].parts[0].url='data:image/png;base64,b3RoZXI=';
  changed[0].info.tokens.output=8;
  const second=store.recordOpenCodeSnapshot({...source,projectID,session,messages:changed});
  assert.equal(second.messageRevisionsAdded,1);
  assert.equal(store.recordOpenCodeSnapshot({...source,projectID,session,messages:changed}).messageRevisionsAdded,0);
  current=store.readOpenCodeSession({projectID,sessionID:session.id});
  assert.equal(current.messages.length,1);
  assert.notEqual(current.messages[0].parts.find(part=>part.type==='file').referenceSha256,attachment.referenceSha256);
  const db=new (await import('node:sqlite')).DatabaseSync(store.filename,{readOnly:true});
  try {assert.equal(db.prepare('SELECT count(*) n FROM opencode_message_revisions').get().n,2);}
  finally {db.close();}
});

test('refreshing the native recent session window retains searchable older and archived conversations',async t=>{
  const f=await localDataFixture({timers:false});t.after(()=>f.close());
  const data=f.app.localData.get(),session={id:'ses_older_archived',title:'Older archived evidence',directory:f.project.directory,
    time:{created:1,updated:2,archived:3}};
  data.indexChat(f.project.id,session,[message('msg_retained_older','Retained heliotrope evidence outside the recent window.')]);
  const request=f.host.request.bind(f.host);
  f.host.request=(route,options)=>route==='/session'?Promise.resolve(structuredClone(f.state.sessions)):request(route,options);
  const refreshed=await f.app.history.rebuildChatSearch({projectID:f.project.id});
  assert.equal(refreshed.failures.length,0);
  assert.ok(Object.hasOwn(data.chatIndexState(f.project.id),session.id));
  const found=await f.app.history.searchChats('heliotrope',{project:f.project.id});
  assert.equal(found.results[0].session,session.id);
  assert.equal(found.results[0].organization.archived,true);
});
