import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseContractArguments, planContractBatches, runContractBatches } from '../scripts/test-contracts.mjs';

const selected = [
  'backend/tests/compatibility.test.mjs',
  'backend/tests/outcome-verification.test.mjs',
  'tests/analytics.test.mjs',
  'tests/git-project-http.test.mjs',
  'tests/git-project.test.mjs',
  'tests/query-responsiveness.test.mjs',
];

test('all selected contracts run exactly once with isolated Git and Windows recorder batches', () => {
  const batches = planContractBatches(selected, { platform: 'win32' });
  assert.deepEqual(batches, [
    { name: 'regular', files: [selected[0], selected[2], selected[5]], concurrency: 4 },
    { name: 'real Git', files: [selected[3], selected[4]], concurrency: 2 },
    { name: 'Windows recorder', files: [selected[1]], concurrency: 1 },
  ]);
  const planned = batches.flatMap(batch => batch.files);
  assert.equal(new Set(planned).size, selected.length);
  assert.deepEqual(planned.toSorted(), selected.toSorted());
});

test('non-Windows selection keeps recorder with regular contracts and still isolates Git', () => {
  const batches = planContractBatches(selected, { platform: 'linux' });
  assert.deepEqual(batches.map(batch => [batch.name, batch.concurrency]), [['regular', 4], ['real Git', 2]]);
  assert.deepEqual(batches[0].files, [selected[0], selected[1], selected[2], selected[5]]);
  assert.deepEqual(batches.flatMap(batch => batch.files).toSorted(), selected.toSorted());
});

test('filtered selections produce only their populated batches, including native path separators', () => {
  assert.deepEqual(planContractBatches([selected[3]], { platform: 'win32' }), [
    { name: 'real Git', files: [selected[3]], concurrency: 2 },
  ]);
  assert.deepEqual(planContractBatches([selected[1]], { platform: 'win32' }), [
    { name: 'Windows recorder', files: [selected[1]], concurrency: 1 },
  ]);
  assert.deepEqual(planContractBatches(['tests\\git-project.test.mjs']), [
    { name: 'real Git', files: ['tests\\git-project.test.mjs'], concurrency: 2 },
  ]);
  assert.deepEqual(planContractBatches([]), []);
});

test('explicit concurrency stays unchanged for regular contracts and bounds isolated batches', () => {
  for (const concurrency of [1, 2, 8]) {
    assert.deepEqual(planContractBatches(selected, { platform: 'win32', concurrency }).map(batch => batch.concurrency),
      [concurrency, Math.min(concurrency, 2), 1]);
  }
});

test('both concurrency syntaxes retain other Node options and normalized filename filters', () => {
  for (const option of [['--test-concurrency', '8'], ['--test-concurrency=8']]) {
    const parsed = parseContractArguments(['--suite', 'app', '--list', ...option, '--test-name-pattern', 'named SELECT',
      '--test-skip-pattern=skip', '--test-reporter', 'spec', '--test-timeout', '1000', 'tests\\analytics']);
    assert.deepEqual(parsed, {
      suite: 'app', list: true, concurrency: 8, filters: ['tests/analytics'],
      nodeArgs: ['--test-name-pattern', 'named SELECT', '--test-skip-pattern=skip', '--test-reporter', 'spec', '--test-timeout', '1000'],
    });
    assert.deepEqual(planContractBatches(selected, { platform: 'win32', concurrency: parsed.concurrency }).map(batch => batch.concurrency), [8, 2, 1]);
  }
  assert.equal(parseContractArguments(['--test-concurrency=8', '--test-concurrency', '1']).concurrency, 1);
  assert.throws(() => parseContractArguments(['--test-concurrency']), /Missing value/);
  assert.throws(() => parseContractArguments(['--test-concurrency=0']), /positive integer/);
});

test('batch failures and spawn errors are reported while every later batch still runs', () => {
  const calls = [], errors = [], logs = [];
  const outcomes = [{ error: Error('fixture spawn refused'), status: null }, { status: 3 }, { status: 0 }];
  const batches = planContractBatches(selected, { platform: 'win32' });
  const status = runContractBatches(batches, ['--test-name-pattern', 'fixture'], {
    spawn: (executable, args, options) => { calls.push({ executable, args, options }); return outcomes.shift(); },
    log: message => logs.push(message), reportError: message => errors.push(message),
  });
  assert.equal(status, 3);
  assert.equal(calls.length, 3);
  assert.equal(logs.length, 3);
  assert.match(errors[0], /regular could not start: fixture spawn refused/);
  assert.match(errors[1], /real Git failed \(exit 3\)/);
  for (const [index, call] of calls.entries()) {
    assert.equal(call.executable, process.execPath);
    assert.deepEqual(call.options, { stdio: 'inherit' });
    assert.deepEqual(call.args, ['--test', `--test-concurrency=${batches[index].concurrency}`, '--test-name-pattern', 'fixture',
      ...batches[index].files.map(file => path.normalize(file))]);
  }
});

test('a thrown spawn failure or terminated batch stays a failure after later success', () => {
  for (const outcome of ['throw', { status: null, signal: 'SIGTERM' }]) {
    let calls = 0;
    const errors = [];
    const batches = planContractBatches([selected[2], selected[3]], { platform: 'win32' });
    const status = runContractBatches(batches, [], {
      spawn: () => {
        if (++calls > 1) return { status: 0 };
        if (outcome === 'throw') throw Error('fixture thrown spawn');
        return outcome;
      },
      log: () => {}, reportError: message => errors.push(message),
    });
    assert.equal(status, 1);
    assert.equal(calls, 2);
    assert.match(errors[0], outcome === 'throw' ? /fixture thrown spawn/ : /signal SIGTERM/);
  }
});

test('CLI list preserves all, fast, Git, app, backend and filename-filter selections', () => {
  const appRoot = fileURLToPath(new URL('..', import.meta.url));
  const list = (...args) => {
    const result = spawnSync(process.execPath, ['scripts/test-contracts.mjs', '--list', ...args], { cwd: appRoot, encoding: 'utf8' });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim().split(/\r?\n/);
  };
  const all = list('--suite', 'all');
  const git = all.filter(file => /\/git-project(?:-http)?\.test\.mjs$/.test(file));
  assert.equal(git.length, 2);
  assert.deepEqual(list('--suite', 'git'), git);
  assert.deepEqual(list('--suite', 'fast'), all.filter(file => !git.includes(file)));
  assert.deepEqual(list('--suite', 'app'), all.filter(file => file.startsWith('tests/')));
  assert.deepEqual(list('--suite', 'backend'), all.filter(file => file.startsWith('backend/tests/')));
  assert.deepEqual(list('--suite', 'all', 'git-project'), git);
  assert.deepEqual(list('--suite', 'app', 'tests\\analytics'), ['tests/analytics.test.mjs']);
});
