import { createHash,randomUUID } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readStateText as readFile,writeState } from '../backend/tools/runtime/state-database.mjs';
import { clarifyPrompt,isInternalMessage,normalizeIntent,queuePrompt,senderState,steerPrompt } from '../domain/sender.mjs';

const keyOf = (project, session) => JSON.stringify([project, session]);
const pending = r => r.status === 'waiting';
const active = r => ['waiting', 'interrupting', 'sending', 'submitted'].includes(r.status);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const isDelegateHandoff = isInternalMessage;
const handoff = row => ['clarify', 'steer'].includes(row.kind);

// This is a durable transport outbox, not another session/agent implementation.
// The application send path retains native policy, auth and request receipts.
export function createSender(app, { file = app.store?.directory && path.join(app.store.directory, 'sender-outbox.json'), interval = 750, beforeSend, executionFor } = {}) {
  let rows = [], timer, closed = false, writes = Promise.resolve(), ticking;
  const locks = new Map(), stopping = new Set(), fences = new Set(), organizing = new Set();
  const publicRow = ({ fingerprint, execution, ...r }) => ({ ...r, text: r.text ?? '' });
  async function save() {
    if (!file) return; // Explicitly supports in-memory application test doubles.
    const text = JSON.stringify({ version: 1, rows });
    const work = writes.then(async () => {
      writeState(file, JSON.parse(text));
    });
    writes = work.catch(() => {});
    return work;
  }
  const ready = (async () => {
    if (!file) return;
    try {
      const data = JSON.parse(await readFile(file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.rows) || data.rows.some(r => !r.id || !r.project || !r.session)) throw Error('Invalid outbox');
      rows = data.rows;
      for (const row of rows.filter(r => r.kind === 'interrupt' && active(r))) {
        row.status = 'uncertain'; row.error = 'Legacy interrupt retained. Inspect the chat before continuing.';
      }
      for (const row of rows.filter(r => ['sending', 'interrupting'].includes(r.status))) {
        row.status = 'uncertain';
        row.error = 'The server restarted during delivery. Check the native chat before sending again.';
      }
      await save();
    } catch (e) {
      if (e.code !== 'ENOENT') throw Error('Cannot read the sender outbox; existing data was preserved.');
    }
  })();
  function locked(project, session, action) {
    if (closed) return Promise.reject(Error('The sender is closing. Restart Freelancer before making changes.'));
    const key = keyOf(project, session);
    const work = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => { await ready; if (fences.has(project)) throw Error("History is being organized. Try again shortly."); return action(); });
    locks.set(key, work);
    const cleanup = () => { if (locks.get(key) === work) locks.delete(key); };
    work.then(cleanup, cleanup);
    return work;
  }
  const records = async (project, session) => (app.store.requestSummaries ? await app.store.requestSummaries(project, session) : Object.values((await app.store.read('requests')).records))
    .filter(r => r.projectID === project && r.sessionID === session);
  async function deliver(project, session, input, execution) {
    const previous = (await app.store.read('settings')).chatChoices?.[session];
    const before = new Set((await records(project, session)).map(r => r.id));
    let sentChoices;
    try {
      await app.send(project, session, input, execution);
      sentChoices = (await app.store.read('settings')).chatChoices?.[session];
      const added = (await records(project, session)).filter(r => !before.has(r.id));
      if (added.length !== 1) throw Error('Native acceptance could not be correlated. Check the chat before resending.');
      return added[0].id;
    } finally {
      // Per-request overrides must not become the next normal composer default.
      // Preserve concurrent settings edits rather than restoring unconditionally.
      sentChoices ??= (await app.store.read('settings')).chatChoices?.[session];
      if (sentChoices && sentChoices.model === input.model) {
        await app.store.update('settings', s => {
          if (isDeepStrictEqual(s.chatChoices?.[session], sentChoices)) {
            s.chatChoices = { ...s.chatChoices };
            if (previous === undefined) delete s.chatChoices[session];
            else s.chatChoices[session] = previous;
          }
          return s;
        });
      }
    }
  }
  async function inputFor(row, chat) {
    await beforeSend?.(row.project, row.session);
    if (row.execution?.worker) {
      const c = row.execution.captured;
      return { text: row.kind === 'steer' ? steerPrompt(row.text, row.id) : queuePrompt(row.text, row.id),
        model: `${c.model.providerID}/${c.model.modelID}`, variant: c.variant ?? '', agentID: c.agent.id };
    }
    const data = await app.bootstrap(row.project, row.session);
    const candidate = data.models.find(m => m.id === row.model);
    if (row.model !== 'auto' && (!candidate || !(data.providers.connected.includes(candidate.provider) || (candidate.provider === 'opencode' && candidate.costClass === 'free'))))
      throw Error('The chosen model is no longer available. Cancel this item and choose another model.');
    if (!handoff(row)) return { text: queuePrompt(row.text, row.id), model: row.model, variant: row.variant, agentID: row.agentID };
    const native = data.sessions.find(s => s.id === row.session);
    const last = row.sourceRequestID
      ? (chat.receipts ?? []).find(r => r.id === row.sourceRequestID)
      : [...(chat.receipts ?? [])].reverse().find(r => ['accepted', 'observed'].includes(r.status));
    const assistant = chat.messages.findLast(m => m.info?.role === 'assistant');
    if (!native || native.parentID || !last?.agent || (assistant?.info.agent && assistant.info.agent !== last.agent?.id && assistant.info.agent !== 'build'))
      throw Error('Delegate and Steer need an established parent chat. Use Queue for worker follow-ups.');
    const preferences = last.preferences ?? {};
    if (row.kind === 'clarify' && row.model !== 'auto' && preferences.allowedModels?.length && !preferences.allowedModels.includes(row.model))
      throw Error('This worker model is outside the active delegation budget. Choose another model.');
    const user = chat.messages.find(m => m.info?.id === last.id) ?? chat.messages.findLast(m => m.info?.role === 'user' && m.info.model);
    const model = user?.info.model ?? last.model;
    if (!model?.providerID || !model.modelID) throw Error('The active parent model is not known yet. Try again after it starts.');
    const original = chat.messages.find(m => m.info?.id === row.sourceMessageID) ??
      chat.messages.findLast(m => m.info?.role === 'user' && !isDelegateHandoff(m));
    const text = row.kind === 'steer' ? steerPrompt(row.text, row.id) : clarifyPrompt(row.text, row.model, row.id, (original?.parts ?? []).filter(p => p.type === 'text').map(p => p.text).join('\n'));
    if (text.length > 200000) throw Error('This concern plus its original request is too long. Shorten the concern or use Queue.');
    return { text, model: `${model.providerID}/${model.modelID}`,
      variant: user?.info.variant ?? last.variant ?? '', agentID: last.agent.id };
  }
  async function pumpSession(project, session) {
    return locked(project, session, async () => {
      if (closed || stopping.has(keyOf(project, session))) return;
      const group = rows.filter(r => r.project === project && r.session === session);
      if (!group.some(active)) return;
      for (const r of group.filter(r => pending(r) && r.execution?.automatic)) {
        const goal = (await app.store.read('goals')).records?.[r.execution.goal.id];
        if (goal?.status !== 'running' || goal.runID !== r.execution.goal.runID) {
          r.status = 'cancelled'; r.notice = 'Automatic continuation inhibited because the goal is paused.'; delete r.text;
        }
      }
      let chat, state;
      try { chat = await app.chat(project, session); state = senderState(chat, session); }
      catch (error) {
        for (const row of group.filter(active)) row.notice = error.message;
        await save(); return; // Unknown state is never evidence that a turn ended.
      }
      for (const row of group.filter(active)) delete row.notice;
      for (const row of group.filter(r => r.status === 'submitted')) {
        // An observed delegate result is distinct from admission and inclusion.
        const action = chat.messages.flatMap(m => m.parts ?? []).find(p => p.type === 'tool' && p.tool === 'delegate' && p.state?.status === 'completed' && JSON.stringify(p.state.input ?? {}).includes(row.id) && p.state.metadata?.freelancer_activity?.child_session);
        if (action) row.actedOn = { at: Date.now(), toolPartID: action.id, worker: action.state.metadata.freelancer_activity.child_session };
        const included = chat.inputEvidence?.find(e => e.messageIDs.includes(row.messageID));
        if (included) row.includedAt ??= included.at;
        if (handoff(row) && state.ready && !row.includedAt) {
          // Native record existence is acceptance, not input consumption. A
          // confirmed idle, unprocessed handoff gets ONE compact continuation.
          const nativeIdle = (chat.nativeStatus ?? chat.status)[session]?.type === 'idle' || !Object.hasOwn(chat.nativeStatus ?? chat.status, session);
          const seen = chat.messages.some(m => m.info?.id === row.messageID);
          const attempted = chat.messages.some(m => m.info?.role === 'assistant' && m.info.parentID === row.messageID);
          if (nativeIdle && seen && !attempted && !row.recoveryID && Array.isArray(chat.inputEvidence) && chat.inputEvidence.length && !state.approvals && !group.some(r => r.kind === 'queue' && active(r))) {
            row.recoveryID = randomUUID(); await save();
            try { await deliver(project, session, { ...(await inputFor({ ...row, text: 'Reconcile the saved handoff in this conversation.' }, chat)), text: `[Freelancer Delivery activity ${row.recoveryID}]\nProcess the saved handoff ${row.id} above if still unprocessed. Preserve the ongoing task and todos. Do not repeat completed actions.` }, row.execution); }
            catch (error) { row.status = 'uncertain'; row.error = error.message; }
            await save(); return;
          }
          row.status = 'uncertain'; row.error = 'Input consumption could not be verified. Inspect the native chat; this handoff will not be replayed.';
        } else if (state.ready && chat.messages.some(m => m.info?.id === row.messageID)) {
          row.status = state.failed || state.interrupted ? 'failed' : 'delivered';
          if (row.status === 'failed') row.error = 'The native turn stopped before completion. Inspect the chat before continuing queued work.';
        }
      }
      const row = group.find(r => pending(r) && handoff(r)) ?? group.find(r => pending(r) && !r.execution?.automatic) ?? group.find(pending);
      if (!row || (state.approvals && !handoff(row)) || (!handoff(row) && (!state.ready || group.some(r => ['submitted', 'uncertain', 'failed'].includes(r.status))))) { await save(); return; }
      if (row.execution?.worker) {
        if (row.kind === 'queue' && ['busy', 'retry'].includes((chat.nativeStatus ?? chat.status)[session]?.type)) { await save(); return; }
        try {
          if (!await app.workerDeliveryGuard(project, session, row.execution)) { row.notice = 'Waiting for a free worker slot.'; await save(); return; }
        } catch (error) { row.status = 'failed'; row.error = error.message; await save(); return; }
      }
      let input;
      try { input = await inputFor(row, chat); }
      catch (error) { row.status = 'failed'; row.error = error.message; await save(); return; }
      if (stopping.has(keyOf(project, session))) return;
      // Recheck after policy/model lookup: native state may have changed meanwhile.
      const fresh = senderState(await app.chat(project, session), session);
      if (!handoff(row) && (fresh.approvals || !fresh.ready)) return;
      row.status = 'sending';
      try { await save(); } // Persist the claim BEFORE sending; never blindly replay it.
      catch (error) { row.status = 'failed'; row.error = `Could not save delivery intent. Nothing was sent. ${error.message}`; return; }
      try {
        row.messageID = await deliver(project, session, input, row.execution);
        row.status = 'submitted';
        delete row.text; // OpenCode owns accepted message history.
      } catch (error) {
        row.status = error.code === 'WORKER_CAPACITY' ? 'waiting' : error.code === 'GOAL_INHIBITED' ? 'cancelled' : 'uncertain';
        row.error = error.code === 'WORKER_CAPACITY' ? error.message : `Delivery could not be confirmed. Check the native chat before sending again. ${error.message}`;
      }
      await save();
    });
  }
  function tick() {
    if (ticking) return ticking;
    const work = ready.then(async () => {
      const groups = new Map(rows.filter(active).map(r => [keyOf(r.project, r.session), r]));
      await Promise.all([...groups.values()].map(r => pumpSession(r.project, r.session)));
    });
    ticking = work;
    const done = () => { if (ticking === work) ticking = undefined; };
    work.then(done, done);
    return work;
  }
  return {
    ready, tick,
    organize(project, action) {
      if (closed) return Promise.reject(Error('The sender is closing. Restart Freelancer before making changes.'));
      if (fences.has(project)) return Promise.reject(Error('History is already being organized.'));
      fences.add(project);
      const work = (async () => {
        try {
          await ready;
          await Promise.allSettled([...locks].filter(([key]) => JSON.parse(key)[0] === project).map(([, promise]) => promise));
          const unresolved = rows.filter(r => r.project === project && ['waiting', 'sending', 'submitted', 'uncertain', 'failed'].includes(r.status));
          return await action(unresolved);
        } finally { fences.delete(project); }
      })();
      organizing.add(work);
      const done = () => organizing.delete(work);
      work.then(done, done);
      return work;
    },
    start() { if (!timer && !closed) { timer = setInterval(() => { void tick().catch(() => {}); }, interval); timer.unref?.(); } },
    async close() { closed = true; clearInterval(timer); await Promise.allSettled([...locks.values(), ...organizing]); await writes; },
    async list(project, session) {
      await ready;
      await app.chat(project, session); // Always validate project/session ownership.
      return rows.filter(r => r.project === project && r.session === session && !['cancelled', 'dismissed', 'delivered'].includes(r.status)).map(publicRow);
    },
    enqueue(project, session, input, execution) {
      return locked(project, session, async () => {
        const intent = normalizeIntent(input), fingerprint = digest({ project, session, ...intent });
        const previous = rows.find(r => r.id === intent.id);
        if (previous) {
          if (previous.fingerprint !== fingerprint) throw Error('This delivery ID belongs to a different request.');
          return publicRow(previous);
        }
        if (stopping.has(keyOf(project, session))) throw Error('The chat is stopping. Try again after it stops.');
        const chat = await app.chat(project, session);
        senderState(chat, session);
        const row = { ...intent, project, session, fingerprint,
          sourceMessageID: chat.messages.findLast(m => m.info?.role === 'user' && !isDelegateHandoff(m))?.info.id,
          status: 'waiting', createdAt: Date.now(), execution: execution ?? await executionFor?.(project, session) };
        if (handoff(row) && !execution?.worker) {
          row.sourceRequestID = [...(chat.receipts ?? [])].reverse().find(r => ['accepted', 'observed'].includes(r.status))?.id;
          const captured = (await app.store.read('requests')).records?.[row.sourceRequestID];
          if (captured) row.execution = { ...row.execution, captured };
        }
        await inputFor(row, chat); // Fail before clearing the user's draft.
        if (rows.filter(active).length >= 100) throw Error('The sender has 100 pending requests. Clear some before adding more.');
        rows.push(row);
        // Retain bounded idempotency tombstones, not accepted chat text.
        if (rows.length > 1000) rows = rows.filter(r => active(r) || r.createdAt > Date.now() - 7 * 86400000);
        try { await save(); } catch (e) { rows = rows.filter(r => r !== row); throw e; }
        return publicRow(row);
      });
    },
    edit(project, session, id, text, version, execution) {
      return locked(project, session, async () => {
        await app.chat(project, session);
        const row = rows.find(r => r.id === id && r.project === project && r.session === session);
        if (!row || row.status !== 'waiting') throw Error('Only a message still saved for delivery can be edited. Sent input requires a new Steer.');
        if ((row.version ?? 0) !== version) throw Error('This pending message changed. Reload it before editing.');
        normalizeIntent({ ...row, text });
        const previous = { ...row };
        row.text = text; row.version = version + 1;
        if (execution) row.execution = { ...row.execution, ...execution };
        try { await save(); }
        catch (error) {
          for (const key of Object.keys(row)) if (!Object.hasOwn(previous, key)) delete row[key];
          Object.assign(row, previous); throw error;
        }
        return publicRow(row);
      });
    },
    async records(project, session) { await ready; return rows.filter(r => r.project === project && r.session === session).map(publicRow); },
    cancel(project, session, id) {
      return locked(project, session, async () => {
        await app.chat(project, session);
        const row = rows.find(r => r.id === id && r.project === project && r.session === session);
        if (!row) throw Error('Request not found.');
        if (!['waiting', 'uncertain', 'failed'].includes(row.status)) throw Error('This request has already been sent. Stop the native response to interrupt it.');
        row.status = pending(row) ? 'cancelled' : 'dismissed';
        delete row.text;
        await save(); return publicRow(row);
      });
    },
    send(project, session, input) {
      return locked(project, session, async () => {
        const state = senderState(await app.chat(project, session), session);
        if (stopping.has(keyOf(project, session)) || state.busy || rows.some(r => r.project === project && r.session === session && ['waiting', 'sending', 'submitted', 'uncertain', 'failed'].includes(r.status)))
          throw Error('This chat is running or has queued messages. Choose Queue or Delegate.');
        await beforeSend?.(project, session);
        return app.send(project, session, input, await executionFor?.(project, session));
      });
    },
    async abortForRotation(project, session, id) {
      const key = keyOf(project, session);
      stopping.add(key);
      try {
        return await locked(project, session, async () => {
          const row = rows.find(r => r.id === id && r.project === project && r.session === session);
          if (row?.status !== 'submitted') throw Error('The limited delivery is no longer running. Inspect it before switching models.');
          await app.stop(project, session);
          const chat = await app.chat(project, session);
          if (['busy', 'retry'].includes((chat.nativeStatus ?? chat.status)[session]?.type))
            throw Error('The limited native response is still active. Inspect it before switching models.');
          row.status = 'failed';
          row.error = 'Free-model retry was stopped after its native turn was confirmed idle.';
          await save();
          return publicRow(row);
        });
      } finally { stopping.delete(key); }
    },
    async stop(project, session) {
      const key = keyOf(project, session);
      stopping.add(key);
      try {
        return await locked(project, session, async () => {
          await app.chat(project, session);
          for (const row of rows.filter(r => r.project === project && r.session === session && pending(r))) { row.status = 'cancelled'; delete row.text; }
          await save();
          const result = await app.stop(project, session);
          for (const row of rows.filter(r => r.project === project && r.session === session && r.status === 'submitted')) row.status = 'delivered';
          await save(); return result;
        });
      } finally { stopping.delete(key); }
    },
  };
}
