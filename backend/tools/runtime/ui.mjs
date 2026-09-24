// Local presentation adapter over authoritative backend files. No new server,
// credential store, collector, execution layer or routing implementation.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { snapshot as usageSnapshot, refreshQuota } from './quota.mjs';
import { loadPreferences, savePreferences } from './preferences.mjs';

async function json(file, fallback) {
  try { return JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw new Error(`Cannot read ${path.basename(file)}; existing data preserved.`); }
}
export function createUiBackend(root, directory) {
  root = path.resolve(root);
  directory = path.resolve(directory);
  let refreshing;
  return {
    async snapshot(sessionID) {
      const warnings = [];
      async function safe(label, fn, fallback) { try { return await fn(); } catch { warnings.push(`${label} unavailable; refresh to retry.`); return fallback; } }
      const [preferences, roster, evidence, history, usage, receipts] = await Promise.all([
        safe('Preferences', () => loadPreferences(root, directory, sessionID), null),
        safe('Route catalog', () => json(path.join(root,'routing/model-roster.json'), {}), {}),
        safe('Evidence', () => json(path.join(root,'routing/model-evidence.json'), {}), {}),
        safe('Outcomes', () => json(path.join(root,'.state/task-history.json'), { entries: [] }), { entries: [] }),
        safe('Quota', () => usageSnapshot(root), null),
        safe('Receipts', async () => {
          if (!sessionID) return [];
          const dir = path.join(root, '.state/delegation');
          const names = await readdir(dir).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
          const rows = [];
          // Sequential bounded batches avoid exhausting handles with long histories.
          for (let i=0; i<names.length; i+=32) {
            const chunk = await Promise.all(names.slice(i,i+32).filter(n => /^[a-f0-9]{64}\.json$/.test(n)).map(n => json(path.join(dir,n), null).catch(() => { warnings.push('A malformed receipt was skipped.'); return null; })));
            rows.push(...chunk.filter(r => r?.parent_session === sessionID && path.resolve(r.directory || directory) === path.resolve(directory)));
          }
          return rows.sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)));
        }, []),
      ]);
      return { schemaVersion: 1, generatedAt: new Date().toISOString(), preferences, roster, evidence, history, usage, receipts, warnings };
    },
    save: input => savePreferences(root, directory, input),
    async refreshQuota() {
      if (!refreshing) refreshing = refreshQuota(root).finally(() => { refreshing = null; });
      return refreshing;
    },
  };
}
