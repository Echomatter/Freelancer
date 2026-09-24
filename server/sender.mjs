import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { senderState, normalizeIntent, clarifyPrompt } from '../domain/sender.mjs';

const keyOf = (project, session) => JSON.stringify([project, session]);
const pending = r => r.status === 'waiting';
const active = r => ['waiting', 'sending', 'submitted'].includes(r.status);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// This is a durable transport outbox, not another session/agent implementation.
// The application send path retains native policy, auth and request receipts.
export function createSender(app, { file = app.store?.directory && path.join(app.store.directory, 'sender-outbox.json'), interval = 750, beforeSend } = {}) {
  let rows = [], timer, closed = false, writes = Promise.resolve(), ticking;
  const locks = new Map(), stopping = new Set(), fences = new Set(), organizing = new Set();
  const publicRow = ({ fingerprint, ...r }) => ({ ...r, text: r.text ?? '' });
  async function save() {
    if (!file) return; // Explicitly supports in-memory application test doubles.
    const text = JSON.stringify({ version: 1, rows });
    const work = writes.then(async () => {
      await mkdir(path.dirname(file), { recursive: true });
      const temp = `${file}.${randomUUID()}.tmp`;
      try { await writeFile(temp, text, { mode: 0o600 }); await rename(temp, file); }
      finally { await unlink(temp).catch(() => {}); }
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
      for (const row of rows.filter(r => r.status === 'sending')) {
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
  const records = async (project, session) => Object.values((await app.store.read('requests')).records)
    .filter(r => r.projectID === project && r.sessionID === session);
  async function deliver(project, session, input) {
    const previous = (await app.store.read('settings')).chatChoices?.[session];
    const before = new Set((await records(project, session)).map(r => r.id));
    let sentChoices;
    try {
      await app.send(project, session, input);
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
    const data = await app.bootstrap(row.project, row.session);
    const candidate = data.models.find(m => m.id === row.model);
    if (row.model !== 'auto' && (!candidate || !(data.providers.connected.includes(candidate.provider) || (candidate.provider === 'opencode' && candidate.costClass === 'free'))))
      throw Error('The chosen model is no longer available. Cancel this item and choose another model.');
    if (row.kind === 'queue') return { text: row.text, model: row.model, variant: row.variant, workflowID: row.workflowID, agentID: row.agentID };
    const native = data.sessions.find(s => s.id === row.session);
    const last = [...(chat.receipts ?? [])].reverse().find(r => ['accepted', 'observed'].includes(r.status));
    const assistant = chat.messages.findLast(m => m.info?.role === 'assistant');
    if (!native || native.parentID || !last?.workflow || (assistant?.info.agent && assistant.info.agent !== last.agent?.id && assistant.info.agent !== 'build'))
      throw Error('Delegate needs an established parent chat. Use Queue for worker follow-ups.');
    const preferences = last.preferences ?? {};
    if (row.model !== 'auto' && preferences.allowedModels?.length && !preferences.allowedModels.includes(row.model))
      throw Error('This worker model is outside the active delegation budget. Choose another model.');
    const user = chat.messages.findLast(m => m.info?.role === 'user' && m.info.model);
    const model = user?.info.model ?? last.model;
    if (!model?.providerID || !model.modelID) throw Error('The active parent model is not known yet. Try again after it starts.');
    const original = chat.messages.find(m => m.info?.id === row.sourceMessageID) ?? user;
    const text = clarifyPrompt(row.text, row.model, row.id, (original?.parts ?? []).filter(p => p.type === 'text').map(p => p.text).join('\n'));
    if (text.length > 200000) throw Error('This concern plus its original request is too long. Shorten the concern or use Queue.');
    return { text, model: `${model.providerID}/${model.modelID}`,
      variant: user?.info.variant ?? last.variant ?? '', workflowID: last.workflow.id, agentID: last.agent.id };
  }
  async function pumpSession(project, session) {
    return locked(project, session, async () => {
      if (closed || stopping.has(keyOf(project, session))) return;
      const group = rows.filter(r => r.project === project && r.session === session);
      if (!group.some(active)) return;
      let chat, state;
      try { chat = await app.chat(project, session); state = senderState(chat, session); }
      catch (error) {
        for (const row of group.filter(active)) row.notice = error.message;
        await save(); return; // Unknown state is never evidence that a turn ended.
      }
      for (const row of group.filter(active)) delete row.notice;
      for (const row of group.filter(r => r.status === 'submitted')) {
        if (state.ready && chat.messages.some(m => m.info?.id === row.messageID)) {
          row.status = state.failed ? 'failed' : 'delivered';
          if (state.failed) row.error = 'The native turn ended with an error. Inspect the chat.';
        }
      }
      const row = group.find(r => pending(r) && r.kind === 'clarify') ?? group.find(pending);
      if (!row || state.approvals || (row.kind === 'queue' && (!state.ready || group.some(r => ['submitted', 'uncertain', 'failed'].includes(r.status))))) { await save(); return; }
      let input;
      try { input = await inputFor(row, chat); }
      catch (error) { row.status = 'failed'; row.error = error.message; await save(); return; }
      if (stopping.has(keyOf(project, session))) return;
      // Recheck after policy/model lookup: native state may have changed meanwhile.
      const fresh = senderState(await app.chat(project, session), session);
      if (fresh.approvals || (row.kind === 'queue' && !fresh.ready)) return;
      row.status = 'sending';
      try { await save(); } // Persist the claim BEFORE sending; never blindly replay it.
      catch (error) { row.status = 'failed'; row.error = `Could not save delivery intent. Nothing was sent. ${error.message}`; return; }
      try {
        row.messageID = await deliver(project, session, input);
        row.status = 'submitted';
        delete row.text; // OpenCode owns accepted message history.
      } catch (error) {
        row.status = 'uncertain';
        row.error = `Delivery could not be confirmed. Check the native chat before sending again. ${error.message}`;
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
    enqueue(project, session, input) {
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
        const row = { ...intent, project, session, fingerprint, sourceMessageID: chat.messages.findLast(m => m.info?.role === 'user')?.info.id, status: 'waiting', createdAt: Date.now() };
        await inputFor(row, chat); // Fail before clearing the user's draft.
        if (rows.filter(active).length >= 100) throw Error('The sender has 100 pending requests. Clear some before adding more.');
        rows.push(row);
        // Retain bounded idempotency tombstones, not accepted chat text.
        if (rows.length > 1000) rows = rows.filter(r => active(r) || r.createdAt > Date.now() - 7 * 86400000);
        try { await save(); } catch (e) { rows = rows.filter(r => r !== row); throw e; }
        return publicRow(row);
      });
    },
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
        return app.send(project, session, input);
      });
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
