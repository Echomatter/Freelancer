import { Worker } from 'node:worker_threads';
import { ModelDataSourceError } from './model-data-sources.mjs';

const sources = new Set(['modelsdev', 'artificial-analysis']);
const vendorCodes = new Set(['missing-key', 'invalid-key', 'forbidden', 'quota', 'http', 'network',
  'timeout', 'body-limit', 'pagination-limit', 'invalid-schema', 'aborted']);
const defaultURL = new URL('./model-data-worker.mjs', import.meta.url);
const failure = (code, status = 503) => Object.assign(Error({
  aborted: 'Model-data refresh was canceled.', timeout: 'Model-data worker exceeded its execution deadline.',
  invalid: 'Model-data worker returned an invalid response.', worker: 'Model-data worker failed. Stored data was preserved.',
  shutdown: 'Model-data worker shutdown could not be confirmed.',
}[code]), { code: `MODEL_DATA_WORKER_${code.toUpperCase()}`, status, ...(code === 'aborted' ? { name: 'AbortError' } : {}) });
const obj = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const quota = value => {
  if (value === null || value === undefined) return null;
  if (!obj(value)) throw failure('invalid');
  const result = {};
  for (const key of ['limit', 'remaining', 'resetAt', 'retryAfterMs']) {
    if (value[key] === null || value[key] === undefined) result[key] = null;
    else if (Number.isSafeInteger(value[key]) && value[key] >= 0) result[key] = value[key];
    else throw failure('invalid');
  }
  result.tier = ['free', 'pro', 'commercial'].includes(value.tier) ? value.tier : null;
  return result;
};

/** Only typed public failures cross the worker boundary; never serialize a caught exception or stack. */
export function serializeModelDataWorkerError(error, source) {
  if (error instanceof ModelDataSourceError || vendorCodes.has(error?.code)) return {
    type: 'source', code: vendorCodes.has(error.code) ? error.code : 'http',
    source: sources.has(source) ? source : null,
    status: Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : null,
    quota: quota(error.quota), retryAfterMs: Number.isSafeInteger(error.retryAfterMs) && error.retryAfterMs >= 0 ? error.retryAfterMs : null,
  };
  if (error?.code === 'MODEL_DATA_QUOTA') return { type: 'source', code: 'quota', source, status: 429, quota: null, retryAfterMs: null };
  return { type: 'worker', code: error?.status === 409 ? 'superseded' : error?.name === 'AbortError' ? 'aborted' : 'failed',
    status: error?.status === 409 ? 409 : 503 };
}
export function deserializeModelDataWorkerError(value, source) {
  if (obj(value) && value.type === 'source' && vendorCodes.has(value.code)) return new ModelDataSourceError(value.code, source,
    { status: Number.isInteger(value.status) && value.status >= 400 && value.status <= 599 ? value.status : null,
      quota: quota(value.quota), retryAfterMs: Number.isSafeInteger(value.retryAfterMs) && value.retryAfterMs >= 0 ? value.retryAfterMs : null });
  if (value?.code === 'superseded') return Object.assign(Error('A newer refresh owns this model-data source.'), { status: 409, code: 'MODEL_DATA_WORKER_SUPERSEDED' });
  return failure(value?.code === 'aborted' ? 'aborted' : 'worker');
}

function receipt(value, source) {
  if (!obj(value) || value.source !== source || typeof value.snapshotID !== 'string' ||
    !new RegExp(`^${source}:[a-f0-9]{64}$`).test(value.snapshotID) ||
    !Number.isSafeInteger(value.recordCount) || value.recordCount < 0 || value.recordCount > 20_000 ||
    !Number.isSafeInteger(value.factCount) || value.factCount < 0 || value.factCount > 2_000_000) throw failure('invalid');
  const result = { source, snapshotID: value.snapshotID, recordCount: value.recordCount, factCount: value.factCount };
  if (typeof value.contentSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.contentSha256)) result.contentSha256 = value.contentSha256;
  if (Number.isSafeInteger(value.retrievedAt) && value.retrievedAt >= 0) result.retrievedAt = value.retrievedAt;
  for (const key of ['deduplicated', 'unchanged', 'staged']) if (typeof value[key] === 'boolean') result[key] = value[key];
  for (const key of ['receivedRecordCount', 'matchedNativeModelCount']) {
    if (value[key] !== undefined) {
      if (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 20_000) throw failure('invalid');
      result[key] = value[key];
    }
  }
  return result;
}
function progress(value) {
  if (!obj(value)) throw failure('invalid');
  const result = {};
  if (typeof value.stage === 'string' && /^[a-z][a-z-]{0,39}$/.test(value.stage)) result.stage = value.stage;
  for (const key of ['recordCount', 'factCount', 'processedRecords', 'processedFacts', 'records', 'facts', 'completed', 'total', 'bytes',
    'processedOperations', 'totalOperations', 'recordsInserted', 'factsInserted'])
    if (Number.isSafeInteger(value[key]) && value[key] >= 0) result[key] = value[key];
  return result;
}

