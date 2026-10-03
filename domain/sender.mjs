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
