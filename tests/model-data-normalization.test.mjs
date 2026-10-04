import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModelsDev, normalizeArtificialAnalysis, validateModelDataSnapshot, matchModelDataIdentity, scopeModelDataSnapshot, withModelDataCanonicalIdentities, MODEL_DATA_LIMITS } from '../domain/model-data.mjs';

const retrievedAt = 1791043200000;
function deployment(overrides = {}) {
  return { id: 'lab/model-v1', name: 'Model V1', description: 'Public model description', attachment: true,
    reasoning: true, reasoning_options: [{ type: 'effort', values: ['low', 'high', null] }], tool_call: true,
    structured_output: true, temperature: false, open_weights: false, release_date: '2026-09', last_updated: '2026-10-03',
    modalities: { input: ['text', 'image'], output: ['text'] }, limit: { context: 200_000, input: 160_000, output: 40_000 },
    canonical_model_id: 'lab/model-v1', cost: { input: 1, output: 2, reasoning: 3, input_audio: 4,
      tiers: [{ input: 2, output: 4, tier: { type: 'context', size: 200_000 } }] }, ...overrides };
}
function modelsPayload(overrides = {}) {
  return { providers: { host: { id: 'host', name: 'Host', npm: '@ai-sdk/host', doc: 'https://example.com/docs',
    env: ['HOST_API_KEY'], models: { 'lab/model-v1': deployment() } } },
  models: { 'lab/model-v1': { id: 'lab/model-v1', name: 'Model V1', description: 'Canonical model description',
    license: 'proprietary', links: [{ url: 'https://example.com/card', type: 'model_card' }],
    benchmarks: [{ name: 'Custom Coding', score: 0.79, metric: 'accuracy', harness: 'Published harness',
      variant: 'high', version: 'v1', date: '2026-09-30', source: 'https://example.com/evaluation' }] } }, ...overrides };
}
function aaRow(overrides = {}) {
  const names = ['intelligence', 'coding', 'agentic', 'finance_and_accounting', 'strategy_and_ops', 'legal',
    'healthcare_and_medical', 'engineering', 'economics'];
  return { id: 'source-uuid-high', name: 'Model V1 (high)', slug: 'model-v1', release_date: '2026-09-20',
    model_creator: { id: 'lab-uuid', name: 'Lab' },
    evaluations: Object.fromEntries(names.map(name => [`artificial_analysis_${name}_index`, name === 'coding' ? null : 24.5])),
    artificial_analysis_intelligence_index_cost: { total_cost: 20.69, cost_per_task: { total_cost: 0.1678 } },
    pricing: { price_1m_input_tokens: 0.06, price_1m_output_tokens: 0.2, price_1m_cache_hit_tokens: null, price_1m_cache_write_tokens: 0 },
    performance: { median_output_tokens_per_second: 296.47, median_time_to_first_token_seconds: 0.65,
      median_time_to_first_answer_token_seconds: 7.4, median_end_to_end_response_time_seconds: 9.09 }, ...overrides };
}
function aaPayload(rows = [aaRow()]) {
  return { tier: 'free', intelligence_index_version: 4.3,
    pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false }, data: rows };
}

