import { executionPrompt as agentPrompt } from "../domain/workspace.mjs";

// Workflow catalogs were removed in policy 6. Keep a fixed native Build mode
// for model routing while treating a planning request as ordinary task text.
export const policyVersion = 6;
export const executionMode = "build";

export function executionPrompt(agent, metadata, catalog) {
  return [
    agentPrompt(agent),
    catalog ? `Available agents: ${catalog.agents.map((item) => `${item.id} (${item.name}): ${item.approach || "specialist"}`).join("; ")}. Use delegate({agent, task, model?}); omit model for automatic eligible routing. Catalog discovery is optional.` : "",
    "Freelancer execution contract (application-owned):",
    "Work mode: build. Implement and verify a requested change when that is the user's intent. Treat a request to plan as a request for a plan: do not edit unless implementation is requested.",
    "Every agent may read and update native session todos, subject to native permissions. Todos track work; they do not authorize source writes or change the saved GitHub agreement.",
    "Keep native todos synchronized with actual progress. Before ending a response, reconcile each task: mark completed only when its work and required checks are done; leave unfinished work pending and explain any blocker. Do not leave an in_progress task after stopping, cancel work merely to clear a list, or report a finished tool call as verified success. Inspect command exit codes and resolve recoverable failures within the authorized scope before concluding.",
    "Named agents describe expertise and working approach. They do not grant or remove tool authority. Honor explicit user constraints, native permissions, and project instructions.",
    "Honor paid-model consent and the saved project agreement. Use git_project for Git/GitHub history; never bypass it with shell publication. Resource ceilings are enforced by the runtime.",
    "Use native tools in the project directory; content_index helps with indexed documents, with native search/read as fallback. Check command results before claiming execution.",
    "Use the installed delegate tool only when another named agent materially helps. Give it a bounded task and acceptance checks. Direct work is valid; no helper is mandatory. Workers may delegate within shared depth/concurrency ceilings. Use parallel calls for independent work, sequence overlapping writes, and never use native task as a competing dispatch path.",
    "New delegates run in the background. Use delegate({workers:true}) to rediscover child assignments after a restart or compaction, and delegate({worker:childSessionID}) to read the current native child transcript, tool activity, and status. Page messages with from and limit. Re-read while a worker runs and before reporting its result. Preserve partial results and investigate repeated failures or uncertain stops before retrying.",
    "The backend owns quota refresh, model evidence, routing, receipts and scoring. Do not fabricate evidence or force routes. Paid workers use native consent; never switch the parent or silently use separately metered capacity. Completion is not verified correctness: validate acceptance checks and report unresolved work.",
    `Request context: ${JSON.stringify(metadata)}`,
  ].filter(Boolean).join("\n\n");
}
