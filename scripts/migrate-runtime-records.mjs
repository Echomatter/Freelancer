import path from 'node:path';
import { createLocalDataStore } from '../server/data/store.mjs';
import { resolveRuntimeConfig } from '../server/runtime-config.mjs';
import { withRuntimeMaintenanceLock } from '../server/runtime-maintenance.mjs';
import { recordDatabasePath } from '../backend/tools/runtime/record-database.mjs';

const args = process.argv.slice(2);
const operation = args.shift();
const runtimeID = value => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value ?? '');
const samePath = (left,right) => process.platform === 'win32'
  ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
  : path.resolve(left) === path.resolve(right);
const quiesced = process.env.FREELANCER_MIGRATION_QUIESCED === '1';

async function withStore(runtimeRoot, action) {
  if (!quiesced) throw Error('Set FREELANCER_MIGRATION_QUIESCED=1 only after stopping Freelancer, OpenCode plugins, and runtime helpers.');
  return withRuntimeMaintenanceLock(runtimeRoot, async () => {
    const store = createLocalDataStore(resolveRuntimeConfig().dataRoot);
    try { return await action(store); }
    finally { store.close(); }
  });
}

if (operation === 'runtime-records' && args.length === 6 && args[0] === '--source' && args[2] === '--runtime-root' && args[4] === '--runtime-id' &&
    path.isAbsolute(args[1]) && path.isAbsolute(args[3]) && runtimeID(args[5])) {
  if (!samePath(args[1],recordDatabasePath(args[3])))
    throw Error('The records database source must be the runtime-root .state/webpage/records.sqlite file.');
  const result = await withStore(args[3], store => store.migrateRuntimeRecords(args[1], { quiesced:true, runtimeID:args[5] }));
  console.log(JSON.stringify(result,null,2));
} else if (operation === 'legacy-pins' && args.length >= 2 && args[0] === '--runtime-root' && path.isAbsolute(args[1]) &&
    (args.length === 2 || args.length === 4 && args[2] === '--batch-size' && /^\d+$/.test(args[3]))) {
  const result = await withStore(args[1], store => store.migrateLegacyPins(args.length === 4 ? Number(args[3]) : 250));
  console.log(JSON.stringify(result,null,2));
} else if (operation === 'runtime-state-files' && args.length === 4 && args[0] === '--root' && args[2] === '--runtime-id' &&
    path.isAbsolute(args[1]) && runtimeID(args[3])) {
  const result = await withStore(args[1], store => store.migrateRuntimeStateFiles(args[1], { quiesced:true, runtimeID:args[3] }));
  console.log(JSON.stringify(result,null,2));
} else {
  console.error('Usage: node scripts/migrate-runtime-records.mjs runtime-records --source <runtime-root/.state/webpage/records.sqlite> --runtime-root <absolute-runtime-root> --runtime-id <stable-id>');
  console.error('   or: node scripts/migrate-runtime-records.mjs legacy-pins --runtime-root <absolute-runtime-root> [--batch-size 250]');
  console.error('   or: node scripts/migrate-runtime-records.mjs runtime-state-files --root <absolute-runtime-root> --runtime-id <registered-id>');
  process.exitCode = 2;
}
