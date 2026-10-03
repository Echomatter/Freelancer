import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLocalDataStore } from '../server/data/store.mjs';
import { createModelRatingService } from '../server/model-ratings.mjs';
import { parseModelRatings, ratingsPrompt } from '../domain/model-ratings.mjs';
import { organizedSessions } from '../domain/history.mjs';

const scores = { coding: 70, reasoning: 60, research: 55, tool_use: 80, instruction_following: 75 };
test('restore guard keeps rating status read-only, blocks new research, and releases retained work without resending uncertain input', async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),'freelancer-rating-recovery-'));
  let db,service;
  t.after(async()=>{service?.close();db?.close();await rm(root,{recursive:true,force:true});});
  const rows=[{id:'opencode/target',name:'Target',provider:'opencode'}],calls=[];
  db=createLocalDataStore(root);db.modelCatalog(rows);
  const job={id:'retained-rating-job',project:'p',session:'ses_retained',model:'opencode/fixture',targets:rows.map(row=>row.id),status:'running',summary:'Retained fixture research',createdAt:Date.now(),
    progress:{rows,queue:rows,workers:[{session:'ses_retained',model:'opencode/fixture',status:'ready',batch:[]}],updated:[],missing:[]}};
  db.saveRatingJob(job);const original=JSON.stringify(db.currentRatingJob());db.close();
  let permitted=false;
  const host={async request(route,options){calls.push({route,options});
    if(route==='/session/status')return {ses_retained:{type:'busy'}};
    if(route==='/permission'||route==='/question'||route.endsWith('/message'))return [];
    if(route.endsWith('/prompt_async'))return {};
    throw Error(route);
  }};
  const options={host,backendRoot:root,dataRoot:root,canRun:()=>permitted,project:async()=>({id:'p',directory:root}),getCatalog:async()=>({models:rows,providers:{connected:['opencode']}})};
  service=createModelRatingService(options);
  assert.equal(service.status().status,'running');service.resumeAutomaticWork();service.status();
  await assert.rejects(service.start('p','opencode/fixture'),error=>error.status===409&&/Review restored work/.test(error.message));
  await new Promise(resolve=>setTimeout(resolve,70));assert.equal(calls.length,0);
  const check=createLocalDataStore(root);assert.equal(JSON.stringify(check.currentRatingJob()),original);check.close();
  permitted=true;service.resumeAutomaticWork();service.resumeAutomaticWork();
  const deadline=Date.now()+3000;
  while(!calls.some(call=>call.route.endsWith('/prompt_async'))&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(calls.filter(call=>call.route.endsWith('/prompt_async')).length,1);
  service.close();permitted=false;service=createModelRatingService(options);service.status();
  const before=calls.length;await new Promise(resolve=>setTimeout(resolve,70));assert.equal(calls.length,before);
  permitted=true;service.resumeAutomaticWork();await new Promise(resolve=>setTimeout(resolve,70));
  assert.equal(calls.filter(call=>call.route.endsWith('/prompt_async')).length,1,'Review observes an existing uncertain request; it never resends its saved identity.');
});

test('rating start rechecks restore authorization after an asynchronous catalog read',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'freelancer-rating-guard-race-'));let allowed=true,release,entered;
  const ready=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;}),calls=[];
  const rows=[{id:'opencode/fixture',provider:'opencode',name:'Fixture'}];
  const service=createModelRatingService({backendRoot:root,dataRoot:root,canRun:()=>allowed,
    project:async()=>({id:'p',directory:root}),host:{async request(route){calls.push(route);throw Error('No native action expected.');}},
    getCatalog:async()=>{entered();await gate;return {models:rows,providers:{connected:['opencode']}};}});
  t.after(async()=>{release();service.close();await rm(root,{recursive:true,force:true});});
  service.catalog(rows);const pending=service.start('p','opencode/fixture');
  const rejected=assert.rejects(pending,error=>error.status===409);
  await ready;allowed=false;release();await rejected;
  assert.deepEqual(calls,[]);assert.equal(service.status(),null);
});

