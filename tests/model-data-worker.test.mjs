import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createLocalDataStore } from '../server/data/store.mjs';
import { normalizeModelsDev } from '../domain/model-data.mjs';
import { ModelDataSourceError } from '../server/model-data-sources.mjs';
import { runModelDataWorker, serializeModelDataWorkerError, deserializeModelDataWorkerError } from '../server/model-data-worker-client.mjs';

const entryURL = new URL('../server/model-data-worker.mjs', import.meta.url).href;
const normalizerURL = new URL('../domain/model-data.mjs', import.meta.url).href;
const sourceURL = new URL('../server/model-data-sources.mjs', import.meta.url).href;
const publicURL = 'https://models.dev/catalog.json?type=all';
const snapshotID = `modelsdev:${'a'.repeat(64)}`;
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const dataURL = source => new URL(`data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`);
function payload(count = 1, label = 'New worker value') {
  return { providers: { fixture: { id: 'fixture', name: 'Fixture', npm: '@ai-sdk/fixture', env: ['FIXTURE_KEY'], doc: 'https://example.com',
    models: Object.fromEntries(Array.from({ length: count }, (_, i) => [`m-${i}`, { id: `m-${i}`, name: label,
      description: 'Synthetic source data remains inside the worker.', attachment: false, reasoning: false, tool_call: true,
      release_date: '2026-09-01', last_updated: '2026-10-03', open_weights: true,
      modalities: { input: ['text'], output: ['text'] }, limit: { context: 1000, output: 200 }, cost: { input: 0, output: 1 } }])) } }, models: {} };
}
function fixtureWorker(body) {
  return dataURL(`import {workerData,parentPort} from 'node:worker_threads';
    import {runModelDataWorkerEntry} from ${JSON.stringify(entryURL)};
    import {normalizeModelsDev} from ${JSON.stringify(normalizerURL)};
    import {ModelDataSourceError} from ${JSON.stringify(sourceURL)};
    await runModelDataWorkerEntry({fetchSource:async(source,args)=>{${body}}});`);
}
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-model-data-worker-'));
  const db = createLocalDataStore(root), controllers = [], pending = [];
  t.after(async () => {
    controllers.forEach(controller => controller.abort()); await Promise.allSettled(pending);
    db.close(); await rm(root, { recursive: true, force: true });
  });
  const initial = db.beginModelDataRefresh({ id: 'last-good', sources: ['modelsdev'] });
  const prior = db.publishModelDataSource(normalizeModelsDev(payload(1, 'Last good'), { retrievedAt: 1791043200000 }), { jobID: initial.id });
  db.finishModelDataRefresh(initial.id, { status: 'complete' });
  const job = db.beginModelDataRefresh({ id: 'worker-refresh', sources: ['modelsdev'] });
  return { root, db, job, prior,
    run(options = {}) {
      const controller = new AbortController(); controllers.push(controller);
      const promise = runModelDataWorker({ filename: db.info().filename, source: 'modelsdev', jobID: job.id,
        nativeModels: Array.from({ length: 200 }, (_, i) => ({ id: `fixture/m-${i}`, provider: 'fixture' })),
        signal: controller.signal, ...options });
      pending.push(promise); return { promise, controller };
    } };
}

test('actual worker keeps normalization and staged SQLite publication off the main event loop and returns only a receipt', async t => {
  const f = await fixture(t), order = [], progress = []; let ticks = 0;
  const interval = setInterval(() => { ticks++; }, 10); t.after(() => clearInterval(interval));
  const workerURL = fixtureWorker(`await args.onRequest({source,url:${JSON.stringify(publicURL)}});
    const until=performance.now()+180;while(performance.now()<until){}
    return normalizeModelsDev(${JSON.stringify(payload(60))});`);
  const { promise } = f.run({ workerURL, apiKey: 'synthetic-worker-key',
    onRequest: async request => { order.push('request'); assert.equal(request.source, 'modelsdev'); assert.equal(request.url, publicURL); assert.equal(JSON.stringify(request).includes('synthetic-worker-key'), false); },
    onQuota: async value => { order.push('quota'); assert.equal(value, null); },
    onProgress: async value => {
      order.push(value.stage); progress.push(value);
      assert.equal(f.db.modelDataList({}).records[0].name, 'Last good', 'Main reads retain the committed pointer while staging is invisible.');
      if (value.stage === 'publishing') {
        assert.equal(typeof value.processedOperations, 'number'); assert.equal(typeof value.totalOperations, 'number');
      }
    } });
  const result = await promise;
  assert.equal(result.recordCount, 60); assert.ok(result.factCount > 1000); assert.ok(ticks >= 5);
  assert.deepEqual(order.slice(0, 5), ['fetching', 'request', 'normalized', 'quota', 'publishing-preparation']);
  assert.ok(progress.filter(row => row.stage === 'publishing').length >= 2);
  assert.equal(progress.find(row => row.stage === 'normalized').recordCount, 60);
  assert.equal(result.records, undefined); assert.equal(result.raw, undefined); assert.equal(result.facts, undefined);
  assert.equal(JSON.stringify(result).includes('synthetic-worker-key'), false);
  assert.equal(f.db.modelDataStatus().sources.find(row => row.id === 'modelsdev').currentSnapshotID, result.snapshotID);
  assert.equal(f.db.modelDataList({ limit: 100 }).records.length, 60);
});

