import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gitProjectFixture } from './fixtures/git-project-app.mjs';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { openCodeEvidenceCandidateID } from '../server/data/judgment-evidence.mjs';

const executeNode = promisify(execFile);
// The HTTP fixture shares this event loop; leave its socket lifecycle responsive.
async function runNode(args, options = {}) {
  const output = await executeNode(process.execPath, args, { encoding: 'utf8', timeout: 30_000, windowsHide: true, ...options });
  return { ...output, status: 0 }; // execFile rejects unsuccessful child exits.
}

async function indexedEvidence(f, { filename, text, query }) {
  const data=f.app.localData.get(),projectKey=process.platform==='win32'?f.project.directory.toLowerCase():f.project.directory;
  await writeFile(path.join(f.project.directory,filename),text);
  const indexed=await runNode([path.resolve('backend/tools/project-content-indexer.mjs'),'--db',data.filename,'--project-key',projectKey,
    'rebuild','--root',f.project.directory,'--facts','none'],{cwd:f.project.directory,encoding:'utf8'});
  assert.equal(indexed.status,0,indexed.stderr);
  const hit=data.searchFiles(query,[projectKey]).find(row=>row.path===filename);
  assert.ok(hit,`fixture source ${filename} was indexed`);
  const ref={kind:'content-unit',candidateID:hit.sourceIdentity,sourceIdentity:hit.sourceIdentity,revisionIdentity:hit.revisionIdentity,
    locator:hit.locator,unitSha256:hit.unitSha256};
  return {candidateIDs:[hit.sourceIdentity],evidenceRefs:[ref],packet:[{...ref,text}]};
}

test('knowledge bridge is private, shared, and delegates typed operations to local data', async t => {
  const f = await gitProjectFixture(); t.after(() => f.close());
  const prior = process.env.FREELANCER_GIT_BRIDGE;
  process.env.FREELANCER_GIT_BRIDGE = 'knowledge-test-secret';
  t.after(() => { if (prior === undefined) delete process.env.FREELANCER_GIT_BRIDGE; else process.env.FREELANCER_GIT_BRIDGE = prior; });
  const request = (headers = {}) => fetch(f.url + '/api/knowledge/agent', {
    method: 'POST', headers: { 'X-Freelancer-Client': 'webpage', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ operation: 'status' }),
  });
  assert.equal((await request()).status, 403);
  assert.equal((await request({ 'X-Freelancer-Git-Bridge': 'wrong' })).status, 403);
  const response = await request({ 'X-Freelancer-Git-Bridge': 'knowledge-test-secret' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { entities: 0, claims: 0, memories: 0, pinned: 0 });
  const claim = f.app.localData.get().addClaim({ predicate: 'uses', origin: 'user-stated', method: 'test', epistemicState: 'supported', scope: { version: 1 }, evidence: [{ id: 'source:1#L1' }] });
  const correction = await fetch(f.url + '/api/knowledge/agent', {
    method: 'POST', headers: { 'X-Freelancer-Client': 'webpage', 'Content-Type': 'application/json', 'X-Freelancer-Git-Bridge': 'knowledge-test-secret' },
    body: JSON.stringify({ operation: 'correct-claim', id: claim.id, predicate: 'uses safely', epistemicState: 'supported', evidenceJson: JSON.stringify({ items: [{ id: 'source:2#L4' }] }), sessionID: 'test-session' }),
  });
  assert.equal(correction.status, 200);
  const result = await correction.json();
  assert.equal(result.corrected, true);
  assert.equal((await f.app.localData.get().analyze('SELECT epistemic_state FROM claims WHERE claim_id=$id', { $id: claim.id })).rows[0].epistemic_state, 'superseded');
});

