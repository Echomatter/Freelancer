import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLocalDataStore } from '../server/data/store.mjs';
import { createModelDataService } from '../server/model-data.mjs';
import { ModelDataSourceError } from '../server/model-data-sources.mjs';
import { normalizeModelsDev, normalizeArtificialAnalysis, scopeModelDataSnapshot, withModelDataCanonicalIdentities } from '../domain/model-data.mjs';

const baseTime = 1791043200000;
const mockVault = { available: true,
  async seal(key) { return 'dpapi-current-user:v1:' + Buffer.from(key, 'utf8').toString('base64'); },
  async open(ciphertext) { return Buffer.from(ciphertext.slice('dpapi-current-user:v1:'.length), 'base64').toString('utf8'); } };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function snapshot(source, time, name = 'Fixture V1') {
  if (source === 'modelsdev') return normalizeModelsDev({ providers: { fixture: { id: 'fixture', name: 'Fixture',
    env: ['FIXTURE_KEY'], npm: '@ai-sdk/fixture', doc: 'https://example.com/docs', models: { m: {
      id: 'm', name, description: 'Synthetic public data', attachment: false, reasoning: false, tool_call: true,
      open_weights: true, release_date: '2026-09-01', last_updated: '2026-10-03',
      modalities: { input: ['text'], output: ['text'] }, limit: { context: 1000, output: 200 }, cost: { input: 0, output: 1 },
    } } } }, models: {} }, { retrievedAt: time });
  const keys = ['intelligence', 'coding', 'agentic', 'finance_and_accounting', 'strategy_and_ops', 'legal', 'healthcare_and_medical', 'engineering', 'economics'];
  return normalizeArtificialAnalysis({ tier: 'free', intelligence_index_version: 4.3,
    pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false }, data: [{ id: 'fixture-aa-uuid', name, slug: 'm',
      release_date: null, model_creator: null, artificial_analysis_intelligence_index_cost: null,
      evaluations: Object.fromEntries(keys.map(k => [`artificial_analysis_${k}_index`, null])),
      pricing: { price_1m_input_tokens: 0, price_1m_output_tokens: 1, price_1m_cache_hit_tokens: null, price_1m_cache_write_tokens: null },
      performance: { median_output_tokens_per_second: 42, median_time_to_first_token_seconds: null,
        median_time_to_first_answer_token_seconds: null, median_end_to_end_response_time_seconds: null } }] }, { retrievedAt: time });
}
async function waitFor(condition, label = 'model-data fixture') {
  const deadline = Date.now() + 3000;
  while (!condition()) { if (Date.now() > deadline) throw Error(`Timed out waiting for ${label}.`); await new Promise(resolve => setTimeout(resolve, 5)); }
}
async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-model-data-service-'));
  let clock = baseTime, db = createLocalDataStore(root), service;
  const calls = [];
  let fetchSource = options.fetchSource ?? (async (source, args) => {
    calls.push(source); await args.onRequest({ source, url: 'https://fixture.invalid' });
    return snapshot(source, args.now());
  });
  let permitted = true;
  const settings = { localData: { get: () => options.storeFacade?.(db) ?? db },
    fetchSource: options.workerRunner ? undefined : (...args) => fetchSource(...args),
    workerRunner: options.workerRunner,
    env: options.env ?? {}, vault: options.vault ?? mockVault, now: () => clock++, canRun: () => permitted };
  service = createModelDataService(settings);
  const nativeModels = options.nativeModels ?? [{ id: 'fixture/m', provider: 'fixture', api: { id: 'm' },
    sourceIdentities: { 'artificial-analysis': { sourceID: 'fixture-aa-uuid' } } }];
  if (!options.unloadedScope) service.setNativeModels(nativeModels);
  t.after(async () => { options.release?.(); await service.close(); db.close(); await rm(root, { recursive: true, force: true }); });
  return { root, calls, get db() { return db; }, get service() { return service; },
    set fetchSource(value) { fetchSource = value; }, setClock(value) { clock = value; }, setPermitted(value) { permitted = value; },
    async restart() { await service.close(); db.close(); db = createLocalDataStore(root); service = createModelDataService(settings);
      if (!options.unloadedScope) service.setNativeModels(nativeModels); return service; },
    async settled() { await waitFor(() => !service.isRunning()); return service.status(); } };
}
const sourceRow = (f, source) => f.service.status().sources.find(row => row.id === source);
async function seed(f, source = 'modelsdev', name = 'Last good') {
  const job = f.db.beginModelDataRefresh({ sources: [source], createdAt: baseTime - 100 });
  const receipt = f.db.publishModelDataSource(snapshot(source, baseTime - 90, name), { jobID: job.id });
  f.db.finishModelDataRefresh(job.id, { status: 'complete', updatedAt: baseTime - 80 }); return receipt;
}

