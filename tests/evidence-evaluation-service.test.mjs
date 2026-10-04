import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLocalDataStore } from '../server/data/store.mjs';
import { createEvidenceEvaluationService } from '../server/evidence-evaluation.mjs';

const owner={projectID:'generic',sessionID:'ses_fixture'};
const supplied=(id,value,kind='supplied')=>({id,value,kind});
const q=(id,extras={})=>({id,primitive:'check',instructions:'Does the supplied receipt support the stated requirement?',
  criteria:{yes:'Evidence explicitly supports the requirement.',no:'Evidence is missing, conflicts or does not support it.'},inputs:['brief'],...extras});
const contract=extras=>({version:1,supplied:[supplied('brief',{requirement:'A readable delivery receipt',receipt:'Arrived Tuesday'})],...extras});
const composition=(id,questionID,weight=1)=>({id,terms:[{questionID,field:'probabilityYes',weight,range:[0,1]}],scale:{min:0,max:100,units:'declared preference points'}});
async function fixture(t,{evaluate,query,clock=()=>100}={}){
  const root=await mkdtemp(path.join(os.tmpdir(),'freelancer-evaluation-')),store=createLocalDataStore(root);
  t.after(async()=>{store.close();assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(root,{recursive:true,force:true});});
  const calls=[];
  const service=createEvidenceEvaluationService({data:store,now:clock,knowledgeQuery:{query:query??(async()=>({results:[],truncated:false,filters:{global:true},coverage:'Synthetic query coverage'}))},provider:{
    async evaluateMany(input){calls.push(structuredClone({...input,signal:undefined}));return evaluate?evaluate(input,store):{status:'ok',requestedProvider:'typesafe',requestedModel:'jev-fixture',reportedProvider:'typesafe',reportedModel:'jev-fixture',latencyMs:1,
      usage:{input_tokens:10,output_tokens:1},results:input.definitions.map(definition=>({questionID:definition.questionID,answer:{probabilityYes:0.8},probabilities:{yes:0.8,no:0.2}}))};}}});
  return {service,store,calls};
}

test('generic non-model factual comparisons/joins and arithmetic bypass Jev and durable judgment writes',async t=>{
  const {service,store,calls}=await fixture(t);
  const result=await service.evaluate({version:1,supplied:[supplied('items',[{sku:'a',quantity:2},{sku:'b',quantity:3}]),supplied('prices',[{sku:'a',price:4},{sku:'b',price:2}]),supplied('tax',0.1,'assumption')],derivations:[
    {id:'joined',expression:{op:'join',left:{ref:'items'},right:{ref:'prices'},leftKey:'sku',rightKey:'sku',how:'left'}},
    {id:'pricesOnly',expression:{op:'project',input:{ref:'joined'},fields:{price:'right.price'}}},
    {id:'basePrice',expression:{op:'sum',args:[{value:[8,6]}]},units:'USD'},
    {id:'total',expression:{op:'multiply',args:[{ref:'basePrice'},{op:'add',args:[{value:1},{ref:'tax'}]}]},units:'USD'},
    {id:'belowBudget',subjective:true,description:'Caller preference: total under 20 USD.',expression:{op:'lt',args:[{ref:'total'},{value:20}]}}
  ]},{owner});
  assert.equal(result.status,'factual');assert.equal(result.requiresInference,false);assert.equal(calls.length,0);assert.deepEqual(store.judgmentHistory(),[]);
  assert.equal(result.derived.find(item=>item.id==='total').value,15.400000000000002);
  assert.equal(result.derived.find(item=>item.id==='belowBudget').subjective,true);
  assert.deepEqual(result.derived[1].value,[{price:4},{price:2}]);assert.equal(result.consequencesExecuted,false);
});

test('unknown values, incomplete filters, division by zero and conflicting rows are preserved',async t=>{
  const {service,calls}=await fixture(t);
  const result=await service.evaluate({version:1,supplied:[supplied('missing',null),supplied('observations',[{id:'same',value:4},{id:'same',value:9},{id:'other',value:null}])],derivations:[
    {id:'unknownTotal',expression:{op:'add',args:[{ref:'missing'},{value:2}]}},
    {id:'undefinedRatio',expression:{op:'divide',args:[{value:10},{value:0}]}},
    {id:'boundedFilter',expression:{op:'filter',input:{ref:'observations'},where:{op:'gt',args:[{row:'value'},{value:3}]}}}
  ]},{owner});
  assert.equal(result.derived[0].value,null);assert.match(result.derived[0].missing.join(),/Unknown/);
  assert.equal(result.derived[1].value,null);assert.match(result.derived[1].missing.join(),/zero/);
  assert.deepEqual(result.derived[2].value,[{id:'same',value:4},{id:'same',value:9}]);assert.equal(result.derived[2].status,'partial');assert.equal(calls.length,0);
});

