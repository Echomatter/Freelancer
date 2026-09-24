// Host-neutral quota view. No credentials, network access, routing weights or UI.
export const providers = {
  'openai-oauth': { name: 'OpenAI / Codex', color: '#66d7c0', url: 'https://chatgpt.com/codex/settings/usage' },
  'opencode-go': { name: 'OpenCode Go', color: '#a9a0ff', url: 'https://opencode.ai/go' },
  'github-copilot-oauth': { name: 'GitHub Copilot', color: '#f6bb73', url: 'https://github.com/settings/billing/ai_usage' },
  'opencode-free': { name: 'OpenCode Free', color: '#8cc9f5', url: 'https://opencode.ai/zen' },
};
const finite = n => typeof n === 'number' && Number.isFinite(n);
const clamp = n => Math.max(0, Math.min(100, n));
const iso = n => finite(n) && n > 0 && Number.isFinite(new Date(n * 1000).getTime()) ? new Date(n * 1000).toISOString() : null;
const duration = n => !finite(n) || n <= 0 ? 'Usage window' : n === 604800 ? 'Weekly' : n === 18000 ? '5-hour' : n >= 86400 ? `${n / 86400}-day` : `${n / 3600}-hour`;

export function usageView(state = {}, installed = [], checks = {}, now = Date.now()) {
  const result = [];
  for (const id of [...new Set(installed)]) {
    const s = state.surfaces?.[id] || {}, t = s.telemetry || {};
    const age = now - Date.parse(t.as_of);
    const fresh = t.status === 'ok' && Number.isFinite(age) && age >= -60000 && age < 600000;
    const p = { id, ...(providers[id] || { name: id, color: '#94a3b8', url: null }), asOf: t.as_of || null,
      source: t.source || null, cached: !!t.cached, fresh, telemetryStatus: t.last_attempt_status || t.status || 'unavailable',
      metrics: [], note: '', pageCheck: null };
    function metric(key, label, used, resetAt, seconds, extra = {}) {
      const valid = finite(used) && used >= 0;
      const resetTime = Date.parse(resetAt);
      const expired = Number.isFinite(resetTime) && resetTime <= now;
      p.metrics.push({ key, label, usedPercent: valid ? used : null,
        remainingPercent: valid ? clamp(100 - used) : null,
        resetAt: Number.isFinite(resetTime) ? new Date(resetTime).toISOString() : null,
        seconds, usable: fresh && valid && !expired, expired, ...extra });
    }
    if (id === 'opencode-go') {
      for (const [key,label,seconds] of [['rolling','5-hour',18000],['weekly','Weekly',604800],['monthly','Monthly',2592000]]) {
        const w = s.windows?.[key];
        metric(key, label, w?.used_percent, w?.resets_at, seconds, { blocked: w?.status === 'rate-limited' });
      }
      p.note = 'One shared allowance across models. The shortest exhausted window blocks use, even when monthly balance remains. API percentages may be rounded or capped.';
    } else if (id === 'openai-oauth') {
      for (const [key,w] of Object.entries(s.windows || {})) {
        if (!w || typeof w !== 'object') continue;
        metric(key, duration(w.window_seconds), w.used_percent, iso(w.reset_at_unix), w.window_seconds);
      }
      p.note = 'Account-wide allowance shared with Codex and Work. The provider reports percentages, not a fixed token entitlement.';
    } else if (id === 'github-copilot-oauth') {
      for (const [key,b] of Object.entries(s.buckets || {})) {
        if (b.unlimited === true && ['chat','completions'].includes(key)) continue;
        const label = key === 'premium_interactions' ? 'Included AI credits' : key === 'chat' ? 'Chat' : key === 'completions' ? 'Completions' : key;
        metric(key, label, finite(b.percent_remaining) ? 100 - b.percent_remaining : undefined, s.reset_at, 2592000,
          { unlimited: b.unlimited === true, entitlement: finite(b.entitlement) ? b.entitlement : null,
            used: finite(b.credits_used) ? b.credits_used : null, remaining: finite(b.quota_remaining) ? b.quota_remaining : null });
      }
      p.note = 'Included AI credits only. Overages are not added to the allowance.';
    } else {
      p.note = id === 'opencode-free' ? 'No published finite allowance. Free availability varies; excluded from the combined bar.' : 'Connected provider; no supported quota adapter yet. Balance is unknown.';
    }
    const finiteMetrics = p.metrics.filter(m => !m.unlimited);
    p.balanceRemaining = finiteMetrics.length && finiteMetrics.every(m => m.usable)
      ? [...finiteMetrics].sort((a,b) => b.seconds-a.seconds)[0].remainingPercent : null;
    p.availableRemaining = finiteMetrics.length && finiteMetrics.every(m => m.usable)
      ? Math.min(...finiteMetrics.map(m => m.blocked ? 0 : m.remainingPercent)) : null;
    p.restricted = s.limit_reached === true || s.allowed === false;
    if (p.restricted) p.availableRemaining = fresh ? 0 : null;
    const executionUntil = Date.parse(s.execution?.reset_at || s.execution?.recheck_at);
    // A display snapshot can outlive an execution block. Expose only its recorded
    // deadline, never raw execution errors/account data, so the UI rechecks.
    // Keep an expired deadline until newer telemetry can confirm availability.
    p.blockedUntil = s.execution?.blocked && Number.isFinite(executionUntil)
      ? new Date(executionUntil).toISOString() : null;
    if (s.execution?.blocked && Number.isFinite(executionUntil) && executionUntil > now) {
      p.availableRemaining = 0; p.note += ' A recent execution failure currently blocks this route.';
    }
    const check = checks.providers?.[id];
    if (check && typeof check.summary === 'string' && Number.isFinite(Date.parse(check.asOf))) {
      p.pageCheck = { asOf: check.asOf, summary: check.summary.slice(0,500) };
    }
    result.push(p);
  }
  // A transparent plan-share estimate, not invented token counts or added dollars.
  // Unknown subscribed providers retain their denominator share; free has no cap.
  const plans = result.filter(p => ['openai-oauth','opencode-go','github-copilot-oauth'].includes(p.id));
  const segments = plans.map(p => ({ id:p.id,name:p.name,color:p.color,share:100/plans.length,
    balance:p.balanceRemaining,available:p.availableRemaining }));
  const total = field => plans.length && segments.some(s => s[field] !== null) ? segments.reduce((n,s) => n+(s[field] ?? 0)/plans.length,0) : null;
  return { schemaVersion:1, generatedAt:new Date(now).toISOString(), providers:result,
    combined:{ estimated:true, method:'equal-plan-share', segments,
      balancePercent:total('balance'), availablePercent:total('available'),
      unknownPlans:segments.filter(s => s.balance === null).length,
      note:'Estimate: each connected finite plan gets an equal share. The bright fill shows its remaining portion. Plans use different units and reset periods; this is a capacity index, not a sum of tokens. Unknown shares stay hatched; free models are excluded.' } };
}