const reviewedNativeModels = () => [
  { id: 'github-copilot/claude-sonnet-5.5', provider: 'github-copilot', modelID: 'claude-sonnet-5.5' },
  { id: 'opencode-go/claude-sonnet-5-5', provider: 'opencode-go', modelID: 'claude-sonnet-5-5' },
];
// Pinned public identity tuples, with synthetic source metrics and a fixture key.
const reviewedConfigurations = [
  { id: 'bbc2ffea-cf6b-43be-8c41-1769347e234d', slug: 'claude-sonnet-5-5-low', name: 'Claude Sonnet 5.5 (Low, Default Fallback)' },
  { id: '268525e2-f873-4178-bc07-e6a0ee1f002d', slug: 'claude-sonnet-5-5-high', name: 'Claude Sonnet 5.5 (High, Default Fallback)' },
  { id: 'b171d979-5ec1-45de-b8b9-db1ee65e77ec', slug: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5 (Max, Default Fallback)' },
];
function reviewedSnapshot(source, time) {
  if (source === 'modelsdev') {
    const canonical = 'anthropic/claude-sonnet-5-5';
    const wire = snapshot(source, time).records[0].raw.model;
    const providers = Object.fromEntries(reviewedNativeModels().map(native => [native.provider, {
      id: native.provider, name: native.provider, npm: '@ai-sdk/openai-compatible', doc: 'https://models.dev', env: ['FIXTURE_SOURCE_KEY'],
      models: { [native.modelID]: { ...wire, id: native.modelID, name: 'Claude Sonnet 5.5',
        canonical_model_id: canonical, release_date: '2026-09-28', cost: { input: 1, output: 2 } } },
    }]));
    return normalizeModelsDev({ providers, models: {
      [canonical]: { id: canonical, name: 'Claude Sonnet 5.5', description: 'Reviewed identity fixture',
        release_date: '2026-09-28', license: 'proprietary' },
      'fixture/unrelated': { id: 'fixture/unrelated', name: 'Unrelated fixture model', description: 'Unrelated identity fixture', license: 'proprietary' },
    } }, { retrievedAt: time });
  }
  const unrelated = snapshot(source, time).records[0].raw;
  return normalizeArtificialAnalysis({ tier: 'free', intelligence_index_version: 4.3,
    pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false }, data: [
      ...reviewedConfigurations.map(tuple => ({ ...structuredClone(unrelated), ...tuple, release_date: '2026-09-28',
        model_creator: { id: 'f0aa413f-e8ae-4fcd-9c48-0e049f4f3128', name: 'Anthropic', slug: 'anthropic' } })), unrelated,
    ] }, { retrievedAt: time });
}

