import { createLocalDataStore } from '../../server/data/store.mjs';

const [directory, operation, serialized] = process.argv.slice(2);
const allowed = new Set(['createEntity', 'addClaim', 'correctClaim', 'addRelation', 'reviseRelation', 'reviseMemory']);
if (!allowed.has(operation)) throw Error('Unsupported fixture operation.');
const store = createLocalDataStore(directory);
try {
  const value = store[operation](JSON.parse(serialized));
  console.log(JSON.stringify({ ok:true, value }));
} catch (error) {
  console.log(JSON.stringify({ ok:false, message:error.message, status:error.status ?? null, code:error.code ?? null }));
} finally { store.close(); }
