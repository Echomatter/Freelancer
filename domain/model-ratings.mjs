export const ratingFields = ['coding', 'reasoning', 'research', 'tool_use', 'instruction_following'];
export const ratingSources = [
  { title: 'OpenAI model catalog and pricing', url: 'https://platform.openai.com/docs/models' },
  { title: 'Anthropic models and pricing', url: 'https://platform.claude.com/docs/en/models/overview' },
  { title: 'Google Gemini model catalog', url: 'https://ai.google.dev/gemini-api/docs/models' },
  { title: 'Artificial Analysis evaluations', url: 'https://artificialanalysis.ai/evaluations/artificial-analysis-intelligence-index' },
  { title: 'Arena model comparisons', url: 'https://arena.ai/leaderboard' },
  { title: 'SWE-bench coding evaluations', url: 'https://www.swebench.com/' },
];

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

export function ratingsPrompt(targets) {
  return `Help me fill in the missing model information in Freelancer so I can make useful comparisons. Investigate every model below and give the best supported assessment you can. Do not stop just because a hosted ID has no exact leaderboard entry.

First identify the underlying model: a provider prefix, free suffix, hosting alias or dated snapshot may refer to a model published under a different name. Search its public name and family with terms like benchmark, evaluation, model card, coding, reasoning, tool calling and instruction following. Look at the developer's model cards, release reports, papers and repositories, then independent evaluations such as Artificial Analysis, Arena and SWE-bench. These are starting points, not an exhaustive source list: ${ratingSources.map(s => s.url).join(' ; ')}. Follow promising links and try another source if a page is unavailable. Use web search when available or fetch public pages directly with webfetch. Research related versions when the exact alias has little coverage.

Make useful comparative 0–100 estimates for coding, reasoning, research, tool use and instruction following. These are presentation estimates, not benchmark pass rates. Account for different agents, tools and evaluation settings. When direct evidence is sparse, a clearly explained family-based inference with low confidence is welcome. Distinguish findings from inference; never invent measurements, identity mappings or visited URLs. If you truly cannot assess a model, omit it so the app can report it as still missing. Do not fill unknowns with zero just to complete the form. You do not need to ask the user research questions.

Models in this batch (keep these exact IDs in the result):
${targets.map((r) => `${r.id}: ${r.name}; native context ${r.context ?? 'unspecified'}; existing capabilities ${JSON.stringify(r.capabilities ?? {})}`).join('\n')}
When finished, return a JSON object so Freelancer can save your findings: {"models":[{"id":"exact ID","scores":{"coding":75,"reasoning":72,"research":70,"tool_use":80,"instruction_following":78},"confidence":"low|medium|high","summary":"Briefly explain evidence, alias or family matching, and uncertainty.","sources":["https://actual-source-you-consulted.example"]}]}. Include all five scores and an explanation for each model you can assess. Empty sources are acceptable for an explicitly inferred estimate. Keep the final response to this object. Research only; do not edit files, routing evidence, credentials, quotas or project settings.`;
}