test('vanilla two-source refresh resolves reviewed AA configurations through Models.dev and keeps persisted links after restart', async t => {
  const calls = [], native = reviewedNativeModels();
  const f = await fixture(t, { nativeModels: native, env: { ARTIFICIAL_ANALYSIS_API_KEY: 'synthetic-aa-key' },
    fetchSource: async (source, args) => { calls.push(source); await args.onRequest({ source }); return reviewedSnapshot(source, args.now()); } });
  f.service.refresh({ sources: ['artificial-analysis', 'modelsdev'] });
  const status = await f.settled();
  assert.equal(status.job.status, 'completed');
  assert.deepEqual(calls, ['modelsdev', 'artificial-analysis'], 'Canonical context is published before AA identity matching.');
  for (const source of ['modelsdev', 'artificial-analysis']) {
    const result = status.job.results.find(row => row.source === source);
    assert.equal(result.status, 'completed'); assert.equal(result.receivedRecordCount, 4);
    assert.equal(result.recordCount, 3); assert.equal(result.matchedNativeModelCount, 2);
    assert.equal(result.snapshotID, sourceRow(f, source).currentSnapshotID);
  }
  const aa = f.service.list({ source: 'artificial-analysis', limit: 20 });
  assert.equal(aa.total, 3);
  assert.deepEqual(aa.records.map(row => row.id).sort(), reviewedConfigurations.map(row => `artificial-analysis:configuration:${row.id}`).sort());
  assert.equal(f.service.list({ query: 'Unrelated fixture model' }).total, 0);
  const expectedNative = native.map(row => row.id).sort();
  const inspect = () => native.map(model => {
    const detail = f.service.detail({ id: model.id, limit: 100 });
    const configurations = detail.matches.filter(match => match.record.source === 'artificial-analysis');
    assert.equal(configurations.length, 3, 'Every tested configuration stays accessible from each native provider deployment.');
    for (const match of configurations) {
      const tuple = reviewedConfigurations.find(row => row.id === match.record.identifiers.sourceID);
      assert.ok(tuple); assert.equal(match.record.configuration.testedName, tuple.name);
      assert.equal(match.record.configuration.reasoning_effort, undefined);
      assert.equal(match.identityMatch.method, 'reviewed-source-model-link');
      assert.deepEqual(match.identityMatch.nativeIDs, expectedNative);
      assert.ok(match.identityMatch.evidence.some(reference => reference.url.startsWith('https://artificialanalysis.ai/models/claude-sonnet-5-5')));
      assert.equal(match.facts.find(fact => fact.attribute === 'performance.median_output_tokens_per_second').value, 42);
      assert.equal(match.facts.find(fact => fact.attribute === 'evaluations.artificial_analysis_coding_index').value, null);
    }
    return detail;
  });
  const details = inspect(), quota = sourceRow(f, 'artificial-analysis').quota;
  const pointers = status.sources.map(row => [row.id, row.currentSnapshotID]);
  await f.restart();
  assert.deepEqual(inspect(), details);
  assert.deepEqual(f.service.status().sources.map(row => [row.id, row.currentSnapshotID]), pointers);
  assert.deepEqual(sourceRow(f, 'artificial-analysis').quota, quota);
  assert.deepEqual(calls, ['modelsdev', 'artificial-analysis'], 'Read and restart do not download or infer.');
});

test('AA-only vanilla refresh obtains missing canonical context once and reuses stored context on the next request', async t => {
  const calls = [];
  const f = await fixture(t, { nativeModels: reviewedNativeModels(), env: { ARTIFICIAL_ANALYSIS_API_KEY: 'synthetic-aa-key' },
    fetchSource: async (source, args) => { calls.push(source); await args.onRequest({ source }); return reviewedSnapshot(source, args.now()); } });
  f.service.refresh({ sources: ['artificial-analysis'] }); await f.settled();
  assert.deepEqual(calls, ['modelsdev', 'artificial-analysis']);
  assert.equal(f.service.list({ source: 'artificial-analysis' }).total, 3);
  f.service.refresh({ sources: ['artificial-analysis'] }); await f.settled();
  assert.deepEqual(calls, ['modelsdev', 'artificial-analysis', 'artificial-analysis']);
  assert.equal(f.service.status().job.status, 'completed');
});

test('failed required canonical refresh cannot fetch AA or replace its last successful scoped snapshot', async t => {
  const calls = [], native = reviewedNativeModels();
  const f = await fixture(t, { nativeModels: native, env: { ARTIFICIAL_ANALYSIS_API_KEY: 'synthetic-aa-key' },
    fetchSource: async source => { calls.push(source); throw new ModelDataSourceError('network', source); } });
  const identities = withModelDataCanonicalIdentities(native, reviewedSnapshot('modelsdev', baseTime - 90).records);
  const previousSnapshot = scopeModelDataSnapshot(reviewedSnapshot('artificial-analysis', baseTime - 90), identities);
  const priorJob = f.db.beginModelDataRefresh({ sources: ['artificial-analysis'], createdAt: baseTime - 100 });
  const previous = f.db.publishModelDataSource(previousSnapshot, { jobID: priorJob.id });
  f.db.finishModelDataRefresh(priorJob.id, { status: 'completed', updatedAt: baseTime - 80 });
  const storedBefore = f.db.modelDataList({ source: 'artificial-analysis' });
  f.service.refresh({ sources: ['artificial-analysis'] }); const status = await f.settled();
  assert.deepEqual(calls, ['modelsdev'], 'A failed required source context blocks the dependent AA download.');
  assert.equal(status.job.status, 'failed');
  assert.deepEqual(status.job.sources, ['artificial-analysis', 'modelsdev'], 'The durable receipt stores a sorted source set.');
  assert.equal(status.job.results.find(row => row.source === 'modelsdev').status, 'failed');
  assert.notEqual(status.job.results.find(row => row.source === 'artificial-analysis').status, 'completed');
  assert.equal(sourceRow(f, 'artificial-analysis').currentSnapshotID, previous.snapshotID);
  assert.deepEqual(f.db.modelDataList({ source: 'artificial-analysis' }), storedBefore);
});

