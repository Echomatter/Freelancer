// Application view models. These sort for browsing; they never select a route.
const number = x => typeof x === 'number' && Number.isFinite(x) ? x : null;
export const clean = x => String(x ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').replace(/\s+/g,' ').trim();
export const clip = (s, width) => { const chars = [...clean(s)]; return chars.length > width ? chars.slice(0,Math.max(0,width-1)).join('') + '…' : chars.join(''); };
export const quantity = n => number(n) === null ? '?' : n >= 1000000 ? `${Math.round(n/10000)/100}M` : n >= 1000 ? `${Math.round(n/100)/10}K` : `${n}`;
export const costLabels = { free:'FREE', subscription:'PLAN', credits:'CREDITS', metered:'METERED', unknown:'UNKNOWN' };
export function economicClass(surface) {
  return ({'opencode-free':'free','opencode-go':'subscription','openai-oauth':'subscription','github-copilot-oauth':'credits'})[surface] || 'unknown';
}
export function modelRows(providers = [], snapshot = {}) {
  const library = snapshot.evidence || {}, roster = snapshot.roster?.eligible_models || [];
  return providers.flatMap(provider => Object.entries(provider.models || {}).map(([modelID, model]) => {
    const id = `${provider.id}/${modelID}`, route = roster.find(r => r.id === id);
    const key = library.alias_index?.[id];
    const evidence = library.models?.[key] || Object.values(library.models || {}).find(e => e.aliases?.includes(id));
    const surface = route?.surface;
    const quota = snapshot.usage?.providers?.find(p => p.id === surface);
    const outcomes = (snapshot.history?.entries || []).filter(e => e.model === id && e.observation_kind !== 'operational');
    const validated = outcomes.filter(e => e.success === true && e.tests_passed === true).length;
    const context = number(model.limit?.context);
    return { id, modelID, provider: provider.id, name: clean(model.name || modelID), surface,
      costClass: economicClass(surface), context, evidenceContext: number(evidence?.context?.input_tokens),
      output: number(model.limit?.output), variants: model.variants ?? [],
      tools: typeof model.capabilities?.toolcall === 'boolean' ? model.capabilities.toolcall : typeof model.toolcall === 'boolean' ? model.toolcall : null,
      capabilities: evidence?.capabilities || {}, evidence: evidence || null,
      sources: (evidence?.source_keys || []).map(k => library.sources?.[k]).filter(Boolean),
      sourceCount: evidence?.source_keys?.length ?? null, researchedAt: evidence?.last_researched_at || null,
      availability: quota?.availableRemaining === 0 ? 'quota constrained' : model.status === 'deprecated' ? 'deprecated' : 'connected / unverified',
      quota: quota?.availableRemaining ?? null, quotaFresh: quota?.fresh === true,
      outcomes: { total:outcomes.length, validated, failed:outcomes.filter(e => e.success === false).length,
        partial:outcomes.filter(e => e.success === true && e.tests_passed !== true).length },
      recent: outcomes.map(e => e.timestamp).filter(Boolean).sort().at(-1) || null,
      host: model };
  }));
}
const rating = r => ({ strong:4, good:3, adequate:2, weak:1 })[r] || 0;
const confidence = r => ({high:3,medium:2,low:1})[r] || 0;
export function browseModels(rows, { query='', freeOnly=false, provider='', capability='', toolsOnly=false, sort='cost' } = {}) {
  const words = clean(query).toLowerCase().split(' ').filter(Boolean);
  const result = rows.filter(r => words.every(w => `${r.name} ${r.id}`.toLowerCase().includes(w)) && (!freeOnly || r.costClass === 'free') &&
    (!provider || r.provider === provider) && (!toolsOnly || r.tools === true) && (!capability || rating(r.capabilities[capability]?.rating) >= 2));
  const value = r => ({cost:({free:0,subscription:1,credits:2,metered:3,unknown:4})[r.costClass],context:-(r.context ?? -1),
    coding:-rating(r.capabilities.coding?.rating),reasoning:-rating((r.capabilities.deep_reasoning || r.capabilities.reasoning)?.rating),
    evidence:-confidence(r.capabilities[capability || 'coding']?.confidence),recent:-(Date.parse(r.recent) || 0),
    outcomes:-r.outcomes.validated,availability:r.availability === 'quota constrained' ? 1 : 0,provider:0})[sort] ?? 0;
  return result.sort((a,b) => value(a)-value(b) || (sort === 'provider' ? a.provider.localeCompare(b.provider) : 0) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
export function reconcileActivity(parts = [], receipts = [], now = Date.now()) {
  const rows = new Map();
  for (const part of parts) {
    const a = part.state?.metadata?.freelancer_activity;
    if (part.type !== 'tool' || !a || a.schema_version !== 1) continue;
    const id = part.state.metadata.task_id || part.id;
    rows.set(id, { id, partID:part.id, agentID:a.agentID || part.state.metadata.agentID || a.role || part.state.metadata.role, agentName:a.agentName || part.state.metadata.agentName || a.role || part.state.metadata.role, workflowID:a.workflowID || part.state.metadata.workflowID, child:a.child_session,
      selected:a.selected_model, dispatched:a.dispatched_model, observed:a.observed_model,
      phase:a.phase, tool:a.tool, subject:a.subject, completedTools:a.completed_tools ?? 0, elapsedMs:a.elapsed_ms,
      updatedAt:a.updated_at, receipt:false, validation:'pending', surface:null });
  }
  for (const receipt of receipts) {
    const attempt = receipt.attempts?.at(-1), a = receipt.activity || {}, previous = rows.get(receipt.task_id);
    const newer = previous && Date.parse(previous.updatedAt) > Date.parse(a.updated_at || receipt.created_at);
    const active = ['running','awaiting_paid_permission'].includes(receipt.status);
    rows.set(receipt.task_id, { ...previous, id:receipt.task_id, agentID:receipt.agent?.id ?? receipt.role, agentName:receipt.agent?.name ?? receipt.role, workflowID:receipt.workflow?.id, child:attempt?.child_session || a.child_session,
      selected:attempt?.selected_model || a.selected_model, dispatched:attempt?.dispatched_model, observed:attempt?.observed_model,
      phase:attempt?.status === 'failed' ? 'failed' : receipt.status === 'completed' ? 'completed' : active ? (newer ? previous.phase : a.phase || 'waiting') : receipt.status,
      status:receipt.status, tool:newer ? previous.tool : a.tool, subject:newer ? previous.subject : a.subject,
      completedTools:newer ? previous.completedTools : a.completed_tools ?? 0,
      elapsedMs:attempt?.elapsed_ms ?? (newer ? previous.elapsedMs : a.elapsed_ms), updatedAt:newer ? previous.updatedAt : a.updated_at || receipt.created_at,
      receipt:true, validation:receipt.validation || 'pending', surface:attempt?.surface,
      usage:attempt?.usage, attempt, raw:receipt });
  }
  return [...rows.values()].map(r => ({ ...r, stale:['working','tool','waiting'].includes(r.phase) && (!Number.isFinite(Date.parse(r.updatedAt)) || now-Date.parse(r.updatedAt)>15000),
    identity: r.selected && r.dispatched && r.observed ? (r.selected === r.dispatched && r.dispatched === r.observed ? 'verified' : 'MISMATCH') : 'pending' }));
}
export function sessionSummary(messages = [], providers = [], children = []) {
  const last = messages.findLast(m => m.role === 'assistant' && !m.summary);
  const measured = messages.filter(m => m.role === 'assistant' && !m.summary && (m.tokens?.input > 0 || m.tokens?.output > 0 || m.tokens?.cache?.read > 0));
  const contextMessage = measured.at(-1);
  const model = providers.find(p => p.id === contextMessage?.providerID)?.models?.[contextMessage?.modelID];
  const t = contextMessage?.tokens;
  const used = t ? [t.input,t.output,t.reasoning,t.cache?.read,t.cache?.write].reduce((sum,n) => sum+(number(n) || 0),0) : null;
  const actual = children.filter(c => c.child && c.dispatched), free = actual.filter(c => c.surface === 'opencode-free');
  return { parent:last ? `${last.providerID}/${last.modelID}` : null, role:last?.agent || null,
    contextUsed:used, contextLimit:number(model?.limit?.context), contextPercent:used !== null && model?.limit?.context ? Math.round(used/model.limit.context*100) : null,
    active:children.filter(c => ['working','tool','waiting'].includes(c.phase)).length,
    freePercent:actual.length ? Math.round(free.length/actual.length*100) : null,
    executions:actual.length, free:free.length,
    reportedCost:measured.length && measured.every(m => number(m.cost) !== null) ? measured.reduce((s,m) => s+m.cost,0) : null };
}
export function statusLine(p, summary, width=60) {
  const fields = { strategy:p.strategy, children:`${summary.active} child${summary.active === 1 ? '' : 'ren'}`,
    free:summary.freePercent === null ? 'free ?' : `${summary.freePercent}% free`, context:summary.contextPercent === null ? 'ctx ?' : `ctx ${summary.contextPercent}%`,
    cost:summary.reportedCost === null ? 'reported ?' : `host $${summary.reportedCost.toFixed(2)}` };
  return clip(['Freelancer',...p.footerFields.map(f => fields[f])].join(' · '),width);
}
export function modelLine(row, width=80) {
  const base = `${row.name} · ${costLabels[row.costClass]} · ${row.availability === 'quota constrained' ? 'LIMITED' : 'connected'}`;
  return clip(width < 100 ? base : `${base} · ctx ${quantity(row.context)} · tools ${row.tools === null ? '?' : row.tools ? 'yes' : 'no'} · coding ${row.capabilities.coding?.rating || '?'}`, Math.max(20,width));
}
