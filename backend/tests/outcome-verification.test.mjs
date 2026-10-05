import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createLocalDataStore } from '../../server/data/store.mjs';
import { FRESH_RUNTIME_ID } from '../../server/runtime-config.mjs';

const recorder = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/record-task-outcome.ps1');
const runtimeRoot = (root) => path.join(root, 'backend');
const dataHome = (root) => path.join(root, 'workspace-v2');

function record(root, args) {
  const env = { ...process.env, FREELANCER_DATA_HOME: dataHome(root) };
  for (const name of ['FREELANCER_RUNTIME_ROOT','FREELANCER_RUNTIME_ID','FREELANCER_RUNTIME_DATA_MODE','FREELANCER_APP_ROOT']) delete env[name];
  const result = spawnSync('powershell.exe', ['-NoProfile', '-File', recorder, '-ToolkitRoot', runtimeRoot(root), ...args], { encoding: 'utf8', timeout: 30000, env });
  assert.ifError(result.error);
  return result;
}

function seedHistory(root) {
  const db = new DatabaseSync(path.join(dataHome(root), 'freelancer.sqlite'));
  try { db.prepare('INSERT INTO application_documents(runtime_id,document_key,data) VALUES(?,?,?)').run(FRESH_RUNTIME_ID, 'task-history.json', JSON.stringify({ generated: true, generated_at: '', entries: [] })); }
  finally { db.close(); }
}

function history(root) {
  const db = new DatabaseSync(path.join(dataHome(root), 'freelancer.sqlite'), { readOnly: true });
  try { const row = db.prepare('SELECT data FROM application_documents WHERE runtime_id=? AND document_key=?').get(FRESH_RUNTIME_ID, 'task-history.json'); return row ? JSON.parse(row.data) : null; }
  finally { db.close(); }
}

function entries(root) {
  return history(root)?.entries ?? [];
}

function snapshot(root) {
  return JSON.stringify(history(root));
}