test('unknown configured scope cannot start a download or replace retained source data with an empty snapshot', async t => {
  const f = await fixture(t, { unloadedScope: true }); const previous = await seed(f);
  assert.throws(() => f.service.refresh({ sources: ['modelsdev'] }), { status: 409 });
  assert.deepEqual(f.calls, []); assert.equal(sourceRow(f, 'modelsdev').currentSnapshotID, previous.snapshotID);
  assert.equal(f.db.modelDataActiveJobs().jobs.length, 0);
  f.service.setNativeModels([]); f.service.refresh({ sources: ['modelsdev'] }); await f.settled();
  assert.deepEqual(f.calls, ['modelsdev']); assert.equal(f.service.list({}).total, 0);
  assert.equal(sourceRow(f, 'modelsdev').recordCount, 0);
});

test('direct refresh captures configured identities deeply and removes unrelated records before publication', async t => {
  const entered = deferred(), gate = deferred();
  const native = [{ id: 'fixture/custom', provider: 'fixture', api: { id: 'm' } }];
  const f = await fixture(t, { nativeModels: native, release: () => gate.resolve(), fetchSource: async (source, args) => {
    entered.resolve(); await gate.promise;
    const received = snapshot(source, args.now());
    received.records.push({ ...structuredClone(received.records[0]), id: 'modelsdev:deployment:other:m', provider: 'other',
      identifiers: { source: 'modelsdev', nativeID: 'other/m', providerID: 'other', modelID: 'm' } });
    return received;
  } });
  native[0].api.id = 'unrelated';
  f.service.refresh({ sources: ['modelsdev'] }); await entered.promise;
  f.service.setNativeModels([{ id: 'other/m', provider: 'other' }]); gate.resolve(); await f.settled();
  const result = f.db.modelDataList({}); assert.equal(result.total, 1);
  assert.equal(result.records[0].id, 'modelsdev:deployment:fixture:m');
  const metadata = sourceRow(f, 'modelsdev').current.metadata.sourceMetadata.scope;
  assert.deepEqual(metadata.nativeModelIDs, ['fixture/custom']);
  assert.equal(metadata.receivedRecordCount, 2); assert.equal(metadata.retainedRecordCount, 1);
});

test('source-declared canonical dependencies retain separate evidence and are presented only to their configured models', async t => {
  const f = await fixture(t, { fetchSource: async (source, args) => {
    const received = snapshot(source, args.now());
    received.records[0].identifiers.canonicalModelID = 'source-canonical';
    received.records.push({ id: 'modelsdev:model:source-canonical', kind: 'model', name: 'Source canonical', modelID: 'source-canonical',
      aliases: [], identifiers: { source: 'modelsdev', canonicalModelID: 'source-canonical' }, configuration: {},
      sourceReference: { url: 'https://models.dev/catalog.json?type=all', path: '/models/source-canonical' },
      sourceDates: {}, raw: { name: 'Source canonical' }, facts: [{ attribute: 'benchmarks.0.score', value: 0.79,
        units: 'accuracy', scale: null, configuration: { variant: 'high' },
        sourceRef: { url: 'https://models.dev/catalog.json?type=all', path: '/models/source-canonical/benchmarks/0/score' },
        dates: { retrievedAt: received.retrievedAt }, identityMatch: { status: 'unmatched', candidateIDs: [] } }] });
    return received;
  } });
  f.service.refresh({ sources: ['modelsdev'] }); await f.settled();
  const canonical = f.service.list({ query: 'Source canonical' }).records[0];
  assert.equal(canonical.identityMatch.status, 'alias');
  assert.equal(canonical.identityMatch.method, 'source-declared-canonical-model');
  assert.deepEqual(canonical.identityMatch.nativeIDs, ['fixture/m']);
  const detail = f.service.detail({ id: canonical.id }); assert.equal(detail.facts[0].value, 0.79);
  assert.equal(detail.facts[0].configuration.variant, 'high');
  f.service.setNativeModels([{ id: 'other/source-canonical', provider: 'other', name: 'Source canonical' }]);
  assert.equal(f.service.list({ query: 'Source canonical' }).records[0].identityMatch.status, 'unmatched');
});