test('independent questions batch once and dependent questions receive only explicitly named earlier answers',async t=>{
  const {service,store,calls}=await fixture(t);
  const result=await service.evaluate(contract({questions:[q('first'),q('second',{instructions:'Does the receipt specify a delivery day?'}),q('followup',{stage:1,dependsOn:['first']})]}),{owner});
  assert.equal(result.status,'ok');assert.equal(calls.length,2);assert.equal(calls[0].definitions.length,2);
  assert.deepEqual(calls[0].state.previousAnswers,[]);assert.equal(calls[1].state.previousAnswers[0].questionID,'first');assert.equal(calls[1].state.previousAnswers.length,1);
  assert.equal(store.judgmentHistory().length,3);const historical=store.judgmentHistory()[0];assert.equal(JSON.parse(historical.derivedJson).evaluationState.evidence[0].id,'brief');
  const inspected=service.inspect(result.receiptID,{owner});assert.deepEqual(inspected.stages,result.stages);
  inspected.packet[0].value.receipt='Caller mutates returned copy';assert.equal(service.inspect(result.receiptID,{owner}).packet[0].value.receipt,'Arrived Tuesday');
});

test('scenarios deduplicate unchanged evidence/questions and deterministic reweighting consumes no inference',async t=>{
  const {service,calls}=await fixture(t);
  const result=await service.evaluate(contract({scenarios:[{id:'same',overlays:[]},{id:'other',overlays:[{id:'counterfactual',target:'brief',kind:'assumption',reason:'Explore a missing receipt.',value:{requirement:'A readable delivery receipt',receipt:null}}]}],
    questions:[q('original'),q('sameScenario',{scenario:'same'}),q('changedScenario',{scenario:'other'})],composition:[composition('preference','original')]}),{owner});
  assert.equal(calls.length,2);assert.equal(calls.reduce((sum,call)=>sum+call.definitions.length,0),2);
  assert.equal(result.answers.find(item=>item.questionID==='sameScenario').reusedFrom,'original');assert.equal(result.compositions[0].value,80);
  const changed=await service.evaluate({receiptID:result.receiptID,composition:[composition('reweighted','sameScenario',3)]},{owner});assert.equal(changed.recombined,true);assert.equal(calls.length,2);assert.ok(Math.abs(changed.compositions[0].value-80)<1e-10);
  assert.equal(changed.packet[0].value.receipt,'Arrived Tuesday');assert.equal(changed.scenarios.find(item=>item.id==='other').entries.brief.kind,'assumption');
});

test('conditional request overlays recompute downstream derivations and retain subjective provenance',async t=>{
  const {service}=await fixture(t);
  const result=await service.evaluate({version:1,supplied:[supplied('quantity',2)],derivations:[
    {id:'cost',expression:{op:'multiply',args:[{ref:'quantity'},{value:5}]},units:'USD'},
    {id:'doubled',expression:{op:'multiply',args:[{ref:'cost'},{value:2}]}}
  ],scenarios:[{id:'scenario',overlays:[{id:'override-cost',target:'cost',value:3,kind:'preference',reason:'Caller assumes discounted cost.',when:{op:'eq',args:[{ref:'quantity'},{value:2}]}}]}]},{owner});
  const staged=result.scenarios.find(item=>item.id==='scenario');assert.equal(staged.entries.cost.value,3);assert.equal(staged.entries.cost.kind,'preference');assert.equal(staged.entries.doubled.value,6);assert.equal(result.derived[0].value,10);assert.equal(staged.overlays[0].applied,true);
});

