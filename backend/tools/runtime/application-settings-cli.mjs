import { resolveRuntimeConfig } from '../../../server/runtime-config.mjs';
import { readApplicationSettings, updateApplicationSettings } from '../../../server/application-settings.mjs';
import { assertFreshRuntimeRoot, createLocalDataStore } from '../../../server/data/store.mjs';

const [operation] = process.argv.slice(2);
const print = value => process.stdout.write(JSON.stringify(value).replace(/[\u007f-\uffff]/g,
  character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`));
const config = resolveRuntimeConfig();
const dataHome = config.dataRoot;

if (operation === 'read') {
  print(readApplicationSettings(dataHome, { allowMissing:true }));
} else if (operation === 'update-launcher') {
  // The tray can be used before the server's first launch. Register the empty
  // runtime before writing any Freelancer-owned preference into its namespace.
  assertFreshRuntimeRoot(dataHome, config.runtimeID);
  const store = createLocalDataStore(dataHome);
  try { store.initializeFreshRuntime(config.runtimeID); }
  finally { store.close(); }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = JSON.parse(Buffer.from(Buffer.concat(chunks).toString('utf8').trim(), 'base64').toString('utf8'));
  if (!input.launcher || !['chrome', 'browser'].includes(input.launcher.startIn))
    throw Error('Launcher preference is invalid.');
  print(updateApplicationSettings(dataHome, current => ({
    ...current,
    values:{ ...current.values, launcher:input.launcher },
  })));
} else {
  throw Error('Unsupported application settings operation.');
}
