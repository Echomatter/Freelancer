import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchModelDataSource } from '../server/model-data-sources.mjs';

const retrievedAt = 1791043200000;
const model = { id: 'm', name: 'M', description: 'Public fixture', attachment: false, reasoning: false,
  tool_call: true, open_weights: true, release_date: '2026-09-01', last_updated: '2026-10-03',
  modalities: { input: ['text'], output: ['text'] }, limit: { context: 1000, output: 200 } };
const models = { providers: { p: { id: 'p', name: 'P', npm: '@ai-sdk/p', doc: 'https://example.com', env: ['P_API_KEY'], models: { m: model } } }, models: {} };
function aa(page = 1, total = 1, id = 'uuid') {
  const indices = ['intelligence', 'coding', 'agentic', 'finance_and_accounting', 'strategy_and_ops', 'legal', 'healthcare_and_medical', 'engineering', 'economics'];
  return { tier: 'free', intelligence_index_version: 4.3, pagination: { page, page_size: 200, total_pages: total, has_more: page < total },
    data: [{ id, name: 'M (high)', slug: 'm', release_date: null, model_creator: null,
      artificial_analysis_intelligence_index_cost: null,
      evaluations: Object.fromEntries(indices.map(key => [`artificial_analysis_${key}_index`, null])),
      pricing: { price_1m_input_tokens: null, price_1m_output_tokens: 0, price_1m_cache_hit_tokens: null, price_1m_cache_write_tokens: null },
      performance: { median_output_tokens_per_second: null, median_time_to_first_token_seconds: null,
        median_time_to_first_answer_token_seconds: null, median_end_to_end_response_time_seconds: null } }] };
}
const response = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

test('Models.dev fetch uses complete fixed official catalog, no authorization and one durable request reservation', async () => {
  const calls = [], reservations = [];
  const snapshot = await fetchModelDataSource('modelsdev', { apiKey: 'must-not-be-sent', now: () => retrievedAt,
    onRequest: async entry => { reservations.push(entry); },
    fetchImpl: async (url, options) => { calls.push({ url, options }); return response(models); } });
  assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://models.dev/catalog.json?type=all');
  assert.equal(calls[0].options.redirect, 'error'); assert.equal(calls[0].options.method, 'GET');
  assert.deepEqual(calls[0].options.headers, { accept: 'application/json' });
  assert.equal(reservations.length, 1); assert.equal(snapshot.retrievedAt, retrievedAt);
  assert.deepEqual(snapshot.sourceMetadata, { requests: 1, pages: 1 });
});

test('AA Free fetch drains bounded pages, retains exact page evidence and reads documented quota headers', async () => {
  const calls = [], reservations = [];
  const snapshot = await fetchModelDataSource('artificial-analysis', { apiKey: 'fixture-key', now: retrievedAt,
    onRequest: async ({ source, url }) => reservations.push({ source, url }),
    fetchImpl: async (url, options) => { calls.push({ url, options }); const page = Number(new URL(url).searchParams.get('page'));
      return response(aa(page, 2, `uuid-${page}`), 200, { 'x-aa-tier': 'free', 'x-ratelimit-limit': '100',
        'x-ratelimit-remaining': String(100 - page), 'x-ratelimit-reset': '1791129600' }); } });
  assert.deepEqual(calls.map(c => c.url), ['https://artificialanalysis.ai/api/v2/language/models/free?page=1',
    'https://artificialanalysis.ai/api/v2/language/models/free?page=2']);
  assert.equal(calls[0].options.headers['x-api-key'], 'fixture-key'); assert.equal(reservations.length, 2);
  assert.equal(snapshot.records.length, 2); assert.equal(snapshot.sourceMetadata.pages, 2);
  assert.equal(snapshot.records[1].sourceReference.url.endsWith('?page=2'), true);
  assert.equal(snapshot.quota.limit, 100); assert.equal(snapshot.quota.remaining, 98);
  assert.equal(snapshot.quota.resetAt, 1791129600000);
  assert.equal(JSON.stringify(snapshot).includes('fixture-key'), false);
});

test('missing AA key and unknown source never dispatch an HTTP request', async () => {
  let count = 0; const fetchImpl = async () => { count++; return response({}); };
  for (const source of ['unknown', 'constructor', '__proto__']) await assert.rejects(fetchModelDataSource(source, { fetchImpl }), e => e.code === 'unknown-source');
  for (const apiKey of [undefined, '', 'x\r\ny']) await assert.rejects(fetchModelDataSource('artificial-analysis', { apiKey, fetchImpl }), e => e.code === 'missing-key');
  assert.equal(count, 0);
});

