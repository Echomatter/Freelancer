import { readRuntimeText as readFile } from './state-database.mjs';

import path from 'node:path';

// A preference adapter for OpenCode's native compactor, not a second engine.
export function applyContextSettings(config, settings, directory) {
  const normalized = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  const project = settings.projects?.find(p => normalized(p.directory) === normalized(directory));
  const auto = settings.contextSettings?.[project?.id]?.autoCompact;
  if (typeof auto === 'boolean') config.compaction = { ...config.compaction, auto };
  return config;
}

export async function configureContextSettings(config, root, directory) {
  try {
    const settings = JSON.parse(await readFile(path.join(root, '.state/webpage/settings.json'), 'utf8'));
    if (settings.version !== 1 || !Array.isArray(settings.projects)) throw Error('Unsupported context settings');
    applyContextSettings(config, settings, directory);
  } catch (error) {
    if (error.code !== 'ENOENT') throw Error('Context settings are unavailable. Existing settings were preserved.');
  }
}
