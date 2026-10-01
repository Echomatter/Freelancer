import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const gitFixtures = new Set(['git-project.test.mjs', 'git-project-http.test.mjs']);
export async function runContracts(args = process.argv.slice(2)) {
  let suite = 'all';
  const filters = [], nodeArgs = [];
  let list = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--suite') suite = args[++i];
    else if (arg === '--list') list = true;
    else if (['--test-name-pattern', '--test-skip-pattern', '--test-reporter', '--test-timeout', '--test-concurrency'].includes(arg)) {
      if (!args[i + 1]) throw Error(`Missing value for ${arg}`);
      nodeArgs.push(arg, args[++i]);
    } else if (arg.startsWith('--')) nodeArgs.push(arg);
    else filters.push(arg.replaceAll('\\', '/'));
  }
  if (!['all', 'fast', 'git', 'app', 'backend'].includes(suite)) throw Error('Unknown contract suite');
  const directories = suite === 'app' ? ['tests'] : suite === 'backend' ? ['backend/tests'] : ['tests', 'backend/tests'];
  const files = (await Promise.all(directories.map(async directory => (await readdir(directory))
    .filter(name => name.endsWith('.test.mjs') && (suite !== 'fast' || !gitFixtures.has(name)) &&
      (suite !== 'git' || gitFixtures.has(name)))
    .map(name => `${directory}/${name}`))))
    .flat().sort().filter(file => !filters.length || filters.some(filter => file.includes(filter)));
  if (!files.length) throw Error('No contract files match the requested suite and filters.');
  if (list) { console.log(files.join('\n')); return 0; }
  console.log(`Running ${files.length} contract files (${suite}${filters.length ? `; ${filters.join(', ')}` : ''}).`);
  const result = spawnSync(process.execPath, ['--test', `--test-concurrency=${suite === 'git' ? 2 : 4}`, ...nodeArgs,
    ...files.map(file => path.normalize(file))], { stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  process.exitCode = await runContracts();