test('knowledge graph supports bounded relation reads and audited deletes without deleting claim-referenced entities', async t => {
  const f=await gitProjectFixture();t.after(()=>f.close());
  const prior=process.env.FREELANCER_GIT_BRIDGE;process.env.FREELANCER_GIT_BRIDGE='knowledge-graph-delete-secret';
  t.after(()=>{if(prior===undefined)delete process.env.FREELANCER_GIT_BRIDGE;else process.env.FREELANCER_GIT_BRIDGE=prior;});
  const send=body=>fetch(f.url+'/api/knowledge/agent',{method:'POST',headers:{'X-Freelancer-Client':'webpage','Content-Type':'application/json','X-Freelancer-Git-Bridge':'knowledge-graph-delete-secret'},body:JSON.stringify(body)});
  let response=await send({operation:'entity',type:'fixture',name:'Graph node A',directory:f.project.directory});assert.equal(response.status,200,await response.clone().text());const a=await response.json();
  response=await send({operation:'entity',type:'fixture',name:'Graph node B',directory:f.project.directory});assert.equal(response.status,200,await response.clone().text());const b=await response.json();
  response=await send({operation:'entity-search',query:'Graph node A'});assert.equal(response.status,200);assert.deepEqual((await response.json()).entities.map(row=>row.id),[a.id]);
  response=await send({operation:'relate',from:a.id,to:b.id,type:'connects'});assert.equal(response.status,200);const relation=await response.json();
  response=await send({operation:'relations',id:a.id,limit:10});assert.equal(response.status,200);assert.deepEqual((await response.json()).relations.map(row=>row.id),[relation.id]);
  const claim=f.app.localData.get().addClaim({subjectEntityID:a.id,predicate:'supports',origin:'user-stated',epistemicState:'supported',evidence:[{id:'fixture:source#L1'}]});
  response=await send({operation:'delete-relation',relationID:relation.id,reason:'fixture'});assert.equal(response.status,200);assert.deepEqual(await response.json(),{id:relation.id,deleted:true});
  response=await send({operation:'delete-relation',relationID:relation.id});assert.equal(response.status,200);assert.deepEqual(await response.json(),{id:relation.id,deleted:false});
  response=await send({operation:'delete-entity',id:a.id,reason:'must retain claim'});assert.equal(response.status,200);assert.deepEqual(await response.json(),{id:a.id,deleted:false,reason:'claims_reference_entity',claimsRetained:1});
  assert.equal((await f.app.localData.get().analyze('SELECT count(*) AS n FROM claims WHERE claim_id=$id',{$id:claim.id})).rows[0].n,1);
  const c=await (await send({operation:'entity',type:'fixture',name:'Graph node C',directory:f.project.directory})).json();
  const d=await (await send({operation:'entity',type:'fixture',name:'Graph node D',directory:f.project.directory})).json();
  const remaining=await (await send({operation:'relate',from:c.id,to:d.id,type:'second-edge'})).json();
  response=await send({operation:'delete-entity',id:c.id,reason:'fixture cleanup'});assert.equal(response.status,200);assert.deepEqual(await response.json(),{id:c.id,deleted:true,relationsDeleted:1});
  response=await send({operation:'relations',id:d.id});assert.deepEqual((await response.json()).relations,[]);
  response=await send({operation:'delete-entity',id:c.id});assert.deepEqual(await response.json(),{id:c.id,deleted:false,relationsDeleted:0});
  assert.ok(remaining.created);
});

test('knowledge bridge records immutable typed judgments and retains provider failures', async t => {
  const f=await gitProjectFixture();t.after(()=>f.close());
  const prior=process.env.FREELANCER_GIT_BRIDGE;process.env.FREELANCER_GIT_BRIDGE='judgment-test-secret';
  t.after(()=>{if(prior===undefined)delete process.env.FREELANCER_GIT_BRIDGE;else process.env.FREELANCER_GIT_BRIDGE=prior;});
  const send=body=>fetch(f.url+'/api/knowledge/agent',{method:'POST',headers:{'X-Freelancer-Client':'webpage','Content-Type':'application/json','X-Freelancer-Git-Bridge':'judgment-test-secret'},body:JSON.stringify(body)});
  const definition={operation:'judgment-definition',definitionID:'fixture-relevance',definitionVersion:1,questionID:'relevance',primitive:'classify',
    questionJson:JSON.stringify('Which synthetic source is more relevant to the synthetic query?'),
    criteriaJson:JSON.stringify({options:{a:'Directly addresses the query',b:'Only mentions a related term'}})};
  let response=await send(definition);assert.equal(response.status,200,await response.text());
  response=await send({...definition,questionJson:JSON.stringify('Changed question')});assert.equal(response.status,400);
  const run={definitionID:'fixture-relevance',definitionVersion:1,stateHash:'a'.repeat(64),candidateIDs:['source:a@r1','source:b@r2'],
    evidenceRefs:[{id:'source:a@r1#unit-1',sha256:'sha-a'},{id:'source:b@r2#unit-3',sha256:'sha-b'}],
    requestedProvider:'jev',requestedModel:'jev-latest',reportedProvider:'jev',reportedModel:'jev-latest',status:'ok',latencyMs:13,
    usage:{input_tokens:31,output_tokens:8},results:[{questionID:'relevance',answer:{choice:'a',action:'review'},probabilities:{a:0.7,b:0.2,none:0.1},confidence:0.7}]};
  response=await send({operation:'judgment-record',runJson:JSON.stringify(run)});const savedText=await response.text();assert.equal(response.status,200,savedText);const saved=JSON.parse(savedText);
  const cacheRequest={operation:'judgment-cache',definitionID:'fixture-relevance',definitionVersion:1,stateHash:'a'.repeat(64),
    candidateIDsJson:JSON.stringify(run.candidateIDs),evidenceRefsJson:JSON.stringify(run.evidenceRefs),requestedProvider:'jev',requestedModel:'jev-latest',reportedProvider:'jev',reportedModel:'jev-latest'};
  response=await send(cacheRequest);assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:'hit',runID:saved.runID});
  response=await send({...cacheRequest,evidenceRefsJson:JSON.stringify([{...run.evidenceRefs[0]}, {...run.evidenceRefs[1],sha256:'changed-revision'}])});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:'miss',runID:null});
  const failed={...run,runID:'fixture-failure',stateHash:'b'.repeat(64),candidateIDs:[],evidenceRefs:[],reportedProvider:null,reportedModel:null,status:'provider-failed',latencyMs:null,usage:undefined,
    results:[{questionID:'relevance',answer:{error:'synthetic provider timeout'}}]};
  response=await send({operation:'judgment-record',runJson:JSON.stringify(failed)});const failedText=await response.text();assert.equal(response.status,200,failedText);
  response=await send({operation:'judgment-history',definitionID:'fixture-relevance',limit:10});assert.equal(response.status,200);const history=await response.json();
  assert.equal(history.length,2);assert.equal(history.find(row=>row.runID===saved.runID).reportedModel,'jev-latest');
  const failure=history.find(row=>row.runID==='fixture-failure');assert.equal(failure.status,'provider-failed');assert.deepEqual(JSON.parse(failure.answerJson),{error:'synthetic provider timeout'});
});

