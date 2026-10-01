// Project an owned worker's native execution state without replaying its input.
// Execution completion is independent of acceptance checks on its result.
export function nativeWorkerActivity(row, child, messages, parent, status) {
  if (child?.id !== row.child || child.parentID !== parent || !row.raw ||
      row.raw.parent_session !== parent) return row;
  if (status && status.type !== 'idle') return { ...row, phase: 'working', stale: false };
  const ordered = [...messages].sort((a, b) => (a.info?.time?.created ?? 0) - (b.info?.time?.created ?? 0));
  const user = ordered.findLast(message => message.info?.role === 'user' && !message.parts?.some(part => part.type === 'compaction'));
  const current = ordered.filter(message => message.info?.parentID === user?.info?.id);
  const reply = current.findLast(message => message.info?.role === 'assistant' && !message.info?.summary);
  const info = reply?.info;
  const model = info && `${info.providerID}/${info.modelID}`;
  const activeTool = current.some(message => message.parts?.some(part => part.type === 'tool' && ['running', 'pending'].includes(part.state?.status)));
  const terminal = info?.time?.completed && (info.error || info.finish && info.finish !== 'tool-calls');
  const identity = model === (row.dispatched ?? row.selected) && info?.agent === (row.raw.agent?.id ?? row.raw.role);
  if (!activeTool && terminal && identity) return { ...row, phase: info.error ? 'failed' : 'completed', stale: false,
    observed: model, label: info.error ? 'Native execution stopped' : 'Execution finished · result verification separate' };
  return { ...row, phase: 'idle', stale: false, label: 'Native worker is idle; parent can inspect and continue it' };
}