test('worker source failure retains last-success pointer and passes only sanitized typed quota evidence', async t => {
  const f = await fixture(t);
  const workerURL = fixtureWorker(`await args.onRequest({source,url:${JSON.stringify(publicURL)}});
    throw new ModelDataSourceError('quota',source,{status:429,quota:{limit:100,remaining:0,resetAt:1791129600000,tier:'free',retryAfterMs:86400000},retryAfterMs:86400000});`);
  const { promise } = f.run({ workerURL });
  await assert.rejects(promise, error => {
    assert.ok(error instanceof ModelDataSourceError); assert.equal(error.code, 'quota'); assert.equal(error.quota.remaining, 0); return true;
  });
  assert.equal(f.db.modelDataStatus().sources.find(row => row.id === 'modelsdev').currentSnapshotID, f.prior.snapshotID);
  assert.equal(f.db.modelDataList({}).records[0].name, 'Last good');
});

test('cancellation joins actual worker termination, ignores a late snapshot, and releases SQLite before cleanup', async t => {
  const f = await fixture(t), entered = deferred();
  const workerURL = fixtureWorker(`await args.onRequest({source,url:${JSON.stringify(publicURL)}});
    const until=performance.now()+10000;while(performance.now()<until){}
    return normalizeModelsDev(${JSON.stringify(payload(1, 'Late value'))});`);
  const { promise, controller } = f.run({ workerURL, onRequest: async () => entered.resolve(), terminateAfterMs: 10 });
  const rejected = assert.rejects(promise, error => error.name === 'AbortError' && error.code === 'MODEL_DATA_WORKER_ABORTED');
  await entered.promise; controller.abort(); await rejected;
  assert.equal(f.db.modelDataStatus().sources.find(row => row.id === 'modelsdev').currentSnapshotID, f.prior.snapshotID);
  // Opening and closing another reader after the rejected promise exercises the released thread/SQLite boundary.
  const reader = createLocalDataStore(f.root, { readOnly: true }); assert.equal(reader.modelDataList({}).records[0].name, 'Last good'); reader.close();
});

test('cancellation while awaiting a quota reservation prevents publish and bounds a non-yielding adapter', async t => {
  const f = await fixture(t), entered = deferred(), gate = deferred(); t.after(() => gate.resolve());
  const { promise, controller } = f.run({ workerURL: fixtureWorker(`await args.onRequest({source,url:${JSON.stringify(publicURL)}});return normalizeModelsDev(${JSON.stringify(payload())});`),
    onRequest: async () => { entered.resolve(); await gate.promise; }, terminateAfterMs: 10 });
  const rejected = assert.rejects(promise, error => error.name === 'AbortError');
  await entered.promise; controller.abort(); await rejected; gate.resolve();
  assert.equal(f.db.modelDataStatus().sources.find(row => row.id === 'modelsdev').currentSnapshotID, f.prior.snapshotID);
});

test('finite worker deadline interrupts CPU work and cannot publish afterward', async t => {
  const f = await fixture(t);
  const workerURL = dataURL(`import {parentPort} from 'node:worker_threads';while(true){}`);
  const { promise } = f.run({ workerURL, timeoutMs: 100, terminateAfterMs: 10 });
  await assert.rejects(promise, error => error.code === 'MODEL_DATA_WORKER_TIMEOUT');
  assert.equal(f.db.modelDataStatus().sources.find(row => row.id === 'modelsdev').currentSnapshotID, f.prior.snapshotID);
  await assert.rejects(runModelDataWorker({ filename: f.db.info().filename, source: 'modelsdev', jobID: f.job.id,
    timeoutMs: 600_001 }), error => error.code === 'MODEL_DATA_WORKER_INVALID');
});

