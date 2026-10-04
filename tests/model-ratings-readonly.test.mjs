import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createLocalDataStore } from '../server/data/store.mjs';
import { createModelRatingService } from '../server/model-ratings.mjs';

test('status reads and blocked restore never dispatch or mutate retained legacy jobs', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-legacy-restore-'));
  const db = createLocalDataStore(root), calls = [];
  const job = { id: 'retained', project: 'p', session: 'ses_retained', model: 'host/model', targets: [], status: 'running', summary: 'Retained', createdAt: 1, progress: {} };
  db.saveRatingJob(job); const original = db.ratingJob(job.id);
  const service = createModelRatingService({ localData: { get: () => db }, canRun: () => false,
    host: { request(route) { calls.push(route); throw Error('No native call'); } } });
  t.after(async () => { await service.close(); db.close(); await rm(root, { recursive: true, force: true }); });
  assert.equal(service.status().status, 'running'); service.resumeAutomaticWork(); await service.retireLegacy();
  await assert.rejects(service.start(), error => error.status === 410);
  assert.deepEqual(calls, []); assert.deepEqual(db.ratingJob(job.id), original);
});

test('restore authorization is rechecked after async native ownership lookup', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-legacy-guard-'));
  const db = createLocalDataStore(root), calls = [];
  db.saveRatingJob({ id: 'retained', project: 'p', session: 'ses_retained', model: 'host/model', targets: [], status: 'running', summary: 'Retained', createdAt: 1, progress: {} });
  let allowed = true, release, entered;
  const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { entered = resolve; });
  const service = createModelRatingService({ localData: { get: () => db }, canRun: () => allowed,
    project: async () => ({ id: 'p', directory: root }), host: { async request(route) {
      calls.push(route); entered(); await gate; return { id: 'ses_retained', directory: root };
    } } });
  t.after(async () => { release(); await service.close(); db.close(); await rm(root, { recursive: true, force: true }); });
  const pending = service.retireLegacy(); await ready; allowed = false; release(); await pending;
  assert.equal(calls.length, 1); assert.equal(db.ratingJob('retained').status, 'retirement-unverified');
  assert.ok(calls.every(route => !route.endsWith('/abort') && !route.includes('prompt')));
});