// Identity tuples from the reviewed production registry; all metric values below
// are fixtures. No native sourceIdentities or caller-authored aliases are supplied.
const sonnetCanonicalID = 'anthropic/claude-sonnet-5-5';
const sonnetConfigurations = [
  { id: 'bbc2ffea-cf6b-43be-8c41-1769347e234d', slug: 'claude-sonnet-5-5-low', name: 'Claude Sonnet 5.5 (Low, Default Fallback)' },
  { id: '268525e2-f873-4178-bc07-e6a0ee1f002d', slug: 'claude-sonnet-5-5-high', name: 'Claude Sonnet 5.5 (High, Default Fallback)' },
  { id: 'b171d979-5ec1-45de-b8b9-db1ee65e77ec', slug: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5 (Max, Default Fallback)' },
];
const sonnetNativeModels = () => [
  { id: 'github-copilot/claude-sonnet-5.5', provider: 'github-copilot', modelID: 'claude-sonnet-5.5' },
  { id: 'opencode-go/claude-sonnet-5-5', provider: 'opencode-go', modelID: 'claude-sonnet-5-5' },
];
function sonnetModelsDev() {
  const providers = Object.fromEntries(sonnetNativeModels().map(native => [native.provider, {
    id: native.provider, name: native.provider, npm: '@ai-sdk/openai-compatible', doc: 'https://models.dev', env: ['FIXTURE_SOURCE_KEY'],
    models: { [native.modelID]: deployment({ id: native.modelID, name: 'Claude Sonnet 5.5',
      canonical_model_id: sonnetCanonicalID, release_date: '2026-09-28' }) },
  }]));
  return normalizeModelsDev({ providers, models: { [sonnetCanonicalID]: {
    id: sonnetCanonicalID, name: 'Claude Sonnet 5.5', description: 'Reviewed identity fixture',
    release_date: '2026-09-28', license: 'proprietary',
  } } }, { retrievedAt });
}
const sonnetAARow = configuration => aaRow({ ...configuration, release_date: '2026-09-28',
  model_creator: { id: 'f0aa413f-e8ae-4fcd-9c48-0e049f4f3128', name: 'Anthropic', slug: 'anthropic' } });

test('Models.dev preserves canonical model and provider deployment identities, source paths, dates and full metadata', () => {
  const payload = modelsPayload(), snapshot = normalizeModelsDev(payload, { retrievedAt });
  assert.equal(snapshot.schemaVersion, 1); assert.equal(snapshot.records.length, 2);
  const canonical = snapshot.records.find(row => row.kind === 'model'), served = snapshot.records.find(row => row.kind === 'deployment');
  assert.equal(canonical.id, 'modelsdev:model:lab%2Fmodel-v1');
  assert.equal(served.id, 'modelsdev:deployment:host:lab%2Fmodel-v1');
  assert.equal(served.identifiers.nativeID, 'host/lab/model-v1');
  assert.equal(served.identifiers.canonicalModelID, 'lab/model-v1');
  assert.equal(served.sourceReference.path, '/providers/host/models/lab~1model-v1');
  assert.equal(served.sourceDates.release_date, '2026-09');
  assert.deepEqual(served.raw.model, payload.providers.host.models['lab/model-v1']);
  assert.deepEqual(served.raw.provider.env, ['HOST_API_KEY']);
  assert.equal(canonical.raw.license, 'proprietary');
  const score = canonical.facts.find(fact => fact.attribute === 'benchmarks.0.score');
  assert.equal(score.value, 0.79); assert.equal(score.units, 'accuracy'); assert.equal(score.configuration.variant, 'high');
  assert.equal(score.dates.publishedAt, '2026-09-30'); assert.equal(score.configuration.publicationURL, 'https://example.com/evaluation');
  assert.equal(score.sourceRef.path, '/models/lab~1model-v1/benchmarks/0/score');
});

test('Models.dev retains audio/reasoning costs, price tiers and provider overrides in useful typed facts', () => {
  const payload = modelsPayload();
  const model = payload.providers.host.models['lab/model-v1'];
  model.provider = { npm: '@ai-sdk/openai-compatible', shape: 'responses', body: { mode: 'test' }, headers: { 'x-public-feature': '1' } };
  model.experimental = { modes: { fast: { cost: { input: 0.1, output: 0.2 }, provider: { body: { faster: true } } } } };
  const row = normalizeModelsDev(payload, { retrievedAt }).records.find(row => row.kind === 'deployment');
  assert.equal(row.facts.find(f => f.attribute === 'cost.reasoning').units, 'USD/1M tokens');
  assert.equal(row.facts.find(f => f.attribute === 'cost.input_audio').value, 4);
  const tier = row.facts.find(f => f.attribute === 'cost.tiers.0.input');
  assert.deepEqual(tier.configuration.priceTier, { type: 'context', size: 200_000 });
  assert.equal(row.facts.find(f => f.attribute === 'experimental.modes.fast.cost.input').configuration.mode, 'fast');
  assert.equal(row.facts.find(f => f.attribute === 'limit.context').units, 'tokens');
  assert.equal(row.facts.find(f => f.attribute === 'provider.shape').value, 'responses');
});

test('normalization preserves unknown JSON source fields without substituting or guessing null values', () => {
  const payload = modelsPayload();
  payload.providers.host.models['lab/model-v1'].future = { score: null, settings: [false, 0, 'available'] };
  payload.providers.host.models['lab/model-v1'].cost.discount = null;
  const row = normalizeModelsDev(payload, { retrievedAt }).records.find(row => row.kind === 'deployment');
  assert.equal(row.facts.find(f => f.attribute === 'source.future.score').value, null);
  assert.deepEqual(row.facts.find(f => f.attribute === 'source.future.settings').value, [false, 0, 'available']);
  assert.equal(row.facts.find(f => f.attribute === 'source.cost.discount').value, null);
  assert.deepEqual(row.raw.model.future, payload.providers.host.models['lab/model-v1'].future);
});

test('plain provider feed is supported and specialized decision model types are preserved', () => {
  const providers = modelsPayload().providers; providers.host.models['lab/model-v1'].type = 'decision';
  const row = normalizeModelsDev(providers, { retrievedAt, sourceReference: 'https://models.dev/api.json?type=all' }).records[0];
  assert.equal(row.raw.model.type, 'decision'); assert.equal(row.sourceReference.path, '/host/models/lab~1model-v1');
});

test('known Models.dev field types, real calendar dates and pricing invariants are validated', () => {
  for (const mutate of [
    p => { p.providers.host.models['lab/model-v1'].tool_call = 'true'; },
    p => { p.providers.host.models['lab/model-v1'].cost.input = -1; },
    p => { p.providers.host.models['lab/model-v1'].release_date = '2026-02-30'; },
    p => { p.providers.host.models['lab/model-v1'].modalities.input = ['unknown']; },
    p => { p.providers.host.models['lab/model-v1'].reasoning_options = [{ type: 'effort', values: ['invented'] }]; },
    p => { p.providers.host.models['lab/model-v1'].cost.tiers.push(p.providers.host.models['lab/model-v1'].cost.tiers[0]); },
    p => { p.providers.host.models['lab/model-v1'].provider = { shape: 'unknown' }; },
    p => { p.providers.host.models['lab/model-v1'].id = 'different-id'; },
  ]) { const payload = modelsPayload(); mutate(payload); assert.throws(() => normalizeModelsDev(payload, { retrievedAt }), /schema/); }
});

test('Artificial Analysis keeps configurations with a shared slug separate and retains null, zero and source version', () => {
  const snapshot = normalizeArtificialAnalysis(aaPayload([aaRow(), aaRow({ id: 'source-uuid-medium', name: 'Model V1 (medium)' })]), { retrievedAt });
  assert.equal(snapshot.records.length, 2); assert.notEqual(snapshot.records[0].id, snapshot.records[1].id);
  assert.ok(snapshot.records.every(row => row.kind === 'configuration'));
  const row = snapshot.records.find(row => row.name.endsWith('(high)'));
  assert.equal(row.configuration.testedName, 'Model V1 (high)');
  assert.equal(row.configuration.performanceAggregation, 'median-across-providers');
  assert.equal(row.facts.find(f => f.attribute === 'evaluations.artificial_analysis_coding_index').value, null);
  assert.equal(row.facts.find(f => f.attribute === 'pricing.price_1m_cache_write_tokens').value, 0);
  const intelligence = row.facts.find(f => f.attribute === 'evaluations.artificial_analysis_intelligence_index');
  assert.equal(intelligence.value, 24.5); assert.equal(intelligence.scale.version, 4.3);
  assert.equal(intelligence.scale.kind, 'composite-index'); assert.equal(intelligence.scale.maximum, null);
  assert.equal(row.facts.find(f => f.attribute === 'evaluations.artificial_analysis_legal_index').scale.version, null);
  assert.equal(row.facts.find(f => f.attribute === 'performance.median_time_to_first_token_seconds').units, 'seconds');
  assert.equal(row.facts.find(f => f.attribute === 'artificial_analysis_intelligence_index_cost.cost_per_task.total_cost').units, 'USD');
  assert.equal(intelligence.dates.measuredAt, undefined, 'Retrieval time is not a measurement time.');
});

test('Artificial Analysis validates Free response fields and rejects legacy envelopes or invalid pagination', () => {
  assert.throws(() => normalizeArtificialAnalysis({ data: [aaRow()] }, { retrievedAt }), /schema/);
  for (const mutate of [
    p => { p.pagination.has_more = true; },
    p => { p.pagination.page = 0; },
    p => { delete p.data[0].pricing.price_1m_cache_hit_tokens; },
    p => { p.data[0].performance.median_output_tokens_per_second = '100'; },
    p => { p.data[0].evaluations.artificial_analysis_coding_index = NaN; },
    p => { p.data[0].release_date = '2026-99-99'; },
  ]) { const payload = aaPayload(); mutate(payload); assert.throws(() => normalizeArtificialAnalysis(payload, { retrievedAt }), /schema/); }
  const row = aaRow({ release_date: null, model_creator: null, artificial_analysis_intelligence_index_cost: null });
  assert.equal(normalizeArtificialAnalysis(aaPayload([row]), { retrievedAt }).records[0].raw.model_creator, null);
});

test('identity matching respects provider deployments and explicit API aliases without fuzzy family mapping', () => {
  const row = normalizeModelsDev(modelsPayload(), { retrievedAt }).records.find(r => r.kind === 'deployment');
  assert.deepEqual(matchModelDataIdentity(row, [{ id: 'host/lab/model-v1' }]).candidateIDs, ['host/lab/model-v1']);
  assert.equal(matchModelDataIdentity(row, [{ id: 'host/lab/model-v1' }]).status, 'exact');
  assert.equal(matchModelDataIdentity(row, [{ id: 'host/custom', provider: 'host', api: { id: 'lab/model-v1' } }]).status, 'alias');
  assert.equal(matchModelDataIdentity(row, [{ id: 'other/lab/model-v1', provider: 'other', api: { id: 'lab/model-v1' }, name: 'Model V1' }]).status, 'unmatched');
  assert.equal(matchModelDataIdentity(row, [{ id: 'host/model-v2', name: 'Model V1', family: 'model' }]).status, 'unmatched');
  const both = matchModelDataIdentity(row, [{ id: 'host/lab/model-v1' }, { id: 'host/custom', provider: 'host', apiID: 'lab/model-v1' }]);
  assert.equal(both.status, 'ambiguous'); assert.deepEqual(both.candidateIDs, ['host/custom', 'host/lab/model-v1']);
});

test('AA configuration requires source-qualified identity and never matches just a slug, name or model family', () => {
  const row = normalizeArtificialAnalysis(aaPayload(), { retrievedAt }).records[0];
  assert.equal(matchModelDataIdentity(row, [{ id: 'lab/model-v1', name: row.name, apiID: row.identifiers.slug }]).status, 'unmatched');
  assert.equal(matchModelDataIdentity(row, [{ id: 'lab/model-v1', sourceIdentities: { 'artificial-analysis': { sourceID: row.identifiers.sourceID } } }]).status, 'exact');
  assert.equal(matchModelDataIdentity(row, [{ id: 'lab/model-v1', sourceAliases: { 'artificial-analysis': [row.id] } }]).status, 'alias');
  assert.equal(matchModelDataIdentity(row, [{ id: 'lab/model-v1', sourceIdentities: { 'artificial-analysis': { name: row.name } } }]).status, 'unmatched');
});

test('configured snapshot scope preserves exact evidence and excludes unrelated deployments and family names', () => {
  const payload = modelsPayload();
  payload.providers.other = { ...payload.providers.host, id: 'other', models: { 'lab/model-v1': deployment() } };
  const received = normalizeModelsDev(payload, { retrievedAt });
  const retained = scopeModelDataSnapshot(received, [{ id: 'host/lab/model-v1', provider: 'host' }]);
  assert.equal(retained.records.length, 2);
  const served = retained.records.find(row => row.kind === 'deployment');
  assert.equal(served.id, 'modelsdev:deployment:host:lab%2Fmodel-v1');
  assert.equal(served, received.records.find(row => row.provider === 'host'), 'Source record and fact objects stay unchanged.');
  assert.deepEqual(retained.sourceMetadata.scope, { kind: 'configured-native-models', nativeModelIDs: ['host/lab/model-v1'],
    canonicalLinks: [{ recordID: 'modelsdev:model:lab%2Fmodel-v1', canonicalModelID: 'lab/model-v1',
      deploymentRecordIDs: ['modelsdev:deployment:host:lab%2Fmodel-v1'], nativeModelIDs: ['host/lab/model-v1'] }],
    modelLinks: [], matchedNativeModelCount: 1,
    receivedRecordCount: 3, receivedFactCount: received.records.reduce((n, row) => n + row.facts.length, 0),
    retainedRecordCount: 2, retainedFactCount: retained.records.reduce((n, row) => n + row.facts.length, 0) });
  assert.equal(scopeModelDataSnapshot(received, [{ id: 'host/model-v2', name: 'Model V1', family: 'model' }]).records.length, 0);
  assert.equal(received.records.length, 3);
});

test('configured AA scope retains separately asserted configurations and does not guess slug identities', () => {
  const received = normalizeArtificialAnalysis(aaPayload([aaRow(), aaRow({ id: 'source-uuid-medium', name: 'Model V1 (medium)' })]), { retrievedAt });
  assert.equal(scopeModelDataSnapshot(received, [{ id: 'lab/model-v1', apiID: 'model-v1', name: 'Model V1 (high)' }]).records.length, 0);
  const retained = scopeModelDataSnapshot(received, [{ id: 'lab/model-v1', sourceIdentities: {
    'artificial-analysis': { sourceID: 'source-uuid-high' } } }]);
  assert.equal(retained.records.length, 1); assert.equal(retained.records[0].identifiers.sourceID, 'source-uuid-high');
  assert.equal(retained.records[0].facts, received.records.find(row => row.identifiers.sourceID === 'source-uuid-high').facts);
});

test('reviewed AA links resolve plain native deployments through source-declared canonical identities across providers', () => {
  const native = sonnetNativeModels(), original = structuredClone(native), modelsdev = sonnetModelsDev();
  const received = normalizeArtificialAnalysis(aaPayload(sonnetConfigurations.map(sonnetAARow)), { retrievedAt });
  assert.equal(scopeModelDataSnapshot(received, native).records.length, 0, 'A familiar native name alone is insufficient.');
  const identities = withModelDataCanonicalIdentities(native, modelsdev.records);
  assert.deepEqual(native, original, 'Private source identity resolution must not mutate native inventory.');
  assert.deepEqual(identities.map(row => row.id), native.map(row => row.id));
  for (const record of received.records) {
    const match = matchModelDataIdentity(record, identities);
    assert.equal(match.method, 'reviewed-source-model-link');
    assert.deepEqual(match.candidateIDs, native.map(row => row.id).sort());
    assert.ok(match.evidence.some(reference => reference.url === 'https://models.dev/catalog.json?type=all'));
    assert.ok(match.evidence.some(reference => reference.url.startsWith('https://artificialanalysis.ai/models/claude-sonnet-5-5')));
  }
  for (const mutate of [
    records => records.splice(records.findIndex(record => record.kind === 'model'), 1),
    records => { records.find(record => record.kind === 'model').name = 'Claude Sonnet 5.6'; },
    records => { records.find(record => record.kind === 'model').sourceDates.release_date = '2026-09-29'; },
    records => { records.find(record => record.kind === 'model').raw.release_date = '2026-09-29'; },
  ]) {
    const records = structuredClone(modelsdev.records); mutate(records);
    const unverified = withModelDataCanonicalIdentities(native, records);
    assert.equal(scopeModelDataSnapshot(received, unverified).records.length, 0, 'Unverified canonical metadata cannot create a reviewed association.');
  }
});

test('an exact native canonical ID cannot bypass checked canonical source assertions', () => {
  const native = [{ id: sonnetCanonicalID, provider: 'anthropic' }];
  const received = normalizeArtificialAnalysis(aaPayload(sonnetConfigurations.map(sonnetAARow)), { retrievedAt });
  const modelsdev = sonnetModelsDev();
  assert.equal(scopeModelDataSnapshot(received, withModelDataCanonicalIdentities(native, modelsdev.records)).records.length, 3);
  for (const mutate of [
    records => records.splice(records.findIndex(record => record.kind === 'model'), 1),
    records => { records.find(record => record.kind === 'model').name = 'Claude Sonnet 5.6'; },
    records => { records.find(record => record.kind === 'model').sourceDates.release_date = '2026-09-29'; },
  ]) {
    const records = structuredClone(modelsdev.records); mutate(records);
    const identities = withModelDataCanonicalIdentities(native, records);
    assert.equal(identities[0].canonicalModelContextChecked, true);
    assert.deepEqual(identities[0].canonicalModelIDs, []);
    assert.equal(scopeModelDataSnapshot(received, identities).records.length, 0);
  }
});

test('reviewed AA scope retains Low High and Max as separate tested configurations and excludes unrelated records', () => {
  const native = withModelDataCanonicalIdentities(sonnetNativeModels(), sonnetModelsDev().records);
  const received = normalizeArtificialAnalysis(aaPayload([...sonnetConfigurations.map(sonnetAARow), aaRow()]), { retrievedAt });
  const retained = scopeModelDataSnapshot(received, native);
  assert.equal(retained.records.length, 3); assert.equal(new Set(retained.records.map(row => row.id)).size, 3);
  assert.equal(retained.sourceMetadata.scope.receivedRecordCount, 4);
  assert.equal(retained.sourceMetadata.scope.retainedRecordCount, 3);
  assert.equal(retained.sourceMetadata.scope.matchedNativeModelCount, 2);
  for (const tuple of sonnetConfigurations) {
    const record = retained.records.find(row => row.identifiers.sourceID === tuple.id);
    assert.ok(record); assert.equal(record, received.records.find(row => row.id === record.id));
    assert.equal(record.kind, 'configuration'); assert.equal(record.configuration.testedName, tuple.name);
    assert.equal(record.identifiers.slug, tuple.slug); assert.equal(record.sourceDates.release_date, '2026-09-28');
    assert.equal(record.configuration.reasoning_effort, undefined, 'The source tested name is retained; no native variant is inferred.');
    assert.equal(record.configuration.performanceAggregation, 'median-across-providers');
  }
  assert.equal(retained.records.some(row => row.identifiers.sourceID === 'source-uuid-high'), false);
  const unrelated = [{ id: 'other/claude-sonnet-5-5', provider: 'other', name: 'Claude Sonnet 5.5' }];
  assert.equal(scopeModelDataSnapshot(received, withModelDataCanonicalIdentities(unrelated, sonnetModelsDev().records)).records.length, 0);
});

test('reviewed AA tuple guards reject tampered creator UUID tested name slug and release metadata', () => {
  const native = withModelDataCanonicalIdentities(sonnetNativeModels(), sonnetModelsDev().records);
  const tuple = sonnetConfigurations[1];
  for (const mutate of [
    row => { row.id = '268525e2-f873-4178-bc07-e6a0ee1f002e'; },
    row => { row.model_creator.id = 'f0aa413f-e8ae-4fcd-9c48-0e049f4f3129'; },
    row => { row.model_creator.name = 'Different creator'; },
    row => { row.model_creator.slug = 'different-creator'; },
    row => { row.name = 'Claude Sonnet 5.5 (Max, Default Fallback)'; },
    row => { row.slug = 'claude-sonnet-5-5'; },
    row => { row.release_date = '2026-09-29'; },
  ]) {
    const row = sonnetAARow(tuple); mutate(row);
    const received = normalizeArtificialAnalysis(aaPayload([row]), { retrievedAt });
    assert.equal(matchModelDataIdentity(received.records[0], native).status, 'unmatched');
    assert.equal(scopeModelDataSnapshot(received, native).records.length, 0);
  }
});

test('unknown native scope is invalid while an explicitly empty configured inventory is valid', () => {
  const received = normalizeModelsDev(modelsPayload(), { retrievedAt });
  for (const scope of [undefined, null, {}, [{ id: '' }], [null]]) assert.throws(() => scopeModelDataSnapshot(received, scope), /schema/);
  const retained = scopeModelDataSnapshot(received, []);
  assert.deepEqual(retained.records, []); assert.deepEqual(retained.sourceMetadata.scope.nativeModelIDs, []);
  assert.equal(retained.sourceMetadata.scope.receivedRecordCount, 2);
});

test('snapshot validation rejects duplicate identity, invalid facts and unsafe JSON without dropping retained source fields', () => {
  assert.equal(MODEL_DATA_LIMITS.snapshotBytes, 128 * 1024 * 1024);
  assert.equal(MODEL_DATA_LIMITS.factBytes, 64 * 1024);
  for (const mutate of [
    p => { p.records.push(p.records[0]); },
    p => { p.records[0].facts[0].units = 1; },
    p => { p.records[0].facts[0].value = Infinity; },
    p => { p.records[0].facts[0].sourceRef.url = 'http://example.com'; },
    p => { p.records[0].raw = JSON.parse('{"__proto__":{"unsafe":true}}'); },
    p => { p.records[0].facts[0].value = 'x'.repeat(64 * 1024); },
  ]) { const snapshot = normalizeModelsDev(modelsPayload(), { retrievedAt }); mutate(snapshot); assert.throws(() => validateModelDataSnapshot(snapshot), /schema/); }
});
