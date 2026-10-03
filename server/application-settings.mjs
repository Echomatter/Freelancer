import { chmodSync, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const RUNTIME_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const GLOBAL_KEYS = new Set(['appearance', 'lastProjectID', 'plans', 'monthlyPlans', 'gitDefaults', 'viewState', 'launcher']);

// The legacy settings document combines application preferences and authored
// domain data. Keep this allowlist deliberately explicit: unclassified fields
// stay in the database, while only known user-wide preferences leave it.
export function splitSettingsByAuthority(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Legacy settings document must be an object.');
  const global = {};
  const domain = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'version' || key === 'revision' || key === 'projects') continue;
    (GLOBAL_KEYS.has(key) ? global : domain)[key] = item;
  }
  const projects = value.projects ?? [];
  if (!Array.isArray(projects)) throw Error('Legacy project list is invalid.');
  const revision = value.revision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0) throw Error('Legacy settings revision is invalid.');
  return { global: { version: 1, revision, values: global }, domain, projects };
}

export function settingsProfilePath(dataHome, runtimeID) {
  if (!path.isAbsolute(dataHome) || !RUNTIME_ID.test(runtimeID ?? ''))
    throw Error('Settings profile requires an absolute data home and stable runtime ID.');
  const identity = createHash('sha256').update(runtimeID).digest('hex').slice(0, 24);
  return path.join(dataHome, `application-settings-${identity}.json`);
}

export const applicationSettingsPath = dataHome => path.join(dataHome, 'application-settings.json');

function validateApplicationSettings(document) {
  if (document?.version !== 1 || !Number.isSafeInteger(document.revision) || document.revision < 0 ||
      !document.values || typeof document.values !== 'object' || Array.isArray(document.values))
    throw Error('Application settings document is invalid.');
  return document;
}

export function readApplicationSettings(dataHome, { allowMissing = false } = {}) {
  const filename = applicationSettingsPath(dataHome);
  let stat;
  try { stat = lstatSync(filename); }
  catch (error) {
    if (error.code === 'ENOENT' && allowMissing) return { version:1, revision:0, values:{} };
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Application settings must be a regular file.');
  return validateApplicationSettings(JSON.parse(readFileSync(filename, 'utf8').replace(/^\uFEFF/, '')));
}

export function writeApplicationSettings(dataHome, document) {
  const filename = applicationSettingsPath(dataHome);
  validateApplicationSettings(document);
  mkdirSync(dataHome, { recursive:true, mode:0o700 });
  const temporary = `${filename}.tmp-${randomUUID()}`;
  const bytes = `${JSON.stringify(document, null, 2)}\n`;
  let fd;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, bytes, 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, filename);
    if (process.platform !== 'win32') chmodSync(filename, 0o600);
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); } catch {}
    throw error;
  }
}

export function updateApplicationSettings(dataHome, change) {
  if (typeof change !== 'function') throw Error('Application settings update requires a change function.');
  const current = readApplicationSettings(dataHome, { allowMissing:true });
  const next = change(current);
  if (!next || typeof next !== 'object' || Array.isArray(next) ||
      !next.values || typeof next.values !== 'object' || Array.isArray(next.values))
    throw Error('Application settings update returned an invalid document.');
  if (next.revision !== current.revision)
    throw Error('Application settings revision changed; reload before retrying.');
  const saved = { version:1, revision:current.revision + 1, values:next.values };
  writeApplicationSettings(dataHome, saved);
  return saved;
}

export function writeSettingsProfile(dataHome, runtimeID, settings) {
  const filename = settingsProfilePath(dataHome, runtimeID);
  const document = { ...settings, runtimeID };
  const bytes = `${JSON.stringify(document, null, 2)}\n`;
  mkdirSync(dataHome, { recursive: true, mode: 0o700 });
  const temporary = `${filename}.tmp-${randomUUID()}`;
  let fd;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, bytes, 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, filename);
    if (process.platform !== 'win32') chmodSync(filename, 0o600);
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); } catch {}
    throw error;
  }
  return { path: filename, sha256: createHash('sha256').update(bytes).digest('hex'), byteCount: Buffer.byteLength(bytes) };
}

export function readSettingsProfile(dataHome, runtimeID) {
  const filename = settingsProfilePath(dataHome, runtimeID);
  const document = JSON.parse(readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
  if (document?.version !== 1 || document.runtimeID !== runtimeID ||
      !Number.isSafeInteger(document.revision) || !document.values || typeof document.values !== 'object' || Array.isArray(document.values))
    throw Error('Settings profile is invalid.');
  return document;
}
