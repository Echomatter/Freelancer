import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createLocalDataService } from './data/store.mjs';
import { parseModelRatings, ratingsPrompt } from '../domain/model-ratings.mjs';
import { checkedCatalog } from '../backend/tools/runtime/agent-catalog.mjs';
import { executionPrompt, policyVersion } from './execution.mjs';

const active = job => job && ['starting', 'running'].includes(job.status);
const batchSize = 6;
const freeWorkerLimit = 4;
export function createModelRatingService({ host, backendRoot, dataRoot, project, getCatalog, store,
  localData }) {
  const ownsLocalData = !localData;
  const dataService = localData ?? createLocalDataService(dataRoot ?? path.join(backendRoot, '.state', 'local-data'));
  let timer, checking = false, starting = false, stopping = false;
  let decisions = { permissions: [], questions: [] };
  const data = () => dataService.get();
  const release = () => {};
  const publicJob = job => job && ({ ...job, progress: undefined,
    missing: job.progress?.missing?.length ?? 0, variant: job.progress?.variant ?? '', free: job.progress?.free === true,
    researchers: (job.progress?.workers ?? [{ session: job.session, model: job.model, status: job.status }]).map(worker => ({
      model: worker.model, status: worker.status, assigned: worker.batch?.length ?? 0,
    })), ...decisions });
  const request = (p, route, options = {}) => host.request(route, { ...options, directory: p.directory });

  function workers(job) {
    return job.progress.workers ?? [{ session: job.session, model: job.model,
      status: job.progress.phase === 'ready' ? 'ready' : 'waiting',
      batch: job.progress.batch ?? job.targets, messageID: job.progress.requestID,
      startedAt: job.progress.startedAt ?? job.createdAt }];
  }

  async function submit(job, p) {
    const progress = job.progress;
    const { agent, workspace, models, connected } = progress;
    const queue = [...(progress.queue ?? progress.rows.slice(progress.offset ?? 0))];
    // Share small queues across every available lane instead of letting the first
    // six-item batch monopolize the remaining work.
    let readyCount = workers(job).filter(worker => worker.status === 'ready').length;
    const next = workers(job).map(worker => {
      if (worker.status !== 'ready' || !queue.length) return worker;
      const size = Math.min(batchSize, Math.max(1, Math.ceil(queue.length / readyCount--)));
      const batch = queue.splice(0, size), messageID = `msg_${randomUUID().replaceAll('-', '')}`;
      return { ...worker, status: 'waiting', batch: batch.map(row => row.id), messageID, startedAt: Date.now() };
    });
    const waiting = next.filter(worker => worker.status === 'waiting' && worker.messageID && !workers(job).find(previous => previous.messageID === worker.messageID));
    if (!waiting.length) return job;
    // Persist identities before dispatch so a restart only observes ambiguous requests.
    job = data().saveRatingJob({ ...job, status: 'running', error: null,
      summary: `Researching models ${job.targets.length - queue.length} of ${job.targets.length} with ${next.filter(worker => worker.status === 'waiting').length} researcher${next.filter(worker => worker.status === 'waiting').length === 1 ? '' : 's'}…`,
      progress: { ...progress, queue, workers: next } });
    await Promise.all(waiting.map(async worker => {
      const [providerID, ...rest] = worker.model.split('/');
      const metadata = { policyVersion, requestID: worker.messageID, projectID: job.project,
        agentID: 'researcher', mode: 'build', configurationTask: 'model-ratings' };
      if (store) await store.recordRequest({ id: worker.messageID, sessionID: worker.session, projectID: job.project,
        createdAt: Date.now(), status: 'prepared', policyVersion, agent, mode: 'build', catalog: workspace,
        catalogModels: models, catalogConnected: connected, directory: p.directory,
        model: { providerID, modelID: rest.join('/') }, variant: progress.variant ?? '', delegationPool: [] });
      try {
        await request(p, `/session/${worker.session}/prompt_async`, { method: 'POST', body: {
          messageID: worker.messageID, model: { providerID, modelID: rest.join('/') }, agent: 'researcher',
          ...(progress.variant ? { variant: progress.variant } : {}),
          system: (store ? executionPrompt(agent, metadata, workspace) : '') +
            '\n\nThis background configuration request is read-only research. Do not delegate or modify files, settings, routing policy or credentials. Comparative ratings are presentation estimates. Research with native web tools and return the requested JSON for the app to save.',
          parts: [{ type: 'text', text: ratingsPrompt((progress.rows ?? []).filter(row => worker.batch.includes(row.id))) }],
        } });
        if (store) await store.recordRequest({ id: worker.messageID, status: 'accepted' }).catch(() => {});
      } catch { data().saveRatingJob({ ...job, summary: 'Checking whether OpenCode accepted the configuration request…' }); }
    }));
    return job;
  }

  async function check() {
    if (checking || starting || stopping) return;
    let job = data().currentRatingJob();
    if (!active(job)) { clearInterval(timer); timer = null; release(); return; }
    checking = true;
    try {
      const p = await project(job.project);
      if (!job.progress.workers) {
        const progress = job.progress;
        const pool = workers(job);
        const offset = (progress.offset ?? 0) + (pool[0].status === 'waiting' ? pool[0].batch.length : 0);
        job = data().saveRatingJob({ ...job, progress: { ...progress, workers: pool,
          queue: (progress.rows ?? []).slice(offset) } });
      }
      const pool = workers(job);
      const [messageLists, statuses, permissions, questions] = await Promise.all([
        Promise.all(pool.map(worker => worker.status === 'waiting'
          ? request(p, `/session/${worker.session}/message`).catch(() => null) : [])), request(p, '/session/status'),
        request(p, '/permission'), request(p, '/question'),
      ]);
      if (!statuses || typeof statuses !== 'object' || Array.isArray(statuses) ||
        !Array.isArray(permissions) || !Array.isArray(questions)) throw Error('Native task status is unavailable.');
      const sessions = new Set(pool.map(worker => worker.session));
      decisions = { permissions: permissions.filter(row => sessions.has(row.sessionID)),
        questions: questions.filter(row => sessions.has(row.sessionID)) };
      const progress = job.progress;
      const changed = pool.map((worker, index) => {
        if (worker.status !== 'waiting' || !Array.isArray(messageLists[index])) return worker;
        const busy = statuses?.[worker.session]?.type && statuses[worker.session].type !== 'idle';
        const answer = [...messageLists[index]].reverse().find(message => message.info?.role === 'assistant' &&
          (!worker.messageID || message.info?.parentID === worker.messageID) && message.info?.time?.completed && message.info?.finish !== 'tool-calls');
        const waitingForDecision = decisions.permissions.some(row => row.sessionID === worker.session) ||
          decisions.questions.some(row => row.sessionID === worker.session);
        if (!answer || busy || waitingForDecision) return worker;
        return { ...worker, answer };
      });
      if (changed.some(worker => worker.answer)) {
        let updated = [...(progress.updated ?? []),], missing = [...(progress.missing ?? [])], queue = [...(progress.queue ?? [])];
        const next = changed.map(worker => {
          if (!worker.answer) return worker;
          let ratings = [];
          try {
            if (worker.answer.info.error) throw Error('Research model failed.');
            const text = (worker.answer.parts ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n');
            ratings = parseModelRatings(text, worker.batch, { partial: true });
          } catch {
            // A failed or throttled researcher relinquishes its batch to another free worker.
            queue = [...worker.batch.map(id => (progress.rows ?? []).find(row => row.id === id)).filter(Boolean), ...queue];
            return { ...worker, status: 'failed', batch: [], answer: undefined };
          }
          data().saveModelRatings(ratings, worker.model);
          updated = [...updated, ...ratings.map(row => row.id)];
          missing = [...missing, ...worker.batch.filter(id => !ratings.some(row => row.id === id))];
          return { ...worker, status: 'ready', batch: [], answer: undefined, messageID: undefined };
        });
        job = data().saveRatingJob({ ...job, progress: { ...progress, workers: next, queue, updated, missing } });
        await submit(job, p);
      } else if (decisions.permissions.length || decisions.questions.length) {
        data().saveRatingJob({ ...job, summary: decisions.permissions.length ? 'Permission needed to continue research.' : 'The research agent needs an answer.' });
      } else if (pool.some(worker => worker.status === 'waiting' && Date.now() - worker.startedAt > 20 * 60_000)) {
        const waiting = pool.filter(worker => worker.status === 'waiting' && Date.now() - worker.startedAt > 20 * 60_000);
        await Promise.all(waiting.map(worker => request(p, `/session/${worker.session}/abort`, { method: 'POST' })));
        const stopped = await request(p, '/session/status');
        if (!stopped || waiting.some(worker => stopped[worker.session]?.type && stopped[worker.session].type !== 'idle'))
          throw Error('Waiting for timed-out researchers to stop.');
        job = data().saveRatingJob({ ...job, progress: { ...progress,
          workers: pool.map(worker => waiting.includes(worker) ? { ...worker, status: 'failed', batch: [] } : worker),
          queue: [...(progress.queue ?? []), ...(progress.rows ?? []).filter(row => waiting.some(worker => worker.batch.includes(row.id)))] } });
      }
      job = data().currentRatingJob();
      if (active(job)) job = await submit(job, p);
      const remainingWorkers = workers(job).filter(worker => worker.status === 'waiting' ||
        (worker.status === 'ready' && (job.progress.queue ?? []).length));
      if (active(job) && !remainingWorkers.length) {
        const missing = [...new Set([...(job.progress.missing ?? []), ...job.targets.filter(id => !(job.progress.updated ?? []).includes(id))])];
        data().saveRatingJob({ ...job, status: missing.length ? 'partial' : 'completed', error: null,
          progress: { ...job.progress, missing }, summary: missing.length
            ? `${job.progress.updated.length} models updated · ${missing.length} models still missing details.`
            : `Done · Updated ${job.progress.updated.length} model rating${job.progress.updated.length === 1 ? '' : 's'}.` });
      }
    } catch {
      // A failed read is not execution completion. Keep observing, including
      // after restart, rather than allowing a duplicate paid request.
      data().saveRatingJob({ ...job, summary: 'Reconnecting to the configuration task…' });
    } finally { checking = false; release(); }
  }
  function watch() {
    if (!timer) { timer = setInterval(() => void check(), 1800); timer.unref?.(); }
    void check();
  }
  return {
    catalog(rows) {
      try { data().modelCatalog(rows); return data().modelRatings(); }
      finally { if (!checking && !starting) release(); }
    },
    status() {
      const job = data().currentRatingJob();
      if (!checking && !starting) release();
      if (active(job)) watch();
      return publicJob(job);
    },
    dismiss(id) {
      try {
        const job = data().currentRatingJob();
        if (!job || job.id !== id) throw Error('This configuration task changed. Refresh and try again.');
        if (active(job) || checking || starting || stopping) throw Error('Wait for the configuration task to finish.');
        if (!data().headers(job.project).some(row => row.id === job.session))
          data().remember(job.project, [{ id: job.session, title: 'Configuration · Update Model Ratings', time: { created: job.createdAt, updated: job.updatedAt } }]);
        const old = data().annotation(job.project, job.session);
        data().annotate(job.project, job.session, { hiddenAt: Date.now() }, old.revision);
        data().saveRatingJob({ ...job, status: 'dismissed' });
        decisions = { permissions: [], questions: [] };
        return null;
      } finally { if (!checking && !starting) release(); }
    },
    async stop(id) {
      if (stopping) throw Error('The task is already stopping.');
      stopping = true;
      try {
        while (checking || starting) await new Promise(resolve => setTimeout(resolve, 25));
        const job = data().currentRatingJob();
        if (job?.id !== id || !active(job)) return publicJob(job);
        const p = await project(job.project);
        await Promise.all(workers(job).map(worker => request(p, `/session/${worker.session}/abort`, { method: 'POST' })));
        for (const kind of ['permission', 'question']) {
          const rows = await request(p, `/${kind}`);
           for (const row of rows.filter(row => workers(job).some(worker => worker.session === row.sessionID))) {
            try { await request(p, `/${kind}/${encodeURIComponent(row.id)}/${kind === 'permission' ? 'reply' : 'reject'}`,
              { method: 'POST', ...(kind === 'permission' ? { body: { reply: 'reject' } } : {}) }); }
            catch (error) { if (error.status !== 404) throw error; }
          }
        }
        const statuses = await request(p, '/session/status');
        if (!statuses || workers(job).some(worker => statuses[worker.session]?.type && statuses[worker.session].type !== 'idle')) throw Error('OpenCode has not confirmed the task stopped.');
        const missing = job.targets.filter(target => !(job.progress.updated ?? []).includes(target));
        decisions = { permissions: [], questions: [] };
        return publicJob(data().saveRatingJob({ ...job, status: 'stopped', error: null,
          progress: { ...job.progress, missing }, summary: `Stopped · ${missing.length} models still missing details.` }));
      } finally { stopping = false; release(); }
    },
    async start(projectID, modelID, retryID, variant = '', free = false) {
      if (starting || checking || stopping || active(data().currentRatingJob())) throw Error('A model ratings update is already running.');
      starting = true;
      let job;
      try {
        if (data().currentRatingJob()) throw Error('Dismiss the previous result before starting another update.');
        if (!free && (typeof modelID !== 'string' || !/^[\w.-]+\/[^\s]+$/.test(modelID))) throw Error('Choose a model for the configuration task.');
        const p = await project(projectID);
        const { models, providers } = await getCatalog(projectID);
        if (!free && !models.some(m => m.id === modelID && providers.connected.includes(m.provider))) throw Error('Choose a connected model.');
        if (typeof variant !== 'string' || (!free && variant && !models.find(m => m.id === modelID)?.variants?.includes(variant))) throw Error('Choose an intelligence level supported by this model.');
        const saved = data().modelRatings();
        const available = data().unratedModels().filter(m => models.some(row => row.id === m.id));
        const missing = available.filter(m => !saved[m.id]?.rating);
        const retry = retryID ? data().ratingJob(retryID) : null;
        if (retryID && (!retry || retry.project !== projectID || retry.status !== 'dismissed')) throw Error('Choose a completed configuration task to retry.');
        const targets = retry?.progress?.missing?.length
          ? available.filter(row => retry.progress.missing.includes(row.id)) : missing.length ? missing : available;
        if (!targets.length) throw Error('There are no models to update.');
        const candidates = free ? models.filter(row => row.costClass === 'free' &&
          (providers.connected.includes(row.provider) || row.provider === 'opencode') && row.availability !== 'quota constrained') : [models.find(row => row.id === modelID)];
        const researchModels = [...new Map(candidates.map(row => [row.id, row])).values()].slice(0, free ? freeWorkerLimit : 1);
        if (!researchModels.length) throw Error('No available free models can research ratings right now.');
        const workspace = store ? checkedCatalog(await store.read('settings')) : null;
        const agent = workspace?.agents.find(item => item.id === 'researcher');
        if (store && !agent) throw Error('The research configuration agent is unavailable.');
        const sessions = await Promise.all(researchModels.map(() => request(p, '/session', { method: 'POST', body: { title: 'Configuration · Update Model Ratings' } })));
        const ownDirectory = directory => process.platform === 'win32' ? path.resolve(directory).toLowerCase() : path.resolve(directory);
        if (sessions.some(session => !/^ses_[\w-]+$/.test(session?.id) || !session.directory || ownDirectory(session.directory) !== ownDirectory(p.directory)))
          throw Error('The native configuration session could not be verified.');
        decisions = { permissions: [], questions: [] };
        data().remember(projectID, sessions);
        const workerRows = sessions.map((session, index) => ({ session: session.id, model: researchModels[index].id, status: 'ready', batch: [] }));
        job = data().saveRatingJob({ id: randomUUID(), project: projectID, session: sessions[0].id, model: researchModels[0].id,
          targets: targets.map(row => row.id), status: 'starting', summary: `Preparing ${targets.length} models…`, createdAt: Date.now(),
          progress: { rows: targets, queue: targets, workers: workerRows, updated: [], missing: [], variant: free ? '' : variant,
            free, workspace, agent, models, connected: providers.connected } });
        await submit(job, p);
        return publicJob(data().ratingJob(job.id));
      } catch (error) {
        if (job) data().saveRatingJob({ ...job, status: 'failed', summary: 'Could not start the configuration task.', error: error.message });
        throw error;
      } finally { starting = false; release(); watch(); }
    },
    async quiesceForLocalDataMaintenance() {
      if (active(data().currentRatingJob()) || checking || starting || stopping)
        throw Error('Wait for model ratings activity to finish before resetting local search indexes.');
      clearInterval(timer);
      timer = null;
      release();
    },
    close() { clearInterval(timer); timer = null; if (ownsLocalData) dataService.close(); },
  };
}
