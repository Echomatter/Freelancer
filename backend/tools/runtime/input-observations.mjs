import { readRuntimeText as readFile, writeState, readState, stateFiles, updateState } from './state-database.mjs';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { replaceFile } from '../../../server/replace-file.mjs';

const safe = id => typeof id === 'string' && /^[\w-]+$/.test(id);
export async function recordModelInput(root, messages) {
  const users = messages.filter(m => m.info?.role === 'user');
  const last = users.at(-1)?.info;
  if (!safe(last?.id) || !safe(last?.sessionID)) return;
  const dir = path.join(root, '.state/model-input', last.sessionID);
  await mkdir(dir, { recursive: true });
  // Retain observed input IDs across tool rounds and compaction for this native
  // request. Input evidence stores identifiers, never another transcript.
  const target = path.join(dir, `${last.id}.json`), temp = `${target}.${randomUUID()}.tmp`;
  updateState(target, previous => ({
    boundaryID: last.id, sessionID: last.sessionID, at: Date.now(),
    messageIDs: [...new Set([...(previous?.messageIDs ?? []), ...users.map(m => m.info.id)])],
  }));
}
export async function modelInputEvidence(root, session, messages) {
  if (!safe(session)) return [];
  const ids = [...new Set(messages.filter(m => m.info?.role === 'assistant' &&
    !m.info.error && (m.parts?.some(p => p.type === 'step-start') || m.info.time?.completed)).map(m => m.info.parentID))];
  return (await Promise.all(ids.filter(safe).map(async id => {
    try { return JSON.parse(await readFile(path.join(root, '.state/model-input', session, `${id}.json`), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }))).filter(Boolean);
}
