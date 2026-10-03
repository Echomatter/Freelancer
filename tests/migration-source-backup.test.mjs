import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { backupRuntimeMigrationSources, restoreRuntimeMigrationSources, validateRuntimeMigrationSourceBackup } from '../server/data/migration-source-backup.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-source-backup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = path.join(root, 'runtime'), state = path.join(runtime, '.state');
  await import('node:fs/promises').then(fs => fs.mkdir(path.join(state, 'webpage'), { recursive: true }));
  const db = new DatabaseSync(path.join(state, 'webpage', 'records.sqlite'));
  db.exec(`CREATE TABLE collections (name TEXT PRIMARY KEY);
    CREATE TABLE records (collection TEXT NOT NULL,id TEXT NOT NULL,project_id TEXT,session_id TEXT,data TEXT NOT NULL,summary TEXT NOT NULL,PRIMARY KEY(collection,id));
    INSERT INTO collections VALUES ('requests'),('document:goals.json');
    INSERT INTO records VALUES ('requests','r1','p1','s1','{"status":"uncertain"}','{}');
    PRAGMA application_id=1179796804; PRAGMA user_version=1;`);
  db.close();
  await writeFile(path.join(state, 'goals.json'), JSON.stringify({ goals: [] }));
  await writeFile(path.join(state, 'storage-runtime.json'), JSON.stringify({ dataRoot: 'private-path' }));
  await writeFile(path.join(state, 'webpage', 'launch.json'), JSON.stringify({ token: 'must-not-be-backed-up' }));
  await writeFile(path.join(state, 'notes.txt'), 'not a registered migration input');
  return { root, runtime, state };
}

test('verified migration-source backup captures legacy SQLite and JSON inputs, excluding live pointers', async t => {
  const { root, runtime, state } = await fixture(t);
  const destination = path.join(root, 'sources');
  await assert.rejects(backupRuntimeMigrationSources(runtime, destination), /Stop Freelancer/);
  const result = await backupRuntimeMigrationSources(runtime, destination, { quiesced: true });
  assert.equal(result.status, 'verified');
  assert.deepEqual(result.manifest.legacyDatabase, { applicationID: 1179796804, schemaVersion: 1, collections: 2, records: 1 });
  const keys = result.manifest.files.map(file => file.key).sort();
  assert.deepEqual(keys, ['.state/goals.json', '.state/webpage/records.sqlite']);
  assert.ok(result.manifest.excluded.some(row => row.key === '.state/storage-runtime.json'));
  assert.ok(result.manifest.excluded.some(row => row.key === '.state/webpage/launch.json'));
  assert.ok(result.manifest.skipped.some(row => row.key === '.state/notes.txt'));
  assert.equal(await readFile(path.join(state, 'goals.json'), 'utf8'), JSON.stringify({ goals: [] }));
  assert.equal((await readFile(path.join(state, 'webpage', 'records.sqlite'))).subarray(0, 15).toString(), 'SQLite format 3');
  const restored = await restoreRuntimeMigrationSources(destination, path.join(root, 'restored-runtime'), { quiesced: true });
  assert.equal(restored.status, 'verified');
  assert.equal(restored.restoredFiles, 2);
  assert.equal(await readFile(path.join(root, 'restored-runtime', '.state', 'goals.json'), 'utf8'), JSON.stringify({ goals: [] }));
  assert.equal((await readFile(path.join(root, 'restored-runtime', '.state', 'webpage', 'records.sqlite'))).subarray(0, 15).toString(), 'SQLite format 3');
  await assert.rejects(readFile(path.join(root, 'restored-runtime', '.state', 'storage-runtime.json')));
  await assert.rejects(readFile(path.join(root, 'restored-runtime', '.state', 'webpage', 'launch.json')));
});

test('migration-source backup rejects invalid JSON and tampered bundle payloads', async t => {
  const { root, runtime, state } = await fixture(t);
  const badState = path.join(state, 'broken.json');
  await writeFile(badState, '{not json');
  await assert.rejects(backupRuntimeMigrationSources(runtime, path.join(root, 'invalid'), { quiesced: true }), /Invalid migration-source JSON/);
  await rm(badState);
  const destination = path.join(root, 'verified');
  await backupRuntimeMigrationSources(runtime, destination, { quiesced: true });
  await writeFile(path.join(destination, 'payload', '.state', 'goals.json'), '{"goals":["changed"]}');
  await assert.rejects(validateRuntimeMigrationSourceBackup(destination), /SHA-256 verification/);
});

test('migration-source CLI acquires the runtime lock and requires explicit quiescence', async t => {
  const { root, runtime } = await fixture(t);
  const cli = fileURLToPath(new URL('../scripts/local-data-backup.mjs', import.meta.url));
  const output = path.join(root, 'cli-bundle');
  const env = { ...process.env };
  delete env.FREELANCER_MIGRATION_QUIESCED;
  const stopped = spawnSync(process.execPath, [cli, 'migration-sources', '--runtime-root', runtime, '--output', output], { encoding: 'utf8', env });
  assert.notEqual(stopped.status, 0);
  assert.match(stopped.stderr, /Stop Freelancer/);
  const quiesced = spawnSync(process.execPath, [cli, 'migration-sources', '--runtime-root', runtime, '--output', output], {
    encoding: 'utf8', env: { ...env, FREELANCER_MIGRATION_QUIESCED: '1' },
  });
  assert.equal(quiesced.status, 0, quiesced.stderr);
  assert.equal(JSON.parse(quiesced.stdout).status, 'verified');
  assert.ok(JSON.parse(quiesced.stdout).manifest.skipped.some(row => row.key === '.state/webpage/application.lock'));
  const restored = path.join(root, 'cli-restored-runtime');
  const restore = spawnSync(process.execPath, [cli, 'restore-sources', '--bundle', output, '--to', restored], {
    encoding: 'utf8', env: { ...env, FREELANCER_MIGRATION_QUIESCED: '1' },
  });
  assert.equal(restore.status, 0, restore.stderr);
  assert.equal(JSON.parse(restore.stdout).status, 'verified');
});