/** Snapshot bodies stay inside the worker. Set workerURL only in a controlled fixture. */
export function runModelDataWorker({ filename, source, apiKey, jobID, nativeModels, signal, onRequest = async () => {},
  // The observed complete public feed contains ~246k insert operations. At
  // ~1k durable operations/second plus preparation, 180 seconds cannot finish.
  // Keep a finite overall budget; the adapter still limits HTTP to 60 seconds.
  onQuota = async () => {}, onProgress = async () => {}, timeoutMs = 600_000,
  workerURL = defaultURL, WorkerImpl = Worker, shutdownMs = 5000, terminateAfterMs = 500 } = {}) {
  if (typeof filename !== 'string' || !filename || !sources.has(source) || typeof jobID !== 'string' || !jobID || jobID.length > 128 ||
    !Array.isArray(nativeModels) || nativeModels.length > 20_000 || nativeModels.some(row => !obj(row) ||
      typeof row.id !== 'string' || !row.id.trim() || row.id.length > 512) ||
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000 ||
    !Number.isSafeInteger(shutdownMs) || shutdownMs < 1 || shutdownMs > 5000 ||
    !Number.isSafeInteger(terminateAfterMs) || terminateAfterMs < 0 || terminateAfterMs > 500) return Promise.reject(failure('invalid', 400));
  if (signal?.aborted) return Promise.reject(failure('aborted', 409));
  let worker;
  try { worker = new WorkerImpl(workerURL, { execArgv: [], stdout: true, stderr: true,
    resourceLimits: { maxOldGenerationSizeMb: 1536, maxYoungGenerationSizeMb: 128 },
    workerData: { filename, source, apiKey, jobID, nativeModels: structuredClone(nativeModels), entryURL: String(workerURL) } }); }
  catch { return Promise.reject(failure('worker')); }
  worker.stdout?.resume(); worker.stderr?.resume();
  return new Promise((resolve, reject) => {
    let response, stopping, exited = false, settled = false, stopTimer, terminateTimer, timer;
    let exitResolve; const whenExited = new Promise(yes => { exitResolve = yes; });
    const rpcIDs = new Set();
    function finish(error, value) {
      if (settled) return;
      settled = true; if (error) reject(error); else resolve(value);
    }
    function cleanup() {
      clearTimeout(timer); clearTimeout(stopTimer); clearTimeout(terminateTimer);
      signal?.removeEventListener('abort', aborted);
    }
    function terminate() { try { void Promise.resolve(worker.terminate()).catch(() => {}); } catch {} }
    function stop(error) {
      if (exited || stopping) return;
      stopping = error; clearTimeout(timer); signal?.removeEventListener('abort', aborted);
      try { worker.postMessage({ type: 'abort' }); } catch {}
      terminateTimer = setTimeout(terminate, terminateAfterMs);
      stopTimer = setTimeout(() => {
        terminate(); const uncertain = failure('shutdown');
        Object.defineProperty(uncertain, 'whenExited', { value: whenExited });
        finish(uncertain);
        // Keep exit observation referenced until confirmed; shutdown uncertainty is explicit.
      }, shutdownMs);
    }
    const aborted = () => stop(failure('aborted', 409));
    timer = setTimeout(() => stop(failure('timeout', 504)), timeoutMs);
    signal?.addEventListener('abort', aborted, { once: true });
    worker.on('message', message => {
      if (stopping || exited || settled) return;
      if (message?.type === 'rpc') {
        if (response || !Number.isSafeInteger(message.id) || message.id < 1 || rpcIDs.has(message.id) || rpcIDs.size) { stop(failure('invalid')); return; }
        rpcIDs.add(message.id);
        void (async () => {
          try {
            if (message.method === 'onRequest') {
              const url = message.payload?.url;
              const expected = source === 'modelsdev' ? /^https:\/\/models\.dev\/catalog\.json\?type=all$/ :
                /^https:\/\/artificialanalysis\.ai\/api\/v2\/language\/models\/free\?page=[1-9]\d{0,4}$/;
              if (message.payload?.source !== source || typeof url !== 'string' || !expected.test(url)) throw failure('invalid');
              await onRequest({ source, url, signal });
            } else if (message.method === 'onQuota') await onQuota(quota(message.payload));
            else if (message.method === 'onProgress') await onProgress(progress(message.payload));
            else throw failure('invalid');
            if (!stopping && !exited && !settled) worker.postMessage({ type: 'ack', id: message.id, ok: true });
          } catch (error) {
            if (!stopping && !exited && !settled) {
              try { worker.postMessage({ type: 'ack', id: message.id, ok: false, error: serializeModelDataWorkerError(error, source) }); }
              catch { stop(failure('worker')); }
            }
          } finally { rpcIDs.delete(message.id); }
        })();
      } else if (message?.type === 'result' && !response && !rpcIDs.size) {
        try { response = { value: receipt(message.receipt, source) }; }
        catch (error) { stop(error); return; }
      } else if (message?.type === 'error' && !response && !rpcIDs.size) {
        try { response = { error: deserializeModelDataWorkerError(message.error, source) }; }
        catch { stop(failure('invalid')); }
      } else stop(failure('invalid'));
    });
    worker.on('error', () => stop(failure('worker')));
    worker.once('exit', code => {
      exited = true; cleanup(); exitResolve();
      if (stopping) finish(stopping);
      else if (response?.error) finish(response.error);
      else if (response?.value && code === 0) finish(null, response.value);
      else finish(failure('worker'));
    });
    if (signal?.aborted) aborted();
  });
}
