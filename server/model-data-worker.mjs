import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { createLocalDataStore } from './data/store.mjs';
import { fetchModelDataSource } from './model-data-sources.mjs';
import { scopeModelDataSnapshot } from '../domain/model-data.mjs';
import { serializeModelDataWorkerError, deserializeModelDataWorkerError } from './model-data-worker-client.mjs';

/** Injectable source/store entry for isolated fixtures; the production entry uses only official adapters. */
export async function runModelDataWorkerEntry({ data = workerData, port = parentPort,
  fetchSource = fetchModelDataSource, openStore = createLocalDataStore } = {}) {
  const controller = new AbortController(), pending = new Map(); let sequence = 0, db;
  function receive(message) {
    if (message?.type === 'abort') {
      controller.abort();
      for (const { reject } of pending.values()) reject(Object.assign(Error('Canceled.'), { name: 'AbortError' }));
      pending.clear();
    } else if (message?.type === 'ack') {
      const call = pending.get(message.id); if (!call) return;
      pending.delete(message.id);
      if (message.ok === true) call.resolve();
      else call.reject(deserializeModelDataWorkerError(message.error, data.source));
    }
  }
  port.on('message', receive);
  const rpc = (method, payload) => {
    controller.signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const id = ++sequence; pending.set(id, { resolve, reject });
      try { port.postMessage({ type: 'rpc', id, method, payload }); }
      catch (error) { pending.delete(id); reject(error); }
    });
  };
  try {
    // Never initialize an incidental database. The main service owns registration and migrations.
    const stat = await lstat(data.filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) throw Error('Missing registered local database.');
    const readOnly = openStore(path.dirname(data.filename), { readOnly: true });
    try { if (path.resolve(readOnly.info().filename) !== path.resolve(data.filename)) throw Error('Unexpected local database path.'); }
    finally { readOnly.close(); }
    controller.signal.throwIfAborted();
    db = openStore(path.dirname(data.filename));
    await rpc('onProgress', { stage: 'fetching' });
    const received = await fetchSource(data.source, { apiKey: data.apiKey, signal: controller.signal,
      onRequest: request => rpc('onRequest', { source: request.source, url: request.url }) });
    controller.signal.throwIfAborted();
    const snapshot = scopeModelDataSnapshot(received, data.nativeModels);
    const counts = { recordCount: snapshot.records.length,
      factCount: snapshot.records.reduce((count, record) => count + record.facts.length, 0) };
    await rpc('onProgress', { stage: 'normalized', ...counts });
    await rpc('onQuota', snapshot.quota ?? null);
    controller.signal.throwIfAborted();
    await rpc('onProgress', { stage: 'publishing-preparation', ...counts });
    const receipt = await db.modelDataPublishStaged(snapshot, { jobID: data.jobID, signal: controller.signal,
      onProgress: value => rpc('onProgress', value) });
    // Pointer publication may have just committed when cancellation arrives; the parent reconciles durable state.
    port.postMessage({ type: 'result', receipt: { ...receipt,
      receivedRecordCount: snapshot.sourceMetadata?.scope?.receivedRecordCount,
      matchedNativeModelCount: snapshot.sourceMetadata?.scope?.matchedNativeModelCount } });
  } catch (error) {
    port.postMessage({ type: 'error', error: serializeModelDataWorkerError(error, data?.source) });
  } finally {
    db?.close();
    port.removeListener('message', receive);
    port.close();
  }
}

if (!isMainThread && parentPort && workerData?.entryURL === import.meta.url) {
  await runModelDataWorkerEntry();
}
