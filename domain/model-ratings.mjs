export const ratingFields = ['coding', 'reasoning', 'research', 'tool_use', 'instruction_following'];
export function parseModelRatings(text, targets, { partial = false } = {}) {
  const payload = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const value = JSON.parse(payload.slice(payload.indexOf('{'), payload.lastIndexOf('}') + 1));
  if (!Array.isArray(value?.models) || (!partial && value.models.length !== targets.length))
    throw Error('The configuration agent did not return a valid model ratings list.');
  const allowed = new Set(targets);
  const seen = new Set();
  return value.models.map((row) => {
    if (typeof row.id !== 'string' || !allowed.has(row.id) || seen.has(row.id)) throw Error('Unexpected model ID in ratings.');
    seen.add(row.id);
    try {
    const scores = {};
    for (const field of ratingFields) {
      const score = row.scores?.[field];
      if (!Number.isFinite(score) || score < 0 || score > 100) throw Error(`Invalid ${field} estimate for ${row.id}.`);
      scores[field] = Math.round(score);
    }
    const sources = Array.isArray(row.sources) ? row.sources.filter((source) =>
      typeof source === 'string' && /^https:\/\/[^\s]+$/.test(source)).slice(0, 8) : [];
    const confidence = ['low', 'medium', 'high'].includes(row.confidence) ? row.confidence : 'low';
    if (typeof row.summary !== 'string' || !row.summary.trim()) throw Error(`Missing explanation for ${row.id}.`);
    return { id: row.id, rating: { scores, summary: row.summary.trim().slice(0, 600),
      confidence, provenance: sources.length ? 'sourced estimate' : 'inferred estimate', sources } };
    } catch (error) { if (!partial) throw error; return null; }
  }).filter(Boolean);
}
