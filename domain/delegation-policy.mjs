import { modelAllowed } from './workspace.mjs';

// Delegation eligibility comes from the user/resource budget, not the selected
// workflow. Workflow model/category fields are advisory UI metadata in v5+.
export function delegationPool(preferences, _workflow, models, connected, variant = '') {
  return models.filter(model =>
    modelAllowed({ category: 'connected' }, model, connected) &&
    (!preferences.allowedModels.length || preferences.allowedModels.includes(model.id)) &&
    !preferences.excludedModels.includes(model.id) &&
    !preferences.excludedProviders.includes(model.provider) &&
    (preferences.costPreference !== 'free-only' || model.costClass === 'free') &&
    // Separately metered inference is not an authorized delegation surface.
    model.costClass !== 'metered' &&
    (!variant || model.variants?.includes(variant)),
  ).map(model => model.id);
}

// Resolve the captured root pool against current explicit restrictions. Older
// receipts used [] to mean unrestricted; new delegationPool: [] means no child.
export function capturedDelegationPool(execution, current, effective, variant = '') {
  const legacy = execution.preferences?.allowedModels;
  const rootPool = execution.delegationPool ?? (legacy?.length ? legacy : null);
  return (execution.catalogModels ?? []).filter(model =>
    // Connected-only on purpose: the child workflow is a job, not a second model pool.
    modelAllowed({ category: 'connected' }, model, execution.catalogConnected ?? []) &&
    (!Array.isArray(rootPool) || rootPool.includes(model.id)) &&
    (!current.allowedModels.length || current.allowedModels.includes(model.id)) &&
    !effective.excludedModels.includes(model.id) &&
    !effective.excludedProviders.includes(model.provider) &&
    (effective.costPreference !== 'free-only' || model.costClass === 'free') &&
    model.costClass !== 'metered' && (!variant || model.variants?.includes(variant)),
  ).map(model => model.id);
}

// Explicit limits may tighten an in-flight request, never expand its authority.
// New preferences/agent definitions become the baseline on the next main turn.
export function effectiveDelegationPreferences(current, captured = current) {
  return {
    ...current,
    childVariant: captured.childVariant,
    delegation: [current.delegation, captured.delegation].includes('manual') ? 'manual'
      : [current.delegation, captured.delegation].includes('ask') ? 'ask' : 'automatic',
    subscriptionDelegation: current.subscriptionDelegation === 'automatic' && captured.subscriptionDelegation === 'automatic'
      ? 'automatic' : 'ask',
    costPreference: [current.costPreference, captured.costPreference].includes('free-only') ? 'free-only' : current.costPreference,
    maxParallel: Math.min(current.maxParallel, captured.maxParallel),
    maxDepth: Math.min(current.maxDepth ?? 2, captured.maxDepth ?? 2),
    childTimeoutSeconds: Math.min(current.childTimeoutSeconds, captured.childTimeoutSeconds),
    minimumContext: Math.max(current.minimumContext, captured.minimumContext),
    excludedModels: [...new Set([...current.excludedModels, ...captured.excludedModels])],
    excludedProviders: [...new Set([...current.excludedProviders, ...captured.excludedProviders])],
  };
}

export function delegationGuidance(preferences, allowedModels) {
  const behavior = 'Decide whether to work directly, use tools, skills, or delegate to suitable named agents. No helper or team shape is mandatory; agent/workflow identity is guidance, not authority.';
  return [
    preferences.delegation === 'manual' ? 'Work directly. The user has disabled workers.' : behavior,
    `Up to ${preferences.maxParallel} simultaneous delegated assignments. This is a ceiling, not a target.`,
    preferences.costPreference === 'free-only'
      ? 'Only free models may run delegated assignments.'
      : preferences.subscriptionDelegation === 'automatic'
        ? 'Connected subscription capacity may be selected without a separate model-choice question; native paid_delegate permission still applies.'
        : 'Subscription assignments require native paid_delegate consent. Do not add a separate model-choice question before the native permission.',
    allowedModels?.length === 0
      ? 'No models currently satisfy this request’s delegation budget. Work directly when permitted; do not fabricate a child or relax the budget.'
      : 'Select models from the eligible pool at execution time. The main model stays unchanged.',
    'Separately metered API delegation is unavailable. Native host permissions and saved GitHub project agreements remain authoritative.',
  ].join(' ');
}