test('service reads and restart expose retained facts without fetching, inference, or quota changes', async t => {
  const f = await fixture(t); await seed(f);
  f.db.saveModelDataSourceStatus('artificial-analysis', { quota: { requestTimes: [baseTime - 10], remaining: 99 } });
  const before = f.db.modelDataStatus();
  assert.equal(f.service.list({}).records.length, 1); assert.equal(f.service.status().job.status, 'complete');
  assert.equal(f.service.detail({ id: 'modelsdev:deployment:fixture:m' }).record.name, 'Last good');
  f.service.credentials(); f.service.setNativeModels([{ id: 'fixture/m', provider: 'fixture' }]);
  assert.equal(f.service.list({}).records[0].identityMatch.status, 'exact');
  await f.restart(); f.service.status(); f.service.list({}); f.service.credentials();
  assert.deepEqual(f.calls, []); assert.deepEqual(f.db.modelDataStatus().sources, before.sources);
});

test('overlapping refreshes coalesce one job and add an independent requested source once', async t => {
  const gate = deferred(), entered = deferred(), calls = [];
  const f = await fixture(t, { release: () => gate.resolve(), env: { ARTIFICIAL_ANALYSIS_API_KEY: 'synthetic-env-key' }, fetchSource: async (source, args) => {
    calls.push(source); await args.onRequest({ source });
    if (source === 'modelsdev') { entered.resolve(); await gate.promise; }
    return snapshot(source, args.now());
  } });
  t.after(() => gate.resolve());
  const first = f.service.refresh({ sources: ['modelsdev'] }); await entered.promise;
  const joined = f.service.refresh({ sources: ['modelsdev'] });
  const extended = f.service.refresh({ sources: ['artificial-analysis', 'modelsdev'] });
  assert.equal(first.job.id, joined.job.id); assert.equal(first.job.id, extended.job.id);
  gate.resolve(); const status = await f.settled();
  assert.deepEqual(calls, ['modelsdev', 'artificial-analysis']); assert.equal(status.job.status, 'completed');
  assert.ok(status.sources.every(row => row.currentSnapshotID)); assert.equal(f.service.list({}).records.length, 2);
});

test('missing AA credentials are explicit and cannot prevent an independent Models.dev source update', async t => {
  const f = await fixture(t);
  f.service.refresh({ sources: ['artificial-analysis', 'modelsdev'] }); const status = await f.settled();
  assert.deepEqual(f.calls, ['modelsdev']); assert.equal(status.job.status, 'partial');
  assert.equal(sourceRow(f, 'artificial-analysis').state, 'needs-key');
  assert.equal(sourceRow(f, 'modelsdev').state, 'complete'); assert.equal(f.service.list({}).records.length, 1);
});

test('source failure preserves last-success data and sanitized vendor quota metadata', async t => {
  const f = await fixture(t, { env: { ARTIFICIAL_ANALYSIS_API_KEY: 'synthetic-private-key' } });
  const previous = await seed(f, 'artificial-analysis');
  f.fetchSource = async (_source, args) => { await args.onRequest({ source: 'artificial-analysis' });
    throw new ModelDataSourceError('quota', 'artificial-analysis', { status: 429,
      quota: { limit: 100, remaining: 0, resetAt: baseTime + 86400000, tier: 'free', retryAfterMs: 86400000 }, retryAfterMs: 86400000 }); };
  f.service.refresh({ sources: ['artificial-analysis'] }); const status = await f.settled();
  const row = sourceRow(f, 'artificial-analysis');
  assert.equal(status.job.status, 'failed'); assert.equal(row.currentSnapshotID, previous.snapshotID);
  assert.equal(row.quota.remaining, 0); assert.equal(row.quota.requestTimes.length, 1); assert.ok(row.retryAt >= baseTime + 86300000);
  assert.equal(f.service.list({}).records[0].name, 'Last good');
  assert.equal(JSON.stringify(status).includes('synthetic-private-key'), false);
});

test('successful AA refresh merges vendor quota with durable request reservations and preserves both across restart', async t => {
  const f = await fixture(t, { env: { ARTIFICIAL_ANALYSIS_API_KEY: 'synthetic-private-key' }, fetchSource: async (source, args) => {
    await args.onRequest({ source }); await args.onRequest({ source });
    return { ...snapshot(source, args.now()), quota: { limit: 100, remaining: 98, resetAt: baseTime + 86400000, tier: 'free', retryAfterMs: null } };
  } });
  f.service.refresh({ sources: ['artificial-analysis'] }); await f.settled();
  const quota = sourceRow(f, 'artificial-analysis').quota;
  assert.equal(quota.remaining, 98); assert.equal(quota.requestTimes.length, 2);
  await f.restart(); assert.deepEqual(sourceRow(f, 'artificial-analysis').quota, quota);
});

