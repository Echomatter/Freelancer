import { readState, writeState, removeState, stateFiles } from './state-database.mjs';
import path from 'node:path';
import { resolveRuntimeConfig, runtimeEnv } from '../../../server/runtime-config.mjs';
import { assertFreshRuntimeRoot, createLocalDataStore } from '../../../server/data/store.mjs';
const [operation, file] = process.argv.slice(2);
if (!file) throw Error('A state document key is required.');
function activateCurrentRuntime(target) {
  const config = resolveRuntimeConfig();
  const parts = path.resolve(target).split(path.sep), marker = parts.lastIndexOf('.state');
  if (marker < 0) return;
  const owner = path.resolve(parts.slice(0, marker).join(path.sep));
  const same = (left, right) => process.platform === 'win32'
    ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
    : path.resolve(left) === path.resolve(right);
  if (!same(owner, config.backendRoot)) return;
  if (process.env.FREELANCER_RUNTIME_DATA_MODE === 'unified') return;
  if (process.env.FREELANCER_RUNTIME_ROOT && !same(process.env.FREELANCER_RUNTIME_ROOT, owner)) return;
  Object.assign(process.env, runtimeEnv(config));
  assertFreshRuntimeRoot(config.dataRoot, config.runtimeID);
  const store = createLocalDataStore(config.dataRoot);
  try { store.initializeFreshRuntime(config.runtimeID); }
  finally { store.close(); }
}
activateCurrentRuntime(file);
const print = value => process.stdout.write(JSON.stringify(value).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')));
if (operation === 'read') print(readState(file, null));
else if (operation === 'list') print(stateFiles(file).map(name => path.join(file, name)));
else if (operation === 'remove') removeState(file);
else if (operation === 'write' || operation === 'write-base64') {
  const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk);
  let text = Buffer.concat(chunks).toString('utf8');
  if (operation === 'write-base64') text = Buffer.from(text.trim(), 'base64').toString('utf8');
  writeState(file, JSON.parse(text.replace(/^\uFEFF/, '')));
} else throw Error('Unsupported state operation.');