test('knowledge bridge sends bounded evidence to TypeSafe only for an explicit evaluation and stores a provenance receipt', async t => {
  const f=await gitProjectFixture();t.after(()=>f.close());
  const prior=process.env.FREELANCER_GIT_BRIDGE;process.env.FREELANCER_GIT_BRIDGE='judgment-evaluate-test-secret';
  t.after(()=>{if(prior===undefined)delete process.env.FREELANCER_GIT_BRIDGE;else process.env.FREELANCER_GIT_BRIDGE=prior;});
  const data=f.app.localData.get();
  data.createJudgmentDefinition({id:'fixture-evidence-fit',version:1,questionID:'evidence_fit',primitive:'score',
    question:'How strongly does the cited evidence support the requested answer?',criteria:{levels:['Does not support','Partly supports','Directly supports']}});
  let received,calls=0;
  f.app.judgmentProvider={status:()=>({configured:true,provider:'typesafe',requestedModel:'jev-latest',connectivity:'not-checked'}),async evaluate(input){received=input;calls++;return {status:'ok',requestedProvider:'typesafe',requestedModel:input.model??'jev-latest',
    reportedProvider:'typesafe',reportedModel:'jev-1.13.0',latencyMs:19,usage:{input_tokens:87,output_tokens:5},
    results:[{questionID:'evidence_fit',answer:{score:2},probabilities:{0:0,1:0,2:1},confidence:0.96,derived:{score:2}}]};}};
  const send=body=>fetch(f.url+'/api/knowledge/agent',{method:'POST',headers:{'X-Freelancer-Client':'webpage','Content-Type':'application/json','X-Freelancer-Git-Bridge':'judgment-evaluate-test-secret'},body:JSON.stringify(body)});
  const providerStatus=await send({operation:'judgment-provider-status'});assert.equal(providerStatus.status,200);assert.deepEqual(await providerStatus.json(),{configured:true,provider:'typesafe',requestedModel:'jev-latest',connectivity:'not-checked'});
  const evidence=await indexedEvidence(f,{filename:'judgment-evidence.txt',text:'Use a staged import and verify each row. Retain each source hash.',query:'staged'});
  const state={query:'Which migration path preserves unrelated state?',evidence:evidence.packet};
  const missingEvidence=await send({operation:'judgment-evaluate',definitionID:'fixture-evidence-fit',definitionVersion:1,stateJson:JSON.stringify(state),candidateIDsJson:'[]',evidenceRefsJson:'[]'});
  assert.equal(missingEvidence.status,400);assert.equal(received,undefined,'no provider call occurs without stable evidence references');
  const response=await send({operation:'judgment-evaluate',definitionID:'fixture-evidence-fit',definitionVersion:1,stateJson:JSON.stringify(state),
    candidateIDsJson:JSON.stringify(evidence.candidateIDs),evidenceRefsJson:JSON.stringify(evidence.evidenceRefs)});
  assert.equal(response.status,200,await response.clone().text());
  const result=await response.json();assert.equal(result.status,'ok');assert.equal(result.reportedModel,'jev-1.13.0');
  assert.equal(received.state.query,state.query);assert.equal(received.definition.questionID,'evidence_fit');
  const staleRef={...evidence.evidenceRefs[0],unitSha256:'a'.repeat(64)};
  const staleCitation=await send({operation:'judgment-evaluate',definitionID:'fixture-evidence-fit',definitionVersion:1,stateJson:JSON.stringify({...state,evidence:[{...evidence.packet[0],unitSha256:staleRef.unitSha256}]}),
    candidateIDsJson:JSON.stringify(evidence.candidateIDs),evidenceRefsJson:JSON.stringify([staleRef])});
  assert.equal(staleCitation.status,400);assert.equal(calls,1,'a stale source hash is rejected before TypeSafe is called');
  const history=data.judgmentHistory({definitionID:'fixture-evidence-fit',limit:5});assert.equal(history.length,1);
  assert.equal(history[0].reportedProvider,'typesafe');assert.equal(history[0].reportedModel,'jev-1.13.0');
  assert.deepEqual(JSON.parse(history[0].usageJson),{input_tokens:87,output_tokens:5});
  assert.equal(history[0].status,'ok');assert.equal(history[0].answerJson.includes(state.evidence[0].text),false);
  const pinnedRequest={operation:'judgment-evaluate',definitionID:'fixture-evidence-fit',definitionVersion:1,requestedModel:'jev-1.13.0',stateJson:JSON.stringify(state),
    candidateIDsJson:JSON.stringify(evidence.candidateIDs),evidenceRefsJson:JSON.stringify(evidence.evidenceRefs)};
  const pinnedFirst=await send(pinnedRequest);assert.equal(pinnedFirst.status,200,await pinnedFirst.clone().text());const firstResult=await pinnedFirst.json();assert.equal(firstResult.cached,undefined);
  const directCache=data.readCachedJudgment({definitionID:'fixture-evidence-fit',definitionVersion:1,stateHash:firstResult.stateHash,candidateIDs:evidence.candidateIDs,
    evidenceRefs:evidence.evidenceRefs,requestedProvider:'typesafe',requestedModel:'jev-1.13.0',reportedProvider:'typesafe',reportedModel:'jev-1.13.0'});
  assert.equal(directCache.status,'hit',JSON.stringify(directCache));
  const callCountAfterPinnedRun=calls;
  const pinnedAgain=await send(pinnedRequest);assert.equal(pinnedAgain.status,200);const cachedResult=await pinnedAgain.json();
  assert.equal(calls,callCountAfterPinnedRun,'an exact immutable reported model reuses its matching successful receipt');
  assert.equal(cachedResult.cached,true);assert.equal(cachedResult.runID,firstResult.runID);assert.deepEqual(cachedResult.results,firstResult.results);
  const changedState={...state,evidence:[{...evidence.packet[0],text:'Retain each source hash.'}]};
  const changedEvidence=await send({...pinnedRequest,stateJson:JSON.stringify(changedState)});
  assert.equal(changedEvidence.status,200);assert.equal((await changedEvidence.json()).cached,undefined,'changed evidence forces a live judgment');
  data.createJudgmentDefinition({id:'fixture-evidence-fit',version:2,questionID:'evidence_fit',primitive:'score',
    question:'How strongly does the cited evidence support the requested answer?',criteria:{levels:['Does not support','Partly supports','Directly supports','Contradicts']}});
  const changedCriteria=await send({...pinnedRequest,definitionVersion:2});
  assert.equal(changedCriteria.status,200);assert.equal((await changedCriteria.json()).cached,undefined,'a new immutable criteria version cannot reuse the older judgment');
  await writeFile(path.join(f.project.directory,'judgment-evidence.txt'),'The source file now has a newer revision.');
  const projectKey=process.platform==='win32'?f.project.directory.toLowerCase():f.project.directory;
  const reindex=await runNode([path.resolve('backend/tools/project-content-indexer.mjs'),'--db',data.filename,'--project-key',projectKey,
    'rebuild','--root',f.project.directory,'--facts','none'],{cwd:f.project.directory,encoding:'utf8'});
  assert.equal(reindex.status,0,reindex.stderr);
  const callsBeforeHistoricalReuse=calls;
  const historicalCitation=await send(pinnedRequest);
  assert.equal(historicalCitation.status,200,await historicalCitation.clone().text());
  assert.equal((await historicalCitation.json()).cached,true,'a stable prior source revision remains resolvable after reindexing');
  assert.equal(calls,callsBeforeHistoricalReuse,'resolving a historical citation does not require a new provider call on an exact cache hit');
  const tooLarge=await send({operation:'judgment-evaluate',definitionID:'fixture-evidence-fit',definitionVersion:1,stateJson:JSON.stringify({text:'x'.repeat(130_000)})});
  assert.equal(tooLarge.status,400);
});

