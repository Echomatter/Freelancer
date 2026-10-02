// Explicit fresh-context fork from one owned managed worker receipt. Pure
// composition and validation: it decides what a new child inherits, how much
// prior evidence travels with it and how the parent must dispatch it. It never
// creates a session, stores a prompt, runs Git, selects a model or grants
// permission; the parent's normal eligible/paid/native routing stays the only
// dispatch path. Historical evidence and project-state drift are annotated, not
// discarded.
import path from 'node:path';

export const forkEvidenceBounds = Object.freeze({
  fields: Object.freeze(['summary', 'findings', 'evidence', 'changedFiles', 'validation',
    'attemptedApproaches', 'assumptions', 'risks', 'openQuestions', 'nextSteps']),
  maxSummaryChars: 1200,
  maxItemsPerField: 6,
  maxItemChars: 400,
  maxTotalChars: 2400,
  staleAfterMs: 30 * 60 * 1000,
});

export const forkRequirements = Object.freeze({
  status: 'fresh_fork_ready',
  explicit_new_task: true,
  continuation: false,
  fresh_child_session: true,
  reuse_child_session: false,
  inherits: Object.freeze(['agent', 'read_only', 'free_only']),
  tightens_only: true,
  evidence_status: 'historical_unverified',
  findings_preserved_under_drift: true,
  model_selected_by_fork: false,
  permissions_granted: Object.freeze([]),
  evidence_drift_kinds: Object.freeze(['missing_source_state', 'missing_current_state', 'stale', 'conflicting']),
  faults: Object.freeze({ ownership: 'PermissionError', task: 'InvalidTask', agent: 'BindingFailure',
    limits: 'PreferenceConstraint', shape: 'InvalidAssignment' }),
});

export function forkFault(name, message, details = undefined) {
  return Object.assign(new Error(message), { name, ...(details ? { details } : {}) });
}

const resolved = directory => {
  try {
    if (typeof directory !== 'string' || !directory.trim()) return '';
    if (/^[a-z]:[\\/]|^\\\\/i.test(directory)) return path.win32.resolve(directory).toLowerCase();
    const value = path.resolve(directory);
    return process.platform === 'win32' ? value.toLowerCase() : value;
  }
  catch { return ''; }
};
const sameDirectory = (a, b) => !!resolved(a) && resolved(a) === resolved(b);
const stamp = value => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString();
  if (Number.isFinite(value)) return new Date(value).toISOString();
  return null;
};
const ageMs = (observed, now) => {
  const at = Date.parse(stamp(observed) || '');
  return Number.isFinite(at) && Number.isFinite(now) ? Math.max(0, now - at) : null;
};
const clip = (text, limit) => {
  const value = String(text ?? '').trim().replace(/\r\n/g, '\n');
  if (value.length <= limit) return { text: value, truncated: false };
  const room = Math.max(0, limit - 1);
  const cut = value.slice(0, room);
  const boundary = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf(' '));
  return { text: `${(boundary > room * 0.6 ? cut.slice(0, boundary) : cut).trimEnd()}…`, truncated: true };
};
const textList = value => (Array.isArray(value) ? value : typeof value === 'string' ? [value] : [])
  .filter(item => typeof item === 'string' && item.trim())
  .map(item => item.trim());

function suppliedEvidence(evidence, fields) {
  if (evidence === undefined || evidence === null) return null;
  if (typeof evidence === 'string') return { summary: [evidence], unknown_fields: [] };
  if (Array.isArray(evidence)) return textList(evidence).length
    ? { notes: textList(evidence), unknown_fields: [] }
    : { summary: [], unknown_fields: [], empty: true };
  if (typeof evidence !== 'object') throw forkFault('InvalidAssignment', 'fork evidence must be bounded strings or the source worker result.', { supplied_evidence: typeof evidence });
  const known = {}, unknown_fields = [];
  for (const [key, value] of Object.entries(evidence)) {
    const field = fields.includes(key) ? key : key === 'notes' ? 'notes' : null;
    if (!field) { if (textList(value).length) unknown_fields.push(key); continue; }
    known[field] = textList(value);
  }
  return { ...known, unknown_fields };
}

