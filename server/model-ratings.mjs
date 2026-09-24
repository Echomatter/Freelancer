import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createLocalDataStore } from './data/store.mjs';
import { parseModelRatings, ratingsPrompt } from '../domain/model-ratings.mjs';
import { checkedCatalog } from '../backend/tools/runtime/agent-catalog.mjs';
import { executionPrompt, policyVersion } from './execution.mjs';

const active = job => job && ['starting', 'running'].includes(job.status);
const batchSize = 6;
export function createModelRatingService({ host, backendRoot, dataRoot, project, getCatalog, store }) {
  let db, timer, checking = false, starting = false, stopping = false;
  let decisions = { permissions: [], questions: [] };
  const data = () => db ??= createLocalDataStore(dataRoot ?? path.join(backendRoot, '.state', 'local-data'));
  const release = () => { db?.close(); db = null; };
  const publicJob = job => job && ({ ...job, progress: undefined,
    missing: job.progress?.missing?.length ?? 0, variant: job.progress?.variant ?? '', ...decisions });
  const request = (p, route, options = {}) => host.request(route, { ...options, directory: p.directory });

  async function submit(job, p) {
    const progress = job.progress;
    const rows = progress.rows.slice(progress.offset, progress.offset + batchSize);
    const messageID = `msg_${randomUUID().replaceAll('-', '')}`;
    const [providerID, ...rest] = job.model.split('/');
    const { agent, workflow, workspace, models, connected } = progress;
    const metadata = { policyVersion, requestID: messageID, projectID: job.project, workflowID: 'explore',
      agentID: 'researcher', mode: 'explore', configurationTask: 'model-ratings' };
    if (store) await store.recordRequest({ id: messageID, sessionID: job.session, projectID: job.project,
      createdAt: Date.now(), status: 'prepared', policyVersion, agent, workflow, catalog: workspace,
      catalogModels: models, catalogConnected: connected, directory: p.directory,
      model: { providerID, modelID: rest.join('/') }, variant: progress.variant ?? '', delegationPool: [] });
    // Persist identity before dispatch. After a crash or ambiguous HTTP result,
    // observe this message; never send it again automatically.
    job = data().saveRatingJob({ ...job, status: 'running', error: null,
      summary: `Researching models ${progress.offset + 1}–${progress.offset + rows.length} of ${job.targets.length}…`,
      progress: { ...progress, phase: 'waiting', requestID: messageID, batch: rows.map(row => row.id), startedAt: Date.now() } });
    try {
      await request(p, `/session/${job.session}/prompt_async`, { method: 'POST', body: {
        messageID, model: { providerID, modelID: rest.join('/') }, agent: 'researcher',
        ...(progress.variant ? { variant: progress.variant } : {}),
        system: (store ? executionPrompt(agent, workflow, metadata, workspace) : '') +
          '\n\nThis background configuration request is read-only research. Do not delegate or modify files, settings, routing policy or credentials. Comparative ratings are presentation estimates. Research with native web tools and return the requested JSON for the app to save.',
        parts: [{ type: 'text', text: ratingsPrompt(rows) }],
      } });
      if (store) await store.recordRequest({ id: messageID, status: 'accepted' }).catch(() => {});
    } catch {
      data().saveRatingJob({ ...job, summary: 'Checking whether OpenCode accepted the configuration request…' });
    }
  }

  async function check() {
    if (checking || starting || stopping) return;
    let job = data().currentRatingJob();
    if (!active(job)) { clearInterval(timer); timer = null; release(); return; }
    checking = true;
    try {
      const p = await project(job.project);
      if (job.progress.phase === 'ready') { await submit(job, p); return; }
      const [messages, statuses, permissions, questions] = await Promise.all([
        request(p, `/session/${job.session}/message`), request(p, '/session/status'),
        request(p, '/permission'), request(p, '/question'),
      ]);
      if (!Array.isArray(messages) || !statuses || typeof statuses !== 'object' || Array.isArray(statuses) ||
        !Array.isArray(permissions) || !Array.isArray(questions)) throw Error('Native task status is unavailable.');
      decisions = { permissions: (permissions ?? []).filter(row => row.sessionID === job.session),
        questions: (questions ?? []).filter(row => row.sessionID === job.session) };
      const progress = job.progress;
      const busy = statuses?.[job.session]?.type && statuses[job.session].type !== 'idle';
      // Old jobs have no message identity; new batches must match their own parent.
      const answer = [...messages].reverse().find(m => m.info?.role === 'assistant' &&
        (!progress.requestID || m.info?.parentID === progress.requestID) &&
        m.info?.time?.completed && m.info?.finish !== 'tool-calls');
      if (answer && !busy && !decisions.permissions.length && !decisions.questions.length) {
        const targets = progress.batch ?? job.targets;
        let ratings = [];
        try {
          if (answer.info.error) throw Error('The selected model could not complete the research.');
          const text = (answer.parts ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n');
          ratings = parseModelRatings(text, targets, { partial: true });
        } catch { /* Keep earlier valid batches and report unresolved profiles. */ }
        data().saveModelRatings(ratings, job.model);
        const updated = [...(progress.updated ?? []), ...ratings.map(row => row.id)];
        const missing = [...(progress.missing ?? []), ...targets.filter(id => !ratings.some(row => row.id === id))];
        const offset = (progress.offset ?? 0) + targets.length;
        if (offset < job.targets.length && progress.rows && !answer.info.error) {
          job = data().saveRatingJob({ ...job, progress: { ...progress, updated, missing, offset, phase: 'ready' } });
          await submit(job, p);
        } else {
          const remaining = [...missing, ...job.targets.slice(offset)];
          data().saveRatingJob({ ...job, status: remaining.length ? 'partial' : 'completed', error: null,
            progress: { ...progress, updated, offset, missing: remaining, phase: 'done' },
            summary: remaining.length
              ? `${updated.length} models updated · ${remaining.length} models still missing details.`
              : `Done · Updated ${updated.length} model rating${updated.length === 1 ? '' : 's'}.` });
        }
      } else if (decisions.permissions.length || decisions.questions.length) {
        data().saveRatingJob({ ...job, summary: decisions.permissions.length ? 'Permission needed to continue research.' : 'The research agent needs an answer.' });
      } else if (Date.now() - (progress.startedAt ?? job.createdAt) > 20 * 60_000) {
        // A timed-out request may still be executing. Stop and verify before retry.
        await request(p, `/session/${job.session}/abort`, { method: 'POST' });
        const stopped = await request(p, '/session/status');
        if (!stopped || (stopped[job.session]?.type && stopped[job.session].type !== 'idle')) throw Error('Waiting for the configuration task to stop.');
        const missing = job.targets.filter(id => !(progress.updated ?? []).includes(id));
        data().saveRatingJob({ ...job, status: 'failed', progress: { ...progress, missing },
          summary: `Research timed out · ${missing.length} models still missing details.` });
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
        await request(p, `/session/${job.session}/abort`, { method: 'POST' });
        for (const kind of ['permission', 'question']) {
          const rows = await request(p, `/${kind}`);
          for (const row of rows.filter(row => row.sessionID === job.session)) {
            try { await request(p, `/${kind}/${encodeURIComponent(row.id)}/${kind === 'permission' ? 'reply' : 'reject'}`,
              { method: 'POST', ...(kind === 'permission' ? { body: { reply: 'reject' } } : {}) }); }
            catch (error) { if (error.status !== 404) throw error; }
          }
        }
        const statuses = await request(p, '/session/status');
        if (!statuses || (statuses[job.session]?.type && statuses[job.session].type !== 'idle')) throw Error('OpenCode has not confirmed the task stopped.');
        const missing = job.targets.filter(target => !(job.progress.updated ?? []).includes(target));
        decisions = { permissions: [], questions: [] };
        return publicJob(data().saveRatingJob({ ...job, status: 'stopped', error: null,
          progress: { ...job.progress, missing }, summary: `Stopped · ${missing.length} models still missing details.` }));
      } finally { stopping = false; release(); }
    },
    async start(projectID, modelID, retryID, variant = '') {
      if (starting || checking || stopping || active(data().currentRatingJob())) throw Error('A model ratings update is already running.');
      starting = true;
      let job;
      try {
        if (data().currentRatingJob()) throw Error('Dismiss the previous result before starting another update.');
        if (typeof modelID !== 'string' || !/^[\w.-]+\/[^\s]+$/.test(modelID)) throw Error('Choose a model for the configuration task.');
        const p = await project(projectID);
        const { models, providers } = await getCatalog(projectID);
        if (!models.some(m => m.id === modelID && providers.connected.includes(m.provider))) throw Error('Choose a connected model.');
        if (typeof variant !== 'string' || (variant && !models.find(m => m.id === modelID)?.variants?.includes(variant))) throw Error('Choose an intelligence level supported by this model.');
        const saved = data().modelRatings();
        const available = data().unratedModels().filter(m => models.some(row => row.id === m.id));
        const missing = available.filter(m => !saved[m.id]?.rating);
        const retry = retryID ? data().ratingJob(retryID) : null;
        if (retryID && (!retry || retry.project !== projectID || retry.status !== 'dismissed')) throw Error('Choose a completed configuration task to retry.');
        const targets = retry?.progress?.missing?.length
          ? available.filter(row => retry.progress.missing.includes(row.id)) : missing.length ? missing : available;
        if (!targets.length) throw Error('There are no models to update.');
        const workspace = store ? checkedCatalog(await store.read('settings')) : null;
        const agent = workspace?.agents.find(item => item.id === 'researcher');
        const workflow = workspace?.workflows.find(item => item.id === 'explore');
        if (store && (!agent || !workflow)) throw Error('The research configuration agent is unavailable.');
        const session = await request(p, '/session', { method: 'POST', body: { title: 'Configuration · Update Model Ratings' } });
        const ownDirectory = directory => process.platform === 'win32' ? path.resolve(directory).toLowerCase() : path.resolve(directory);
        if (!/^ses_[\w-]+$/.test(session?.id) || !session.directory || ownDirectory(session.directory) !== ownDirectory(p.directory))
          throw Error('The native configuration session could not be verified.');
        decisions = { permissions: [], questions: [] };
        data().remember(projectID, [session]);
        job = data().saveRatingJob({ id: randomUUID(), project: projectID, session: session.id, model: modelID,
          targets: targets.map(row => row.id), status: 'starting', summary: `Preparing ${targets.length} models…`, createdAt: Date.now(),
          progress: { rows: targets, offset: 0, updated: [], missing: [], variant, workspace, agent, workflow, models, connected: providers.connected } });
        await submit(job, p);
        return publicJob(data().ratingJob(job.id));
      } catch (error) {
        if (job) data().saveRatingJob({ ...job, status: 'failed', summary: 'Could not start the configuration task.', error: error.message });
        throw error;
      } finally { starting = false; release(); watch(); }
    },
    close() { clearInterval(timer); timer = null; release(); },
  };
}
