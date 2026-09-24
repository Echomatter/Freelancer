import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createLocalDataStore } from './store.mjs';

export function maintainLocalData(directory, operation) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { directory, operation },
      execArgv: process.execArgv.filter(arg => !arg.startsWith('--input-type')) });
    let result;
    worker.once('message', value => { result = value; });
    worker.once('error', reject);
    worker.once('exit', code => {
      if (code || !result) reject(Error('SQLite maintenance ended before returning a result.'));
      else resolve(result);
    });
  });
}

if (!isMainThread) {
  const db = createLocalDataStore(workerData.directory);
  try { parentPort.postMessage(db.maintainIndex(workerData.operation)); }
  finally { db.close(); }
}