async function withRoot(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'outcome-verify-'));
  try {
    await mkdir(runtimeRoot(root), { recursive: true });
    const store = createLocalDataStore(dataHome(root));
    try { store.initializeFreshRuntime(FRESH_RUNTIME_ID); } finally { store.close(); }
    await fn(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('six VerificationStatus states map to tests_passed', { skip: process.platform !== 'win32' && 'Windows PowerShell 5.1 recorder' }, async () => {
  await withRoot(async (root) => {
    seedHistory(root);
    const cases = [
      { status: 'passed', success: 'true', testsPassed: true },
      { status: 'failed', success: 'false', testsPassed: false },
      { status: 'skipped', success: 'true', testsPassed: null },
      { status: 'unavailable', success: 'false', testsPassed: null },
      { status: 'not-run', success: 'false', testsPassed: null },
      { status: 'unverified', success: 'true', testsPassed: null },
    ];
    for (const [index, item] of cases.entries()) {
      const id = `verify-${index}-${item.status}`;
      const done = record(root, ['-TaskId', id, '-Repo', 'fixture', '-TaskType', 'bounded_feature', '-Model', 'opencode-go/b', '-Success', item.success, '-VerificationStatus', item.status]);
      assert.equal(done.status, 0, `${item.status} records (stderr: ${done.stderr})`);
    }
    const found = entries(root);
    assert.equal(found.length, 6);
    for (const item of cases) {
      const entry = found.find((row) => row.task_id === `verify-${cases.indexOf(item)}-${item.status}`);
      assert.equal(entry.verification_status, item.status);
      assert.equal(entry.tests_passed, item.testsPassed);
    }
  });
});

test('legacy TestsPassed true/false maps to passed/failed', { skip: process.platform !== 'win32' && 'Windows PowerShell 5.1 recorder' }, async () => {
  await withRoot(async (root) => {
    seedHistory(root);
    const ok = record(root, ['-TaskId', 'legacy-true', '-Repo', 'fixture', '-TaskType', 'bounded_feature', '-Model', 'opencode-go/b', '-Success', 'true', '-TestsPassed', 'true']);
    assert.equal(ok.status, 0, `legacy true records (stderr: ${ok.stderr})`);
    const bad = record(root, ['-TaskId', 'legacy-false', '-Repo', 'fixture', '-TaskType', 'bounded_feature', '-Model', 'opencode-go/b', '-Success', 'false', '-TestsPassed', 'false']);
    assert.equal(bad.status, 0, `legacy false records (stderr: ${bad.stderr})`);
    const found = entries(root);
    const yes = found.find((row) => row.task_id === 'legacy-true');
    const no = found.find((row) => row.task_id === 'legacy-false');
    assert.equal(yes.verification_status, 'passed');
    assert.equal(yes.tests_passed, true);
    assert.equal(no.verification_status, 'failed');
    assert.equal(no.tests_passed, false);
  });
});

test('invalid boolean and contradictory inputs are rejected without mutation', { skip: process.platform !== 'win32' && 'Windows PowerShell 5.1 recorder' }, async () => {
  await withRoot(async (root) => {
    seedHistory(root);
    const seed = record(root, ['-TaskId', 'stable-id', '-Repo', 'fixture', '-TaskType', 'bounded_feature', '-Model', 'opencode-go/b', '-Success', 'true', '-VerificationStatus', 'passed']);
    assert.equal(seed.status, 0, `seed records (stderr: ${seed.stderr})`);
    const before = snapshot(root);
    const invalid = record(root, ['-TaskId', 'stable-id', '-Repo', 'fixture', '-TaskType', 'bounded_feature', '-Model', 'opencode-go/b', '-Success', 'maybe', '-VerificationStatus', 'passed']);
    assert.notEqual(invalid.status, 0, 'unknown boolean string is rejected');
    assert.equal(snapshot(root), before, 'invalid boolean preserves history');
    const unknownTests = record(root, ['-TaskId', 'stable-id', '-TaskType', 'bounded_feature', '-Success', 'true', '-TestsPassed', 'not-run']);
    assert.notEqual(unknownTests.status, 0, 'a nonboolean test result cannot silently become a failed check');
    assert.equal(snapshot(root), before, 'unknown legacy test result preserves history');
    const contradictions = [
      ['-TestsPassed', 'true', '-VerificationStatus', 'failed'],
      ['-TestsPassed', 'false', '-VerificationStatus', 'passed'],
      ['-TestsPassed', 'true', '-VerificationStatus', 'skipped'],
    ];
    for (const extra of contradictions) {
      const attempt = record(root, ['-TaskId', 'stable-id', '-Repo', 'fixture', '-TaskType', 'bounded_feature', '-Model', 'opencode-go/b', '-Success', 'true', ...extra]);
      assert.notEqual(attempt.status, 0, `${extra.join(' ')} is rejected`);
      assert.equal(snapshot(root), before, `${extra.join(' ')} preserves history`);
    }
  });
});

test('failed operational receipt records not-run with null tests', { skip: process.platform !== 'win32' && 'Windows PowerShell 5.1 recorder' }, async () => {
  await withRoot(async (root) => {
    seedHistory(root);
    const id = 'f'.repeat(64);
    const db = new DatabaseSync(path.join(dataHome(root), 'freelancer.sqlite'));
    try {
      db.prepare('INSERT INTO application_documents(runtime_id,document_key,data) VALUES(?,?,?)').run(FRESH_RUNTIME_ID, `delegation/${id}.json`, JSON.stringify({
      task_id: id, role: 'worker', status: 'failed',
      attempts: [{ status: 'failed', failure: 'timeout', selected_model: 'opencode/free', observed_model: 'opencode/free', surface: 'opencode-free', usage: { input: 25, output: 2 } }],
      }));
      db.prepare('INSERT INTO runtime_collection_markers(runtime_id,collection_name) VALUES(?,?)').run(FRESH_RUNTIME_ID, `document:delegation/${id}.json`);
    } finally { db.close(); }
    const done = record(root, ['-TaskId', id, '-Repo', 'fixture', '-TaskType', 'bounded_feature', '-Model', 'opencode/free', '-Success', 'false', '-TestsPassed', 'false', '-Operational']);
    assert.equal(done.status, 0, `operational failure records (stderr: ${done.stderr})`);
    const entry = entries(root).find((row) => row.task_id === id);
    assert.equal(entry.verification_status, 'not-run');
    assert.equal(entry.tests_passed, null);
    assert.equal(entry.success, false);
    assert.equal(entry.observation_kind, 'operational');
    const before = snapshot(root);
    const claimed = record(root, ['-TaskId', id, '-Repo', 'fixture', '-TaskType', 'bounded_feature', '-Model', 'opencode/free', '-Success', 'false', '-Operational', '-VerificationStatus', 'passed']);
    assert.notEqual(claimed.status, 0, 'operational run cannot claim passed verification');
    assert.equal(snapshot(root), before, 'rejected operational claim preserves history');
    const failedClaim = record(root, ['-TaskId', id, '-TaskType', 'bounded_feature', '-Success', 'false', '-Operational', '-VerificationStatus', 'failed']);
    assert.notEqual(failedClaim.status, 0, 'an execution failure is not evidence of failed verification');
    assert.equal(snapshot(root), before);
    const contradictory = record(root, ['-TaskId', id, '-TaskType', 'bounded_feature', '-Success', 'false', '-Operational', '-TestsPassed', 'false', '-VerificationStatus', 'skipped']);
    assert.notEqual(contradictory.status, 0, 'an explicit operational state cannot conflict with the legacy boolean');
    assert.equal(snapshot(root), before);
  });
});

test('revision retains prior validation state', { skip: process.platform !== 'win32' && 'Windows PowerShell 5.1 recorder' }, async () => {
  await withRoot(async (root) => {
    seedHistory(root);
    const first = record(root, ['-TaskId', 'rev-id', '-Repo', 'fixture', '-TaskType', 'bounded_feature', '-Model', 'opencode-go/b', '-Success', 'true', '-VerificationStatus', 'passed']);
    assert.equal(first.status, 0, `first observation records (stderr: ${first.stderr})`);
    const second = record(root, ['-TaskId', 'rev-id', '-Repo', 'fixture', '-TaskType', 'bounded_feature', '-Model', 'opencode-go/b', '-Success', 'false', '-VerificationStatus', 'failed']);
    assert.equal(second.status, 0, `correction records (stderr: ${second.stderr})`);
    const found = entries(root).filter((row) => row.task_id === 'rev-id');
    assert.equal(found.length, 1, 'correction is an upsert');
    assert.equal(found[0].success, false);
    assert.equal(found[0].verification_status, 'failed');
    assert.equal(found[0].revisions?.length, 1);
    assert.equal(found[0].revisions[0].previous_success, true);
    assert.equal(found[0].revisions[0].previous_tests_passed, true);
    assert.equal(found[0].revisions[0].previous_verification_status, 'passed');
  });
});
