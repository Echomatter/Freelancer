import test from 'node:test';
import assert from 'node:assert/strict';
import { createTypeSafeJudgmentProvider } from '../server/data/judgment-provider.mjs';

test('TypeSafe adapter sends a typed score, records actual model and token usage, and honors abort', async () => {
  let request, options;
  const provider=createTypeSafeJudgmentProvider({env:{TYPESAFE_API_KEY:'test-key'},client:{
    async systemOne(input,settings) {
      request=input; options=settings;
      return {model:'jev-1.13.0',usage:{input_tokens:42,output_tokens:6},answers:{relevance:{type:'score',score:1.8,confidence:0.91,
        legend:{0:'poor',1:'mixed',2:'strong'},probabilities:{0:0,1:0.2,2:0.8}}}};
    },
  }});
  const controller=new AbortController();
  const result=await provider.evaluate({definition:{questionID:'relevance',primitive:'score',question:'How relevant is this evidence?',criteria:{levels:['poor','mixed','strong']}},
    state:{query:'migration',evidence:[{ref:'source-a#L1-L4',text:'A staged, recoverable import.'}]},signal:controller.signal});
  assert.equal(request.model,'jev-latest');
  assert.equal(request.questions.relevance.type,'score');
  assert.deepEqual(options.signal,controller.signal);
  assert.equal(result.reportedProvider,'typesafe');
  assert.equal(result.reportedModel,'jev-1.13.0');
  assert.deepEqual(result.usage,{input_tokens:42,output_tokens:6});
  assert.equal(result.results[0].confidence,0.91);
  assert.deepEqual(result.results[0].probabilities,{0:0,1:0.2,2:0.8});
});

test('TypeSafe adapter sends independent question definitions in one System One request', async () => {
  let calls=0,request;
  const provider=createTypeSafeJudgmentProvider({env:{TYPESAFE_API_KEY:'test-key'},client:{async systemOne(input){calls++;request=input;return {
    model:'jev-1.13.0',usage:{input_tokens:60,output_tokens:10},answers:{relevance:{type:'score',score:2,confidence:0.9,probabilities:{0:0,1:0,2:1}},
      contains_id:{type:'noul',noul:0.98}},
  };}}});
  const response=await provider.evaluateMany({definitions:[
    {questionID:'relevance',primitive:'score',question:'Score candidate relevance.',criteria:{levels:['low','medium','high']}},
    {questionID:'contains_id',primitive:'check',question:'Does it contain the exact identifier?',criteria:{yes:'Exact identifier is present',no:'Identifier is absent'}},
  ],state:{candidate:'Reference id REF-9 appears in this synthetic passage.'}});
  assert.equal(calls,1);assert.deepEqual(Object.keys(request.questions),['relevance','contains_id']);
  assert.equal(response.results.length,2);assert.equal(response.results[1].answer.probabilityYes,0.98);
});

test('TypeSafe adapter requires the runtime credential and never returns it', async () => {
  const provider=createTypeSafeJudgmentProvider({env:{}});
  assert.deepEqual(provider.status(),{configured:false,provider:'typesafe',connectivity:'unavailable',reason:'TYPESAFE_API_KEY is not configured.'});
  assert.equal((await provider.evaluate({definition:{},state:{}})).status,'unavailable');
});

test('TypeSafe adapter rejects out of rubric answers and keeps provider errors bounded and redacted', async () => {
  const invalid=createTypeSafeJudgmentProvider({env:{TYPESAFE_API_KEY:'test-key'},client:{
    async systemOne() { return {model:'jev-test',answers:{relevance:{type:'score',score:9,confidence:0.9,probabilities:{0:0,1:0,2:1}}}}; },
  }});
  const def={questionID:'relevance',primitive:'score',question:'Score.',criteria:{levels:['poor','mixed','strong']}};
  assert.equal((await invalid.evaluate({definition:def,state:{}})).status,'invalid-response');

  const failed=createTypeSafeJudgmentProvider({env:{TYPESAFE_API_KEY:'test-key'},client:{
    async systemOne() { throw Error('API key: secret-value rejected'); },
  }});
  const receipt=await failed.evaluate({definition:def,state:{}});
  assert.equal(receipt.status,'provider-failed');
  assert.doesNotMatch(receipt.failure,/secret-value/);
});
