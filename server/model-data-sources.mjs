import { MODEL_DATA_URLS, normalizeModelsDev, normalizeArtificialAnalysis, validateModelDataSnapshot } from '../domain/model-data.mjs';

// Only these official read-only routes are permitted. Redirects must not forward an API key.
export const MODEL_DATA_FETCH_LIMITS = Object.freeze({ timeoutMs: 15_000, totalMs: 60_000,
  bodyBytes: 16 * 1024 * 1024, totalBytes: 32 * 1024 * 1024, pages: 20, attempts: 2 });

export class ModelDataSourceError extends Error {
  constructor(code, source, { status = null, quota = null, retryAfterMs = null } = {}) {
    const descriptions = { 'unknown-source': 'Unknown model data source.', 'missing-key': 'Artificial Analysis needs an API key.',
      'invalid-key': 'Artificial Analysis API key is invalid.', 'forbidden': 'The model data source denied access.',
      'quota': 'Model data source quota is exhausted.', 'http': 'Model data source request failed.',
      'network': 'Model data source could not be reached.', 'timeout': 'Model data source request timed out.',
      'body-limit': 'Model data source response exceeded the size limit.', 'pagination-limit': 'Model data source exceeded the page limit.',
      'invalid-schema': 'Model data source returned an invalid schema.', 'aborted': 'Model data refresh was canceled.' };
    super(descriptions[code] ?? 'Model data source request failed.');
    this.name = 'ModelDataSourceError'; this.code = code;
    this.source = Object.hasOwn(MODEL_DATA_URLS, source) ? source : null;
    this.status = status; this.quota = quota; this.retryAfterMs = retryAfterMs;
  }
}

const err = (code, source, extra) => new ModelDataSourceError(code, source, extra);
const positiveHeader = (headers, key, multiplier = 1) => {
  const raw = headers?.get?.(key);
  if (raw === null || raw === undefined || !/^\d+$/.test(raw)) return null;
  const number = Number(raw) * multiplier;
  return Number.isSafeInteger(number) ? number : null;
};
function quotaHeaders(headers) {
  const tier = headers?.get?.('x-aa-tier');
  return { limit: positiveHeader(headers, 'x-ratelimit-limit'), remaining: positiveHeader(headers, 'x-ratelimit-remaining'),
    resetAt: positiveHeader(headers, 'x-ratelimit-reset', 1000), tier: ['free', 'pro', 'commercial'].includes(tier) ? tier : null,
    retryAfterMs: positiveHeader(headers, 'retry-after', 1000) };
}
async function cancelBody(response) { try { await response?.body?.cancel?.(); } catch {} }

async function readJSON(response, source, signal, limits, budget) {
  const type = response.headers?.get?.('content-type') ?? '';
  if (!/^application\/(?:json|[^;]+\+json)(?:;|$)/i.test(type)) {
    await cancelBody(response); throw err('invalid-schema', source);
  }
  const declared = positiveHeader(response.headers, 'content-length');
  if (declared !== null && (declared > limits.bodyBytes || declared + budget.bytes > limits.totalBytes)) {
    await cancelBody(response); throw err('body-limit', source);
  }
  const chunks = []; let bytes = 0;
  if (!response.body?.getReader) throw err('invalid-schema', source);
  const reader = response.body.getReader();
  const onAbort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted(); if (done) break;
      if (!(value instanceof Uint8Array)) throw err('invalid-schema', source);
      bytes += value.byteLength;
      if (bytes > limits.bodyBytes || budget.bytes + bytes > limits.totalBytes) throw err('body-limit', source);
      chunks.push(value);
    }
  } catch (error) { try { await reader.cancel(); } catch {} throw error; }
  finally { signal.removeEventListener('abort', onAbort); reader.releaseLock(); }
  budget.bytes += bytes;
  const merged = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(merged)); }
  catch { throw err('invalid-schema', source); }
}

const defaultDelay = (ms, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(signal.reason); return; }
  const timer = setTimeout(done, ms);
  function done() { signal.removeEventListener('abort', aborted); resolve(); }
  function aborted() { clearTimeout(timer); signal.removeEventListener('abort', aborted); reject(signal.reason); }
  signal.addEventListener('abort', aborted, { once: true });
});
function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const aborted = () => { signal.removeEventListener('abort', aborted); reject(signal.reason); };
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(promise).then(value => { signal.removeEventListener('abort', aborted); resolve(value); },
      error => { signal.removeEventListener('abort', aborted); reject(error); });
  });
}