function carriedEvidence({ evidence, receipt, worker, taskID, attempt, bounds, dropped }) {
  const source = evidence ? 'supplied' : receipt.worker_result ? 'receipt_worker_result' : 'none';
  const raw = evidence ?? receipt.worker_result ?? {};
  const grouped = suppliedEvidence(raw, bounds.fields) ?? {};
  const groups = [];
  if (Array.isArray(grouped.summary) || typeof raw.summary === 'string') groups.push({ field: 'summary', limit: bounds.maxSummaryChars });
  for (const field of bounds.fields) if (field !== 'summary' && textList(grouped[field]).length) groups.push({ field, limit: bounds.maxItemChars });
  if (textList(grouped.notes).length) groups.push({ field: 'notes', limit: bounds.maxItemChars });
  for (const key of grouped.unknown_fields || []) dropped.push({ field: key, reason: 'unknown_field', dropped: 1 });
  let used = 0, carried = 0, truncatedFields = [];
  const items = [];
  for (const { field, limit } of groups) {
    const perField = field === 'summary' ? 1 : bounds.maxItemsPerField;
    const values = field === 'summary' && typeof raw.summary === 'string' && !Array.isArray(grouped.summary)
      ? [raw.summary] : textList(grouped[field]);
    let kept = 0;
    for (const value of values) {
      if (kept >= perField) { dropped.push({ field, reason: 'field_item_limit', dropped: values.length - kept }); break; }
      if (used >= bounds.maxTotalChars) { dropped.push({ field, reason: 'total_budget', dropped: values.length - kept }); break; }
      const clipped = clip(value, Math.min(limit, bounds.maxTotalChars - used));
      const room = bounds.maxTotalChars - used;
      if (clipped.text.length > room) { dropped.push({ field, reason: 'total_budget', dropped: values.length - kept }); break; }
      if (clipped.truncated) truncatedFields.push(field);
      used += clipped.text.length;
      kept += 1; carried += 1;
      items.push({ field, text: clipped.text, status: forkRequirements.evidence_status, source: source === 'none' ? 'unrecorded' : source,
        source_task: taskID, source_worker: worker,
        recorded_at: attempt?.completed_at ?? receipt.created_at ?? null,
        recorded_status: receipt.worker_result?.validationStatus ?? 'unverified' });
    }
  }
  return { evidence: { source, label: 'Historical, unverified evidence from the source worker. Inspect the source session before relying on it.',
    status: forkRequirements.evidence_status, items, item_count: carried,
    bounds: { ...bounds, fields: [...bounds.fields], chars_used: used },
    truncated_fields: [...new Set(truncatedFields)], dropped },
    evidence_source: source };
}

function stateDrift({ receipt, current, now, bounds }) {
  const source = receipt.project_state || (receipt.state_fingerprint
    ? { fingerprint: receipt.state_fingerprint, ref: receipt.git_ref ?? null, observed_at: receipt.created_at ?? null } : null);
  const sourceFingerprint = source?.fingerprint ?? null;
  const currentFingerprint = current?.fingerprint ?? null;
  const drift = [], warnings = [];
  if (!sourceFingerprint) {
    drift.push('missing_source_state');
    warnings.push('The source worker recorded no project-state fingerprint, so its findings cannot be tied to a working tree.');
  }
  if (!currentFingerprint) {
    drift.push('missing_current_state');
    warnings.push('No current project-state fingerprint was observed, so drift against the source evidence could not be compared.');
  }
  const observedAge = ageMs(source?.observed_at, now);
  if (sourceFingerprint && currentFingerprint && sourceFingerprint !== currentFingerprint) {
    drift.push('conflicting');
    warnings.push('The project state changed after the source evidence was gathered. Re-verify its findings against the current tree before acting on them.');
  } else if (sourceFingerprint && currentFingerprint && observedAge !== null && observedAge > bounds.staleAfterMs) {
    drift.push('stale');
    warnings.push(`Source project-state evidence is ${Math.round(observedAge / 60000)} minutes old. Treat it as stale until rechecked.`);
  }
  if (source?.ref && current?.ref && source.ref !== current.ref) {
    drift.push('conflicting');
    warnings.push(`Recorded ref ${source.ref} differs from the current ref ${current.ref}.`);
  }
  const comparable = !!sourceFingerprint && !!currentFingerprint;
  const consistent = comparable ? sourceFingerprint === currentFingerprint : null;
  if (comparable && consistent) warnings.push('Source and current project-state fingerprints match; carried findings are still unverified worker claims.');
  return { project_state: { source: sourceFingerprint ? { fingerprint: sourceFingerprint, ref: source.ref ?? null, observed_at: stamp(source.observed_at) } : null,
    current: currentFingerprint ? { fingerprint: currentFingerprint, ref: current.ref ?? null, observed_at: stamp(current.observed_at) } : null,
    comparable, consistent, drift: [...new Set(drift)], warnings,
    annotation_only: true, findings_preserved: true, stale_after_ms: bounds.staleAfterMs } };
}

