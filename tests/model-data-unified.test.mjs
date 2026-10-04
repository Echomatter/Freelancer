import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLocalDataStore } from '../server/data/store.mjs';
import { createModelDataService } from '../server/model-data.mjs';
import { createEvidenceEvaluationService } from '../server/evidence-evaluation.mjs';
import { modelObservationKey,modelObservationSchema,toModelObservation,MODEL_CATALOG_AGENT_RESPONSE_BYTES } from '../domain/model-data-unified.mjs';
import { EVALUATION_SCHEMA } from '../domain/evidence-evaluation-schema.mjs';

const mdID='modelsdev:deployment:fixture:m',aaID='artificial-analysis:configuration:fixture-aa-uuid';
const fact=(attribute,value,configuration={})=>({attribute,value,units:null,scale:null,configuration,
  sourceRef:{url:'https://example.com/public-schema',path:`/fixture/${attribute}`},dates:{retrievedAt:100},identityMatch:{status:'unmatched'}});
async function fixture(t,mdFacts,aaFacts=[],sourceMetadata={}) {
  const root=await mkdtemp(path.join(os.tmpdir(),'freelancer-unified-model-data-')),store=createLocalDataStore(root);
  const service=createModelDataService({localData:{get:()=>store},env:{},vault:{available:false},
    fetchSource:async()=>{throw Error('Unexpected source refresh.');}});
  service.setNativeModels([{id:'fixture/m',provider:'fixture',modelID:'m',
    sourceIdentities:{'artificial-analysis':{sourceID:'fixture-aa-uuid'}}}]);
  const publish=(source,id,kind,facts)=>{
    const job=store.beginModelDataRefresh({sources:[source],createdAt:100});
    store.publishModelDataSource({schemaVersion:1,source,retrievedAt:100,sourceMetadata,sourceReference:{url:'https://example.com/public-schema'},records:[{
      id,kind,name:'Synthetic fixture',...(source==='modelsdev'?{provider:'fixture',modelID:'m'}:{}),
      identifiers:source==='modelsdev'?{source,providerID:'fixture',modelID:'m',nativeID:'fixture/m'}:{source,sourceID:'fixture-aa-uuid'},
      configuration:source==='modelsdev'?{providerID:'fixture'}:{testedName:'Synthetic fixture configuration'},
      sourceReference:{url:'https://example.com/public-schema',path:'/fixture'},sourceDates:{},raw:{},facts,
    }]},{jobID:job.id});store.finishModelDataRefresh(job.id,{status:'complete'});
  };
  publish('modelsdev',mdID,'deployment',mdFacts);
  if(aaFacts.length)publish('artificial-analysis',aaID,'configuration',aaFacts);
  t.after(async()=>{await service.close();store.close();assert.equal(path.dirname(root),path.resolve(os.tmpdir()));await rm(root,{recursive:true,force:true});});
  return {store,service};
}

test('one observation key space preserves native values, units, scales and source configurations',()=>{
  const md={id:mdID,source:'modelsdev',snapshotID:'md-snapshot',snapshotSha256:'source-hash'};
  const aa={id:aaID,source:'artificial-analysis',snapshotID:'aa-snapshot'};
  const zero=toModelObservation({...fact('cost.input',0),units:'USD/1M tokens'},md);
  const missing=toModelObservation({...fact('pricing.price_1m_input_tokens',null),units:'USD/1M tokens'},aa);
  assert.equal(zero.key,missing.key);assert.equal(zero.key,'pricing.input');assert.equal(zero.value,0);
  assert.equal(zero.availability,'present');assert.equal(missing.value,null);assert.equal(missing.availability,'source-reported-unavailable');
  assert.equal(toModelObservation(fact('tool_call',false),md).value,false);
  assert.equal(modelObservationKey('modelsdev','benchmarks.3.score'),'benchmarks.score');
  assert.equal(modelObservationKey('artificial-analysis','evaluations.artificial_analysis_coding_index'),'ratings.artificial-analysis.coding');
  assert.notEqual(modelObservationKey('modelsdev','benchmarks.3.score'),modelObservationKey('artificial-analysis','evaluations.artificial_analysis_coding_index'));
  assert.equal(modelObservationKey('modelsdev','source.future.metric'),'source.modelsdev.source.future.metric');
  const rated=toModelObservation({...fact('evaluations.artificial_analysis_coding_index',57,{testedName:'High'}),scale:{version:4.3,maximum:null}},aa);
  assert.deepEqual(rated.scale,{version:4.3,maximum:null});assert.deepEqual(rated.configuration,{testedName:'High'});
  assert.equal(zero.provenance.snapshotSha256,'source-hash');
});

