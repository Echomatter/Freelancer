import { randomUUID, createHash } from 'node:crypto';
import { normalizePreferences } from '../shared/strategy.mjs';
import { goalContract, eligibleGoalModels, availabilityFailure } from '../domain/goals.mjs';
import { senderState } from '../domain/sender.mjs';

const ongoing = g => g.status === 'running' || ['starting', 'stopping'].includes(g.transition);
const publicGoal = ({ captured, ...g }) => g;
const text = (value, max = 190000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error('Write a nonempty goal within the text limit.');
  return value.trim();
};

export function createGoals(app, { sender, interval = 1500, now = Date.now } = {}) {
  let queue = Promise.resolve(), timer, ticking, closed = false;
  const all = async () => Object.values((await app.store.read('goals')).records);
  const put = g => app.store.update('goals', d => ({ ...d, records: { ...d.records, [g.id]: structuredClone(g) } }));
  const lock = fn => { const work = queue.catch(() => {}).then(fn); queue = work; return work; };
  const get = async (project, id) => { await app.project(project); const g = (await all()).find(g => g.id === id && g.project === project); if (!g) throw Error('Goal not found.'); return g; };
  const event = (g, kind, detail) => { g.events = [...(g.events ?? []), { at: now(), kind, detail }].slice(-100); };
  const pause = async (g, reason) => { g.status = 'paused'; g.reason = reason; delete g.transition; await put(g); };
  const ready = lock(async () => {
    for (const g of await all()) {
      if (g.creation === 'creating') { g.creation = 'uncertain'; await pause(g, 'Chat creation was interrupted. Inspect native history; a replacement will not be created automatically.'); }
      else if (ongoing(g)) {
        if (g.stopRequested || g.transition === 'stopping') await pause(g, 'Stop remains in effect after server restart.');
        else { g.status = 'running'; delete g.transition; g.reason = 'Reconciling native history after server restart'; await put(g); }
      }
    }
  });
  async function execution(g) {
    const records = (await app.store.read('requests')).records;
    const captured = { ...(g.rootRequestID ? records[g.rootRequestID] : {}), ...g.captured };
    return { captured, goal: g, contract: goalContract(g) };
  }
  async function schedule(g, reason) {
    const deliveryID = `goal_${g.id}_${g.sequence++}`;
    g.deliveryID = deliveryID; g.reason = reason; g.transition = 'starting'; g.unsettled = true;
    await put(g); // Claim before enqueue: a crash never silently repeats inference.
    try {
      await sender.enqueue(g.project, g.session, { id: deliveryID, kind: 'queue',
        text: `[Freelancer Goal activity ${g.id}]\n${reason}\nContinue goal revision ${g.revision} in this conversation. Orient from the goal contract, native todos and outstanding workers.`,
        model: g.model, agentID: g.agentID, variant: g.variant }, { ...await execution(g), automatic: true });
      delete g.transition; await put(g);
    } catch (error) { await pause(g, `Delivery needs inspection: ${error.message}`); }
  }
  async function reconcile(g) {
    if (g.status !== 'running' || g.transition === 'stopping') return;
    try {
      const chat = await app.chat(g.project, g.session);
      if (chat.availabilityWarnings?.length) throw Error(chat.availabilityWarnings.join(' '));
      const state = senderState(chat, g.session);
      const tree = await app.goalTree(g.project, g.session);
      await settleFailures(g, g.session, chat);
      await Promise.all(tree.filter(t => t.id !== g.session && !t.active).map(async t => {
        const records = await sender.records(g.project, t.id);
        if (records.some(d => d.status === 'failed')) await settleFailures(g, t.id, await app.chat(g.project, t.id));
      }));
      const deliveries = await sender.records(g.project, g.session);
      const workerDeliveries = (await Promise.all(tree.filter(t => t.id !== g.session).map(t => sender.records(g.project, t.id)))).flat();
      const own = deliveries.find(d => d.id === g.deliveryID);
      if (own?.messageID && !g.rootRequestID) { g.rootRequestID = own.messageID; await put(g); }
      const native = (chat.nativeStatus ?? chat.status)[g.session];
      if (g.settings.freeRotation && native?.type === 'retry' && availabilityFailure(native) &&
          own?.status === 'submitted' && chat.messages.findLast(m => m.info?.role === 'user' &&
            !m.parts?.some(p => p.type === 'compaction'))?.info.id === own.messageID) {
        const boot = await app.bootstrap(g.project, g.session);
        if (boot.models.find(m => m.id === g.model)?.costClass !== 'free')
          return pause(g, 'The selected parent model is unavailable. Inspect its error before Resume.');
        // OpenCode may keep a free-tier failure in retry until its distant reset.
        // End only this parent turn before choosing another model; never overlap
        // inference or abort the goal's independent workers.
        if (chat.messages.some(m => m.info?.parentID === own.messageID && m.parts?.some(p => p.type === 'tool' && ['running', 'pending'].includes(p.state?.status))))
          return pause(g, 'A tool is still active during model retry. Inspect the chat before Resume.');
        await sender.abortForRotation(g.project, g.session, own.id);
        await sender.cancel(g.project, g.session, own.id);
        await app.refreshUsage();
        const refreshed = await app.bootstrap(g.project, g.session);
        g.exhausted = [...new Set([...g.exhausted, g.model])];
        const next = eligibleGoalModels(refreshed.models, refreshed.providers.connected, g.settings.preferences, g.exhausted)[0];
        if (!next) return pause(g, 'No eligible free models available');
        const previous = g.model; g.model = next.id; g.variant = '';
        event(g, 'model', `${previous} → ${g.model}`);
        return schedule(g, 'Free model limit reached. Continue unfinished work; inspect existing workers first.');
      }
      if (deliveries.some(d => ['uncertain', 'failed'].includes(d.status))) {
        const last = chat.messages.findLast(m => m.info?.role === 'assistant');
        if (!(g.settings.freeRotation && availabilityFailure(last?.info.error))) return pause(g, 'Delivery or execution needs inspection. Review the chat before Resume.');
      }
      if (chat.questions?.length) return pause(g, 'Waiting for your answer');
      if (chat.permissions?.length) {
        if (g.settings.autoApprove) {
          const allowed = chat.permissions.filter(p => !/paid|git/i.test(p.permission ?? p.type ?? '') && ['read','glob','grep','edit','write','bash','webfetch','websearch','todowrite'].includes(p.permission));
          for (const p of allowed) await app.respond(g.project, 'permission', p.id, { reply: 'once' });
          if (allowed.length === chat.permissions.length) return;
        }
        return pause(g, 'Waiting for your permission');
      }
      // Raw native state, not a spinner or a guessed terminal state.
      const workersActive = tree.some(t => t.id !== g.session && t.active);
      if (tree.find(t => t.id === g.session)?.active || !state.ready) { g.reason = workersActive ? 'Working with delegated agents' : 'Working on the goal'; await put(g); return; }
      // Worker transport is the parent's recovery task, not a goal-wide user
      // confirmation. Never replay it; preserve it for native inspection.
      g.unsettled = workersActive;
      if (!state.ready || !own || ['waiting', 'sending', 'submitted'].includes(own.status)) return;
      // Explicit user input always drains before an automatic continuation.
      if (deliveries.some(d => ['waiting','sending','submitted','uncertain'].includes(d.status))) return;
      const last = chat.messages.findLast(m => m.info?.role === 'assistant' && !m.info.summary && m.info.parentID === state.userID);
      const turn = last?.info.id ?? (state.interrupted ? state.userID : undefined);
      if (!turn || g.reconciledTurn === turn) return;
      g.reconciledTurn = turn;
      if (last?.info.error) {
        g.failures++;
        if (g.settings.freeRotation && availabilityFailure(last.info.error)) {
          const boot = await app.bootstrap(g.project, g.session);
          if (boot.models.find(m => m.id === g.model)?.costClass !== 'free')
            return pause(g, 'The selected parent model is unavailable. Inspect its error before Resume.');
          g.exhausted = [...new Set([...g.exhausted, g.model])];
          const next = eligibleGoalModels(boot.models, boot.providers.connected, g.captured.preferences, g.exhausted)[0];
          if (!next) return pause(g, 'No eligible free models available');
          const previous = g.model; g.model = next.id; g.variant = '';
          event(g, 'model', `${previous} → ${g.model}`);
          for (const d of deliveries.filter(d => d.status === 'failed')) await sender.cancel(g.project, g.session, d.id);
          return schedule(g, 'Model availability changed. Continue unfinished work; inspect existing workers first.');
        }
        if (/abort|cancel/i.test(JSON.stringify(last.info.error)) && g.failures < 3)
          return schedule(g, 'The parent turn was interrupted. Recover native tasks and worker statuses yourself, preserve partial work, checkpoint and continue.');
        return pause(g, g.failures >= 3 ? 'Repeated failures without progress' : 'Native execution failed. Inspect the error before Resume.');
      }
      const checkpoint = last && g.checkpoint?.requestID === last.info.parentID ? g.checkpoint : undefined;
      if (!checkpoint) {
        g.checkpointRecoveries = (g.checkpointRecoveries ?? 0) + 1;
        if (g.checkpointRecoveries > 3) return pause(g, 'Repeated checkpoint recovery failed. Native history and partial work are preserved.');
        return schedule(g, 'The last turn ended without a current checkpoint. Recover from native history and todos, inspect and reconcile existing workers yourself, record goal_checkpoint, then continue useful unfinished work. Do not ask the user to confirm worker statuses or replay uncertain input.');
      }
      g.checkpointRecoveries = 0;
      if (checkpoint.outcome === 'pause') return pause(g, checkpoint.reason);
      if ((checkpoint.outcome === 'waiting' || checkpoint.outcome === 'complete') &&
          (workersActive || workerDeliveries.some(d => ['waiting','sending','submitted'].includes(d.status)))) {
        g.reason = 'Working with delegated agents'; delete g.reconciledTurn; await put(g); return;
      }
      const unfinished = chat.todos?.some(t => !['completed','cancelled'].includes(t.status));
      if (checkpoint.outcome === 'complete') {
        if (workerDeliveries.some(d => ['uncertain','failed'].includes(d.status))) {
          g.completionRecoveries = (g.completionRecoveries ?? 0) + 1;
          if (g.completionRecoveries > 3) return pause(g, 'Completion remains unverified: worker delivery reconciliation has not succeeded.');
          return schedule(g, 'Reconcile unresolved worker delivery from native history before claiming completion. Inspect the workers yourself, preserve uncertain input without replay, and verify the remaining work.');
        }
        if (unfinished || !checkpoint.evidence?.trim()) return pause(g, 'Completion needs evidence and reconciled native tasks');
        g.status = 'complete'; g.reason = checkpoint.reason; event(g, 'complete', checkpoint.evidence); await put(g); return;
      }
      // Repeated checkpoint prose alone is not useful progress. Compare actual
      // native successful work and todos across responses and model changes.
      const work = [...new Set(chat.messages.flatMap(m => m.parts ?? []).filter(p => p.type === 'tool' && p.state?.status === 'completed' && !['goal_checkpoint','delegate','question','skill'].includes(p.tool)).map(p => JSON.stringify([p.tool,p.state.input,p.state.output])))].sort();
      const progress = createHash('sha256').update(JSON.stringify({ todos: chat.todos, work })).digest('hex');
      g.failures = progress === g.progress ? g.failures + 1 : 0; g.progress = progress;
      if (g.failures >= 3) return pause(g, 'Repeated failures without progress');
      await schedule(g, 'Reconcile the latest checkpoint and continue useful unfinished work.');
    } catch (error) { await pause(g, `State needs reconciliation: ${error.message}`); }
  }
  async function settleFailures(g, session, chat) {
    const state = senderState(chat, session);
    if (!state.ready || state.approvals || ['busy','retry'].includes((chat.nativeStatus ?? chat.status)[session]?.type)) return;
    for (const d of await sender.records(g.project, session)) {
      const receipt = chat.receipts?.find(r => r.id === d.messageID);
      const goalInput = receipt?.goalID === g.id && receipt.goalRunID === g.runID;
      if (d.status !== 'failed' || session === g.session && d.id !== g.deliveryID && !goalInput) continue;
      const accepted = chat.messages.some(m => m.info?.role === 'user' && m.info.id === d.messageID);
      const terminal = chat.messages.some(m => m.info?.role === 'assistant' && m.info.parentID === d.messageID &&
        (m.info.error || m.info.time?.completed && m.info.finish && m.info.finish !== 'tool-calls'));
      if (accepted && (terminal || d.includedAt || session === g.session && state.interrupted)) {
        await sender.cancel(g.project, session, d.id);
        event(g, 'recovery', `Reconciled settled delivery ${d.id} in ${session}; no input replayed.`);
        await put(g);
      }
    }
  }
  const service = {
    ready,
    async list(project) { await ready; await app.project(project); return (await all()).filter(g => g.project === project).map(publicGoal); },
    async forSession(project, session) { await ready; return (await all()).find(g => g.project === project && g.session === session); },
    async executionFor(project, session) { const g = await service.forSession(project, session); return g?.status === 'running' ? execution(g) : undefined; },
    create(project, input) { return lock(async () => {
      const objective = text(input.objective);
      if (!/^[\w-]{16,60}$/.test(input.id ?? '')) throw Error('Invalid goal ID.');
      const prior = (await all()).find(g => g.id === input.id);
      if (prior) { if (prior.project !== project) throw Error('Goal ID belongs to another project.'); return publicGoal(prior); }
      const boot = await app.bootstrap(project);
      const preferences = normalizePreferences({ ...(boot.projectPreferences?.defaults ?? boot.snapshot.preferences.defaults), ...(input.settings?.preferences ?? {}) });
      const agentID = input.settings?.agentID ?? boot.sessionDefaults?.agentID ?? 'engineer';
      const agent = boot.settings.agents.find(a => a.id === agentID); if (!agent) throw Error('Choose a named agent.');
      const model = input.settings?.model || agent.model && agent.model !== 'auto' && agent.model || boot.sessionDefaults?.parentModel || boot.nativeModels?.[agentID] || boot.nativeModels?.default;
      const g = { id: input.id, project, objective, title: input.title === undefined ? objective.replace(/\s+/g, ' ').slice(0, 80) : text(input.title, 120), revision: 1,
        revisions: [], status: 'ready', reason: 'Saved; not started', session: null, creation: 'creating',
        settings: { freeRotation: input.settings?.freeRotation === true, autoApprove: input.settings?.autoApprove === true, preferences },
        agentID, model, variant: input.settings?.variant ?? boot.sessionDefaults?.reasoningVariant ?? '',
        captured: { catalog: { agents: boot.settings.agents }, preferences },
        sequence: 0, failures: 0, exhausted: [], createdAt: now(), events: [] };
      await put(g);
      try {
        const chat = await app.createChat(project, g.title); g.session = chat.id; g.creation = 'created'; await put(g);
        await app.savePreferences(project, { scope: 'session', sessionID: g.session, preferences });
      }
      catch (e) { g.creation = 'uncertain'; await pause(g, `Chat creation needs inspection: ${e.message}. A replacement will not be created automatically.`); }
      return publicGoal(g);
    }); },
    update(project, input) { return lock(async () => {
      const g = await get(project, input.id);
      if (g.transition === 'stopping') throw Error('Wait for Stop to settle before editing this goal.');
      if (input.revision !== g.revision) throw Error('This goal changed. Reload before saving.');
      const objective = text(input.objective);
      const title = input.title === undefined ? g.title : text(input.title, 120);
      if (input.settings && ongoing(g)) throw Error('Stop the goal before changing execution settings. Objective edits can be sent while running.');
      let choices;
      if (input.settings) {
        const boot = await app.bootstrap(project);
        const agentID = input.settings.agentID ?? g.agentID;
        const agent = g.captured.catalog.agents.find(a => a.id === agentID) ?? boot.settings.agents.find(a => a.id === agentID);
        if (!agent) throw Error('Choose a named agent.');
        choices = { agent, agentID, model: input.settings.model === undefined ? g.model : input.settings.model ||
          (agent.model && agent.model !== 'auto' ? agent.model : '') || boot.sessionDefaults?.parentModel || boot.nativeModels?.[agentID] || boot.nativeModels?.default };
      }
      const changed = objective !== g.objective;
      if (changed) { g.revisions.push({ revision: g.revision, objective: g.objective, at: now() }); g.objective = objective; g.revision++; delete g.checkpoint; }
      if (title !== g.title) { await app.changeChat(project, g.session, { title }); g.title = title; }
      if (input.settings) {
        g.settings = { ...g.settings, freeRotation: input.settings.freeRotation === true, autoApprove: input.settings.autoApprove === true,
          preferences: normalizePreferences({ ...g.settings.preferences, ...input.settings.preferences }) };
        g.model = choices.model; g.agentID = choices.agentID; g.variant = input.settings.variant ?? g.variant;
        if (!g.captured.catalog.agents.some(a => a.id === choices.agentID)) g.captured.catalog.agents.push(choices.agent);
        g.captured.preferences = g.settings.preferences;
        await app.savePreferences(project, { scope: 'session', sessionID: g.session, preferences: g.settings.preferences });
      }
      await put(g);
      if (g.status === 'running' && changed) {
        try {
          const pending = (await sender.records(project, g.session)).find(d => d.id === g.deliveryID && d.status === 'waiting');
          if (pending) await sender.edit(project, g.session, pending.id, `[Freelancer Goal activity ${g.id}]\nPursue objective revision ${g.revision}: ${g.objective}`, pending.version ?? 0, await execution(g));
          else await sender.enqueue(project, g.session, { id: `revision_${g.id}_${g.revision}`, kind: 'steer', model: 'auto', text: `Objective revision ${g.revision}: ${g.objective}\nThe previous objective is retained in the goal record. Incorporate the changed requirement in this same goal and plan.` }, await execution(g));
        }
        catch (e) { await pause(g, `Objective saved; steering needs inspection: ${e.message}`); }
      }
      return publicGoal(g);
    }); },
    start(project, id) { return lock(async () => {
      const g = await get(project, id);
      if (g.status === 'running') return publicGoal(g);
      if (g.transition === 'stopping') throw Error('Wait for Stop to settle before Resume.');
      if (g.archived || !g.session) throw Error('Restore the goal and resolve its linked chat before starting.');
      if ((await all()).some(other => other.project === project && other.id !== id && ongoing(other))) throw Error('Only one autonomous goal may run per project. Stop the running goal first.');
      for (const other of (await all()).filter(o => o.project === project && o.id !== id && o.unsettled && o.session)) {
        if ((await app.goalTree(project, other.session)).some(t => t.active)) throw Error('Another goal still has active native work. Stop it first.');
      }
      const chat = await app.chat(project, g.session);
      if (chat.availabilityWarnings?.length) throw Error(chat.availabilityWarnings.join(' '));
      const tree = await app.goalTree(project, g.session);
      if (tree.find(t => t.id === g.session)?.active || chat.questions?.length || chat.permissions?.length) throw Error('Resolve existing native work and pending decisions before Resume.');
      // Resume is explicit recovery after inspection, not permission to replay
      // worker input. A failed, accepted worker handoff can be acknowledged
      // only when its own native chat proves a settled turn. Preserve uncertain
      // and waiting cards so the parent can never silently duplicate work.
      for (const worker of tree.filter(t => t.id !== g.session)) {
        const pending = await sender.list(project, worker.id);
        if (!pending.length) continue;
        const workerChat = await app.chat(project, worker.id);
        const workerState = senderState(workerChat, worker.id);
        const idle = ((workerChat.nativeStatus ?? workerChat.status)[worker.id]?.type ?? 'idle') === 'idle';
        for (const d of pending) {
          const accepted = workerChat.messages.some(m => m.info?.role === 'user' && m.info.id === d.messageID);
          const terminal = workerChat.messages.some(m => m.info?.role === 'assistant' && m.info.parentID === d.messageID &&
            (m.info.error || (m.info.time?.completed && m.info.finish && m.info.finish !== 'tool-calls')));
          if (d.status === 'failed' && accepted && idle && workerState.ready && !workerState.approvals &&
              (terminal || d.includedAt)) await sender.cancel(project, worker.id, d.id);
        }
        // Leave uncertain and pending input visible for the parent to inspect.
        // Resuming the parent never grants permission to replay worker input.
      }
      const native = (chat.nativeStatus ?? chat.status)[g.session]?.type ?? 'idle';
      await settleFailures(g, g.session, chat);
      for (const d of await sender.list(project, g.session)) {
        // Resume acknowledges a confirmed, settled native failure. An uncertain
        // transport remains inspect-only and is never made replayable here.
        // Native interruption/compaction can finish without an assistant error.
        // Only this goal's accepted continuation is acknowledged in that case;
        // unrelated user deliveries must still be resolved in the chat.
        const ownStopped = d.id === g.deliveryID && native === 'idle' && chat.messages.some(m => m.info?.role === 'user' && m.info.id === d.messageID);
        if (d.status === 'failed' && (ownStopped || chat.messages.some(m => m.info?.role === 'assistant' && m.info.parentID === d.messageID && m.info.error))) await sender.cancel(project, g.session, d.id);
      }
      if ((await sender.list(project, g.session)).length) throw Error('Resolve pending or uncertain deliveries in the chat before Resume.');
      if (g.settings.freeRotation) await app.refreshUsage();
      const boot = await app.bootstrap(project, g.session);
      if (g.settings.freeRotation && boot.models.find(m => m.id === g.model)?.costClass === 'free') {
        g.exhausted = [];
        const pool = eligibleGoalModels(boot.models, boot.providers.connected, g.settings.preferences);
        const previous = g.model;
        g.model = pool.find(m => m.id === g.model)?.id ?? pool[0]?.id;
        if (g.model !== previous) g.variant = '';
        if (!g.model) { await pause(g, 'No eligible free models available'); return publicGoal(g); }
      }
      if (!boot.models.some(m => m.id === g.model)) throw Error('Choose an available parent model in goal settings.');
      g.status = 'running'; g.unsettled = true; g.stopRequested = false; g.runID ??= randomUUID();
      g.checkpointRecoveries = 0;
      g.completionRecoveries = 0;
      await schedule(g, g.rootRequestID ? 'Resume this goal from its checkpoint, native tasks and existing workers.' : `Start this saved goal: ${g.objective}`);
      return publicGoal(g);
    }); },
    async stop(project, id) {
      // Persist inhibition before waiting for transport or native aborts.
      let g;
      await lock(async () => { g = await get(project, id); g.status = 'paused'; g.stopRequested = true; g.transition = 'stopping'; g.reason = 'Stopping the parent and its workers'; await put(g); });
      try {
        let stopErrors = [];
        for (let round = 0; round < 3; round++) {
          const tree = await app.goalTree(project, g.session);
          const targets = round === 0 ? tree : tree.filter(t => t.active);
          const outcomes = await Promise.allSettled(targets.map(target => sender.stop(project, target.id)));
          stopErrors = outcomes.filter(r => r.status === 'rejected').map(r => r.reason.message);
          if (!(await app.goalTree(project, g.session)).some(t => t.active)) break;
        }
        const active = (await app.goalTree(project, g.session)).some(t => t.active);
        g.unsettled = active || stopErrors.length > 0;
        await lock(() => pause(g, g.unsettled ? `Stop not yet confirmed. Inspect workers and retry Stop.${stopErrors.length ? ' ' + stopErrors.join(' ') : ''}` : 'Stopped by you. Partial results and tasks are preserved.'));
      } catch (e) { g.unsettled = true; await lock(() => pause(g, `Stop could not be confirmed: ${e.message}`)); }
      return publicGoal(g);
    },
    archive(project, id, archived) { return lock(async () => {
      const g = await get(project, id); if (ongoing(g)) throw Error('Stop this goal before archiving.');
      if (g.unsettled || (await app.goalTree(project, g.session)).some(t => t.active)) throw Error('Confirm Stop for this goal and its workers before archiving.');
      const boot = await app.history.decorateBootstrap(await app.bootstrap(project));
      const chat = boot.sessions.find(s => s.id === g.session); if (!chat) throw Error('The linked native chat is missing. History was preserved; no replacement was created.');
      await app.history.archive(project, g.session, { archived, revision: chat.organization?.revision ?? 0 }, sender.organize);
      g.archived = archived; await put(g); return publicGoal(g);
    }); },
    checkpoint(input) { return lock(async () => {
      const { receipt, message, project } = await app.goalActor(input);
      const g = await get(project, receipt.goalID);
      if (g.status !== 'running' || receipt.goalRunID !== g.runID || receipt.goalRevision !== g.revision) throw Error('This goal is not running under this objective revision. Read the current steering before reporting.');
      if (!['continue','waiting','pause','complete'].includes(input.outcome)) throw Error('Invalid outcome.');
      g.checkpoint = { requestID: message.info.parentID, assistantID: message.info.id, at: now(), outcome: input.outcome,
        interpretation: text(input.interpretation, 12000), checkpoint: text(input.checkpoint, 12000), reason: text(input.reason, 2000), evidence: String(input.evidence ?? '').slice(0,16000) };
      await put(g); return { recorded: true, outcome: input.outcome, note: 'The controller will reconcile native work before changing goal status.' };
    }); },
    tick() {
      // Slow native reads must not enqueue one reconciliation per timer pulse:
      // that backlog starves checkpoint, Resume and explicit user operations.
      if (ticking) return ticking;
      const work = lock(async () => { if (!closed) for (const g of await all()) await reconcile(g); });
      ticking = work;
      const done = () => { if (ticking === work) ticking = undefined; };
      work.then(done, done);
      return work;
    },
    startTimer() { timer = setInterval(() => { void service.tick().catch(() => {}); }, interval); timer.unref?.(); },
    async close() { closed = true; clearInterval(timer); await queue.catch(() => {}); },
  };
  return service;
}
