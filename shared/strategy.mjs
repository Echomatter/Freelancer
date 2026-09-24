// Portable preferences only. No filesystem, model inventory or host execution.
import { delegationGuidance } from '../domain/delegation-policy.mjs';
import { migrateAgentAccess, normalizeAgentAccess } from '../domain/agent-policy.mjs';
export const defaults = Object.freeze({ schemaVersion: 2, strategy: 'balanced', delegation: 'automatic', subscriptionDelegation: 'ask',
  costPreference: 'prefer-free', maxParallel: 3, maxDepth: 2, childTimeoutSeconds: 600,
  parentModel: 'auto', reasoningVariant: '', childVariant: '',
  agentAccess: null, allowedModels: [], excludedModels: [], excludedProviders: [], contextPolicy: 'standard',
  minimumContext: 0, contextWarning: 70, showStatus: true, showPanel: true,
  footerFields: ['strategy', 'children', 'free', 'context'], panelWidth: 32 });
export const presets = {
  manual: { label: 'Manual', description: 'Keep work in the selected agent without delegation.', delegation: 'manual', maxParallel: 1 },
  'free-first': { label: 'Free First', description: 'Keep the parent; prefer qualified free children. Subscription choices still ask.', costPreference: 'prefer-free' },
  balanced: { label: 'Balanced', description: 'Prefer free children for bounded work; compare capability and capacity before escalation.' },
  'quality-first': { label: 'Quality First', description: 'Compare capability-specific evidence without a free-cost preference. Subscription choices still ask.', costPreference: 'any' },
  'research-heavy': { label: 'Research Heavy', description: 'Use Researcher for evidence, Engineer for edits, and the Review workflow for independent checks.' },
  'minimal-agents': { label: 'Minimal Agents', description: 'Prefer direct work; use one focused worker when useful.', delegation: 'automatic', maxParallel: 1 },
  'premium-parent': { label: 'Selected parent / free children', description: 'Keep your chosen parent. Only qualified free routes may execute children.', costPreference: 'free-only' },
};
export function preset(id) {
  if (!presets[id]) throw new Error('Unknown strategy');
  const { label, description, ...policy } = presets[id];
  return normalizePreferences({ ...defaults, ...policy, strategy: id });
}
export function normalizePreferences(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Preferences must be an object');
  const legacy = value.schemaVersion === 1;
  if (value.schemaVersion !== undefined && ![1, 2].includes(value.schemaVersion)) throw Error('Unsupported preferences schema');
  const p = { ...defaults, ...value, schemaVersion: 2 };
  if (legacy && value.allowedRoles !== undefined) p.agentAccess = migrateAgentAccess(value.allowedRoles);
  else if (value.allowedRoles !== undefined) throw Error('Use agentAccess with named agent IDs, not retired helper roles');
  p.agentAccess = normalizeAgentAccess(p.agentAccess);
  if (p.parentModel !== 'auto' && (typeof p.parentModel !== 'string' || !/^[\w.:-]+\/[\w./:-]+$/.test(p.parentModel))) throw new Error('Invalid parent model');
  for (const key of ['reasoningVariant', 'childVariant']) if (typeof p[key] !== 'string' || !/^[\w-]{0,80}$/.test(p[key])) throw new Error(`Invalid ${key}`);
  if (p.schemaVersion !== 2 || !presets[p.strategy]) throw new Error('Unsupported preferences schema or strategy');
  for (const [key, choices] of Object.entries({ delegation: ['automatic','ask','manual'], subscriptionDelegation: ['ask','automatic'], costPreference: ['free-only','prefer-free','balanced','any'], contextPolicy: ['compact','standard','large','max'] })) {
    if (!choices.includes(p[key])) throw new Error(`Invalid ${key}`);
  }
  for (const [key, min, max] of [['maxParallel',1,6],['maxDepth',1,6],['childTimeoutSeconds',30,1800],['minimumContext',0,2000000],['contextWarning',10,100],['panelWidth',24,60]]) {
    if (!Number.isInteger(p[key]) || p[key] < min || p[key] > max) throw new Error(`Invalid ${key}: expected ${min}–${max}`);
  }
  for (const [key, choices] of [['footerFields',['strategy','children','free','context','cost']]]) {
    if (!Array.isArray(p[key]) || p[key].some(x => !choices.includes(x))) throw new Error(`Invalid ${key}`);
    p[key] = [...new Set(p[key])];
  }
  for (const key of ['allowedModels','excludedModels','excludedProviders']) {
    if (!Array.isArray(p[key]) || p[key].length > (key === 'allowedModels' ? 5000 : 200) || p[key].some(x => typeof x !== 'string' || !/^[\w./:-]{1,180}$/.test(x))) throw new Error(`Invalid ${key}`);
    p[key] = [...new Set(p[key])];
  }
  for (const key of ['showStatus','showPanel']) if (typeof p[key] !== 'boolean') throw new Error(`Invalid ${key}`);
  return Object.fromEntries(Object.keys(defaults).map(k => [k, p[k]]));
}
export function policyInputs(preferences, args = {}) {
  const p = normalizePreferences(preferences);
  return { ...args, freeOnly: args.freeOnly === true || p.costPreference === 'free-only',
    preferredCostClass: args.preferredCostClass || (['prefer-free','free-only'].includes(p.costPreference) ? 'free' : 'any'),
    minimumContext: Math.max(args.minimumContext || 0, p.minimumContext, p.contextPolicy === 'large' ? 128000 : 0),
    excludeModels: [...new Set([...(args.excludeModels || []), ...p.excludedModels])] };
}
export function strategyGuidance(preferences) {
  const p = normalizePreferences(preferences);
  return `Freelancer delegation budget: ${delegationGuidance(p)}
Delegation: ${p.delegation}; at most ${p.maxParallel} active children; child timeout ${p.childTimeoutSeconds}s.
Child cost preference: ${p.costPreference}. Never change the selected parent model. Automatic routes remain limited to the backend allowed surfaces; no metered gateways.
Context: ${p.contextPolicy}; minimum child context ${policyInputs(p).minimumContext}. ${p.contextPolicy === 'compact' ? 'Use concise handoffs and summaries.' : p.contextPolicy === 'max' ? 'Compare qualified candidates by context capacity when the task benefits; do not choose solely by window size.' : 'OpenCode owns context construction and compaction.'}
These preferences do not grant native permissions. Manual means no delegated assignments; native task dispatch is not an alternative route.`;
}
