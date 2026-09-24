import { readFile, mkdir, writeFile, unlink, open } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { defaults, normalizePreferences } from '../../../shared/strategy.mjs';
import { replaceFile } from '../../../server/replace-file.mjs';

const key = directory => createHash('sha256').update(process.platform === 'win32' ? path.resolve(directory).toLowerCase() : path.resolve(directory)).digest('hex');
export const preferencesFile = (root, directory) => path.join(root, '.state', 'preferences', `${key(directory)}.json`);
async function document(root, directory) {
  try {
    const data = JSON.parse((await readFile(preferencesFile(root, directory), 'utf8')).replace(/^\uFEFF/, ''));
    if (data.schemaVersion !== 1 || !data.sessions || typeof data.sessions !== 'object') throw new Error('Invalid preference document');
    return data;
  } catch (e) { if (e.code === 'ENOENT') return { schemaVersion: 1, revision: 0, project: null, sessions: {} }; throw e; }
}
export async function loadPreferences(root, directory, sessionID) {
  const data = await document(root, directory);
  const base = normalizePreferences(data.sessions[sessionID] || data.project || defaults);
  return { defaults: base, preferences: normalizePreferences({ ...base, ...data.execution?.[sessionID] }),
    revision: data.revision, scope: data.sessions[sessionID] ? 'session' : data.project ? 'project' : 'default' };
}
export async function savePreferences(root, directory, { preferences, sessionID, scope = 'session', revision }) {
  const p = normalizePreferences(preferences);
  if (!['session','project','execution'].includes(scope) || (scope !== 'project' && !/^ses_[\w-]+$/.test(sessionID || ''))) throw new Error('Select a native session or project scope');
  const file = preferencesFile(root, directory);
  await mkdir(path.dirname(file), { recursive: true });
  let lock;
  try { lock = await open(`${file}.lock`, 'wx'); } catch { throw new Error('Preferences are being updated. Refresh and retry.'); }
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const data = await document(root, directory);
    if (revision !== undefined && revision !== data.revision) throw new Error('Preferences changed elsewhere. Refresh before saving.');
    if (scope === 'execution') {
      data.execution ??= {};
      data.execution[sessionID] = { allowedModels: p.allowedModels, maxParallel: p.maxParallel, childVariant: p.childVariant };
    } else {
      if (scope === 'project') { data.project = p; if (sessionID) delete data.sessions[sessionID]; }
      else data.sessions[sessionID] = p;
      if (data.execution && sessionID) delete data.execution[sessionID];
    }
    data.revision++;
    await writeFile(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await replaceFile(temp, file);
    return loadPreferences(root, directory, sessionID);
  } finally { await unlink(temp).catch(() => {}); await lock.close(); await unlink(`${file}.lock`).catch(() => {}); }
}