/** Fetch only free data contracts. onRequest durably reserves quota before every HTTP attempt. */
export async function fetchModelDataSource(source, { apiKey, signal, fetchImpl = fetch, now = Date.now,
  onRequest = async () => {}, limits: supplied = {}, delayImpl = defaultDelay } = {}) {
  if (!Object.hasOwn(MODEL_DATA_URLS, source)) throw err('unknown-source', source);
  if (source === 'artificial-analysis' && (typeof apiKey !== 'string' || !apiKey.trim() ||
    apiKey.length > 8192 || /[\r\n]/.test(apiKey))) throw err('missing-key', source);
  if (signal?.aborted) throw err('aborted', source);
  // Overrides can shorten fixture deadlines/bounds, never relax the production boundary.
  const limits = Object.fromEntries(Object.entries(MODEL_DATA_FETCH_LIMITS).map(([key, value]) => {
    const candidate = supplied[key] ?? value;
    if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate > value) throw err('invalid-schema', source);
    return [key, candidate];
  }));
  const retrievedAt = typeof now === 'function' ? now() : now;
  const total = new AbortController(), totalTimer = setTimeout(() => total.abort(new DOMException('Timeout', 'TimeoutError')), limits.totalMs);
  const cancellation = signal ? AbortSignal.any([signal, total.signal]) : total.signal;
  const budget = { bytes: 0 }; let requests = 0, quota = null;
  async function request(url) {
    for (let attempt = 1; attempt <= limits.attempts; attempt++) {
      if (cancellation.aborted) throw err(signal?.aborted ? 'aborted' : 'timeout', source, { quota });
      // This hook is outside network-error retry handling: a quota/store rejection cannot be retried.
      try { await abortable(onRequest({ source, url, signal: cancellation }), cancellation); }
      catch (error) {
        if (cancellation.aborted) throw err(signal?.aborted ? 'aborted' : 'timeout', source, { quota });
        throw error;
      }
      if (cancellation.aborted) throw err(signal?.aborted ? 'aborted' : 'timeout', source, { quota });
      const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(new DOMException('Timeout', 'TimeoutError')), limits.timeoutMs);
      const requestSignal = AbortSignal.any([cancellation, timeout.signal]);
      try {
        requests++;
        const response = await abortable(fetchImpl(url, { method: 'GET', redirect: 'error', signal: requestSignal,
          headers: { accept: 'application/json', ...(source === 'artificial-analysis' ? { 'x-api-key': apiKey } : {}) } }), requestSignal);
        if (requestSignal.aborted) { void cancelBody(response); throw requestSignal.reason; }
        if (source === 'artificial-analysis') quota = quotaHeaders(response.headers);
        if (response.status !== 200) {
          await abortable(cancelBody(response), requestSignal);
          const details = { status: response.status, quota, retryAfterMs: quota?.retryAfterMs ?? null };
          if (response.status >= 500 && response.status <= 599 && attempt < limits.attempts) {
            await delayImpl(250 * 2 ** (attempt - 1), cancellation); continue;
          }
          throw err(response.status === 401 ? 'invalid-key' : response.status === 403 ? 'forbidden' :
            response.status === 429 ? 'quota' : 'http', source, details);
        }
        return await abortable(readJSON(response, source, requestSignal, limits, budget), requestSignal);
      } catch (error) {
        if (error instanceof ModelDataSourceError) throw error;
        if (requestSignal.aborted) throw err(signal?.aborted ? 'aborted' : 'timeout', source, { quota });
        if (attempt === limits.attempts) throw err('network', source, { quota });
        await delayImpl(250 * 2 ** (attempt - 1), cancellation);
      } finally { clearTimeout(timer); }
    }
  }
  try {
    if (source === 'modelsdev') {
      const payload = await request(MODEL_DATA_URLS.modelsdev);
      let snapshot;
      try { snapshot = normalizeModelsDev(payload, { retrievedAt }); }
      catch { throw err('invalid-schema', source); }
      return { ...snapshot, sourceMetadata: { requests, pages: 1 } };
    }
    const records = [], seen = new Set(); let metadata, totalPages, pageSize, tier, indexVersion;
    for (let page = 1; page <= limits.pages; page++) {
      const url = `${MODEL_DATA_URLS[source]}?page=${page}`;
      const payload = await request(url);
      let snapshot;
      try { snapshot = normalizeArtificialAnalysis(payload, { retrievedAt, sourceReference: url }); }
      catch { throw err('invalid-schema', source, { quota }); }
      const pagination = payload.pagination;
      if (pagination.page !== page || payload.data.length > pagination.page_size ||
        (page > 1 && (pagination.total_pages !== totalPages || pagination.page_size !== pageSize || payload.tier !== tier || payload.intelligence_index_version !== indexVersion))) {
        throw err('invalid-schema', source, { quota });
      }
      totalPages = pagination.total_pages; pageSize = pagination.page_size; tier = payload.tier; indexVersion = payload.intelligence_index_version;
      metadata = snapshot.sourceMetadata;
      for (const record of snapshot.records) {
        if (seen.has(record.id) || records.length >= 20_000) throw err('invalid-schema', source, { quota });
        seen.add(record.id); records.push(record);
      }
      if (!pagination.has_more) {
        try { return validateModelDataSnapshot({ ...snapshot, records: records.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
          sourceReference: { url: MODEL_DATA_URLS[source], path: '' }, quota,
          sourceMetadata: { ...metadata, requests, pages: page } }); }
        catch { throw err('invalid-schema', source, { quota }); }
      }
      if (quota?.remaining === 0) throw err('quota', source, { quota, retryAfterMs: quota.retryAfterMs });
    }
    throw err('pagination-limit', source, { quota });
  } finally { clearTimeout(totalTimer); }
}