test('conservative Free quota rejects the next HTTP attempt and remains durable across service restart', async t => {
  let dispatched = 0;
  const f = await fixture(t, { env: { ARTIFICIAL_ANALYSIS_API_KEY: 'synthetic' }, fetchSource: async (source, args) => {
    await args.onRequest({ source }); dispatched++; return snapshot(source, args.now());
  } });
  const times = Array.from({ length: 100 }, (_, i) => baseTime - 1000 + i);
  f.db.saveModelDataSourceStatus('artificial-analysis', { quota: { requestTimes: times } });
  f.service.refresh({ sources: ['artificial-analysis'] }); await f.settled();
  assert.equal(dispatched, 0); assert.equal(sourceRow(f, 'artificial-analysis').quota.requestTimes.length, 100);
  await f.restart(); f.service.refresh({ sources: ['artificial-analysis'] }); await f.settled();
  assert.equal(dispatched, 0); assert.equal(sourceRow(f, 'artificial-analysis').quota.requestTimes.length, 100);
  f.setClock(baseTime + 86400001); f.service.refresh({ sources: ['artificial-analysis'] }); await f.settled();
  assert.equal(dispatched, 1); assert.equal(sourceRow(f, 'artificial-analysis').quota.requestTimes.length, 1);
});

test('cancel and late adapter success never publish a canceled snapshot or discard prior data', async t => {
  const entered = deferred(), gate = deferred();
  const f = await fixture(t, { release: () => gate.resolve(), fetchSource: async (source, args) => { entered.resolve(); await gate.promise; return snapshot(source, args.now(), 'Late value'); } });
  const previous = await seed(f); t.after(() => gate.resolve());
  const current = f.service.refresh({ sources: ['modelsdev'] }); await entered.promise;
  const canceling = f.service.cancel(current.job.id); assert.equal(canceling.job.status, 'cancelling');
  gate.resolve(); const status = await f.settled();
  assert.equal(status.job.status, 'cancelled'); assert.equal(sourceRow(f, 'modelsdev').currentSnapshotID, previous.snapshotID);
  assert.equal(f.service.list({}).records[0].name, 'Last good');
});

test('startup marks interrupted work for explicit retry without adapter replay and retains published source and quota', async t => {
  const f = await fixture(t); const previous = await seed(f);
  f.db.saveModelDataSourceStatus('artificial-analysis', { quota: { requestTimes: [baseTime - 5] } });
  f.db.beginModelDataRefresh({ id: 'crash-receipt', sources: ['modelsdev', 'artificial-analysis'], createdAt: baseTime + 1 });
  await f.restart(); const status = f.service.status();
  assert.equal(status.job.id, 'crash-receipt'); assert.equal(status.job.status, 'interrupted'); assert.deepEqual(f.calls, []);
  assert.equal(sourceRow(f, 'modelsdev').currentSnapshotID, previous.snapshotID);
  assert.equal(sourceRow(f, 'artificial-analysis').quota.requestTimes.length, 1);
  f.service.list({}); f.service.detail({ id: 'modelsdev:deployment:fixture:m' }); assert.deepEqual(f.calls, []);
});

test('a superseding durable generation prevents stale service publication', async t => {
  const entered = deferred(), gate = deferred();
  const f = await fixture(t, { release: () => gate.resolve(), fetchSource: async (source, args) => { entered.resolve(); await gate.promise; return snapshot(source, args.now(), 'Stale service value'); } });
  t.after(() => gate.resolve()); await seed(f);
  f.service.refresh({ sources: ['modelsdev'] }); await entered.promise;
  const winner = f.db.beginModelDataRefresh({ id: 'independent-winner', sources: ['modelsdev'], createdAt: baseTime + 100 });
  const receipt = f.db.publishModelDataSource(snapshot('modelsdev', baseTime + 101, 'Winner value'), { jobID: winner.id });
  f.db.finishModelDataRefresh(winner.id, { status: 'complete', updatedAt: baseTime + 102 });
  gate.resolve(); await f.settled();
  assert.equal(sourceRow(f, 'modelsdev').currentSnapshotID, receipt.snapshotID); assert.equal(f.service.list({}).records[0].name, 'Winner value');
});