test('AA 401/403/429 are not retried; bodies and credentials cannot appear in sanitized source errors', async () => {
  for (const [status, code] of [[401, 'invalid-key'], [403, 'forbidden'], [429, 'quota']]) {
    let calls = 0;
    await assert.rejects(fetchModelDataSource('artificial-analysis', { apiKey: 'fixture-secret',
      fetchImpl: async () => { calls++; return response({ error: 'fixture-secret-private-body' }, status,
        { 'retry-after': '86400', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1791129600' }); } }), error => {
      assert.equal(error.code, code); assert.equal(error.status, status); assert.equal(error.retryAfterMs, 86400000);
      assert.equal(JSON.stringify(error).includes('fixture-secret'), false); assert.equal(error.message.includes('private-body'), false); return true;
    }); assert.equal(calls, 1);
  }
});

test('transient server errors retry with bounded backoff and reserve quota before every attempt', async () => {
  let calls = 0, reservations = 0; const delays = [];
  const snapshot = await fetchModelDataSource('modelsdev', { now: retrievedAt, onRequest: async () => { reservations++; },
    delayImpl: async ms => { delays.push(ms); }, fetchImpl: async () => ++calls === 1 ? response({}, 503) : response(models) });
  assert.equal(calls, 2); assert.equal(reservations, 2); assert.deepEqual(delays, [250]); assert.equal(snapshot.sourceMetadata.requests, 2);
  let failedCalls = 0;
  await assert.rejects(fetchModelDataSource('modelsdev', { delayImpl: async () => {}, fetchImpl: async () => { failedCalls++; throw Error('private-network-details'); } }), e => e.code === 'network' && !e.message.includes('private'));
  assert.equal(failedCalls, 2);
});

test('durable quota reservation rejection and exhausted remaining quota stop before the next HTTP attempt', async () => {
  let calls = 0;
  await assert.rejects(fetchModelDataSource('modelsdev', { onRequest: async () => { throw Error('Local quota reservation unavailable.'); },
    fetchImpl: async () => { calls++; return response(models); } }), /Local quota/);
  assert.equal(calls, 0);
  await assert.rejects(fetchModelDataSource('artificial-analysis', { apiKey: 'fixture', fetchImpl: async () => { calls++;
    return response(aa(1, 2), 200, { 'x-ratelimit-remaining': '0' }); } }), e => e.code === 'quota');
  assert.equal(calls, 1);
});

test('AA pagination rejects changing versions, tier, repeated IDs, wrong pages and incomplete bounded catalogs', async () => {
  for (const mutation of ['version', 'tier', 'duplicate', 'page', 'limit']) {
    let calls = 0;
    await assert.rejects(fetchModelDataSource('artificial-analysis', { apiKey: 'fixture', limits: { pages: mutation === 'limit' ? 1 : 20 },
      fetchImpl: async () => { calls++; const value = aa(calls, 2, mutation === 'duplicate' ? 'same' : `id-${calls}`);
        if (calls === 2 && mutation === 'version') value.intelligence_index_version = 5;
        if (calls === 2 && mutation === 'tier') value.tier = 'pro';
        if (mutation === 'page') value.pagination.page = 2;
        return response(value); } }), e => e.code === (mutation === 'limit' ? 'pagination-limit' : 'invalid-schema'));
    assert.ok(calls <= 2);
  }
});

test('source response requires JSON, valid complete schemas and bounded declared or streamed body bytes', async () => {
  for (const fixture of [() => new Response('<html>private</html>', { headers: { 'content-type': 'text/html' } }),
    () => new Response('{invalid', { headers: { 'content-type': 'application/json' } }), () => response({ models: {} })]) {
    await assert.rejects(fetchModelDataSource('modelsdev', { fetchImpl: async () => fixture() }), e => e.code === 'invalid-schema');
  }
  for (const declared of [true, false]) await assert.rejects(fetchModelDataSource('modelsdev', { limits: { bodyBytes: 100 },
    fetchImpl: async () => response(models, 200, declared ? { 'content-length': '1000000' } : {}) }), e => e.code === 'body-limit');
  await assert.rejects(fetchModelDataSource('modelsdev', { limits: { bodyBytes: 17 * 1024 * 1024 } }), e => e.code === 'invalid-schema');
});

test('cancellation and per-request timeout bound unresolved fetch and request reservation without retries', async () => {
  const controller = new AbortController(); let entered, calls = 0;
  const ready = new Promise(resolve => { entered = resolve; });
  const pending = fetchModelDataSource('modelsdev', { signal: controller.signal, fetchImpl: async () => { calls++; entered(); return new Promise(() => {}); } });
  await ready; controller.abort(); await assert.rejects(pending, e => e.code === 'aborted'); assert.equal(calls, 1);
  await assert.rejects(fetchModelDataSource('modelsdev', { limits: { timeoutMs: 15 }, fetchImpl: async () => new Promise(() => {}) }), e => e.code === 'timeout');
  await assert.rejects(fetchModelDataSource('modelsdev', { limits: { totalMs: 15 }, onRequest: async () => new Promise(() => {}),
    fetchImpl: async () => { throw Error('Must not dispatch'); } }), e => e.code === 'timeout');
});
