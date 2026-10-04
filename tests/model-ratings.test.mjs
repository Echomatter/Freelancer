import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createLocalDataStore } from '../server/data/store.mjs';
import { createModelRatingService } from '../server/model-ratings.mjs';
import { parseModelRatings } from '../domain/model-ratings.mjs';
import { organizedSessions } from '../domain/history.mjs';

const scores = { coding: 70, reasoning: 60, research: 55, tool_use: 80, instruction_following: 75 };
async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-legacy-rating-'));
  const db = createLocalDataStore(root), calls = [];
  const job = { id: 'legacy', project: 'p', session: 'ses_legacy', model: 'host/research', targets: ['host/model'],
    status: 'running', summary: 'Historical research', createdAt: 1, progress: { workers: [{ session: 'ses_worker' }] } };
  db.saveRatingJob(job);
  const host = { async request(route, input = {}) {
    calls.push({ route, input });
    if (options.respond) return options.respond(route, input, root);
    if (route === '/session/status') return { ses_legacy: { type: 'idle' }, ses_worker: { type: 'idle' } };
    if (route.endsWith('/message')) return [];
    if (route.endsWith('/abort')) return true;
    if (route.startsWith('/session/')) return { id: route.split('/')[2], directory: root };
    throw Error('Unexpected native route');
  } };
  const service = createModelRatingService({ localData: { get: () => db }, backendRoot: root, host,
    project: async () => ({ id: 'p', directory: root }), canRun: options.canRun ?? (() => true) });
  t.after(async () => { await service.close(); db.close(); await rm(root, { recursive: true, force: true }); });
  return { root, db, calls, job, service };
}

test('legacy parser preserves labeled historical estimates and rejects incomplete/unrelated ratings', () => {
  const text = JSON.stringify({ models: [{ id: 'host/model', scores, summary: 'Historical estimate', sources: [] }] });
  assert.equal(parseModelRatings(text, ['host/model'])[0].rating.provenance, 'inferred estimate');
  assert.throws(() => parseModelRatings(text, ['host/other']), /Unexpected model/);
  assert.throws(() => parseModelRatings(text, ['host/model', 'host/missing']), /valid model ratings list/);
  assert.throws(() => parseModelRatings(JSON.stringify({ models: [{ id: 'host/model', scores: { coding: 70 }, summary: 'X' }] }), ['host/model']), /Invalid reasoning/);
});

test('retained estimates remain explicitly legacy and no new ratings can start', async t => {
  const f = await fixture(t);
  f.service.catalog([{ id: 'host/model', name: 'Model' }]);
  f.db.saveModelRatings([{ id: 'host/model', rating: { scores, summary: 'Old', sources: [] } }], 'host/research');
  const row = f.service.catalog([{ id: 'host/model', name: 'Model' }])['host/model'];
  assert.equal(row.estimateKind, 'legacy-estimate'); assert.equal(row.estimateLabel, 'Legacy estimate');
  assert.deepEqual(row.rating.scores, scores);
  await assert.rejects(f.service.start('p', 'host/research'), error => error.status === 410);
  assert.deepEqual(f.calls, []);
});

test('catalog replacement prunes absent models and preserves retained estimates and historical jobs', async t => {
  const f = await fixture(t);
  f.service.catalog([{ id: 'host/model', name: 'Model' }, { id: 'other/unconfigured', name: 'Unconfigured' }]);
  f.db.saveModelRatings([{ id: 'host/model', rating: { scores, summary: 'Kept', sources: [] } },
    { id: 'other/unconfigured', rating: { scores, summary: 'Removed', sources: [] } }], 'host/research');
  const retained = f.db.modelRatings()['host/model'], originalJob = f.db.ratingJob(f.job.id);
  const replaced = f.service.catalog([{ id: 'host/model', name: 'Renamed model' }, { id: 'opencode/free', name: 'Free' }]);
  assert.deepEqual(Object.keys(replaced).sort(), ['host/model', 'opencode/free']);
  assert.deepEqual(replaced['host/model'], retained);
  assert.equal(f.db.unratedModels().find(row => row.id === 'host/model').name, 'Renamed model');
  assert.equal(replaced['opencode/free'].rating, null);
  assert.deepEqual(f.db.ratingJob(f.job.id), originalJob);
  assert.deepEqual(f.service.catalog([]), {});
  assert.deepEqual(f.db.unratedModels(), []);
  assert.deepEqual(f.db.ratingJob(f.job.id), originalJob);
  assert.deepEqual(f.calls, []);
});

