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
