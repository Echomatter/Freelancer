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
import { createLocalDataStore } from '../server/data/store.mjs';
import { withUnifiedTransaction } from '../backend/tools/runtime/unified-database.mjs';
import { recordModelInput, modelInputEvidence } from '../backend/tools/runtime/input-observations.mjs';

test('fresh unified runtime accepts new session input without per-session migration', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-session-input-'));
  const backendRoot = path.join(root, 'backend'), dataHome = path.join(root, 'data');
  const runtimeID = 'session-input-fixture';
  const store = createLocalDataStore(dataHome);
  store.initializeFreshRuntime(runtimeID);
  const keys = ['FREELANCER_RUNTIME_DATA_MODE', 'FREELANCER_RUNTIME_ID', 'FREELANCER_DATA_HOME'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { FREELANCER_RUNTIME_DATA_MODE:'unified', FREELANCER_RUNTIME_ID:runtimeID, FREELANCER_DATA_HOME:dataHome });
  t.after(async () => {
    for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    store.close();
    await rm(root, { recursive:true, force:true });
  });
  const sessionID = 'ses_first', id = 'msg_first';
  const filename = path.join(backendRoot, '.state/model-input', sessionID, `${id}.json`);
  await mkdir(path.dirname(filename), { recursive:true });
  await writeFile(filename, '{"messageIDs":["stale-legacy-input"]}');
  assert.equal(readState(filename, null), null, 'fresh SQLite reads never import stale JSON');
  assert.deepEqual(stateFiles(path.dirname(filename)), []);
  await recordModelInput(backendRoot, [{ info:{ role:'user', sessionID, id } }]);
  assert.deepEqual(readState(filename).messageIDs, [id]);
  await recordModelInput(backendRoot, [
    { info:{ role:'user', sessionID, id:'msg_earlier' } },
    { info:{ role:'user', sessionID, id } },
  ]);
  assert.deepEqual(readState(filename).messageIDs, [id, 'msg_earlier']);
  assert.deepEqual(stateFiles(path.dirname(filename)), [`${id}.json`]);
  const evidence = await modelInputEvidence(backendRoot, sessionID, [
    { info:{ role:'assistant', parentID:id, time:{ completed:1 } }, parts:[] },
  ]);
  assert.equal(evidence[0].boundaryID, id);
  assert.equal(await readFile(filename, 'utf8'), '{"messageIDs":["stale-legacy-input"]}');
  const secondFile = path.join(backendRoot, '.state/model-input/ses_second/msg_second.json');
  await recordModelInput(backendRoot, [{ info:{ role:'user', sessionID:'ses_second', id:'msg_second' } }]);
  assert.deepEqual(readState(secondFile).messageIDs, ['msg_second']);
  await assert.rejects(readFile(secondFile), { code:'ENOENT' });
  removeState(secondFile);
  assert.equal(readState(secondFile, null), null);
  assert.throws(() => readState(path.join(backendRoot, '.state/unregistered/ses_new/msg_new.json')), /no migration marker/);
  withUnifiedTransaction({ dataHome, runtimeID }, (db, owner) => {
    db.prepare("DELETE FROM runtime_collection_markers WHERE runtime_id=? AND collection_name='directory:model-input/'").run(owner);
  });
  assert.throws(() => readState(path.join(backendRoot, '.state/model-input/ses_new/msg_new.json')), /no migration marker/);
  assert.throws(() => stateFiles(path.join(backendRoot, '.state/model-input/ses_new')), /no migration marker/);
});

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
