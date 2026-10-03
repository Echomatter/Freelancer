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
  // A native compaction boundary is not newly submitted user work. Native
  // busy/retry still inhibits dispatch while the compactor is actually active.
  const user = messages.findLast(m => m.info?.role === 'user' && !m.parts?.some(p => p.type === 'compaction'));
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
  if (!['queue', 'clarify', 'steer'].includes(input.kind)) throw Error('Choose Queue, Delegate, or Steer.');
  if (typeof input.id !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(input.id)) throw Error('Invalid delivery ID.');
  if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 190000) throw Error('Write a message of at most 190,000 characters.');
  if (!(['clarify', 'steer'].includes(input.kind) && input.model === 'auto') && (typeof input.model !== 'string' || !/^[\w.:-]+\/[^\s]+$/.test(input.model) || input.model.length > 500)) throw Error('Choose an available model.');
  for (const key of ['agentID', 'variant']) {
    if (input[key] !== undefined && (typeof input[key] !== 'string' || input[key].length > 100)) throw Error(`Invalid ${key}.`);
  }
  return { id: input.id, kind: input.kind, text: input.text, model: input.model,
    agentID: input.agentID ?? 'engineer', variant: input.variant ?? '' };
}

export const isInternalMessage = message => message?.info?.role === 'user' && message.parts?.some(p =>
  p.type === 'text' && /^\[Freelancer (?:Delegate|Queue|Steer|Goal|Delivery) (?:handoff|activity) [\w-]+\]\n/.test(p.text ?? ''));

export function userInitiatedRequest(text) {
  const match = typeof text === 'string' && text.match(/^\[Freelancer (Delegate|Queue|Steer) handoff [\w-]+\]\n/);
  if (!match) return null;
  const marker = match[1] === 'Delegate' ? 'User concern:\n'
    : match[1] === 'Queue' ? 'User request:\n' : 'User correction:\n';
  const markerAt = text.lastIndexOf(marker);
  return { kind: match[1].toLowerCase(), text: markerAt >= 0 ? text.slice(markerAt + marker.length).trim() : text.slice(match[0].length).trim() };
}

export function queuePrompt(text, id) {
  return `[Freelancer Queue handoff ${id}]\nQueued user request. Continue it after the current response finishes, preserving the conversation's context and constraints.\n\nUser request:\n${text}`;
}

export function steerPrompt(text, id) {
  return `[Freelancer Steer handoff ${id}]\nAdjust the ongoing work at the next supported boundary. Incorporate this correction yourself; delegation is not required. Preserve the original objective except where this update changes it, native todos, outstanding workers, captured constraints, permissions, parent agent/model and goal identity. Do not cancel queued input or restart the assignment. Tools already executing may finish before this update takes effect.\n\nUser correction:\n${text}`;
}

export function clarifyPrompt(text, model, id, original = '') {
  return `[Freelancer Delegate handoff ${id}]\n` +
    `The user submitted a bounded concern while the original task continues. This is not a request to stop or replace that task.\n` +
    (model === 'auto'
      ? `At your next safe tool boundary, use delegate with an appropriate named agent and bounded task from the supplied catalog for the concern below, using its saved model default or normal eligible selection when unpinned. Do not change the parent model.\n`
      : `At your next safe tool boundary, use delegate with an appropriate named agent and bounded task using model=${JSON.stringify(model)} for the concern below. The user explicitly selected this worker model. Do not change the parent model.\n`) +
    `Keep the assignment narrow, include handoff ID ${id} in the worker task for correlation, pass the relevant original-task context, preserve its exclusions and permissions, and give concurrent writers disjoint files. Do not infer source-write permission from the Delegate action itself. Continue independent original-task work and integrate the worker's result.\n` +
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
