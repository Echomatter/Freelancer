import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DatabaseSync, constants: SQLITE } = require('node:sqlite');
const allowedFunctions = new Set([
  'abs', 'avg', 'coalesce', 'count', 'date', 'datetime', 'hex', 'ifnull', 'instr',
  'json', 'json_array', 'json_each', 'json_extract', 'json_type', 'json_valid', 'length', 'like',
    'glob', 'lower', 'max', 'min', 'nullif', 'printf', 'round', 'substr', 'sum', 'time',
  'total', 'trim', 'typeof', 'unicode', 'upper',
]);

const jsonValue = value => typeof value === 'bigint' ? value.toString() :
  value instanceof Uint8Array ? Buffer.from(value).toString('base64') : value;
const serializedBytes = value => Buffer.byteLength(JSON.stringify(value, (_key, item) => jsonValue(item)));

process.once('message', workerData => {
  let reader;
  let response;
  try {
    const started = Date.now();
    const deadline = started + workerData.timeoutMs;
    reader = new DatabaseSync(workerData.filename, { readOnly: true });
    reader.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=10000;');
    const allowed = new Set([SQLITE.SQLITE_SELECT, SQLITE.SQLITE_READ, SQLITE.SQLITE_RECURSIVE, SQLITE.SQLITE_FUNCTION]);
    reader.setAuthorizer((action, arg1, arg2) => {
      // FTS5 virtual tables consult this read-only pragma internally while
      // resolving their shadow content tables; raw PRAGMA SQL is rejected in
      // the public validator before the query reaches SQLite.
      if (action === SQLITE.SQLITE_PRAGMA && String(arg1).toLowerCase() === 'data_version') return SQLITE.SQLITE_OK;
      if (!allowed.has(action)) return SQLITE.SQLITE_DENY;
      if (action === SQLITE.SQLITE_FUNCTION && !allowedFunctions.has(String(arg2 ?? arg1 ?? '').toLowerCase()))
        return SQLITE.SQLITE_DENY;
      return SQLITE.SQLITE_OK;
    });
    const query = reader.prepare(workerData.sql);
    const columns = query.columns().map(column => column.name);
    if (!columns.length) throw Error('Query did not return a result set.');
    const rows = [];
    let bytes = serializedBytes(columns), partial = false, truncated = false;
    if (bytes > workerData.maxBytes) throw Error('Analytics column metadata exceeds the result byte limit.');
    for (const row of query.iterate(workerData.params)) {
      if (Date.now() >= deadline) { partial = true; truncated = true; break; }
      const value = Object.fromEntries(Object.entries(row).map(([key, item]) => [key, jsonValue(item)]));
      const rowBytes = serializedBytes(value);
      if (rows.length >= workerData.maxRows || bytes + rowBytes > workerData.maxBytes) { truncated = true; break; }
      rows.push(value);
      bytes += rowBytes;
    }
    response = { result: { columns, rows, partial, truncated, bytes, elapsedMs: Date.now() - started } };
  } catch (error) {
    response = { error: { message: error?.message ?? String(error), name: error?.name, code: error?.code, errcode: error?.errcode } };
  } finally {
    try { reader?.close(); } catch { /* the worker is exiting */ }
  }
  if (process.connected) process.send(response, () => process.exit(0));
  else process.exit(0);
});
