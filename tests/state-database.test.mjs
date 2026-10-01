import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { snapshot as quotaSnapshot } from '../backend/tools/runtime/quota.mjs';
import { readState, writeState, updateState, removeState, stateFiles } from '../backend/tools/runtime/state-database.mjs';
import { recordDatabasePath, withRecordDatabase } from '../backend/tools/runtime/record-database.mjs';

test('runtime documents migrate once, survive restarts and never fall back to stale JSON', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-database-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const key of ['webpage/goals', 'webpage/settings', 'webpage/sender-outbox', 'webpage/schedules', 'delegation/receipt', 'preferences/project', 'model-input/session/boundary', 'quota-state', 'remote-access']) {
    const file = path.join(root, '.state', key + '.json');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '{"revision":1}');
    assert.equal(readState(file).revision, 1);
    updateState(file, row => ({ ...row, revision: 2 }));
    assert.equal(await readFile(file, 'utf8'), '{"revision":1}');
    await writeFile(file, '{stale');
    assert.equal(readState(file).revision, 2);
    removeState(file);
    assert.equal(readState(file), undefined);
  }
  const directory = path.join(root, '.state/delegation');
  writeState(path.join(directory, 'new.json'), { worker: 'one' });
  assert.deepEqual(stateFiles(directory), ['new.json']);
  await writeFile(recordDatabasePath(root), 'broken database');
  assert.throws(() => readState(path.join(directory, 'new.json')));
});

test('a failed state mutation rolls back without a phantom migration marker', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-db-rollback-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, '.state/webpage/settings.json');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, '{"revision":3}');
  assert.throws(() => updateState(file, () => { throw Error('invalid settings'); }), /invalid settings/);
  withRecordDatabase(root, false, db => assert.equal(db.prepare('SELECT count(*) n FROM collections').get().n, 0));
  assert.equal(readState(file).revision, 3);
});

test('Windows PowerShell preserves Unicode through the database bridge', { skip: process.platform !== 'win32' }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-ps-database-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, '.state/document.json');
  const bridge = fileURLToPath(new URL('../backend/scripts/state-database.ps1', import.meta.url));
  const quote = text => "'" + text.replaceAll("'", "''") + "'";
  const script = `. ${quote(bridge)}; $value = [string][char]233 + [char]0x4e2d; Write-FreelancerState ${quote(file)} (@{ value = $value } | ConvertTo-Json); if ((Read-FreelancerState ${quote(file)}).value -ne $value) { throw 'Unicode mismatch' }`;
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true });
  assert.equal(readState(file).value, 'é中');
  await assert.rejects(readFile(file), { code: 'ENOENT' });
});

test('native authentication remains native even when its configured path contains .state', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-native-auth-'));
  const previous = process.env.XDG_DATA_HOME;
  t.after(async () => { if (previous === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = previous; await rm(root, { recursive: true, force: true }); });
  process.env.XDG_DATA_HOME = path.join(root, '.state/native-data');
  const file = path.join(process.env.XDG_DATA_HOME, 'opencode/auth.json');
  await mkdir(path.dirname(file), { recursive: true });
  const original = '{"openai":{"type":"oauth","access":"disposable-fixture"}}';
  await writeFile(file, original);
  await quotaSnapshot(root);
  assert.equal(await readFile(file, 'utf8'), original);
  withRecordDatabase(root, false, db => assert.equal(db.prepare("SELECT count(*) n FROM records WHERE id LIKE '%auth%' OR data LIKE '%disposable-fixture%'").get().n, 0));
});
