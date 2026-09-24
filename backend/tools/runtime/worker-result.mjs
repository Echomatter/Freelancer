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