test('canonical and native attribute filters select before pagination and bind continuation to the selected keys',async t=>{
  const rows=[...Array.from({length:125},(_,i)=>fact(`source.fixture.${i}`,i)),fact('limit.context',200000),fact('limit.output',16000)];
  const {store}=await fixture(t,rows);
  const canonical=store.modelDataDetail(mdID,{attributes:['limits.context'],limit:1});
  assert.equal(canonical.facts[0].attribute,'limit.context');assert.equal(canonical.factTotal,1);assert.equal(canonical.factsTruncated,false);
  assert.deepEqual(store.modelDataDetail(mdID,{attributes:['limit.context'],limit:1}).facts,canonical.facts);
  const page=store.modelDataDetail(mdID,{attributes:['limits.context','limits.output'],limit:1});
  assert.equal(page.factTotal,2);assert.equal(page.factsTruncated,true);
  const next=store.modelDataDetail(mdID,{attributes:['limits.output','limits.context'],limit:1,cursor:page.nextCursor});
  assert.equal(next.facts[0].attribute,'limit.output');assert.equal(next.factsTruncated,false);
  assert.throws(()=>store.modelDataDetail(mdID,{attributes:['limits.output'],limit:1,cursor:page.nextCursor}),/cursor/i);
  assert.equal(store.modelDataDetail(mdID,{attributes:[],limit:1}).facts.length,0);
});

test('canonical pricing retains every tier/mode, and benchmark result selection excludes score rows',async t=>{
  const {store}=await fixture(t,[fact('cost.input',1),fact('cost.tiers.0.input',2,{priceTier:{type:'context',size:200000}}),
    fact('experimental.modes.fast.cost.input',3,{mode:'fast'}),fact('benchmarks.0',{name:'Fixture benchmark',score:80}),fact('benchmarks.0.score',80,{benchmark:'Fixture benchmark'})]);
  const prices=store.modelDataDetail(mdID,{attributes:['pricing.input'],limit:10});
  assert.equal(prices.factTotal,3);assert.deepEqual(prices.facts.map(f=>f.value),[1,2,3]);assert.equal(prices.facts[1].configuration.priceTier.size,200000);
  assert.equal(store.modelDataDetail(mdID,{attributes:['benchmarks.result'],limit:10}).facts[0].attribute,'benchmarks.0');
  assert.equal(store.modelDataDetail(mdID,{attributes:['benchmarks.result'],limit:10}).factTotal,1);
  assert.equal(store.modelDataDetail(mdID,{attributes:['benchmarks.score'],limit:10}).factTotal,1);
});

test('catalog and evidence expose identical observations, source-filtered native details and honest missing coverage without inference',async t=>{
  const {store,service}=await fixture(t,[...Array.from({length:125},(_,i)=>fact(`source.fixture.${i}`,i)),fact('cost.input',0),fact('limit.context',200000)],
    [fact('pricing.price_1m_input_tokens',null),fact('evaluations.artificial_analysis_coding_index',52)]);
  const selected=['pricing.input','limits.context'];
  const md=service.agentAction({operation:'detail',id:mdID,attributes:selected,limit:10}).records[0];
  const evaluator=createEvidenceEvaluationService({data:store,modelData:service,provider:{evaluateMany(){throw Error('Unexpected inference.');}}});
  t.after(()=>evaluator.close());
  assert.deepEqual(evaluator.describe().modelCatalogSchema,service.agentAction({operation:'schema'}).schema);
  const owner={projectID:'fixture',sessionID:'ses_fixture'};
  const prepared=await evaluator.prepare({version:1,evidence:[{id:'metadata',source:'catalog',recordID:mdID,attributes:selected,limit:10}]},{owner});
  assert.deepEqual(prepared.packet[0].value,md.observations);assert.equal(prepared.packet[0].status,'ok');assert.equal(prepared.requiresInference,false);
  const missing=await evaluator.prepare({version:1,evidence:[{id:'aa',source:'catalog',recordID:aaID,attributes:selected,limit:10}]},{owner});
  assert.equal(missing.packet[0].status,'partial');assert.equal(missing.packet[0].value[0].value,null);
  assert.ok(missing.packet[0].missing.includes('limits.context: not-covered'));
  assert.ok(missing.packet[0].missing.includes('pricing.input: source-reported-unavailable'));
  const native=service.agentAction({operation:'detail',id:'fixture/m',source:'modelsdev',attributes:['pricing.input'],limit:10});
  assert.equal(native.records.length,1);assert.equal(native.records[0].source,'modelsdev');
  assert.equal(service.agentAction({operation:'list',limit:10}).records[0].observationsRequested,false);
  assert.deepEqual(store.judgmentHistory(),[]);
  assert.throws(()=>service.agentAction({operation:'detail',id:'fixture/m',cursor:'fixture'}),/exact source record ID/);
});