for(const revokedBy of ['review guard','close'])test(`pending rating request persistence cannot dispatch after ${revokedBy}`,async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'freelancer-rating-persist-race-'));
  const db=createLocalDataStore(root),rows=[{id:'opencode/target',provider:'opencode',name:'Target'}],calls=[];
  db.modelCatalog(rows);db.saveRatingJob({id:'held-rating-job',project:'p',session:'ses_held',model:'opencode/fixture',targets:rows.map(row=>row.id),status:'running',summary:'Held fixture research',createdAt:Date.now(),
    progress:{rows,queue:rows,workers:[{session:'ses_held',model:'opencode/fixture',status:'ready',batch:[]}],updated:[],missing:[]}});
  let allowed=true,release,entered,service;
  const ready=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  t.after(async()=>{release();service?.close();await new Promise(resolve=>setTimeout(resolve,50));db.close();await rm(root,{recursive:true,force:true});});
  const host={async request(route){calls.push(route);
    if(route==='/session/status')return {ses_held:{type:'busy'}};
    if(route==='/permission'||route==='/question'||route.endsWith('/message'))return [];
    throw Error('No execution request expected.');
  }};
  const captured=[];
  service=createModelRatingService({backendRoot:root,host,localData:{get:()=>db},canRun:()=>allowed,project:async()=>({id:'p',directory:root}),
    store:{async recordRequest(receipt){captured.push(receipt);entered();await gate;}}});
  service.resumeAutomaticWork();await ready;
  assert.ok(db.currentRatingJob().progress.workers[0].messageID,'Native request identity is durable before its delivery boundary.');
  if(revokedBy==='close')service.close();else {allowed=false;service.suspendAutomaticWork();}
  release();await new Promise(resolve=>setTimeout(resolve,80));
  assert.equal(captured.length,1);assert.equal(calls.filter(route=>route.endsWith('/prompt_async')).length,0);
  assert.equal(db.currentRatingJob().status,'running','The uncertain persisted identity is retained for inspection.');
  if(revokedBy==='review guard') {allowed=true;service.resumeAutomaticWork();await new Promise(resolve=>setTimeout(resolve,80));
    assert.equal(calls.filter(route=>route.endsWith('/prompt_async')).length,0,'Restoring authorization does not replay the uncertain saved request.');}
});

test('rating contract accepts labeled estimates and rejects unrelated or incomplete scores', () => {
  const text = JSON.stringify({ models: [{ id: 'opencode/example', scores, confidence: 'low', summary: 'Estimated from its predecessor.', sources: [] }] });
  assert.equal(parseModelRatings(text, ['opencode/example'])[0].rating.provenance, 'inferred estimate');
  assert.throws(() => parseModelRatings(text, ['opencode/different']), /Unexpected model/);
  assert.throws(() => parseModelRatings(text, ['opencode/example', 'opencode/other']), /valid model ratings list/);
  assert.throws(() => parseModelRatings(JSON.stringify({ models: [{ id: 'opencode/example', scores: { coding: 70 }, summary: 'X' }] }), ['opencode/example']), /Invalid reasoning/);
});

test('partial results preserve complete profiles and natural research accepts public aliases', () => {
  const rows = [{ id: 'provider/a', scores, summary: 'Family inference', sources: [] },
    { id: 'provider/b', scores: { coding: 50 }, summary: 'Incomplete' }];
  assert.equal(parseModelRatings('Here are the results:\n```json\n' + JSON.stringify({ models: rows }) + '\n```',
    ['provider/a', 'provider/b', 'provider/c'], { partial: true }).length, 1);
  assert.throws(() => parseModelRatings(JSON.stringify({ models: [rows[0], rows[0]] }), ['provider/a'], { partial: true }), /Unexpected/);
  const prompt = ratingsPrompt([{ id: 'provider/example-free', name: 'Example' }]);
  assert.match(prompt, /hosting alias/);
  assert.match(prompt, /SWE-bench/);
  assert.match(prompt, /webfetch/);
  assert.match(prompt, /Consider shared Fetch/);
  assert.match(prompt, /optional retrieval methods, not prerequisites/);
  assert.match(prompt, /do not prove actual Freelancer model outcomes/);
  assert.match(prompt, /inference with low confidence/);
});

