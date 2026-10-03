import test from 'node:test';
import assert from 'node:assert/strict';
import { gitProjectFixture } from './fixtures/git-project-app.mjs';
import { readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { projectAgreement } from '../domain/git-project.mjs';

async function fixture(t) {
  const f=await gitProjectFixture();t.after(()=>f.close());
  const previous=process.env.FREELANCER_GIT_BRIDGE;process.env.FREELANCER_GIT_BRIDGE='record-evidence-fixture';
  t.after(()=>{if(previous===undefined)delete process.env.FREELANCER_GIT_BRIDGE;else process.env.FREELANCER_GIT_BRIDGE=previous;});
  const send=async body=>{
    const response=await fetch(f.url+'/api/knowledge/agent',{method:'POST',headers:{'Content-Type':'application/json','X-Freelancer-Git-Bridge':'record-evidence-fixture'},body:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  };
  const data=f.app.localData.get();
  data.createJudgmentDefinition({id:'record-fit',version:1,questionID:'fit',primitive:'check',question:'Does this record concern painting?',criteria:{}});
  return {...f,data,send};
}
const request=packet=>({operation:'judgment-evaluate',definitionID:'record-fit',definitionVersion:1,requestedModel:'jev-fixture',
  stateJson:JSON.stringify(packet.state),candidateIDsJson:JSON.stringify(packet.candidateIDs),evidenceRefsJson:JSON.stringify(packet.evidenceRefs)});
const result={status:'ok',requestedProvider:'typesafe',requestedModel:'jev-fixture',reportedProvider:'typesafe',reportedModel:'jev-fixture',
  latencyMs:1,usage:{input_tokens:20,output_tokens:1},results:[{questionID:'fit',answer:{probabilityYes:0.9}}]};

test('native record packet operation supports memory and claims with cache invalidation after correction',async t=>{
  const {app,data,send}=await fixture(t);
  const memory=data.createMemory({id:'authored-note',kind:'note',title:'Painting',body:'The walls were painted blue.'});
  data.setMemoryPin({id:memory.id,pinned:true,expectedRevision:0});
  const claim=data.addClaim({id:'authored-claim',predicate:'wall color',value:'blue',origin:'human-authored',epistemicState:'unverified',
    evidence:[{id:`memory:${memory.id}@1`,kind:'memory',memoryID:memory.id,memoryRevision:1}]});
  let calls=0;
  app.judgmentProvider={async evaluate(){calls++;return result;}};
  const note=await send({operation:'judgment-evidence',domain:'memories',id:memory.id,revision:1,query:'painting'});
  assert.equal(note.status,200,JSON.stringify(note));assert.equal(note.body.state.evidence[0].text,'The walls were painted blue.');
  const packet=await send({operation:'query-evidence',domain:'facts',id:claim.id,query:'painting'});
  assert.equal(packet.status,200,JSON.stringify(packet));
  const first=await send(request(packet.body));assert.equal(first.status,200);assert.equal(first.body.status,'ok');
  const cached=await send(request(packet.body));assert.equal(cached.status,200);assert.equal(cached.body.cached,true);assert.equal(calls,1);
  data.correctClaim({id:claim.id,epistemicState:'disputed',value:'red',evidence:[{id:'human-correction',detail:'The wall is red.'}]});
  const stale=await send(request(packet.body));assert.equal(stale.status,400);assert.equal(calls,1,'stale record never reaches the provider');
  const old=await send({operation:'judgment-history'});assert.equal(old.status,200);assert.equal(old.body[0].runID,first.body.runID);
  data.forgetMemory({id:memory.id});
  assert.equal((await send(request(note.body))).status,400);
  assert.equal((await send({operation:'judgment-evidence',domain:'memories',id:memory.id,revision:1})).status,400);
});

for (const batch of [false,true]) test(`source changes during ${batch?'batch':'single'} evaluation retain a failed receipt instead of a reusable success`,async t=>{
  const {app,data,send}=await fixture(t);
  const memory=data.createMemory({id:'race-note',kind:'note',title:'Painting',body:'Recorded painting evidence.'});
  const packet=(await send({operation:'judgment-evidence',domain:'memories',id:memory.id,revision:1})).body;
  app.judgmentProvider={async evaluate(){data.forgetMemory({id:memory.id});return result;},async evaluateMany(){data.forgetMemory({id:memory.id});return result;}};
  const input=request(packet);
  if(batch) {input.operation='judgment-evaluate-batch';input.definitionsJson=JSON.stringify([{id:'record-fit',version:1}]);}
  const response=await send(input);
  assert.equal(response.status,200,JSON.stringify(response));assert.equal(response.body.status,'evidence-changed');
  assert.equal(response.body.resultsReusable,false);
  const history=data.judgmentHistory();assert.equal(history.length,1);assert.equal(history[0].status,'evidence-changed');
  assert.deepEqual(JSON.parse(history[0].answerJson),{probabilityYes:0.9},'actual answer remains a historical receipt');
  assert.equal(JSON.parse(history[0].derivedJson).staleEvidence,true);
  assert.equal(JSON.parse(history[0].usageJson).input_tokens,20,'actual provider usage remains recorded');
  if(!batch) assert.equal(response.body.results[0].derived.staleEvidence,true);
  assert.equal(data.findCachedJudgment({definitionID:'record-fit',definitionVersion:1,stateHash:history[0].stateHash,candidateIDs:packet.candidateIDs,
    evidenceRefs:packet.evidenceRefs,requestedProvider:'typesafe',requestedModel:'jev-fixture',reportedProvider:'typesafe',reportedModel:'jev-fixture'}).status,'miss');
});

test('optional judgment failure and high confidence leave retrieval, pins, native denial and saved Git agreement intact',async t=>{
  const {app,data,store,project,directory,send}=await fixture(t);
  const nativeFile=path.join(directory,'opencode.jsonc'),nativeBytes=Buffer.from('{\n // native authority\n "permission":{"edit":"deny","bash":"deny"}\n}\n');
  await writeFile(nativeFile,nativeBytes);
  await store.update('settings',settings=>({...settings,gitProjects:{...settings.gitProjects,[project.id]:{...projectAgreement({tracking:true,preset:'inspect'}),revision:7}}}));
  const settingsBefore=await store.read('settings'),agreementBefore=await app.gitProjects.policy(project.id);
  const memory=data.createMemory({id:'optional-note',kind:'note',title:'Painting evidence',body:'Painting evidence remains stored.',source:{projectID:project.id}});
  let calls=0;
  app.judgmentProvider={async evaluate(){calls++;throw Error('Ordinary reads must never call an optional provider');}};
  const query=()=>send({operation:'query',domain:'memories',query:'Painting',projectID:project.id});
  assert.equal((await query()).body.results[0].id,memory.id);
  const pin=await send({operation:'pin',id:memory.id,pinned:true,expectedRevision:0});assert.equal(pin.status,200);
  assert.equal((await send({operation:'read',id:memory.id,revision:1})).body.revision.body,'Painting evidence remains stored.');
  assert.equal(calls,0,'query, pin and stored revision reads do not require Jev');
  const packet=async()=> (await send({operation:'judgment-evidence',domain:'memories',id:memory.id,revision:1})).body;
  app.judgmentProvider={async evaluate(){calls++;return {status:'provider-failed',requestedProvider:'typesafe',requestedModel:'jev-fixture',reportedProvider:null,reportedModel:null,
    latencyMs:1,failure:'Synthetic provider is unavailable.'};}};
  const failed=await send(request(await packet()));assert.equal(failed.status,200);assert.equal(failed.body.status,'provider-failed');
  assert.equal((await query()).body.results[0].id,memory.id);
  assert.ok((await send({operation:'read',id:memory.id})).body.pinnedAt);
  const unpin=await send({operation:'pin',id:memory.id,pinned:false,expectedRevision:pin.body.pinRevision});assert.equal(unpin.status,200);
  assert.equal(calls,1,'ordinary work stays independent after provider failure');
  app.judgmentProvider={async evaluate(){calls++;return {...result,results:[{questionID:'fit',answer:{probabilityYes:1,permission:'allow',action:'publish'},confidence:1}]};}};
  const confident=await send(request(await packet()));assert.equal(confident.status,200);assert.equal(confident.body.status,'ok');
  assert.equal(confident.body.results[0].confidence,1);
  assert.deepEqual(await store.read('settings'),settingsBefore,'typed answers never update authored settings');
  assert.deepEqual(await app.gitProjects.policy(project.id),agreementBefore,'confidence cannot rewrite the saved Git agreement');
  assert.deepEqual(await readFile(nativeFile),nativeBytes,'typed answers never rewrite native deny rules');
  assert.equal((await send({operation:'read',id:memory.id,revision:1})).body.revision.body,'Painting evidence remains stored.');
  assert.equal(data.judgmentHistory().find(row=>row.status==='provider-failed').answerJson.includes('Synthetic provider is unavailable.'),true);
});
