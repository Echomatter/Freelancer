import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertLocalStoragePath } from '../shared/local-storage-path.mjs';
import { nativeSmokeConfigPaths } from './native-smoke-fixture.mjs';

// Test commands can be launched by the installed OpenCode process. Its runtime
// activation and private bridge must never reach disposable fixture workers.
const runtimeVariable = /^FREELANCER_(?:RUNTIME_.*|APP_ROOT|.*BRIDGE|WEB_PORT|DATA_HOME)$/i;
const credentialVariable = /^(?:OPENCODE_(?:CONFIG(?:_.*)?|SERVER_.*|AUTH(?:_.*)?)|AWS_CONFIG_FILE|AZURE_CLIENT_CERTIFICATE_PATH|CODEX_HOME|CLAUDE_CONFIG_DIR)$|(?:^|_)(?:API_KEY|ACCESS_KEY(?:_ID)?|SECRET_ACCESS_KEY|TOKEN|PASSWORD|SECRET|CREDENTIALS?)(?:_|$)/i;
const nativePathVariable = /^(?:HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|TEMP|TMP|XDG_(?:CONFIG|DATA|CACHE|STATE)_HOME|OPENCODE_TEST_HOME|GH_CONFIG_DIR)$/i;
const isolatedVariable = key => runtimeVariable.test(key) || credentialVariable.test(key) || nativePathVariable.test(key);
const samePath = (left, right) => process.platform === 'win32'
  ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
  : path.resolve(left) === path.resolve(right);

export function createTestEnvironment(inherited = process.env) {
  // Only this explicit test variable is reusable by nested runners/configs.
  // A caller may supply an isolated fixture home; it remains caller-owned.
  const suppliedHome = inherited.FREELANCER_TEST_DATA_HOME;
  if (suppliedHome && !path.isAbsolute(suppliedHome))
    throw Error('FREELANCER_TEST_DATA_HOME must be an absolute isolated test directory.');
  const temporaryParent = suppliedHome ? null : realpathSync(os.tmpdir());
  const dataHome = suppliedHome ? path.resolve(suppliedHome)
    : realpathSync(mkdtempSync(path.join(temporaryParent, 'freelancer-test-data-')));
  assertLocalStoragePath(dataHome);
  const { xdgConfigHome, nativeConfig } = nativeSmokeConfigPaths(dataHome);
  const nativeHome = path.join(dataHome, 'native-home');
  const overrides = {
    FREELANCER_DATA_HOME: dataHome,
    FREELANCER_TEST_DATA_HOME: dataHome,
    OPENCODE_CONFIG_DIR: nativeConfig,
    OPENCODE_CONFIG_CONTENT: '{}',
    OPENCODE_TEST_HOME: nativeHome,
    HOME: nativeHome,
    USERPROFILE: nativeHome,
    APPDATA: path.join(nativeHome, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(nativeHome, 'AppData', 'Local'),
    XDG_CONFIG_HOME: xdgConfigHome,
    XDG_DATA_HOME: path.join(dataHome, 'native-data'),
    XDG_CACHE_HOME: path.join(dataHome, 'native-cache'),
    XDG_STATE_HOME: path.join(dataHome, 'native-state'),
    GH_CONFIG_DIR: path.join(dataHome, 'native-config', 'gh'),
    // Browser binaries are immutable tool installations, not test state.
    // Point disposable workers at the exact Playwright cache installed for
    // this user instead of looking for a nonexistent cache under nativeHome.
    PLAYWRIGHT_BROWSERS_PATH: inherited.PLAYWRIGHT_BROWSERS_PATH || (process.platform === 'win32'
      ? path.join(inherited.LOCALAPPDATA || process.env.LOCALAPPDATA || os.homedir(), 'ms-playwright')
      : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')
        : path.join(os.homedir(), '.cache', 'ms-playwright')),
    TEMP: path.join(dataHome, 'native-temp'),
    TMP: path.join(dataHome, 'native-temp'),
  };
  if (process.platform === 'win32') {
    overrides.HOMEDRIVE = path.parse(nativeHome).root.slice(0, -1);
    overrides.HOMEPATH = nativeHome.slice(overrides.HOMEDRIVE.length);
  }
  for (const [key, directory] of Object.entries(overrides))
    if (!['OPENCODE_CONFIG_CONTENT', 'HOMEDRIVE', 'HOMEPATH'].includes(key)) mkdirSync(directory, { recursive: true });
  const env = { ...inherited };
  for (const key of Object.keys(env)) if (isolatedVariable(key)) delete env[key];
  Object.assign(env, overrides);
  let cleaned = false;
  return {
    env,
    dataHome,
    overrides,
    cleanup() {
      if (suppliedHome || cleaned) return;
      cleaned = true;
      if (!existsSync(dataHome)) return;
      const resolved = realpathSync(dataHome);
      if (lstatSync(dataHome).isSymbolicLink() || !samePath(resolved, dataHome) ||
          !samePath(path.dirname(resolved), temporaryParent) ||
          !path.basename(resolved).startsWith('freelancer-test-data-'))
        throw Error('Test data directory changed ownership; preserving it instead of removing it.');
      rmSync(resolved, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
    },
  };
}

export function applyTestEnvironment(testEnvironment, target = process.env) {
  for (const key of Object.keys(target)) if (isolatedVariable(key)) delete target[key];
  Object.assign(target, testEnvironment.overrides);
}