test('receipt settlement waits for actual exit and exposes retained exit observation if stop is unconfirmed', async () => {
  let instance;
  class FixtureWorker extends EventEmitter {
    constructor(_url, options) { super(); instance = this; this.options = options; this.messages = []; }
    postMessage(value) { this.messages.push(value); }
    terminate() { this.terminated = true; return new Promise(() => {}); }
  }
  const controller = new AbortController(); let settled = false;
  const promise = runModelDataWorker({ filename: 'fixture.sqlite', source: 'modelsdev', jobID: 'fixture', signal: controller.signal,
    nativeModels: [{ id: 'fixture/model' }],
    WorkerImpl: FixtureWorker, shutdownMs: 20, terminateAfterMs: 0 });
  promise.then(() => { settled = true; }, () => { settled = true; });
  instance.emit('message', { type: 'result', receipt: { source: 'modelsdev', snapshotID, recordCount: 1, factCount: 2, raw: 'must-not-cross' } });
  await Promise.resolve(); assert.equal(settled, false, 'A receipt is not proof the worker released its database.');
  controller.abort(); let uncertainty;
  await assert.rejects(promise, error => { uncertainty = error; return error.code === 'MODEL_DATA_WORKER_SHUTDOWN'; });
  assert.ok(uncertainty.whenExited instanceof Promise); assert.equal(Object.keys(uncertainty).includes('whenExited'), false);
  assert.equal(instance.terminated, true); let observed = false;
  uncertainty.whenExited.then(() => { observed = true; }); await Promise.resolve(); assert.equal(observed, false);
  instance.emit('exit', 1); await uncertainty.whenExited; assert.equal(observed, true);
});

test('worker protocol rejects unapproved routes and unknown results without echoing private payload', async () => {
  let instance, calls = 0;
  class FixtureWorker extends EventEmitter {
    constructor() { super(); instance = this; }
    postMessage(message) { if (message.type === 'ack' && message.ok === false) {
      this.emit('message', { type: 'error', error: message.error }); queueMicrotask(() => this.emit('exit', 0));
    } }
    terminate() { this.emit('exit', 1); return Promise.resolve(1); }
  }
  const promise = runModelDataWorker({ filename: 'fixture.sqlite', source: 'modelsdev', jobID: 'fixture', WorkerImpl: FixtureWorker,
    nativeModels: [{ id: 'fixture/model' }],
    onRequest: async () => { calls++; } });
  instance.emit('message', { type: 'rpc', id: 1, method: 'onRequest', payload: { source: 'modelsdev', url: 'https://private.example/key=synthetic-private' } });
  await assert.rejects(promise, error => { assert.equal(error.message.includes('synthetic-private'), false); return true; }); assert.equal(calls, 0);
});

test('error serialization strips native exceptions, stacks and secret values while retaining known public source categories', () => {
  const error = Object.assign(Error('synthetic-private-key'), { stack: 'private stack', quota: { requestTimes: ['private'], remaining: 0 } });
  const serialized = serializeModelDataWorkerError(error, 'modelsdev');
  assert.equal(JSON.stringify(serialized).includes('private'), false);
  assert.equal(deserializeModelDataWorkerError(serialized, 'modelsdev').message.includes('private'), false);
  const typed = new ModelDataSourceError('invalid-key', 'artificial-analysis', { status: 401 });
  const recovered = deserializeModelDataWorkerError(serializeModelDataWorkerError(typed, 'artificial-analysis'), 'artificial-analysis');
  assert.equal(recovered.code, 'invalid-key'); assert.equal(recovered.status, 401);
});

test('missing database is rejected without initializing incidental storage or invoking a source', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-model-worker-missing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(runModelDataWorker({ filename: path.join(root, 'freelancer.sqlite'), source: 'modelsdev', jobID: 'fixture',
    nativeModels: [],
    workerURL: fixtureWorker('throw Error("Source must not be called without a database.");') }), error => error.code === 'MODEL_DATA_WORKER_WORKER');
  assert.deepEqual(await readdir(root), []);
});

test('actual worker persists only captured configured source identities and leaves full payload outside SQLite', async t => {
  const f = await fixture(t);
  const { promise } = f.run({ nativeModels: [{ id: 'fixture/custom', provider: 'fixture', api: { id: 'm-1' } }],
    workerURL: fixtureWorker(`return normalizeModelsDev(${JSON.stringify(payload(3))});`) });
  const receipt = await promise; assert.equal(receipt.recordCount, 1);
  const stored = f.db.modelDataList({}); assert.equal(stored.total, 1);
  assert.equal(stored.records[0].id, 'modelsdev:deployment:fixture:m-1');
  const metadata = f.db.modelDataStatus().sources.find(row => row.id === 'modelsdev').current.metadata.sourceMetadata.scope;
  assert.equal(metadata.receivedRecordCount, 3); assert.equal(metadata.retainedRecordCount, 1);
  assert.deepEqual(metadata.nativeModelIDs, ['fixture/custom']);
});

test('worker rejects absent native scope before creating any worker or touching storage', async () => {
  let created = false;
  class NeverWorker extends EventEmitter { constructor() { super(); created = true; } }
  await assert.rejects(runModelDataWorker({ filename: 'fixture.sqlite', source: 'modelsdev', jobID: 'fixture',
    WorkerImpl: NeverWorker }), error => error.code === 'MODEL_DATA_WORKER_INVALID');
  assert.equal(created, false);
});
