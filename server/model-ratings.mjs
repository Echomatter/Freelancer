import path from 'node:path';
import { createLocalDataService } from './data/store.mjs';

const inFlight = job => job && ['starting','running','retiring','retirement-unverified'].includes(job.status);
const sameDirectory = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  a = path.resolve(a); b = path.resolve(b);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
};

// Retain historical estimates and native session identities. No new research.
export function createModelRatingService({ host, backendRoot, dataRoot, localData, project, canRun = () => true } = {}) {
  const ownsData = !localData;
  const service = localData ?? createLocalDataService(dataRoot ?? path.join(backendRoot, '.state', 'local-data'));
  const data = () => service.get();
  let retiring = null, closed = false;
  const permitted = () => !closed && canRun() === true;
  async function retire() {
    if (!permitted()) return;
    if (retiring) return retiring;
    retiring = (async () => {
      const jobs = data().ratingJobs?.() ?? [data().currentRatingJob()].filter(Boolean);
      for (const job of jobs.filter(inFlight)) {
        if (!permitted()) break;
        const sessions = [...new Set([job.session, ...(job.progress?.workers ?? []).map(row => row.session)].filter(Boolean))];
        let verified = sessions.length > 0;
        const existing = [];
        data().saveRatingJob({ ...job, status: 'retiring', error: null, summary: 'Stopping retired model-rating research. No request will be replayed.' });
        try {
          const p = await project(job.project);
          for (const id of sessions) {
            if (!/^ses_[\w-]+$/.test(id)) throw Error('Legacy identity is invalid.');
            if (!permitted()) { verified = false; break; }
            let native;
            try { native = await host.request('/session/' + encodeURIComponent(id), { directory: p.directory }); }
            catch (error) { if (error.status === 404) continue; throw error; }
            if (!sameDirectory(native?.directory, p.directory) || native.id !== id) throw Error('Legacy identity is not verified.');
            existing.push(id);
            if (!permitted()) { verified = false; break; }
            await host.request('/session/' + encodeURIComponent(id) + '/abort', { method: 'POST', directory: p.directory });
          }
          if (verified && permitted()) {
            const statuses = await host.request('/session/status', { directory: p.directory });
            if (!statuses || typeof statuses !== 'object' || Array.isArray(statuses) ||
                existing.some(id => Object.hasOwn(statuses, id) && statuses[id]?.type !== 'idle')) verified = false;
            for (const id of existing) {
              if (!permitted()) { verified = false; break; }
              const rows = await host.request('/session/' + encodeURIComponent(id) + '/message', { directory: p.directory });
              if (!Array.isArray(rows) || rows.length > 4000 || rows.some(row => !Array.isArray(row?.parts) ||
                  row.parts.some(part => part.type === 'tool' && ['pending','running'].includes(part.state?.status)))) verified = false;
            }
          } else verified = false;
        } catch { verified = false; }
        if (closed) break;
        data().saveRatingJob({ ...job, status: verified ? 'retired' : 'retirement-unverified',
          error: verified ? null : 'Native execution could not be confirmed stopped. Inspect the retained configuration sessions.',
          summary: verified ? 'Legacy model-rating research stopped. Historical estimates and sessions retained.'
            : 'Legacy research retirement needs inspection. No new research was started.' });
      }
    })().finally(() => { retiring = null; });
    return retiring;
  }
  return {
    catalog(rows) { data().modelCatalog(rows); return data().modelRatings(); },
    status() { const job = data().currentRatingJob(); return job && {
      id: job.id, status: job.status, project: job.project, session: job.session,
      summary: job.summary, error: job.error, legacy: true, inference: 'retired',
      createdAt: job.createdAt, updatedAt: job.updatedAt,
    }; },
    async start() { throw Object.assign(Error('Generated model ratings are retired. Use Update model data to refresh published source facts.'), { status: 410 }); },
    async stop(id) {
      const job = data().currentRatingJob();
      if (job?.id !== id) throw Object.assign(Error('This legacy rating job changed.'), { status: 409 });
      await retire(); return this.status();
    },
    dismiss(id) {
      const job = data().currentRatingJob();
      if (job?.id !== id || inFlight(job)) throw Object.assign(Error('Inspect or stop the retained legacy job before dismissing it.'), { status: 409 });
      data().saveRatingJob({ ...job, status: 'dismissed' }); return null;
    },
    retireLegacy: retire,
    suspendAutomaticWork() {},
    resumeAutomaticWork() { void retire().catch(() => {}); },
    async quiesceForLocalDataMaintenance() {
      if (retiring || (data().ratingJobs?.() ?? [data().currentRatingJob()]).some(inFlight))
        throw Error('Resolve retained legacy model-rating execution before local data maintenance.');
    },
    async close() { closed = true; if (retiring) await retiring; if (ownsData) service.close(); },
  };
}
