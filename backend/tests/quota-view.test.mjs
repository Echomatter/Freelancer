import test from 'node:test';
import assert from 'node:assert/strict';
import { usageView } from '../../shared/usage.mjs';
const now=Date.parse('2026-09-19T22:00:00Z');
const reset='2026-10-01T00:00:00Z';
const telemetry={status:'ok',as_of:new Date(now).toISOString(),source:'fixture'};
function fixture(){return {surfaces:{
  'opencode-go':{telemetry,windows:{rolling:{used_percent:0,resets_at:reset},weekly:{used_percent:102.6,resets_at:reset,status:'rate-limited'},monthly:{used_percent:51.3,resets_at:reset}}},
  'openai-oauth':{telemetry,windows:{primary:{used_percent:24,window_seconds:604800,reset_at_unix:Date.parse(reset)/1000}}},
  'github-copilot-oauth':{telemetry,reset_at:reset,buckets:{premium_interactions:{percent_remaining:0,entitlement:1500,credits_used:1508,quota_remaining:-8.5},chat:{unlimited:true,percent_remaining:100}}}
}};}
const installed=['opencode-go','openai-oauth','github-copilot-oauth','opencode-free'];
test('weekly exhaustion blocks current use without erasing monthly balance',()=>{
  const view=usageView(fixture(),installed,{},now),go=view.providers[0];
  assert.equal(go.availableRemaining,0);assert.equal(go.balanceRemaining,48.7);
  assert.equal(go.metrics[1].usedPercent,102.6);assert.equal(go.metrics[1].remainingPercent,0);
  assert.equal(view.combined.segments.length,3);
  assert.ok(Math.abs(view.combined.availablePercent-76/3)<1e-8);
  assert.ok(Math.abs(view.combined.balancePercent-(76+48.7)/3)<1e-8);
});
test('unlimited Copilot buckets do not dilute exhausted included credits',()=>{
  const cp=usageView(fixture(),installed,{},now).providers[2];
  assert.equal(cp.availableRemaining,0);assert.equal(cp.balanceRemaining,0);
  assert.equal(cp.metrics[0].remaining,-8.5);
  assert.deepEqual(cp.metrics.map(m=>m.key),['premium_interactions']);
});
test('Copilot hides unlimited chat and completions but retains finite allowances',()=>{
  const s=fixture(),b=s.surfaces['github-copilot-oauth'].buckets;
  b.completions={unlimited:true,percent_remaining:100};
  assert.deepEqual(usageView(s,installed,{},now).providers[2].metrics.map(m=>m.key),['premium_interactions']);
  b.chat={unlimited:false,percent_remaining:50};
  assert.deepEqual(usageView(s,installed,{},now).providers[2].metrics.map(m=>m.key),['premium_interactions','chat']);
});
test('missing telemetry remains unknown and keeps its aggregate share',()=>{
  const s=fixture();delete s.surfaces['opencode-go'];
  const view=usageView(s,installed,{},now);
  assert.equal(view.providers[0].balanceRemaining,null);assert.equal(view.combined.unknownPlans,1);
  assert.equal(view.combined.segments[0].share,100/3);
});
test('old or reset-past observations cannot imply current capacity',()=>{
  for(const time of [now+600001,Date.parse(reset)+1]){
    const view=usageView(fixture(),installed,{},time);
    assert.equal(view.providers[0].balanceRemaining,null);assert.equal(view.providers[1].availableRemaining,null);
  }
});
test('invalid numbers, missing windows, unknown providers and free-only installs are honest',()=>{
  const s=fixture();s.surfaces['openai-oauth'].windows.primary.used_percent=null;
  assert.equal(usageView(s,installed,{},now).providers[1].balanceRemaining,null);
  assert.equal(usageView({},['custom-provider'],{},now).providers[0].availableRemaining,null);
  assert.equal(usageView({},['custom-provider'],{},now).combined.balancePercent,null);
  assert.equal(usageView({},['opencode-free'],{},now).combined.balancePercent,null);
});
test('dated cached data retains its freshness and reports the failed refresh',()=>{
  const s=fixture();s.surfaces['openai-oauth'].telemetry={...telemetry,cached:true,last_attempt_status:'auth-failed'};
  const p=usageView(s,installed,{},now).providers[1];
  assert.equal(p.availableRemaining,76);assert.equal(p.cached,true);assert.equal(p.telemetryStatus,'auth-failed');
});
test('active execution block affects current use, not plan balance',()=>{
  const s=fixture();s.surfaces['openai-oauth'].execution={blocked:true,recheck_at:reset};
  const p=usageView(s,installed,{},now).providers[1];assert.equal(p.availableRemaining,0);assert.equal(p.balanceRemaining,76);
});