test('explicit update honors restore/close guard; ordinary catalog and detail reads remain available', async t => {
  const f = await fixture(t); await seed(f); f.setPermitted(false);
  assert.throws(() => f.service.refresh({ sources: ['modelsdev'] }), { status: 409 });
  assert.equal(f.service.list({}).records.length, 1); assert.equal(f.service.detail({ id: 'modelsdev:deployment:fixture:m' }).record.name, 'Last good');
  assert.deepEqual(f.calls, []); await f.service.close(); assert.throws(() => f.service.refresh({ sources: ['modelsdev'] }), { status: 409 });
});

test('credential receipts disclose presence only; environment wins without persisting plaintext and refresh owns key changes', async t => {
  const entered = deferred(), gate = deferred(), observedKeys = [];
  const f = await fixture(t, { release: () => gate.resolve(), env: { ARTIFICIAL_ANALYSIS_API_KEY: 'synthetic-env-priority' }, fetchSource: async (source, args) => {
    observedKeys.push(args.apiKey); entered.resolve(); await gate.promise; return snapshot(source, args.now());
  } });
  t.after(() => gate.resolve()); const saved = await f.service.saveCredentials({ artificialAnalysisKey: 'synthetic-saved-key' });
  assert.equal(saved.artificialAnalysis.configured, true); assert.equal(saved.artificialAnalysis.storage, 'environment');
  assert.equal(JSON.stringify(saved).includes('synthetic-saved-key'), false); assert.equal(JSON.stringify(saved).includes('synthetic-env-priority'), false);
  assert.ok(f.db.modelDataSecret('artificial-analysis').startsWith('dpapi-current-user:v1:'));
  f.service.refresh({ sources: ['artificial-analysis'] }); await entered.promise;
  await assert.rejects(f.service.saveCredentials({ artificialAnalysisKey: 'synthetic-another-key' }), { status: 409 });
  assert.throws(() => f.service.removeCredentials(), { status: 409 }); gate.resolve(); await f.settled();
  assert.deepEqual(observedKeys, ['synthetic-env-priority']); f.service.removeCredentials(); assert.equal(f.db.modelDataSecret('artificial-analysis'), null);
  assert.equal(f.service.credentials().artificialAnalysis.configured, true, 'Removing stored bytes does not remove the server environment key.');
});

test('native model detail uses explicit deployment identities while ambiguous and unmatched configuration evidence stays labeled', async t => {
  const f = await fixture(t); await seed(f);
  f.service.setNativeModels([{ id: 'fixture/m', provider: 'fixture' }]);
  const result = f.service.detail({ id: 'fixture/m' });
  assert.equal(result.matches.length, 1); assert.equal(result.matches[0].record.id, 'modelsdev:deployment:fixture:m');
  assert.equal(result.matches[0].identityMatch.status, 'exact');
  f.service.setNativeModels([{ id: 'other/m', provider: 'other', name: 'Last good' }]);
  const unmatched = f.service.detail({ id: 'other/m' }); assert.equal(unmatched.matches.length, 0); assert.equal(unmatched.identityMatch.status, 'unmatched');
});

test('startup staging cleanup preserves stored reads and blocks only another explicit update until it settles', async t => {
  const gate = deferred(); let orphaned = true, cleanupCalls = 0;
  const f = await fixture(t, { release: () => gate.resolve(), storeFacade: db => Object.assign(Object.create(db), {
    modelDataStagingJobs: () => ({ jobs: orphaned ? [{ jobID: 'interrupted-stage', status: 'interrupted', sources: ['modelsdev'] }] : [] }),
    modelDataCleanupStaging: async id => { assert.equal(id, 'interrupted-stage'); cleanupCalls++; await gate.promise; orphaned = false; },
  }) });
  await seed(f);
  assert.equal(f.service.status().maintenance.state, 'cleaning');
  assert.equal(f.service.list({}).records[0].name, 'Last good');
  assert.equal(f.service.detail({ id: 'modelsdev:deployment:fixture:m' }).facts[0].subject, 'modelsdev:deployment:fixture:m');
  assert.throws(() => f.service.refresh({ sources: ['modelsdev'] }), { status: 409 });
  assert.deepEqual(f.calls, []); gate.resolve(); await f.settled();
  assert.equal(cleanupCalls, 1); assert.equal(f.service.status().maintenance.state, 'ready');
  f.service.refresh({ sources: ['modelsdev'] }); await f.settled();
  assert.deepEqual(f.calls, ['modelsdev']);
});

