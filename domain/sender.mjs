// Pure sender state. Native status/messages/receipts, not a browser spinner,
// decide when it is safe to start the next parent turn.
export function senderState(chat, session) {
  if (!chat || !chat.status || !Array.isArray(chat.messages))
    throw Error('Chat state is unavailable. Nothing was sent.');
  const status = chat.status[session]?.type ?? 'idle';
  if (!['idle', 'busy', 'retry'].includes(status))
    throw Error('Chat state is unknown. Nothing was sent.');
  const approvals = !!(chat.permissions?.length || chat.questions?.length);
  // Imported records are presentation history, never evidence of native work.
  const messages = chat.messages.filter(message => !message.info?.imported);
  const user = messages.findLast(m => m.info?.role === 'user');
  const receipt = [...(chat.receipts ?? [])].reverse().find(r => ['accepted', 'observed'].includes(r.status));
  const awaitingReceipt = !!(receipt && !messages.some(m => m.info?.id === receipt.id));
  const replies = user ? messages.filter(m => m.info?.role === 'assistant' && m.info?.parentID === user.info.id) : [];
  const last = replies.at(-1);
  const staleTools = (user ? replies : messages).some(m => m.parts?.some(p => p.type === 'tool' && ['running', 'pending'].includes(p.state?.status)));
  const tools = status !== 'idle' && staleTools;
  const complete = !user || !!(last?.info.time?.completed && (last.info.error || (last.info.finish && last.info.finish !== 'tool-calls')));
  // Some native failures leave a stale busy status behind. A terminal
  // assistant error with no live tool or approval is stronger evidence than
  // that stale status: stop treating the chat as running so the user can send
  // a recovery message and queued delivery can record the failure.
  const failed = !!last?.info?.error && !approvals && !tools;
  // A busy native session may be doing slow inference even with no assistant
  // message yet. Elapsed time alone cannot authorize another parent turn.
  // Native idle with an older unanswered turn is recoverable after the brief
  // acceptance/status transition window has passed.
  const userAge = user?.info?.time?.created == null ? 0 : Date.now() - user.info.time.created;
  const interrupted = !approvals && !awaitingReceipt &&
    (status === 'idle' && (staleTools || !!user && !complete && userAge > 3000) ||
      status !== 'idle' && !tools &&
      (!!user && complete || !user && messages.some(m => m.info?.role === 'assistant')));
  const busy = !failed && !interrupted && (status !== 'idle' || approvals || tools || awaitingReceipt || !complete);
  return { busy, approvals, ready: !busy, userID: user?.info.id, failed, interrupted,
    failure: failed ? String(last.info.error) : interrupted ? 'This response appears to have stopped. Inspect the chat, then send a recovery message to continue.' : '' };
}

export function normalizeIntent(input) {
  if (!['queue', 'clarify'].includes(input.kind)) throw Error('Choose Queue or Delegate.');
  if (typeof input.id !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(input.id)) throw Error('Invalid delivery ID.');
  if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 190000) throw Error('Write a message of at most 190,000 characters.');
  if (!(input.kind === 'clarify' && input.model === 'auto') && (typeof input.model !== 'string' || !/^[\w.:-]+\/[^\s]+$/.test(input.model) || input.model.length > 500)) throw Error('Choose an available model.');
  for (const key of ['workflowID', 'agentID', 'variant']) {
    if (input[key] !== undefined && (typeof input[key] !== 'string' || input[key].length > 100)) throw Error(`Invalid ${key}.`);
  }
  return { id: input.id, kind: input.kind, text: input.text, model: input.model,
    workflowID: input.workflowID ?? 'build', agentID: input.agentID ?? 'inherit', variant: input.variant ?? '' };
}

export function clarifyPrompt(text, model, id, original = '') {
  return `[Freelancer Delegate handoff ${id}]\n` +
    `The user submitted a bounded concern while the original task continues. This is not a request to stop or replace that task.\n` +
    (model === 'auto'
      ? `At your next safe tool boundary, use delegate with an appropriate named agent and bounded task from the supplied catalog for the concern below, using its saved model default or normal free-first selection when unpinned. Do not change the parent model.\n`
      : `At your next safe tool boundary, use delegate with an appropriate agent, task and model=${JSON.stringify(model)} for the concern below. The user explicitly selected this worker model. Do not change the parent model.\n`) +
    `Keep the assignment narrow, pass the relevant original-task context, preserve its exclusions and permissions, and give concurrent writers disjoint files. Do not infer source-write permission from the Delegate action itself. Continue independent original-task work and integrate the worker's result.\n` +
    `Use the normal delegation eligibility, quota and native permission checks; do not bypass them. Report a blocked/failed handoff honestly instead of claiming a worker started.\n\n` +
    (original ? `Original parent request (context and constraints, not the worker assignment):\n${original}\n\n` : '') +
    `User concern:\n${text}`;
}

export function senderAction({ busy, draft, loading, available, hasAttachments = false }) {
  if (loading) return 'loading';
  if (busy && !draft.trim()) return 'stop';
  if (busy && draft.trim()) return 'handoff';
  return available && (draft.trim() || hasAttachments) ? 'send' : 'disabled';
}
