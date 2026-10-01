import { readState, writeState } from './state-database.mjs';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { replaceFile } from '../../../server/replace-file.mjs';

// Share the short admission boundary between the native delegate plugin and
// the durable web sender. Never hold this lock while waiting for inference.
export async function workerDispatchLock(root, sessionID) {
  const base = path.join(root, '.state/delegation/dispatch-locks');
  const file = path.join(base, createHash('sha256').update(sessionID).digest('hex'));
  await mkdir(base, { recursive: true });
  const end = Date.now() + 15000;
  while (true) {
    try { await mkdir(file); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const owner = JSON.parse(await readFile(path.join(file, 'owner.json'), 'utf8'));
        if (!Number.isInteger(owner.pid) || owner.pid < 1) throw Error('Invalid dispatch owner.');
        try { process.kill(owner.pid, 0); }
        catch (e) { if (e.code === 'ESRCH') { await rm(file, { recursive: true, force: true }); continue; } }
      } catch { /* A live creator may still be writing its owner record. */ }
      if (Date.now() > end) throw Error('Worker admission is still settling. Inspect existing workers before retrying.');
      await delay(40);
    }
  }
  await writeFile(path.join(file, 'owner.json'), JSON.stringify({ pid: process.pid }));
  let released = false;
  return async () => { if (!released) { released = true; await rm(file, { recursive: true, force: true }); } };
}

async function claims(root, rootID, change) {
  const unlock = await workerDispatchLock(root, rootID);
  const file = path.join(root, '.state/delegation/dispatch-locks', createHash('sha256').update(rootID).digest('hex') + '.json');
  try {
    const rows = readState(file, []);
    const result = await change(rows);
    writeState(file, rows);
    return result;
  } finally { await unlock(); }
}

// Reserve capacity, not an execution-wide mutex. The claim covers native create
// and prompt acknowledgement gaps while independent workers start concurrently.
export async function reserveWorkerSlot(root, rootID, { limit, active, settled, sessionID }) {
  const id = randomUUID();
  const accepted = await claims(root, rootID, async rows => {
    const live = await active();
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      let dead = false;
      try { process.kill(r.pid, 0); } catch (e) { dead = e.code === 'ESRCH'; }
      if (live.has(r.childID) || r.childID && await settled(r) || dead && !r.childID) rows.splice(i, 1);
    }
    if (sessionID && live.has(sessionID)) return 'active';
    const occupied = new Set([...live, ...rows.map(r => r.childID || r.id)]);
    if (occupied.size >= limit || sessionID && rows.some(r => r.childID === sessionID)) return false;
    rows.push({ id, pid: process.pid, childID: sessionID, createdAt: Date.now() });
    return true;
  });
  if (!accepted) return null;
  const update = change => accepted === 'active' ? Promise.resolve() : claims(root, rootID, rows => {
    const at = rows.findIndex(r => r.id === id); if (at >= 0) change(rows, at);
  });
  let released = false;
  return {
    bind: (childID, messageID) => update((rows, at) => { rows[at] = { ...rows[at], childID, messageID }; }),
    release: async () => { if (!released) { released = true; await update((rows, at) => { rows.splice(at, 1); }); } },
  };
}

export const releaseWorkerSession = (root, rootID, sessionID) => claims(root, rootID, rows => {
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].childID === sessionID) rows.splice(i, 1);
});