test('schema declares array question inputs and mandatory numeric mapping for choice composition',()=>{
  assert.equal(EVALUATION_SCHEMA.$defs.question.properties.inputs.type,'array');
  assert.deepEqual(EVALUATION_SCHEMA.$defs.term.allOf[0].then.required,['mapping']);
  const schema=modelObservationSchema();assert.equal(schema.id,'freelancer.model-observations');
  assert.ok(schema.attributes.find(row=>row.key==='pricing.input').sourceAttributes.modelsdev);
});

test('source filtering precedes the native-match bound so numerous AA configurations cannot hide a deployment',async t=>{
  const {store,service}=await fixture(t,[fact('cost.input',0)],[fact('pricing.price_1m_input_tokens',1)]);
  const original=store.modelDataDetail(aaID),ids=Array.from({length:21},(_,i)=>`artificial-analysis:configuration:fixture-aa-${i}`);
  const job=store.beginModelDataRefresh({sources:['artificial-analysis'],createdAt:101});
  store.publishModelDataSource({schemaVersion:1,source:'artificial-analysis',retrievedAt:101,sourceReference:{url:'https://example.com/public-schema'},
    records:ids.map((id,i)=>({...original.record,id,identifiers:{source:'artificial-analysis',sourceID:`fixture-aa-${i}`},facts:original.facts}))},{jobID:job.id});
  store.finishModelDataRefresh(job.id,{status:'complete'});
  service.setNativeModels([{id:'fixture/m',provider:'fixture',modelID:'m',sourceAliases:{'artificial-analysis':ids}}]);
  const all=service.agentAction({operation:'detail',id:'fixture/m',attributes:['pricing.input'],limit:1});
  assert.equal(all.recordsTruncated,true);assert.ok(all.records.length>0&&all.records.length<20);
  assert.equal(all.recordPage.boundedBy,'native-response-bytes');
  assert.ok(Buffer.byteLength(JSON.stringify(all))<=MODEL_CATALOG_AGENT_RESPONSE_BYTES);
  const md=service.agentAction({operation:'detail',id:'fixture/m',source:'modelsdev',attributes:['pricing.input'],limit:1});
  assert.equal(md.recordsTruncated,false);assert.equal(md.records.length,1);assert.equal(md.records[0].id,mdID);
});

test('large inventory mappings become counts in native reads without changing selected provenance or legacy metadata',async t=>{
  const mappings=Array.from({length:250},(_,i)=>({recordID:`modelsdev:model:scope-${i}`,canonicalModelID:`fixture/scope-${i}`,nativeModelIDs:[`provider/scope-${i}`],
    evidence:[{url:'https://example.com/public-schema',path:`/scope/${i}`,label:'Global mapping label must stay in the warehouse. '.repeat(20)}]}));
  const metadata={pages:4,requests:4,tier:'free',intelligenceIndexVersion:4.3,scope:{kind:'configured-native-models',
    nativeModelIDs:mappings.map(row=>row.nativeModelIDs[0]),canonicalLinks:mappings,modelLinks:mappings,
    receivedRecordCount:8841,retainedRecordCount:2,matchedNativeModelCount:79}};
  const {store,service}=await fixture(t,[fact('limit.context',200000),fact('cost.input',0)],
    [fact('evaluations.artificial_analysis_intelligence_index',52),fact('pricing.price_1m_input_tokens',1)],metadata);
  assert.ok(Buffer.byteLength(JSON.stringify(service.status()))>500000);
  assert.equal(service.detail({id:mdID}).record.sourceSnapshot.metadata.sourceMetadata.scope.canonicalLinks.length,250);
  const views=[service.agentAction({operation:'schema'}),service.agentAction({operation:'status'}),service.agentAction({operation:'list',limit:1}),
    service.agentAction({operation:'detail',id:'fixture/m',attributes:['limits.context','pricing.input','ratings.artificial-analysis.intelligence'],limit:20})];
  for(const view of views){const json=JSON.stringify(view);assert.ok(Buffer.byteLength(json)<MODEL_CATALOG_AGENT_RESPONSE_BYTES);assert.equal(json.includes('Global mapping label'),false);
    assert.equal(view.sources[0].current.metadata.sourceMetadata.scope.canonicalLinksCount,250);
    assert.equal(view.sources[0].current.metadata.sourceMetadata.scope.nativeModelIDs,undefined);}
  const detail=views.at(-1);assert.equal(detail.records.length,2);
  const md=detail.records.find(row=>row.source==='modelsdev');assert.equal(md.observations.find(row=>row.key==='pricing.input').value,0);
  const selected=md.observations[0];assert.equal(selected.sourceRef.url,'https://example.com/public-schema');
  assert.equal(selected.provenance.snapshotSha256,md.snapshotSha256);assert.equal(selected.identityMatch.status,'exact');
  assert.equal(selected.provenance.sourceRef,undefined);assert.equal(selected.provenance.identityMatch,undefined);
  const evaluator=createEvidenceEvaluationService({data:store,modelData:service,provider:{evaluateMany(){throw Error('Unexpected inference.');}}});t.after(()=>evaluator.close());
  const prepared=await evaluator.prepare({version:1,evidence:[{id:'metadata',source:'catalog',recordID:mdID,attributes:['limits.context','pricing.input'],limit:20}]},
    {owner:{projectID:'fixture',sessionID:'ses_fixture'}});
  assert.deepEqual(prepared.packet[0].value,md.observations);assert.ok(Buffer.byteLength(JSON.stringify(prepared.packet))<20000);
  assert.equal(JSON.stringify(prepared).includes('Global mapping label'),false);
  assert.equal(store.modelDataDetail(mdID).record.sourceSnapshot.metadata.sourceMetadata.scope.canonicalLinks.length,250);
});

