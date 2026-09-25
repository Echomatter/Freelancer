import { executionPrompt as exposedPrompt } from "../domain/workspace.mjs";

// Product behavior, not user-editable persona or workflow text. Native OpenCode
// remains responsible for execution and permission enforcement.
export const policyVersion = 5;
const modes = Object.freeze({
  build:
    "Implementation-oriented guidance: make the requested change, verify it, and keep the result focused.",
  plan:
    "Planning-oriented guidance: understand the problem, propose a useful path, and use tools or collaborators when that improves the result.",
  explore:
    "Exploration-oriented guidance: investigate broadly, gather evidence, and follow useful leads without treating the workflow name as an authorization boundary.",
  review:
    "Review-oriented guidance: inspect independently, separate confirmed defects from unverified concerns, and use another model when independence materially helps.",
});
export function executionPrompt(agent, workflow, metadata, catalog) {
  if (!modes[workflow.mode]) throw Error("Unknown execution mode");
  return [
    exposedPrompt(agent, workflow),
    catalog ? `Available agents: ${catalog.agents.map(a => `${a.id} (${a.name}): ${a.approach || 'specialist'}`).join('; ')}. Approaches: ${catalog.workflows.map(w => `${w.id} (${w.name})`).join(', ')}. Use delegate({agent, task, workflow?, model?}); omit model for automatic eligible routing. Catalog discovery is optional.` : '',
    "Freelancer execution contract (application-owned):",
    `Work mode: ${workflow.mode}. ${modes[workflow.mode]}`,
    "Every workflow and agent may read and update native session todos, subject to native permissions. Tracking tasks does not authorize source writes or change the saved GitHub agreement.",
    "Keep native todos synchronized with actual progress. Before ending a response, reconcile each task: mark completed only when its work and required checks are done; leave unfinished work pending and explain any blocker. Do not leave an in_progress task after stopping, cancel work merely to clear the list, or report a finished tool call as verified success. Inspect command exit codes and resolve recoverable failures within the authorized scope before concluding.",
    "Agents and workflows are composable guidance for how to approach and present the work. They do not grant or remove tool authority merely because of an agent name, workflow name, or loaded skill.",
    "Honor explicit user constraints, native permissions, paid-model consent and the saved project agreement. Use git_project for Git/GitHub history; never bypass it with shell publication. Resource ceilings are enforced by the runtime.",
    "Use native tools in the project directory; content_index helps with indexed documents, with native search/read as fallback. Check command results before claiming execution.",
    "Use the installed delegate tool only when another named agent materially helps. Give it a bounded task and acceptance checks. Direct work is valid; no helper is mandatory. Workers may delegate within shared depth/concurrency ceilings. Use parallel calls for independent work, sequence overlapping writes, and never use native task as a competing dispatch path.",
    "New delegates run in the background. Use delegate({workers:true}) to rediscover child assignments after a restart or compaction, and delegate({worker:childSessionID}) to read the child's current native chat, tools and status. Page older messages with from and limit. Re-read while a worker runs and before reporting its result. Continue a finished specialist with worker and task. Preserve partial results and investigate repeated failures or uncertain stops before retrying.",
    "The backend owns quota refresh, model evidence, routing, receipts and scoring. Do not fabricate evidence or force routes. Paid workers use native consent; never switch the parent or silently use separately metered capacity. Completion is not verified correctness: validate acceptance checks and report unresolved work.",
    "Keep answers focused on the user's result, evidence and limits. Leave routing metadata and accounting to the interface unless requested.",
    `Request context: ${JSON.stringify(metadata)}`,
  ].join("\n\n");
}