test('knowledge bridge batches independent TypeSafe questions once and records shared usage without double-counting', async t => {
  const f=await gitProjectFixture();t.after(()=>f.close());
  const prior=process.env.FREELANCER_GIT_BRIDGE;process.env.FREELANCER_GIT_BRIDGE='judgment-batch-test-secret';
  t.after(()=>{if(prior===undefined)delete process.env.FREELANCER_GIT_BRIDGE;else process.env.FREELANCER_GIT_BRIDGE=prior;});
  const data=f.app.localData.get();
  data.createJudgmentDefinition({id:'batch-relevance',version:1,questionID:'relevance',primitive:'score',question:'Score candidate relevance.',criteria:{levels:['low','medium','high']}});
  data.createJudgmentDefinition({id:'batch-id-check',version:1,questionID:'has_exact_id',primitive:'check',question:'Does the evidence contain the exact ID?',criteria:{yes:'Exact ID appears',no:'ID is absent'}});
  const atomicRun={runID:'atomic-batch-member',definitionID:'batch-relevance',definitionVersion:1,stateHash:'c'.repeat(64),candidateIDs:['source:one'],evidenceRefs:[{ref:'source:one#L1'}],
    requestedProvider:'typesafe',requestedModel:'jev-latest',reportedProvider:'typesafe',reportedModel:'jev-1.13.0',status:'ok',results:[{questionID:'relevance',answer:{score:2}}]};
  assert.throws(()=>data.recordJudgmentBatch({runs:[atomicRun,{...atomicRun,runID:'atomic-batch-invalid',definitionID:'missing-definition'}]}),/does not exist/);
  assert.deepEqual(data.judgmentHistory({definitionID:'batch-relevance',limit:10}),[],'failed batch persistence rolls back every member');
  let calls=0;
  f.app.judgmentProvider={async evaluateMany({definitions,state,model}){calls++;assert.equal(definitions.length,2);assert.equal(state.query,'REF-9');return {
    status:'ok',requestedProvider:'typesafe',requestedModel:model??'jev-latest',reportedProvider:'typesafe',reportedModel:'jev-1.13.0',latencyMs:27,
    usage:{input_tokens:96,output_tokens:12},results:[
      {questionID:'relevance',answer:{score:1.9},probabilities:{0:0,1:0.1,2:0.9},confidence:0.91,derived:{score:1.9}},
      {questionID:'has_exact_id',answer:{probabilityYes:0.99},probabilities:{yes:0.99,no:0.01},derived:{probabilityYes:0.99}},
    ]};}};
  const send=body=>fetch(f.url+'/api/knowledge/agent',{method:'POST',headers:{'X-Freelancer-Client':'webpage','Content-Type':'application/json','X-Freelancer-Git-Bridge':'judgment-batch-test-secret'},body:JSON.stringify(body)});
  const evidence=await indexedEvidence(f,{filename:'batch-evidence.txt',text:'Synthetic reference REF-9. Keep the source revision stable.',query:'Synthetic'});
  const state={query:'REF-9',evidence:evidence.packet};
  const response=await send({operation:'judgment-evaluate-batch',definitionsJson:JSON.stringify([{id:'batch-relevance',version:1},{id:'batch-id-check',version:1}]),
    requestedModel:'jev-1.13.0',stateJson:JSON.stringify(state),candidateIDsJson:JSON.stringify(evidence.candidateIDs),evidenceRefsJson:JSON.stringify(evidence.evidenceRefs)});
  assert.equal(response.status,200,await response.clone().text());const batch=await response.json();
  assert.equal(calls,1);assert.equal(batch.status,'ok');assert.equal(batch.runs.length,2);assert.notEqual(batch.runs[0].runID,batch.runs[1].runID);
  const [relevance,hasID]=[data.judgmentHistory({definitionID:'batch-relevance'})[0],data.judgmentHistory({definitionID:'batch-id-check'})[0]];
  assert.equal(relevance.runID,batch.runs[0].runID);assert.equal(hasID.runID,batch.runs[1].runID);
  const sharedUsage=JSON.parse(relevance.usageJson),usagePointer=JSON.parse(hasID.usageJson);
  assert.equal(sharedUsage.input_tokens,96);assert.equal(sharedUsage.sharedBatchID,batch.batchID);assert.equal(sharedUsage.sharedQuestionCount,2);
  assert.deepEqual(usagePointer,{sharedBatchID:batch.batchID,sharedUsageRecordedRunID:relevance.runID});
  assert.equal(relevance.stateHash,hasID.stateHash);assert.equal(relevance.reportedModel,'jev-1.13.0');
  const callsAfterLiveBatch=calls;
  const cachedBatchResponse=await send({operation:'judgment-evaluate-batch',definitionsJson:JSON.stringify([{id:'batch-relevance',version:1},{id:'batch-id-check',version:1}]),
    requestedModel:'jev-1.13.0',stateJson:JSON.stringify(state),candidateIDsJson:JSON.stringify(evidence.candidateIDs),evidenceRefsJson:JSON.stringify(evidence.evidenceRefs)});
  assert.equal(cachedBatchResponse.status,200,await cachedBatchResponse.clone().text());const cachedBatch=await cachedBatchResponse.json();
  assert.equal(calls,callsAfterLiveBatch,'complete exact-model batches reuse both successful receipts');assert.equal(cachedBatch.cached,true);
  assert.deepEqual(cachedBatch.runs.map(run=>run.runID),[relevance.runID,hasID.runID]);
  const changedBatchState={...state,evidence:[{...evidence.packet[0],text:'Keep the source revision stable.'}]};
  const partialCache=await send({operation:'judgment-evaluate-batch',definitionsJson:JSON.stringify([{id:'batch-relevance',version:1},{id:'batch-id-check',version:1}]),
    requestedModel:'jev-1.13.0',stateJson:JSON.stringify(changedBatchState),candidateIDsJson:JSON.stringify(evidence.candidateIDs),evidenceRefsJson:JSON.stringify(evidence.evidenceRefs)});
  assert.equal(partialCache.status,200);assert.equal((await partialCache.json()).cached,undefined,'a batch with changed evidence runs live as a whole');
  assert.equal(calls,callsAfterLiveBatch+1);
});

