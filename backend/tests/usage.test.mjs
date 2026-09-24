import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeSessions} from '../tools/runtime/usage.mjs';
const message=(id,input)=>({info:{id,role:'assistant',providerID:'p',modelID:'m',tokens:{input,output:2,reasoning:1,cache:{read:3,write:0}},cost:0}});
test('parent and child are separated and duplicate exports/messages cannot double count',()=>{
 const p={info:{id:'parent'},messages:[message('m1',10),message('m1',10)]};const c={info:{id:'child',parentID:'parent'},messages:[message('m2',20)]};
 const r=summarizeSessions([p,c,c],'parent');assert.equal(r.sessions.length,2);assert.equal(r.sessions[0].models[0].input,10);assert.equal(r.sessions[1].models[0].input,20);assert.equal(r.savings.measurable,false);
});
test('absent usage is marked incomplete, not claimed as measured zero',()=>{
 const r=summarizeSessions([{info:{id:'p'},messages:[{info:{id:'m',role:'assistant',providerID:'p',modelID:'m'}}]}],'p');assert.equal(r.sessions[0].models[0].complete_usage,false);
});