export function composeWorkerFork(input = {}) {
  const { sourceReceipt: receipt, parent = {}, projectState = null, bounds = forkEvidenceBounds } = input;
  const now = Number.isFinite(Date.parse(stamp(input.now) || '')) ? Date.parse(stamp(input.now)) : Date.now();
  if (input.continuation === true || input.delivery !== undefined || input.fresh === false)
    throw forkFault('InvalidAssignment', 'A fork starts one fresh child session. Use worker+task without fork, or steer/queue, for the existing worker.', { supplied_delivery: input.delivery ?? null });
  const worker = typeof input.worker === 'string' ? input.worker.trim() : '';
  if (!worker) throw forkFault('InvalidAssignment', 'fork requires worker: the child session ID from workers:true or a worker receipt.', { supplied_worker: input.worker ?? null });
  if (!receipt || typeof receipt !== 'object')
    throw forkFault('PermissionError', 'This worker does not belong to this parent and project.', { supplied_worker: worker });
  const taskID = receipt.task_id;
  if (!/^[a-f0-9]{64}$/.test(taskID ?? ''))
    throw forkFault('PermissionError', 'This worker does not belong to this parent and project.', { supplied_worker: worker, supplied_task_id: taskID ?? null });
  if (!parent.sessionID || !parent.directory)
    throw forkFault('InvalidAssignment', 'fork requires the owning parent session ID and project directory.', { source_worker: worker });
  if (receipt.parent_session !== parent.sessionID)
    throw forkFault('PermissionError', 'This worker does not belong to this parent and project.', { source_worker: worker, owner: receipt.parent_session ?? null });
  if (!sameDirectory(receipt.directory, parent.directory))
    throw forkFault('PermissionError', 'This worker belongs to a different project directory.', { source_worker: worker, source_directory: receipt.directory ?? null });
  const child = input.sourceChild;
  if (child && typeof child === 'object') {
    if (child.parentID !== parent.sessionID)
      throw forkFault('PermissionError', 'This worker does not belong to this parent and project.', { source_worker: worker, native_parent: child.parentID ?? null });
    if (child.directory && !sameDirectory(child.directory, parent.directory))
      throw forkFault('PermissionError', 'This worker belongs to a different project directory.', { source_worker: worker, native_directory: child.directory ?? null });
  }
  const attempts = Array.isArray(receipt.attempts) ? receipt.attempts.filter(attempt => attempt && typeof attempt === 'object') : [];
   const attempt = attempts.find(row => row.child_session === worker);
   if (!attempt)
    throw forkFault('PermissionError', 'This worker does not belong to this parent and project.', { source_worker: worker, source_task: taskID });
  const agent = receipt.agent || (typeof receipt.agent_id === 'string' ? { id: receipt.agent_id, name: receipt.agent_id } : null);
  if (!agent?.id) throw forkFault('PermissionError', 'The source worker receipt names no agent.', { source_worker: worker });
  if (input.agentID && input.agentID !== agent.id)
    throw forkFault('BindingFailure', 'A fork inherits the source worker agent. Omit agent, or start a separate assignment for another agent.', { source_agent: agent.id, supplied_agent: input.agentID });
  if (typeof input.task !== 'string' || !input.task.trim())
    throw forkFault('InvalidTask', 'A fork needs a new bounded task describing what this fresh child must do. It is not a continuation of the source worker.', { source_worker: worker, source_task: taskID });
  const sourceReadOnly = receipt.read_only === true;
  const sourceFreeOnly = receipt.free_only === true;
  const parentReadOnly = parent.readOnly === true || input.readOnly === true;
  const parentFreeOnly = parent.freeOnly === true || input.freeOnly === true;
  if (input.needsWrites === true && (sourceReadOnly || parentReadOnly))
    throw forkFault('PermissionError', 'Read-only constraints from the source worker or the parent cannot be relaxed by a fork.', { source_worker: worker, source_read_only: sourceReadOnly, parent_read_only: parentReadOnly });
  if (input.readOnly === false && (sourceReadOnly || parentReadOnly))
    throw forkFault('PermissionError', 'Read-only constraints from the source worker or the parent cannot be relaxed by a fork.', { source_worker: worker });
  if (input.freeOnly === false && (sourceFreeOnly || parentFreeOnly))
    throw forkFault('PreferenceConstraint', 'The free-only constraint inherited from the source worker or the parent cannot be relaxed by a fork.', { source_worker: worker, source_free_only: sourceFreeOnly, parent_free_only: parentFreeOnly });
  const readOnly = sourceReadOnly || parentReadOnly || input.needsWrites === false || input.inspectionOnly === true;
  const freeOnly = sourceFreeOnly || parentFreeOnly || input.freeOnly === true;
  const tightened = [];
  if (parentReadOnly && !sourceReadOnly) tightened.push('read_only');
  if (parentFreeOnly && !sourceFreeOnly) tightened.push('free_only');
  if (input.needsWrites === false || input.inspectionOnly === true) tightened.push('read_only');
  if (input.freeOnly === true) tightened.push('free_only');
  const dropped = [];
  const carried = carriedEvidence({ evidence: input.evidence, receipt, worker, taskID, attempt, bounds, dropped });
  const drift = stateDrift({ receipt, current: projectState, now, bounds });
  const suppliedModel = input.model ?? input.selectedModel ?? null;
  const notices = [
    'Fork composition only. No child session, prompt, Git action or dispatch was performed here.',
    'Dispatch this as a new assignment with a fresh child session; do not continue, steer or queue the source worker.',
    'Model selection stays with normal eligible, paid and native routing. This fork selects and grants nothing.',
    'Carried evidence is historical and unverified; inspect the source session and re-verify claims before acting on them.',
  ];
  if (dropped.length) notices.push(`${dropped.reduce((total, row) => total + (row.dropped || 0), 0)} evidence item(s) exceeded the fork bounds and were not carried.`);
  for (const warning of drift.project_state.warnings) notices.push(warning);
  return {
    status: forkRequirements.status,
    source: { task_id: taskID, worker, parent_session: receipt.parent_session,
      agent: { id: agent.id, name: agent.name ?? agent.id },
      captured: { read_only: sourceReadOnly, free_only: sourceFreeOnly, created_at: stamp(receipt.created_at),
        receipt_status: receipt.status ?? null, selected_model: attempt?.selected_model ?? null },
      native_status: input.sourceChild?.status ?? null },
    dispatch: { fresh_child: true, continuation: false, reuse_child_session: false, delivery: null,
      agentID: agent.id, task: input.task.trim(), directory: parent.directory, parent_session: parent.sessionID,
      source_worker: worker, source_task_id: taskID,
      needsWrites: !readOnly, read_only: readOnly, inspection_only: readOnly, free_only: freeOnly,
      inherited_from_source: { agent: agent.id, read_only: sourceReadOnly, free_only: sourceFreeOnly },
      tightened_by_parent: [...new Set(tightened)] },
    routing: { mode: 'normal_eligible_routing', selected_model: null, supplied_model: suppliedModel ?? null,
      ignored: [],
      permission_required: ['eligible budget and surface policy', 'native task permission', 'paid_delegate for any non-free route'],
      granted: [], note: 'A fork never pins or grants a model; an explicit model is validated by normal routing, never inherited from the source.' },
    evidence: carried.evidence,
    project_state: drift.project_state,
    requirements: { ...forkRequirements, inherits: [...forkRequirements.inherits], permissions_granted: [],
      evidence_drift_kinds: [...forkRequirements.evidence_drift_kinds], faults: { ...forkRequirements.faults } },
    notices,
    result: `Fork composed for a fresh child of @${agent.name ?? agent.id} from worker ${worker} (source task ${taskID}). ${carried.evidence.item_count} historical evidence item(s) carried${carried.evidence.dropped.length ? `, ${carried.evidence.dropped.length} bound(s) dropped` : ''}${drift.project_state.drift.length ? `; project-state drift: ${drift.project_state.drift.join(', ')}` : ''}. No session started, no model selected, no permission granted: dispatch the new task through normal routing and verify the source findings yourself.`,
  };
}