test('knowledge bridge reads bounded OpenCode warehouse snapshots and coverage', async t => {
  const f=await localDataFixture({timers:false});t.after(()=>f.close());
  const nativeRequest=f.host.request.bind(f.host);
  const inventoryRequests=[];
  f.host.request=async(route,options={})=>{
    if(route.startsWith('/experimental/session?')) {
      const params=new URL(route,'http://fixture').searchParams;
      assert.equal(params.get('archived'),'true');assert.equal(params.get('directory'),f.directory);
      assert.equal(options.responseMetadata,true);
      inventoryRequests.push({start:params.get('start'),cursor:params.get('cursor'),limit:params.get('limit')});
      return {body:[],metadata:{'x-next-cursor':null}};
    }
    return nativeRequest(route,options);
  };
  const prior=process.env.FREELANCER_GIT_BRIDGE;process.env.FREELANCER_GIT_BRIDGE='warehouse-test-secret';
  t.after(()=>{if(prior===undefined)delete process.env.FREELANCER_GIT_BRIDGE;else process.env.FREELANCER_GIT_BRIDGE=prior;});
  const data=f.app.localData.get(),source=(await import('../server/data/opencode-warehouse.mjs')).openCodeSourceIdentity('synthetic-opencode-db');
  data.recordOpenCodeSnapshot({...source,projectID:f.project.id,session:{id:'ses_snapshot',title:'Synthetic'},messages:[{info:{id:'msg_snapshot',role:'assistant'},parts:[{id:'part_text',type:'text',text:'synthetic persisted text'},{id:'part_reasoning',type:'reasoning',text:'never expose this'}]}]});
  const send=body=>fetch(f.url+'/api/knowledge/agent',{method:'POST',headers:{'X-Freelancer-Client':'webpage','Content-Type':'application/json','X-Freelancer-Git-Bridge':'warehouse-test-secret'},body:JSON.stringify(body)});
  let response=await send({operation:'opencode-read',projectID:f.project.id,sessionID:'ses_snapshot',limit:1});assert.equal(response.status,200);
  let value=await response.json();assert.equal(value.messages.length,1);assert.match(JSON.stringify(value),/synthetic persisted text/);assert.doesNotMatch(JSON.stringify(value),/never expose this/);
  const capturedMessage=value.messages.find(row=>row.messageID==='msg_snapshot');
  response=await send({operation:'warehouse-status'});assert.equal(response.status,200);assert.equal((await response.json()).sources.reduce((n,row)=>n+row.messages,0),1);
  response=await send({operation:'warehouse-backfill',projectID:f.project.id,pageSize:10});assert.equal(response.status,200,await response.clone().text());
  assert.equal((await response.json()).results[0].status,'complete');
  assert.deepEqual(inventoryRequests,[{start:null,cursor:null,limit:'10'},{start:null,cursor:null,limit:'10'}],
    'native empty inventory and final head confirmation use the timestamp page/header envelope, not a fabricated offset response');
  response=await send({operation:'warehouse-status'});assert.equal(response.status,200);const status=await response.json();assert.equal(status.sources.reduce((n,row)=>n+row.messages,0),1);assert.equal(status.ingestRuns[0].status,'complete');assert.deepEqual(status.failures,[]);
  response=await send({operation:'opencode-read',projectID:'unregistered',sessionID:'ses_snapshot'});assert.equal(response.status,400);
  data.createJudgmentDefinition({id:'warehouse-text-support',version:1,questionID:'supports_text',primitive:'check',question:'Does the cited text support the query?',criteria:{yes:'Supported',no:'Unsupported'}});
  let evaluated=0;
  f.app.judgmentProvider={async evaluate({state}){evaluated++;assert.equal(state.evidence[0].text,'synthetic persisted text');return {status:'ok',requestedProvider:'typesafe',requestedModel:'jev-pinned',
    reportedProvider:'typesafe',reportedModel:'jev-pinned',results:[{questionID:'supports_text',answer:{probabilityYes:0.9},probabilities:{yes:0.9,no:0.1},derived:{primitive:'check',probabilityYes:0.9}}]};}};
  const candidateID=openCodeEvidenceCandidateID(source.sourceSystemID,f.project.id,'ses_snapshot');
  const evidenceRef={kind:'opencode-text-part',candidateID,sourceSystemID:source.sourceSystemID,projectID:f.project.id,sessionID:'ses_snapshot',
    messageID:'msg_snapshot',revisionSha256:capturedMessage.revisionSha256,
    partID:'part_text',partSha256:createHash('sha256').update('synthetic persisted text').digest('hex')};
  const judgment=await send({operation:'judgment-evaluate',definitionID:'warehouse-text-support',definitionVersion:1,requestedModel:'jev-pinned',
    candidateIDsJson:JSON.stringify([candidateID]),evidenceRefsJson:JSON.stringify([evidenceRef]),
    stateJson:JSON.stringify({query:'synthetic text',evidence:[{...evidenceRef,text:'synthetic persisted text'}]})});
  assert.equal(judgment.status,200,await judgment.clone().text());assert.equal((await judgment.json()).status,'ok');assert.equal(evaluated,1);
  const reasoningRef={...evidenceRef,partID:'part_reasoning',partSha256:createHash('sha256').update('never expose this').digest('hex')};
  const reasoning=await send({operation:'judgment-evaluate',definitionID:'warehouse-text-support',definitionVersion:1,requestedModel:'jev-pinned',
    candidateIDsJson:JSON.stringify([candidateID]),evidenceRefsJson:JSON.stringify([reasoningRef]),
    stateJson:JSON.stringify({query:'synthetic text',evidence:[{...reasoningRef,text:'never expose this'}]})});
  assert.equal(reasoning.status,400);assert.equal(evaluated,1,'omitted reasoning cannot be cited to TypeSafe');
});

