import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const safeInteger = (value, fallback, min, max) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback;
};

function validate(sql, params, signal) {
  if (typeof sql !== 'string' || !sql.trim() || sql.length > 20_000)
    throw Error('Provide one bounded read-only SQL query.');
  if (!params || typeof params !== 'object' || Array.isArray(params))
    throw Error('SQL parameters must be a named parameter object.');
  if (signal?.aborted) throw Object.assign(Error('Query cancelled.'), { name: 'AbortError' });
  const statement = sql.trim();
  if (!/^(?:SELECT|WITH)\b/i.test(statement) || /;|--|\/\*/.test(statement) ||
      /\b(?:ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|ANALYZE|CREATE|DROP|ALTER|INSERT|UPDATE|DELETE|REPLACE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|LOAD_EXTENSION)\b/i.test(statement))
    throw Error('Only a single read-only SELECT or CTE query is supported.');
  for (const [key, value] of Object.entries(params)) {
    if (!/^[$:@][A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw Error('SQL parameters must use named SQLite placeholders.');
    if (!(value === null || ['string', 'number', 'bigint', 'boolean'].includes(typeof value) || Buffer.isBuffer(value) || value instanceof Uint8Array))
      throw Error(`SQL parameter ${key} has an unsupported value.`);
  }
  return statement;
}

export function createAnalyticsService(filename) {
  const pending = new Set();
  let closed = false;
  return {
    analyze(sql, params = {}, { signal, timeoutMs = 2000, maxRows = 500, maxBytes = 1_000_000 } = {}) {
      const statement = validate(sql, params, signal);
      if (closed) throw Object.assign(Error('Analytics service is closed.'), { code: 'ERR_SQLITE_ANALYTICS_CLOSED' });
      if (pending.size >= 4) throw Object.assign(Error('Too many local analytics queries are running.'), { code: 'ERR_SQLITE_ANALYTICS_BUSY' });
      const timeout = safeInteger(timeoutMs, 2000, 1, 10_000);
      const worker = fork(fileURLToPath(new URL('./analytics-worker.mjs', import.meta.url)), [], {
        execArgv: [], serialization: 'advanced', stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      const workerData = {
          filename, sql: statement,
          params: Object.fromEntries(Object.entries(params).map(([name,value]) =>
            [name,typeof value === 'boolean' ? Number(value) : value])),
          timeoutMs: timeout,
          maxRows: safeInteger(maxRows, 500, 1, 5000),
          maxBytes: safeInteger(maxBytes, 1_000_000, 1024, 5_000_000),
        };
      return new Promise((resolve, reject) => {
        let settled = false;
        let exited = false;
        let response;
        let terminationError;
        let timer, killTimer, stopTimer;
        const clearWaits = () => {
          clearTimeout(timer);
          clearTimeout(killTimer);
          clearTimeout(stopTimer);
          signal?.removeEventListener('abort', abort);
        };
        const finish = (error, result) => {
          if (settled) return;
          settled = true;
          if (error) reject(error); else resolve(result);
        };
        const kill = signalName => {
          try { worker.kill(signalName); } catch { /* The close/error listeners own settlement. */ }
        };
        const terminate = (error) => {
          if (exited || settled || terminationError) return;
          terminationError = error;
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          // kill() requests termination; SQLite handles are not released until the
          // child exits. Keep the slot and promise pending until close confirms it.
          killTimer = setTimeout(() => kill('SIGKILL'), 250);
          stopTimer = setTimeout(() => {
            kill('SIGKILL');
            finish(Object.assign(Error('Analytics worker did not exit after termination.'), {
              code: 'ERR_SQLITE_ANALYTICS_STOP', cause: terminationError, workerPID: worker.pid,
            }));
            // Retain the pending slot and close listener until the process really
            // exits; an unsuccessful stop must not advertise released resources.
          }, 2000);
          kill('SIGTERM');
        };
        const abort = () => terminate(Object.assign(Error('Query cancelled.'), { name: 'AbortError' }));
        const cancelForClose = () => {
          if (terminationError && !exited) kill('SIGKILL');
          else terminate(Object.assign(Error('Analytics service is closed.'), { code: 'ERR_SQLITE_ANALYTICS_CLOSED' }));
        };
        timer = setTimeout(() => terminate(Object.assign(Error('Analytics query exceeded its execution time limit.'), {
          code: 'ERR_SQLITE_ANALYTICS_TIMEOUT',
        })), timeout);
        pending.add(cancelForClose);
        signal?.addEventListener('abort', abort, { once: true });
        worker.on('message', message => {
          if (terminationError || settled || response) return;
          if (message?.error) {
            const error = Object.assign(Error(message.error.message), {
              name: message.error.name || 'Error', code: message.error.code,
              errcode: message.error.errcode,
            });
            response = { error };
          } else response = { result: message?.result };
          clearTimeout(timer);
          timer = setTimeout(() => terminate(Object.assign(Error('Analytics worker did not exit after returning its result.'), {
            code: 'ERR_SQLITE_ANALYTICS_WORKER',
          })), 1000);
        });
        worker.on('error', error => {
          if (exited || settled) return;
          if (worker.pid) terminate(error);
          else {
            clearWaits();
            pending.delete(cancelForClose);
            finish(error);
          }
        });
        worker.once('close', (code, signalName) => {
          exited = true;
          clearWaits();
          pending.delete(cancelForClose);
          if (terminationError) finish(terminationError);
          else if (response) finish(response.error, response.result);
          else finish(Object.assign(Error(`Analytics worker exited without a result (code ${code}, signal ${signalName ?? 'none'}).`), {
            code: 'ERR_SQLITE_ANALYTICS_WORKER',
          }));
        });
        worker.send(workerData, error => { if (error) terminate(error); });
        if (signal?.aborted) abort();
      });
    },
    close() {
      closed = true;
      for (const cancel of [...pending]) cancel();
    },
  };
}
