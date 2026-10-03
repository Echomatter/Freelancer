import path from 'node:path';
import { resolveDataRoot } from '../server/runtime-config.mjs';
import { backupLocalData, restoreLocalData } from '../server/data/backup.mjs';
import { backupRuntimeMigrationSources, restoreRuntimeMigrationSources } from '../server/data/migration-source-backup.mjs';
import { withRuntimeMaintenanceLock } from '../server/runtime-maintenance.mjs';
import { storagePathContains } from '../shared/local-storage-path.mjs';

const [operation,...args] = process.argv.slice(2);
const quiesced = process.env.FREELANCER_MIGRATION_QUIESCED === '1';
const outsideRuntimeRoot = (runtimeRoot, target) => {
  if (storagePathContains(runtimeRoot,target))
    throw Error('Backup bundle and restore destination must be outside the runtime root.');
};
let result;
if (operation === 'backup' && args.length === 4 && args[0] === '--runtime-root' && args[2] === '--output' &&
    path.isAbsolute(args[1]) && path.isAbsolute(args[3])) {
  outsideRuntimeRoot(args[1],args[3]);
  result = await withRuntimeMaintenanceLock(args[1],() => backupLocalData(resolveDataRoot(),args[3],{quiesced}));
} else if (operation === 'restore' && args.length === 6 && args[0] === '--runtime-root' && args[2] === '--bundle' && args[4] === '--to' &&
    path.isAbsolute(args[1]) && path.isAbsolute(args[3]) && path.isAbsolute(args[5])) {
  outsideRuntimeRoot(args[1],args[3]);
  outsideRuntimeRoot(args[1],args[5]);
  result = await withRuntimeMaintenanceLock(args[1],() => restoreLocalData(args[3],args[5],{quiesced}));
} else if (operation === 'migration-sources' && args.length === 4 && args[0] === '--runtime-root' && args[2] === '--output' &&
    path.isAbsolute(args[1]) && path.isAbsolute(args[3])) {
  outsideRuntimeRoot(args[1],args[3]);
  result = await withRuntimeMaintenanceLock(args[1],() => backupRuntimeMigrationSources(args[1],args[3],{quiesced}));
} else if (operation === 'restore-sources' && args.length === 4 && args[0] === '--bundle' && args[2] === '--to' &&
    path.isAbsolute(args[1]) && path.isAbsolute(args[3])) {
  result = await restoreRuntimeMigrationSources(args[1],args[3],{quiesced});
} else {
  console.error('Usage: node scripts/local-data-backup.mjs backup --runtime-root <absolute-runtime-root> --output <absolute-new-bundle-directory>');
  console.error('   or: node scripts/local-data-backup.mjs restore --runtime-root <absolute-runtime-root> --bundle <absolute-bundle-directory> --to <absolute-new-data-directory>');
  console.error('   or: node scripts/local-data-backup.mjs migration-sources --runtime-root <absolute-runtime-root> --output <absolute-new-bundle-directory>');
  console.error('   or: node scripts/local-data-backup.mjs restore-sources --bundle <absolute-bundle-directory> --to <absolute-new-runtime-root>');
  console.error('Set FREELANCER_MIGRATION_QUIESCED=1 only after stopping Freelancer, OpenCode plugins, and runtime helpers.');
  process.exitCode = 2;
}
if (result) console.log(JSON.stringify(result,null,2));