test('all missing models run in batches, restart observes the right reply, and retry keeps earlier results', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-rating-batches-'));
  const models = Array.from({ length: 9 }, (_, i) => ({ id: `opencode/model${i}`, provider: 'opencode', name: `Model ${i}` }));
  models[0].variants = ['high'];
  const messages = [], calls = [];
  let busy = true, sessions = 0, failRead = false;
  const host = { async request(route, options) {
    calls.push({ route, options });
    if (route === '/session') return { id: `ses_config${++sessions}`, directory: root };
    if (route.endsWith('/prompt_async')) { busy = true; return {}; }
    if (route.endsWith('/abort')) { busy = false; return true; }
    if (route.endsWith('/message')) { if (failRead) throw Error('Temporary disconnection'); return messages; }
    if (route === '/session/status') return { [`ses_config${sessions}`]: { type: busy ? 'busy' : 'idle' } };
    if (route === '/permission' || route === '/question') return [];
    throw Error(route);
  } };
  const options = { host, backendRoot: root, dataRoot: root, project: async () => ({ id: 'p', directory: root }),
    getCatalog: async () => ({ models, providers: { connected: ['opencode'] } }) };
  let service = createModelRatingService(options);
  t.after(async () => { service.close(); await rm(root, { recursive: true, force: true }); });
  service.catalog(models);
  const prompts = () => calls.filter(call => call.route.endsWith('/prompt_async'));
  async function until(condition) {
    for (let i = 0; i < 100; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
    assert.fail('Configuration job did not advance');
  }
  const reply = ids => {
    messages.push({ info: { role: 'assistant', parentID: prompts().at(-1).options.body.messageID,
      finish: 'stop', time: { completed: Date.now() } }, parts: [{ type: 'text', text: JSON.stringify({
        models: ids.map(id => ({ id, scores, summary: 'Estimated from model card', sources: [] })),
      }) }] });
    busy = false;
  };
  await assert.rejects(service.start('p', models[0].id, undefined, 'invented'), /intelligence level/);
  const job = await service.start('p', models[0].id, undefined, 'high');
  assert.equal(prompts()[0].options.body.variant, 'high');
  assert.equal(job.targets.length, 9, 'no three-model cap');
  await assert.rejects(service.start('p', models[0].id), /already running/);
  reply(job.targets.slice(0, 5)); // One omitted profile must not discard the five good ones.
  await until(() => prompts().length === 2);
  assert.match(prompts()[1].options.body.parts[0].text, /model8/);
  service.close();
  service = createModelRatingService(options);
  failRead = true;
  service.status();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(service.status().status, 'running', 'read failure cannot release the execution fence');
  failRead = false;
  busy = false;
  await new Promise(resolve => setTimeout(resolve, 1950));
  assert.equal(service.status().status, 'running', 'previous batch reply cannot complete the new batch');
  assert.equal(prompts().length, 2, 'restart never resubmits');
  reply(job.targets.slice(6));
  await until(() => service.status().status === 'partial');
  assert.equal(service.status().missing, 1);
  assert.equal(Object.values(service.catalog(models)).filter(row => row.rating).length, 8);
  service.dismiss(job.id);
  assert.equal(service.status(), null);
  const db = createLocalDataStore(root);
  assert.ok(db.annotation('p', job.session).hiddenAt);
  assert.deepEqual(organizedSessions([{ id: job.session }, { id: 'ses_child', parentID: job.session }, { id: 'ses_normal' }],
    {}, false, db.systemSessions('p')).map(row => row.id), ['ses_normal']);
  db.close();
  const retry = await service.start('p', models[0].id, job.id);
  assert.deepEqual(retry.targets, [job.targets[5]]);
  reply(retry.targets);
  await until(() => service.status().status === 'completed');
  service.dismiss(retry.id);
  service.close();
  service = createModelRatingService(options);
  assert.equal(service.status(), null, 'dismissed jobs stay hidden after restart');
  assert.equal(Object.values(service.catalog(models)).filter(row => row.rating).length, 9);
  const stopped = await service.start('p', models[0].id);
  const result = await service.stop(stopped.id);
  assert.equal(result.status, 'stopped');
  assert.equal(result.missing, 9);
  assert.equal(Object.values(service.catalog(models)).filter(row => row.rating).length, 9, 'Stop preserves saved ratings');
  service.dismiss(stopped.id);
});

test('SQLite holds full catalog metadata and prioritizes missing profiles without changing previous ratings', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-ratings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const db = createLocalDataStore(root);
  const rows = [{ id: 'opencode/a', name: 'A', native: { cost: { input: 0 } } }, { id: 'opencode/b', name: 'B' }];
  db.modelCatalog(rows);
  assert.equal(db.unratedModels()[0].native.cost.input, 0);
  db.saveModelRatings([{ id: 'opencode/a', rating: { scores, summary: 'Estimate', sources: [] } }], 'opencode/worker');
  assert.throws(() => db.saveModelRatings([{ id: 'opencode/missing', rating: { scores, summary: 'X' } }], 'opencode/worker'), /inventory changed/);
  db.modelCatalog(rows);
  assert.equal(db.modelRatings()['opencode/a'].status, 'Updated');
  assert.equal(db.unratedModels()[0].id, 'opencode/b');
  db.close();
  const reopened = createLocalDataStore(root);
  assert.equal(reopened.modelRatings()['opencode/a'].sourceModel, 'opencode/worker');
  reopened.close();
});

