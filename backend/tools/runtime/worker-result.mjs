// Compact semantic handoffs. Child claims are evidence to inspect, never proof
// of task correctness. Native transcripts remain the authoritative full record.
const fields = ['findings', 'evidence', 'changedFiles', 'validation', 'attemptedApproaches', 'assumptions', 'risks', 'openQuestions', 'nextSteps'];
export const workerResultInstruction = 'Return a concise JSON object with summary and any useful fields: findings, evidence, changedFiles, validation, attemptedApproaches, assumptions, risks, openQuestions, nextSteps (arrays of strings). Report checks actually performed and limitations. Do not claim verified success from execution completion alone.';
export function workerResult(text = '', { partial = false } = {}) {
  let parsed;
  try { parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch {}
  const structured = parsed && typeof parsed.summary === 'string' && fields.every(key => parsed[key] === undefined || Array.isArray(parsed[key]) && parsed[key].every(value => typeof value === 'string'));
  const result = { summary: (structured ? parsed.summary : text).slice(0, 6000), resultSource: partial ? 'partial' : structured ? 'structured_completion' : 'final_assistant_fallback', validationStatus: 'unverified' };
  if (structured) for (const key of fields) if (parsed[key]?.length) result[key] = parsed[key].slice(0, 24).map(value => value.slice(0, 1200));
  return result;
}
export function annotateWorkerContext(result, receipt, { now = Date.now(), staleAfterMs = 30 * 60 * 1000, currentProjectState = null } = {}) {
  if (!result || typeof result !== 'object') return result;
  const timestamp = receipt?.activity?.updated_at ?? receipt?.attempts?.at(-1)?.completed_at ?? receipt?.created_at ?? null;
  const observed = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp ?? '');
  const ageMs = Number.isFinite(observed) ? Math.max(0, now - observed) : null;
  const stale = ageMs === null ? null : ageMs > staleAfterMs;
  const sourceFingerprint = receipt?.project_state?.fingerprint ?? receipt?.state_fingerprint ?? null;
  const currentFingerprint = currentProjectState?.fingerprint ?? null;
  const projectState = !sourceFingerprint ? 'source_not_recorded'
    : !currentFingerprint ? 'current_not_compared'
    : sourceFingerprint === currentFingerprint ? 'matching_fingerprints' : 'conflicting_fingerprints';
  const warnings = [];
  if (stale === true) warnings.push(`Worker context was last observed ${Math.round(ageMs / 60000)} minutes ago; treat its findings as stale until rechecked.`);
  else if (stale === null) warnings.push('Worker context age is unknown; verify its findings against the current project.');
  if (projectState === 'source_not_recorded') warnings.push('The worker recorded no project-state fingerprint; its findings are not tied to a particular working tree.');
  else if (projectState === 'current_not_compared') warnings.push('No current project-state fingerprint was observed; project drift cannot be compared.');
  else if (projectState === 'conflicting_fingerprints') warnings.push('The project changed since this worker evidence was recorded; recheck all findings.');
  return { ...result, context: { observed_at: Number.isFinite(observed) ? new Date(observed).toISOString() : null,
    age_ms: ageMs, stale, stale_after_ms: staleAfterMs, project_state: projectState,
    warnings, findings_preserved: true } };
}
// Last assistant text of a child turn, read without trusting execution state.
// Scoped cancellation uses it to keep partial output when a stop interrupts work.
export function partialText(messages = []) {
  const assistants = (Array.isArray(messages) ? messages : []).filter(row => row?.info?.role === 'assistant' && !row.info.summary);
  return (assistants.at(-1)?.parts || []).filter(part => part.type === 'text').map(part => part.text).join('\n');
}
export function runtimeSignals(messages = []) {
  const tools = messages.flatMap(row => row.parts || []).filter(part => part.type === 'tool');
  const failed = tools.filter(part => part.state?.status === 'error');
  const signatures = new Map();
  for (const part of failed) {
    const key = JSON.stringify([part.tool, part.state?.input, part.state?.error]);
    signatures.set(key, (signatures.get(key) || 0) + 1);
  }
  return { toolCalls: tools.length, failedToolCalls: failed.length, repeatedEquivalentFailures: Math.max(0, ...signatures.values()), needsDiagnosis: [...signatures.values()].some(count => count >= 3) };
}