test('knowledge reads preserve target sessions while mutation provenance uses only the native caller', async t => {
  const f=await localDataFixture({timers:false});t.after(()=>f.close());
  const prior=process.env.FREELANCER_GIT_BRIDGE;process.env.FREELANCER_GIT_BRIDGE='knowledge-actor-target-fixture';
  t.after(()=>{if(prior===undefined)delete process.env.FREELANCER_GIT_BRIDGE;else process.env.FREELANCER_GIT_BRIDGE=prior;});
  const data=f.app.localData.get(),source=(await import('../server/data/opencode-warehouse.mjs')).openCodeSourceIdentity('actor-target-native-db');
  let snapshotRevisionSha256;
  for(const [sessionID,text] of [['target-session','Exact retained target'],['caller-session','Unrelated caller transcript']]) {
    const captured=data.recordOpenCodeSnapshot({...source,projectID:f.project.id,projectionSafe:true,session:{id:sessionID,title:text,directory:f.directory},messages:[{
      info:{id:`message-${sessionID}`,role:'assistant'},parts:[{type:'text',text}],
    }]});
    if(sessionID==='target-session') snapshotRevisionSha256=captured.snapshotRevisionSha256;
  }
  const send=(body,native=true)=>fetch(f.url+`/api/knowledge${native?'/agent':''}`,{method:'POST',headers:{
    'X-Freelancer-Client':'webpage','Content-Type':'application/json',...(native?{'X-Freelancer-Git-Bridge':'knowledge-actor-target-fixture'}:{}),
  },body:JSON.stringify(body)});
  let response=await send({operation:'opencode-read',projectID:f.project.id,sourceSystemID:source.sourceSystemID,
    sessionID:'target-session',actorSessionID:'caller-session',messageID:'native-caller-message'});
  assert.equal(response.status,200,await response.clone().text());
  const retained=await response.json();
  assert.equal(retained.session.sessionID,'target-session');
  assert.match(JSON.stringify(retained),/Exact retained target/);
  assert.doesNotMatch(JSON.stringify(retained),/Unrelated caller transcript/);
  assert.match(snapshotRevisionSha256,/^[a-f0-9]{64}$/);
  data.recordOpenCodeSnapshot({...source,projectID:f.project.id,projectionSafe:true,
    session:{id:'target-session',title:'Changed live target',directory:f.directory},messages:[{
      info:{id:'message-target-session',role:'assistant'},parts:[{type:'text',text:'Changed live target transcript'}],
    }]});
  response=await send({operation:'opencode-read',projectID:f.project.id,sourceSystemID:source.sourceSystemID,
    sessionID:'target-session',snapshotRevisionSha256,actorSessionID:'forged-native-actor'},false);
  assert.equal(response.status,200,await response.clone().text());
  const historical=await response.json();
  assert.equal(historical.session.sessionID,'target-session');
  assert.match(JSON.stringify(historical),/Exact retained target/);
  assert.doesNotMatch(JSON.stringify(historical),/Changed live target transcript/,'browser evidence reads never substitute newer current text');
  response=await send({operation:'opencode-read',projectID:'unregistered',sourceSystemID:source.sourceSystemID,
    sessionID:'target-session',snapshotRevisionSha256},false);
  assert.equal(response.status,400,'browser reads still require a current registered project');
  response=await send({operation:'remember',title:'Native caller note',body:'Native caller evidence',projectID:f.project.id,
    sessionID:'target-session',actorSessionID:'caller-session',messageID:'native-caller-message',actor:'forged-actor'});
  assert.equal(response.status,200,await response.clone().text());const note=await response.json();
  assert.deepEqual(data.getMemory(note.id).revision.provenance,{sessionID:'caller-session',messageID:'native-caller-message'});
  assert.equal((await data.analyze('SELECT actor FROM memory_changes WHERE memory_id=$id AND change_type=$type',{$id:note.id,$type:'created'})).rows[0].actor,'caller-session');
  response=await send({operation:'revise',id:note.id,expectedRevision:1,body:'Browser-authored correction',
    sessionID:'forged-native-session',actorSessionID:'forged-native-actor',messageID:'forged-native-message',actor:'forged-actor'},false);
  assert.equal(response.status,200,await response.clone().text());
  assert.deepEqual(data.getMemory(note.id).revision.provenance,{},'browser input cannot assert native execution provenance');
  assert.equal((await data.analyze('SELECT actor FROM memory_changes WHERE memory_id=$id AND change_type=$type',{$id:note.id,$type:'revised'})).rows[0].actor,'user');
});