test('background configuration accepts one native session and records completed ratings', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-rating-job-'));
  let response = [];
  const calls = [];
  const host = { async request(route, options) {
    calls.push({ route, options });
    if (route === '/session') return { id: 'ses_config', directory: root };
    if (route.endsWith('/prompt_async')) return {};
    if (route === '/session/status') return { ses_config: { type: response.length ? 'idle' : 'busy' } };
    if (route === '/permission' || route === '/question') return [];
    if (route.endsWith('/message')) return response;
    throw Error(route);
  } };
  const service = createModelRatingService({ host, backendRoot: root, dataRoot: root,
    project: async () => ({ id: 'p', directory: root }),
    getCatalog: async () => ({ models: [{ id: 'opencode/a', provider: 'opencode', name: 'A' },
      { id: 'opencode/worker', provider: 'opencode', name: 'Worker' }], providers: { connected: ['opencode'] } }) });
  t.after(async () => { service.close(); await rm(root, { recursive: true, force: true }); });
  service.catalog([{ id: 'opencode/a', name: 'A' }]);
  const job = await service.start('p', 'opencode/worker');
  assert.equal(job.status, 'running');
  await assert.rejects(service.start('p', 'opencode/worker'), /already running/);
  assert.equal(calls.filter((call) => call.route.endsWith('/prompt_async')).length, 1);
  response = [{ info: { role: 'assistant', parentID: calls.find(call => call.route.endsWith('/prompt_async')).options.body.messageID, time: { completed: Date.now() }, finish: 'stop' }, parts: [{ type: 'text', text: JSON.stringify({
    models: [{ id: 'opencode/a', scores, summary: 'Best estimate', confidence: 'low', sources: [] }],
  }) }] }];
  await new Promise((resolve) => setTimeout(resolve, 1950));
  assert.equal(service.status().status, 'completed');
  assert.equal(service.catalog([{ id: 'opencode/a' }])['opencode/a'].status, 'Updated');
});

for (const targetCount of [1, 24]) test(`free research dispatches four workers concurrently and reassigns a failed batch (${targetCount} targets)`, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-free-rating-pool-'));
  const targets = Array.from({ length: targetCount }, (_, i) => ({ id: `provider/model${i}`, provider: 'provider', name: `Model ${i}`, costClass: 'subscription' }));
  const free = Array.from({ length: 4 }, (_, i) => ({ id: `opencode/free${i}`, provider: 'opencode', name: `Free ${i}`, costClass: 'free' }));
  const models = [...targets, ...free], calls = [], messages = new Map(), statuses = {};
  let sessions = 0;
  const host = { async request(route, options) {
    calls.push({ route, options });
    if (route === '/session') { const id = `ses_free${++sessions}`; statuses[id] = { type: 'busy' }; return { id, directory: root }; }
    if (route.endsWith('/prompt_async')) return {};
    if (route.endsWith('/message')) return messages.get(route.split('/')[2]) ?? [];
    if (route === '/session/status') return statuses;
    if (route === '/permission' || route === '/question') return [];
    if (route.endsWith('/abort')) return true;
    throw Error(route);
  } };
  const service = createModelRatingService({ host, backendRoot: root, dataRoot: root,
    project: async () => ({ id: 'p', directory: root }),
    getCatalog: async () => ({ models, providers: { connected: ['provider', 'opencode'] } }) });
  t.after(async () => { service.close(); await rm(root, { recursive: true, force: true }); });
  service.catalog(models);
  await service.start('p', '', undefined, '', true);
  const prompts = () => calls.filter(call => call.route.endsWith('/prompt_async'));
  assert.equal(prompts().length, 4, 'four free workers start without waiting for each other');
  const failed = prompts()[0], session = failed.route.split('/')[2];
  messages.set(session, [{ info: { role: 'assistant', parentID: failed.options.body.messageID, error: true,
    finish: 'stop', time: { completed: Date.now() } }, parts: [] }]);
  statuses[session] = { type: 'idle' };
  const completed = prompts()[1], completedSession = completed.route.split('/')[2];
  const completedTargets = models.filter(row => completed.options.body.parts[0].text.includes(`${row.id}:`));
  messages.set(completedSession, [{ info: { role: 'assistant', parentID: completed.options.body.messageID,
    finish: 'stop', time: { completed: Date.now() } }, parts: [{ type: 'text', text: JSON.stringify({ models: completedTargets.map(row => ({
      id: row.id, scores, summary: 'Estimate', sources: [],
    })) }) }] }]);
  statuses[completedSession] = { type: 'idle' };
  for (let i = 0; i < 30 && prompts().length === 4; i++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(prompts().length, 5, 'another available free worker receives the failed batch');
  assert.equal(prompts().filter(call => call.route.split('/')[2] === session).length, 1, 'failed worker is not retried');
  for (const call of prompts()) {
    const id = call.route.split('/')[2];
    messages.set(id, [{ info: { role: 'assistant', parentID: call.options.body.messageID, error: true,
      finish: 'stop', time: { completed: Date.now() } }, parts: [] }]);
    statuses[id] = { type: 'idle' };
  }
  for (let i = 0; i < 40 && service.status().status === 'running'; i++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(service.status().status, 'partial', 'an exhausted pool terminates with unresolved work instead of hanging');
  assert.ok(service.status().missing > 0);
});
