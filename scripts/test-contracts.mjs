import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTestEnvironment } from './test-environment.mjs';

const gitFixtures = new Set(['git-project.test.mjs', 'git-project-http.test.mjs']);
export function parseContractArguments(args) {
  let suite = 'all';
  const filters = [], nodeArgs = [];
  let list = false, concurrency = 4;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--suite') suite = args[++i];
    else if (arg === '--list') list = true;
    else if (arg === '--test-concurrency') {
      if (!args[i + 1]) throw Error(`Missing value for ${arg}`);
      concurrency = Number(args[++i]);
    } else if (arg.startsWith('--test-concurrency=')) concurrency = Number(arg.slice('--test-concurrency='.length));
    else if (['--test-name-pattern', '--test-skip-pattern', '--test-reporter', '--test-timeout'].includes(arg)) {
      if (!args[i + 1]) throw Error(`Missing value for ${arg}`);
      nodeArgs.push(arg, args[++i]);
    } else if (arg.startsWith('--')) nodeArgs.push(arg);
    else filters.push(arg.replaceAll('\\', '/'));
  }
  if (!['all', 'fast', 'git', 'app', 'backend'].includes(suite)) throw Error('Unknown contract suite');
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw Error('Test concurrency must be a positive integer.');
  return { suite, filters, nodeArgs, list, concurrency };
}

// Plan only already-selected files, so suite and filename filters keep their
// existing meaning. Cold real-Git and PS5.1 processes run in separate batches.
export function planContractBatches(files, { platform = process.platform, concurrency = 4 } = {}) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw Error('Test concurrency must be a positive integer.');
  const regular = [], git = [], recorder = [];
  for (const file of files) {
    const name = file.replaceAll('\\', '/').split('/').at(-1);
    if (platform === 'win32' && name === 'outcome-verification.test.mjs') recorder.push(file);
    else if (gitFixtures.has(name)) git.push(file);
    else regular.push(file);
  }
  return [
    { name: 'regular', files: regular, concurrency },
    { name: 'real Git', files: git, concurrency: Math.min(concurrency, 2) },
    { name: 'Windows recorder', files: recorder, concurrency: 1 },
  ].filter(batch => batch.files.length);
}

export function runContractBatches(batches, nodeArgs = [], { spawn = spawnSync, log = console.log, reportError = console.error } = {}) {
  let status = 0;
  if (!batches.length) return status;
  const testEnvironment = createTestEnvironment();
  try {
    for (const batch of batches) {
      log(`Contract batch: ${batch.name}; ${batch.files.length} files; ${batch.concurrency} workers.`);
      let result;
      try {
        result = spawn(process.execPath, ['--test', `--test-concurrency=${batch.concurrency}`, ...nodeArgs,
          ...batch.files.map(file => path.normalize(file))], { stdio: 'inherit', env: testEnvironment.env });
      } catch (error) {
        reportError(`Contract batch ${batch.name} could not start: ${error.message ?? error}`);
        status = 1;
        continue;
      }
      if (result.error) {
        reportError(`Contract batch ${batch.name} could not start: ${result.error.message ?? result.error}`);
        status = 1;
      } else if (result.status !== 0) {
        status = result.status ?? 1;
        reportError(`Contract batch ${batch.name} failed (${result.signal ? `signal ${result.signal}` : `exit ${status}`}).`);
      }
    }
  } finally { testEnvironment.cleanup(); }
  return status;
}

export async function runContracts(args = process.argv.slice(2)) {
  const { suite, filters, nodeArgs, list, concurrency } = parseContractArguments(args);
  const directories = suite === 'app' ? ['tests'] : suite === 'backend' ? ['backend/tests'] : ['tests', 'backend/tests'];
  const files = (await Promise.all(directories.map(async directory => (await readdir(directory))
    .filter(name => name.endsWith('.test.mjs') && (suite !== 'fast' || !gitFixtures.has(name)) &&
      (suite !== 'git' || gitFixtures.has(name)))
    .map(name => `${directory}/${name}`))))
    .flat().sort().filter(file => !filters.length || filters.some(filter => file.includes(filter)));
  if (!files.length) throw Error('No contract files match the requested suite and filters.');
  if (list) { console.log(files.join('\n')); return 0; }
  console.log(`Running ${files.length} contract files (${suite}${filters.length ? `; ${filters.join(', ')}` : ''}).`);
  return runContractBatches(planContractBatches(files, { concurrency }), nodeArgs);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  process.exitCode = await runContracts();