test('startup staging cleanup failure remains explicit and sanitized while retained facts stay readable', async t => {
  const f = await fixture(t, { storeFacade: db => Object.assign(Object.create(db), {
    modelDataStagingJobs: () => ({ jobs: [{ jobID: 'failed-stage', status: 'interrupted', sources: ['modelsdev'] }] }),
    modelDataCleanupStaging: async () => { throw Error('Synthetic private diagnostic must not reach clients.'); },
  }) });
  await seed(f); await waitFor(() => f.service.status().maintenance.state === 'failed');
  const status = f.service.status();
  assert.match(status.maintenance.error, /Interrupted staging could not be cleared/);
  assert.doesNotMatch(JSON.stringify(status), /Synthetic private diagnostic/);
  assert.throws(() => f.service.refresh({ sources: ['modelsdev'] }), { status: 409 });
  assert.equal(f.service.list({}).records[0].name, 'Last good'); assert.deepEqual(f.calls, []);
});

test('post-worker staging cleanup stays visible and prevents a completed receipt from silently coalescing a new request', async t => {
  const gate = deferred(), entered = deferred();
  const f = await fixture(t, { release: () => gate.resolve(), storeFacade: db => Object.assign(Object.create(db), {
    modelDataCleanupStaging: async () => { entered.resolve(); await gate.promise; },
  }) });
  f.service.refresh({ sources: ['modelsdev'] }); await entered.promise;
  assert.equal(f.service.status().job.status, 'completed');
  assert.equal(f.service.status().maintenance.state, 'cleaning');
  assert.equal(f.service.list({}).records.length, 1);
  assert.throws(() => f.service.refresh({ sources: ['modelsdev'] }), { status: 409 });
  assert.deepEqual(f.calls, ['modelsdev']); gate.resolve(); await f.settled();
  assert.equal(f.service.status().maintenance.state, 'ready');
});

test('restart reconciles every active receipt and preserves a source committed before an incomplete two-source refresh', async t => {
  const f = await fixture(t);
  f.db.beginModelDataRefresh({ id: 'older-active', sources: ['modelsdev'], createdAt: baseTime + 1 });
  const winner = f.db.beginModelDataRefresh({ id: 'newer-active', sources: ['modelsdev', 'artificial-analysis'], createdAt: baseTime + 2 });
  const published = f.db.publishModelDataSource(snapshot('modelsdev', baseTime + 3, 'Committed before restart'), { jobID: winner.id });
  assert.equal(f.db.modelDataActiveJobs().jobs.length, 2);
  await f.restart(); const status = f.service.status();
  assert.equal(f.db.modelDataActiveJobs().jobs.length, 0);
  assert.equal(status.job.id, winner.id); assert.equal(status.job.status, 'interrupted');
  assert.equal(status.job.results.find(row => row.source === 'modelsdev').status, 'completed');
  assert.equal(sourceRow(f, 'modelsdev').state, 'complete');
  assert.equal(sourceRow(f, 'modelsdev').currentSnapshotID, published.snapshotID);
  assert.equal(sourceRow(f, 'artificial-analysis').state, 'interrupted');
  assert.equal(f.service.list({}).records[0].name, 'Committed before restart'); assert.deepEqual(f.calls, []);
});

test('uncertain worker stop holds its checkpoint lease and running guard until actual exit, then restores once', async t => {
  const gate = deferred(), entered = deferred(); let exited = false, acquired = 0, released = 0;
  const f = await fixture(t, { release: () => { exited = true; gate.resolve(); },
    storeFacade: db => Object.assign(Object.create(db), {
      beginModelDataBackgroundWrite: () => {
        acquired++; const release = db.beginModelDataBackgroundWrite();
        return () => { assert.equal(exited, true, 'The main checkpoint policy is restored only after the worker has exited.'); released++; release(); };
      },
    }),
    workerRunner: async () => { entered.resolve(); throw Object.assign(Error('Synthetic private worker diagnostic.'), {
      code: 'MODEL_DATA_WORKER_SHUTDOWN', whenExited: gate.promise,
    }); },
  });
  const current = f.service.refresh({ sources: ['modelsdev'] }); await entered.promise;
  await waitFor(() => f.service.status().job.status === 'cancelling');
  assert.equal(acquired, 1); assert.equal(released, 0); assert.equal(f.service.isRunning(), true);
  assert.doesNotMatch(JSON.stringify(f.service.status()), /Synthetic private worker diagnostic/);
  f.service.cancel(current.job.id); exited = true; gate.resolve(); const status = await f.settled();
  assert.equal(status.job.status, 'cancelled'); assert.equal(released, 1); assert.deepEqual(f.calls, []);
});