test('exact generic stored memory/claim evidence retains provenance and changed sources block before inference',async t=>{
  const {service,store,calls}=await fixture(t);
  store.createMemory({id:'delivery-note',title:'Delivery',kind:'note',body:'The parcel arrived Tuesday.'});
  store.addClaim({id:'delivery-claim',predicate:'Delivery day',value:'Tuesday',origin:'human-authored',epistemicState:'unverified',evidence:[{id:'memory:delivery-note@1',kind:'memory',memoryID:'delivery-note',memoryRevision:1}]});
  const prepared=await service.prepare({version:1,evidence:[{id:'brief',source:'knowledge',domain:'facts',recordID:'delivery-claim',fields:['predicate','value','epistemicState','observedAt']}],questions:[q('fit')]},{owner});
  assert.equal(prepared.packet[0].value.value,'Tuesday');assert.equal(prepared.packet[0].provenance.evidenceRefs[0].kind,'claim-record');
  store.correctClaim({id:'delivery-claim',value:'Wednesday',epistemicState:'disputed',evidence:[{id:'authored-correction',detail:'A corrected receipt.'}]});
  const result=await service.evaluate({receiptID:prepared.receiptID},{owner});assert.equal(result.status,'evidence-changed');assert.equal(calls.length,0);
});

test('unknown conditional overlays do not invent a branch, and later conditions see recalculated values',async t=>{
  const {service}=await fixture(t);
  const result=await service.evaluate({version:1,supplied:[supplied('quantity',2),supplied('unknownCondition',null)],derivations:[
    {id:'cost',expression:{op:'multiply',args:[{ref:'quantity'},{value:5}]}},
    {id:'next',expression:{op:'add',args:[{ref:'cost'},{value:1}]}}
  ],scenarios:[{id:'unknown',overlays:[{id:'conditional',target:'cost',value:20,kind:'assumption',reason:'Only if unknown condition becomes true.',when:{ref:'unknownCondition'}}]},
    {id:'ordered',overlays:[{id:'quantity-change',target:'quantity',value:3,kind:'assumption',reason:'Caller scenario.'},
      {id:'cost-change',target:'cost',value:4,kind:'preference',reason:'Use discount if recalculated cost exceeds 12.',when:{op:'gt',args:[{ref:'cost'},{value:12}]}}]}]},{owner});
  const uncertain=result.scenarios.find(item=>item.id==='unknown');assert.equal(uncertain.entries.cost.value,null);assert.equal(uncertain.entries.next.value,null);assert.equal(uncertain.overlays[0].condition,null);
  const ordered=result.scenarios.find(item=>item.id==='ordered');assert.equal(ordered.entries.cost.value,4);assert.equal(ordered.entries.next.value,5);assert.equal(ordered.overlays[1].applied,true);
});

test('derived evidence carries incomplete coverage and transitive assumption/preference distinctions',async t=>{
  const {service}=await fixture(t,{query:async()=>({results:[{value:2}],truncated:true,filters:{},coverage:'Synthetic partial page'})});
  const result=await service.evaluate({version:1,evidence:[{id:'rows',source:'query',domain:'facts',query:'cost',fields:['value']}],supplied:[supplied('fee',3,'assumption')],
    derivations:[{id:'count',expression:{op:'count',args:[{ref:'rows'}]}},{id:'amount',expression:{op:'add',args:[{ref:'count'},{ref:'fee'}]}}]},{owner});
  assert.equal(result.derived[0].status,'partial');assert.equal(result.derived[1].status,'partial');assert.deepEqual(result.derived[1].provenance.basis.assumption,['fee']);assert.deepEqual(result.derived[1].provenance.basis.stored,['rows']);
});

test('catalog facts remain immutable across overlays and questions, preserving attributes/units/dates/conflicts',async t=>{
  const {service,store}=await fixture(t);
  const job=store.beginModelDataRefresh({id:'evaluation-fixture-refresh',sources:['modelsdev']});
  store.publishModelDataSource({schemaVersion:1,source:'modelsdev',retrievedAt:100,sourceReference:{url:'https://models.dev/api.json'},records:[{
    id:'modelsdev:fixture/example',kind:'deployment',name:'Public fixture',provider:'fixture',modelID:'example',configuration:{},sourceReference:{path:'fixture/example'},sourceDates:{publishedAt:'2026-09'},raw:{},
    facts:[{attribute:'arbitrary.source.metric',value:12,units:'observed units',scale:null,configuration:{},sourceRef:{path:'metric'},dates:{measuredAt:'2026-09'},identityMatch:{status:'unmatched'}}]}]},{jobID:job.id});
  store.finishModelDataRefresh(job.id,{status:'complete'});const before=store.modelDataDetail('modelsdev:fixture/example');
  const result=await service.evaluate({version:1,evidence:[{id:'brief',source:'catalog',recordID:'modelsdev:fixture/example',attributes:['arbitrary.source.metric','unrecorded']}],
    scenarios:[{id:'what-if',overlays:[{id:'assumed',target:'brief',value:[{attribute:'arbitrary.source.metric',value:4}],kind:'assumption',reason:'Caller counterfactual'}]}],questions:[q('fit',{scenario:'what-if'})]},{owner});
  assert.equal(result.status,'ok');assert.deepEqual(store.modelDataDetail('modelsdev:fixture/example'),before);
  assert.equal(result.packet[0].value[0].units,'observed units');assert.equal(result.packet[0].value[0].dates.measuredAt,'2026-09');assert.match(result.packet[0].missing.join(),/unrecorded/);
});

