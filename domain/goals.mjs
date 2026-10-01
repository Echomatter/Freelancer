export function goalContract(goal) {
  return `Freelancer goal contract (application-owned):
Goal ${goal.id}; stable run ${goal.runID}; objective revision ${goal.revision}.
Objective: ${goal.objective}
Orient → perform useful work → verify and reconcile → continue, pause, or complete.
Use the pursue-goal skill. On initial execution, resumption, compaction recovery or model replacement, read the objective and interpretation, native todos, decisions, latest checkpoint and outstanding workers. Extend the shared execution and worker-recovery instructions; do not invent another plan store. Internal goal activity and steering continue this assignment and never clear its native todos.
Use delegate({workers:true}) and delegate({worker:sessionID}) to inspect and reconcile outstanding assignments yourself before creating replacements. Native history and live status settle stale receipts; a verified stopped worker can continue in the same chat with a new bounded task. Preserve uncertain input without replaying it. Do not ask the user to confirm routine worker statuses. Reuse workers for follow-ups and accept their results against checks. Wait only when useful work depends on worker progress; otherwise continue independent parent work.
Before ending or when the conversation grows long, call goal_checkpoint with an interpretation, concrete checkpoint, outcome (continue, waiting, pause, complete), reason and evidence. Side workers do not have to stop for a checkpoint. Use continue when useful parent work remains, even while workers run; use waiting when progress depends on them. Complete requires the interpretation to be satisfied and verifiable evidence, with native todos reconciled. A test failure is work to resolve, not a reason to replace the model. Ask the user only for genuinely missing decisions or authorization. The application schedules at most one continuation after the parent turn settles; it owns recovery, model rotation and Stop. Do not schedule yourself or change models.
Keep the stable goal/run identity, captured constraints, Git agreement and native permissions. Project scope is not filesystem isolation; other chats may share this directory.
Latest checkpoint: ${JSON.stringify(goal.checkpoint ?? null)}
Previous objective revisions: ${JSON.stringify(goal.revisions?.slice(-5) ?? [])}`;
}

export function eligibleGoalModels(models, connected, preferences, excluded = []) {
  return models.filter(m => m.costClass === 'free' &&
    (m.provider === 'opencode' || connected.includes(m.provider)) && m.quota !== 0 &&
    !excluded.includes(m.id) && !preferences.excludedModels?.includes(m.id) &&
    !preferences.excludedProviders?.includes(m.provider) &&
    (!preferences.allowedModels?.length || preferences.allowedModels.includes(m.id)));
}
export const availabilityFailure = error => /(?:quota|rate.?limit|429|capacity|free.{0,20}(?:limit|usage exceeded)|model.{0,30}(?:unavailable|not found)|overloaded)/i.test(typeof error === 'string' ? error : JSON.stringify(error ?? ''));
