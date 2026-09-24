import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDecision, answeredChoice} from '../tools/runtime/decision.mjs';
const decision=()=>makeDecision({id:'test',args:{role:'architect',task:'Inspect a design.'},selection:{selected_model:'openai/strong',surface:'openai-oauth',choices:{recommended:{id:'openai/strong',surface:'openai-oauth'},lower_cost:[{id:'openai/small',surface:'openai-oauth'}],free:[{id:'opencode/free',surface:'opencode-free'}]}},parentModel:'openai/parent',sessionID:'parent',userMessageID:'user1',createdAt:new Date(100).toISOString()});
const answered=(d,label)=>[{info:{role:'user',id:'user1'},parts:[]},{info:{role:'assistant'},parts:[{type:'tool',tool:'question',callID:'question1',state:{status:'completed',time:{start:101},input:{questions:[d.question]},metadata:{answers:[[label]]}}}]}];
test('choice explains distinct qualified routes, current model, wait and cancel',()=>{
 const d=decision();assert.deepEqual(d.choices.map(c=>c.label),['Recommended child','Lower-cost child','Free child','Continue current','Wait','Cancel']);
 assert.equal(answeredChoice(d,answered(d,'Lower-cost child'),200).model,'openai/small');
 assert.equal(answeredChoice(d,answered(d,'Continue current'),200).action,'continue_parent');
 assert.equal(answeredChoice(d,answered(d,'Wait'),200).action,'wait_requested');
 assert.equal(answeredChoice(d,answered(d,'Cancel'),200).action,'cancelled');
});
test('absent choices and unverified stop are honest and cannot offer another writer',()=>{
 const d=makeDecision({id:'none',args:{role:'worker',task:'Fix one file.'},parentModel:'openai/parent',sessionID:'parent',createdAt:new Date(100).toISOString(),allowParent:false,failure:'throttle'});
 assert.deepEqual(d.choices.map(c=>c.label),['Wait','Cancel']);assert.match(d.question.question,/unverified/);assert.match(d.question.question,/Free child: currently unavailable/);
});
test('fabricated, stale, altered and unrelated question answers cannot authorize execution',()=>{
 const d=decision();assert.throws(()=>answeredChoice(d,[],200));
 const m=answered(d,'Recommended child');m[1].parts[0].state.metadata.answers=[['custom answer']];assert.throws(()=>answeredChoice(d,m,200));
 const other=answered(d,'Recommended child');other[0].info.id='later-user';assert.throws(()=>answeredChoice(d,other,200),/request changed/);
 const early=answered(d,'Recommended child');early[1].parts[0].state.time.start=99;assert.throws(()=>answeredChoice(d,early,200));
 assert.throws(()=>answeredChoice(d,answered(d,'Recommended child'),31*60*1000),/expired/);
 const changed=structuredClone(answered(d,'Recommended child'));changed[1].parts[0].state.input.questions[0].question='Different assignment';assert.throws(()=>answeredChoice(d,changed,200));
});