test('query selectors use existing scoped helper, explicit projection, retained locators and bounded coverage',async t=>{
  const requests=[];const {service}=await fixture(t,{query:async input=>{requests.push(input);return {results:[{id:'fixture-row',value:5,unselected:'Do not send',originalSourceRef:{kind:'claim-record',claimID:'stored-id'},sourceRevision:{hash:'abc'},dates:{recordedAt:42}}],filters:{global:false,projectID:'generic'},coverage:'Cached test scope',truncated:true,nextCursor:'next'};}});
  const result=await service.evaluate({version:1,evidence:[{id:'rows',source:'query',domain:'facts',query:'delivery',fields:['value'],filters:{projectID:'generic'},limit:1}]},{owner});
  assert.equal(requests[0].projectID,'generic');assert.deepEqual(result.packet[0].value,[{value:5}]);assert.equal(result.packet[0].status,'partial');assert.equal(result.packet[0].provenance.sourceRefs[0].sourceRef.claimID,'stored-id');
});

for(const status of ['unavailable','provider-failed','invalid-response','cancelled'])test(`${status} remains honest, persists failure, and blocks dependent stage`,async t=>{
  const {service,store,calls}=await fixture(t,{evaluate:()=>({status,requestedProvider:'typesafe',requestedModel:'jev-fixture',failure:'Synthetic failure',results:[]})});
  const result=await service.evaluate(contract({questions:[q('first'),q('dependent',{stage:1,dependsOn:['first']})],composition:[composition('view','first')]}),{owner});
  assert.equal(result.status,status);assert.equal(calls.length,1);assert.equal(result.answers[1].status,'blocked');assert.equal(result.compositions[0].value,null);assert.equal(store.judgmentHistory()[0].status,status);
});

test('valid historical answers from an invalid batch remain inspectable but cannot compose or feed later stages',async t=>{
  const {service}=await fixture(t,{evaluate:()=>({status:'invalid-response',resultsReusable:false,requestedProvider:'typesafe',requestedModel:'jev-fixture',reportedModel:'wrong',failure:'One invalid answer',
    results:[{questionID:'first',answer:{probabilityYes:0.8}}]})});
  const result=await service.evaluate(contract({questions:[q('first'),q('second'),q('dependent',{stage:1,dependsOn:['first']})],composition:[composition('view','first')]}),{owner});
  assert.equal(result.answers[0].answer.probabilityYes,0.8);assert.equal(result.answers[0].reusable,false);assert.equal(result.answers[2].status,'blocked');assert.equal(result.compositions[0].value,null);
});

test('cancellation and source edits during provider call retain actual answers as nonreusable',async t=>{
  const controller=new AbortController();const {service,store}=await fixture(t,{evaluate:()=>{controller.abort();return {status:'ok',requestedProvider:'typesafe',requestedModel:'jev-fixture',results:[{questionID:'fit',answer:{probabilityYes:0.8}}]};}});
  const result=await service.evaluate(contract({questions:[q('fit')]}),{owner,signal:controller.signal});assert.equal(result.status,'cancelled');assert.equal(result.answers[0].reusable,false);assert.equal(store.judgmentHistory()[0].status,'cancelled');
});

test('receipt ownership/expiry/copies and invalid preflight prevent provider calls',async t=>{
  let time=100;const {service,calls}=await fixture(t,{clock:()=>time});const prepared=await service.prepare(contract({questions:[q('fit')]}),{owner});
  assert.throws(()=>service.inspect(prepared.receiptID,{owner:{...owner,sessionID:'other'}}),/unavailable/);
  await assert.rejects(()=>service.prepare(contract({questions:[q('fit',{dependsOn:['fit']})]}),{owner}),/later stage/);
  await assert.rejects(()=>service.prepare({version:1,supplied:[supplied('secret',{apiKey:'private'})]},{owner}),/Secret/);
  time+=3600001;assert.throws(()=>service.inspect(prepared.receiptID,{owner}),/expired/);assert.equal(calls.length,0);
});