test('invalid catalog rows cannot erase or partially replace the saved inventory', async t => {
  const f = await fixture(t);
  f.service.catalog([{ id: 'host/model', name: 'Model' }]);
  f.db.saveModelRatings([{ id: 'host/model', rating: { scores, summary: 'Kept', sources: [] } }], 'host/research');
  const ratings = f.db.modelRatings(), metadata = f.db.unratedModels();
  const cyclic = { id: 'host/cyclic' }; cyclic.self = cyclic;
  for (const input of [null, {}, [null], [{}], [{ id: 1 }], [{ id: ' ' }], [{ id: ' host/model' }],
    [{ id: 'host/\u0000model' }], [{ id: 'x'.repeat(513) }], [{ id: 'host/model' }, { id: 'host/model' }],
    [{ id: 'host/new' }, cyclic], [{ id: 'host/model', toJSON: () => ({ id: 'host/spoofed' }) }],
    Array.from({ length: 20_001 }, (_, i) => ({ id: 'host/' + i }))]) {
    assert.throws(() => f.service.catalog(input), /valid model inventory/);
    assert.deepEqual(f.db.modelRatings(), ratings);
    assert.deepEqual(f.db.unratedModels(), metadata);
  }
});

test('catalog replacement rolls back pruning and metadata updates when a write fails', async t => {
  const f = await fixture(t);
  f.service.catalog([{ id: 'host/model', name: 'Model' }, { id: 'other/unconfigured', name: 'Unconfigured' }]);
  f.db.saveModelRatings([{ id: 'host/model', rating: { scores, summary: 'Kept', sources: [] } }], 'host/research');
  const ratings = f.db.modelRatings(), metadata = f.db.unratedModels();
  const raw = new DatabaseSync(f.db.filename);
  try {
    raw.exec("CREATE TRIGGER fail_catalog_insert BEFORE INSERT ON model_catalog WHEN new.model_id='host/failing' BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
    assert.throws(() => f.service.catalog([{ id: 'host/model', name: 'Changed' }, { id: 'host/failing', name: 'Failing' }]), /fixture failure/);
    assert.deepEqual(f.db.modelRatings(), ratings);
    assert.deepEqual(f.db.unratedModels(), metadata);
    raw.exec('DROP TRIGGER fail_catalog_insert');
  } finally { raw.close(); }
});

test('retirement verifies native ownership, aborts retained workers, observes tools, and preserves historical filtering', async t => {
  const f = await fixture(t);
  await Promise.all([f.service.retireLegacy(), f.service.retireLegacy()]);
  assert.equal(f.service.status().status, 'retired');
  assert.equal(f.calls.filter(row => row.route.endsWith('/abort')).length, 2);
  assert.equal(f.calls.filter(row => row.route.endsWith('/message')).length, 2);
  assert.ok(f.calls.every(row => !row.route.includes('prompt') && !(row.route === '/session' && row.input.method === 'POST')));
  const hidden = f.db.systemSessions('p');
  assert.deepEqual(organizedSessions([{ id: 'ses_legacy' }, { id: 'ses_worker' }, { id: 'ses_child', parentID: 'ses_legacy' }, { id: 'ses_normal' }], {}, false, hidden).map(row => row.id), ['ses_normal']);
  f.service.dismiss(f.job.id); assert.equal(f.service.status(), null);
  assert.equal(f.db.ratingJob(f.job.id).progress.workers[0].session, 'ses_worker');
});

for (const reason of ['foreign directory', 'transport failure', 'pending tool', 'unknown native status']) {
  test('unverified legacy retirement remains inspectable: ' + reason, async t => {
    const f = await fixture(t, { respond(route, input, root) {
      if (reason === 'transport failure') throw Error('Do not expose provider secrets');
      if (route.endsWith('/abort')) return true;
      if (route.endsWith('/message')) return reason === 'pending tool' ? [{ parts: [{ type: 'tool', state: { status: 'running' } }] }] : [];
      if (route === '/session/status') return reason === 'unknown native status' ? { ses_legacy: {} } : {};
      return { id: route.split('/')[2], directory: reason === 'foreign directory' ? path.join(root, 'foreign') : root };
    } });
    await f.service.retireLegacy();
    assert.equal(f.service.status().status, 'retirement-unverified');
    assert.match(f.service.status().error, /could not be confirmed stopped/);
    assert.throws(() => f.service.dismiss('legacy'), /Inspect or stop/);
    await assert.rejects(f.service.quiesceForLocalDataMaintenance(), /Resolve retained/);
    assert.ok(f.calls.every(row => !row.route.includes('prompt')));
    if (reason === 'foreign directory') assert.equal(f.calls.filter(row => row.route.endsWith('/abort')).length, 0);
  });
}

test('all retained jobs are retired, not just the newest job', async t => {
  const f = await fixture(t);
  f.db.saveRatingJob({ ...f.job, id: 'second', session: 'ses_second', createdAt: 2, progress: {} });
  await f.service.retireLegacy();
  assert.ok(f.db.ratingJobs().every(job => job.status === 'retired'));
  assert.equal(f.calls.filter(row => row.route.endsWith('/abort')).length, 3);
});

test('missing native sessions can retire without recreating or replaying them', async t => {
  const f = await fixture(t, { respond(route) {
    if (route === '/session/status') return {};
    throw Object.assign(Error('Not found'), { status: 404 });
  } });
  await f.service.retireLegacy(); assert.equal(f.service.status().status, 'retired');
  assert.ok(f.calls.every(row => row.input.method !== 'POST'));
});