test('native record and fact pages adapt to byte budgets with lossless cursors using the original limit',async t=>{
  const {store,service}=await fixture(t,Array.from({length:80},(_,i)=>fact(`source.metric.${i}`,`measurement-${i}-`+'x'.repeat(700))));
  const original=store.modelDataDetail(mdID,{limit:100}),ids=Array.from({length:40},(_,i)=>`modelsdev:deployment:fixture:m-${i}`);
  const job=store.beginModelDataRefresh({sources:['modelsdev'],createdAt:101});
  store.publishModelDataSource({schemaVersion:1,source:'modelsdev',retrievedAt:101,sourceReference:{url:'https://example.com/public-schema'},
    records:ids.map((id,i)=>({...original.record,id,name:`Synthetic ${i}`,modelID:`m-${i}`,identifiers:{source:'modelsdev',nativeID:`fixture/m-${i}`,providerID:'fixture',modelID:`m-${i}`},facts:original.facts}))},{jobID:job.id});
  store.finishModelDataRefresh(job.id,{status:'complete'});service.setNativeModels(ids.map((_,i)=>({id:`fixture/m-${i}`,provider:'fixture',modelID:`m-${i}`})));
  const found=[];let cursor,first;
  do{const page=service.agentAction({operation:'list',source:'modelsdev',limit:100,...(cursor?{cursor}:{})});first??=page;
    assert.ok(Buffer.byteLength(JSON.stringify(page))<=MODEL_CATALOG_AGENT_RESPONSE_BYTES);found.push(...page.records.map(row=>row.id));cursor=page.nextCursor;
  }while(cursor);
  assert.equal(first.page.limit,100);assert.ok(first.page.responseLimit<100);assert.equal(first.page.boundedBy,'native-response-bytes');
  assert.equal(found.length,ids.length);assert.equal(new Set(found).size,ids.length);
  const attributes=[];cursor=undefined;first=undefined;
  do{const page=service.agentAction({operation:'detail',id:ids[0],limit:100,...(cursor?{cursor}:{})});const record=page.records[0];first??=record;
    assert.ok(Buffer.byteLength(JSON.stringify(page))<=MODEL_CATALOG_AGENT_RESPONSE_BYTES);attributes.push(...record.observations.map(row=>row.attribute));cursor=record.nextCursor;
  }while(cursor);
  assert.equal(first.observationPage.limit,100);assert.ok(first.observationPage.responseLimit<100);assert.equal(first.observationsTruncated,true);
  assert.equal(attributes.length,80);assert.equal(new Set(attributes).size,80);
  assert.equal(store.modelDataDetail(ids[0],{limit:100}).facts.length,80);
});

test('one oversized UTF-8 observation is rejected explicitly and remains stored in full',async t=>{
  const value='é'.repeat(25000),{store,service}=await fixture(t,[fact('source.large',value)]);
  assert.throws(()=>service.agentAction({operation:'detail',id:mdID,limit:1}),error=>error.status===413&&/40 KB/.test(error.message));
  assert.equal(store.modelDataDetail(mdID).facts[0].value,value);
});
