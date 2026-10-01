import path from 'node:path';
import { normalizePlans } from '../domain/costs.mjs';
import { migrateSettings } from './settings-migration.mjs';
import { readState, updateState, writeState } from '../backend/tools/runtime/state-database.mjs';

export function createDocumentStore(root) {
  const directory = path.join(root, '.state/webpage');
  const initialized = new Set();
  const files = { settings: 'settings.json', goals: 'goals.json', gitOperations: 'git-operations.json' };
  const validate = (name, data) => {
    if (data?.version !== 1 || (name === 'settings'
      ? !Array.isArray(data.projects) || !Number.isInteger(data.revision)
      : !data.records || typeof data.records !== 'object' || Array.isArray(data.records))) throw Error(`Invalid ${name}; existing data preserved.`);
    return name === 'settings' ? migrateSettings(data) : data;
  };
  const file = name => { if (!files[name]) throw Error('Unknown document'); return path.join(directory, files[name]); };
  return {
    directory,
    async read(name) {
      if (initialized.has(name)) return validate(name, readState(file(name)));
      const value = updateState(file(name), value => validate(name, value ?? (name === 'settings'
        ? { version: 1, revision: 0, projects: [], plans: normalizePlans(), monthlyPlans: {} }
        : { version: 1, records: {} })));
      initialized.add(name);
      return value;
    },
    async write(name, value) { writeState(file(name), validate(name, value)); },
  };
}