test('file search applies the same AND, phrase, source, role and status filters through HTTP', async t => {
  const f=await gitProjectFixture();t.after(()=>f.close());
  const projectKey=process.platform==='win32'?f.project.directory.toLowerCase():f.project.directory;
  const indexed=await runNode([path.resolve('backend/tools/project-content-indexer.mjs'),'--db',f.app.localData.get().filename,'--project-key',projectKey,'rebuild','--root',f.project.directory,'--facts','none'],{cwd:f.project.directory,encoding:'utf8'});
  assert.equal(indexed.status,0,indexed.stderr);
  const search=(params)=>fetch(f.url+`/api/index/search?${new URLSearchParams({q:'Hello',project:f.project.id,...params})}`,{headers:{'X-Freelancer-Client':'webpage'}});
  let response=await search({source:'hello.txt',role:'project_source',status:'source'});assert.equal(response.status,200);assert.equal((await response.json()).results.length,1);
  response=await search({source:'%.txt'});assert.equal((await response.json()).results.length,0,'source wildcard characters are treated literally');
  response=await search({role:'reference_source'});assert.equal((await response.json()).results.length,0);
  response=await fetch(f.url+`/api/index/search?${new URLSearchParams({q:'Hello project',project:f.project.id,phrase:'true'})}`,{headers:{'X-Freelancer-Client':'webpage'} });
  assert.equal(response.status,200);assert.equal((await response.json()).results.length,1);
  response=await fetch(f.url+`/api/index/search?${new URLSearchParams({q:'Hello Neptune',project:f.project.id})}`,{headers:{'X-Freelancer-Client':'webpage'} });
  assert.equal(response.status,200);assert.equal((await response.json()).results.length,0);
});
