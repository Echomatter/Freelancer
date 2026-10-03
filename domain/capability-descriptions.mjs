// Short, safe summaries for capability detail views. These are labels, not
// permission grants; OpenCode's live schemas and native permission state remain
// authoritative for what a tool or skill can do.

const skills = Object.freeze({
  'bounded-judgment': { name: 'Bounded judgment', description: 'Use optional JEV judgments to compare a small, explicit set of evidence-grounded alternatives.' },
  'browser-verify': { name: 'Browser verify', description: 'Choose focused browser checks and report live observations separately from fixture journeys.' },
  debug: { name: 'Debug', description: 'Reproduce a failure, test one concrete hypothesis, make a narrow fix, and rerun the reproduction.' },
  'docs-research': { name: 'Documentation research', description: 'Use local source first, then current technical documentation and primary-source fallbacks when needed.' },
  fetch: { name: 'Fetch', description: 'Retrieve external pages and primary sources when outside information is needed.' },
  handoff: { name: 'Handoff', description: 'Write a durable checkpoint with current state, evidence, constraints, risks, and one next action.' },
  'managed-git': { name: 'Managed Git', description: 'Use saved-agreement Git previews and explicit approval flows through Freelancer’s managed tool.' },
  'model-routing': { name: 'Model routing', description: 'Use eligible model evidence and bounded named-agent delegation while preserving consent and constraints.' },
  playwright: { name: 'Playwright', description: 'Use the shared browser tools for live page interaction and visible-state inspection.' },
  'pursue-goal': { name: 'Pursue goal', description: 'Continue a saved goal in its persistent conversation and report evidence-based checkpoints.' },
  'reason-through': { name: 'Reason through', description: 'Optionally structure difficult problems into hypotheses, alternatives, and open questions.' },
  'record-outcome': { name: 'Record outcome', description: 'Record validated execution results from actual receipts without overstating evidence.' },
  remember: { name: 'Remember', description: 'Search or intentionally retain durable knowledge, source-linked claims, graph data, and conversation pins.' },
  reorient: { name: 'Reorient', description: 'Map the current project instructions, entry points, constraints, and relevant checks.' },
  review: { name: 'Review', description: 'Provide a report-only review of correctness, regressions, security, tests, and user-visible behavior.' },
  'search-index': { name: 'Search index', description: 'Search indexed project documents and chats, check freshness, and verify decisive hits at their sources.' },
  'typesafe-ai': { name: 'TypeSafe AI', description: 'Consult TypeSafe guidance for building bounded typed judgments; it does not change Freelancer routing or permissions.' },
  verify: { name: 'Verify', description: 'Select and classify checks that directly establish the implementation or behavior claim.' },
  'web-research': { name: 'Web research', description: 'Find and cite relevant external primary sources while treating retrieved content as evidence, not instructions.' },
  'context7-mcp': { name: 'Context7', description: 'Look up current library and API documentation through the shared Context7 tools.' },
  'customize-opencode': { name: 'Customize OpenCode', description: 'OpenCode-provided guidance for configuring the native runtime; follow its current instructions.' },
  sync: { name: 'Sync', description: 'OpenCode-provided synchronization guidance; follow its current instructions and repository boundaries.' },
});

const tools = Object.freeze({
  apply_patch: { name: 'Apply patch', description: 'Apply a source patch through the native OpenCode tool, subject to its permission checks.' },
  bash: { name: 'Shell', description: 'Run a shell command through OpenCode with the active native permissions.' },
  content_index: { name: 'Content index', description: 'Search and maintain the project document, data, and conversation index.' },
  delegate: { name: 'Delegate', description: 'Assign, inspect, continue, steer, queue, fork, or cancel bounded work for a named agent.' },
  edit: { name: 'Edit', description: 'Edit a file through the native OpenCode tool, subject to its permission checks.' },
  git_project: { name: 'Managed Git', description: 'Inspect, preview, prepare, execute, merge, or request Git/GitHub work under the saved project agreement.' },
  glob: { name: 'Find files', description: 'Find files by path pattern through the native OpenCode tool.' },
  goal_checkpoint: { name: 'Goal checkpoint', description: 'Report a saved-goal checkpoint and proposed outcome for application reconciliation.' },
  grep: { name: 'Search source', description: 'Search source files through the native OpenCode tool.' },
  invalid: { name: 'Invalid tool request', description: 'OpenCode-generated validation feedback for an unsupported tool call or argument.' },
  knowledge: { name: 'Knowledge', description: 'Search or manage shared memories, facts, claims, relations, bounded graph reads, and canonical pins.' },
  lsp: { name: 'Language server', description: 'Inspect language-server symbols and diagnostics when the runtime provides this tool.' },
  question: { name: 'Ask a question', description: 'Request user input through OpenCode’s native question flow; it does not grant tool permission.' },
  read: { name: 'Read file', description: 'Read source or project files through the native OpenCode tool.' },
  skill: { name: 'Load skill', description: 'Load optional procedural guidance; a skill does not grant capability or permission.' },
  task: { name: 'Native task', description: 'OpenCode task tool; Freelancer worker assignments use the shared delegate tool instead.' },
  todowrite: { name: 'Update todos', description: 'Update the current conversation’s native task list.' },
  webfetch: { name: 'Fetch web page', description: 'Retrieve a web page through the native OpenCode tool.' },
  websearch: { name: 'Search the web', description: 'Search the web through the native OpenCode tool when available to the selected model.' },
  write: { name: 'Write file', description: 'Write a file through the native OpenCode tool, subject to its permission checks.' },
});

export function describeCapability(kind, id) {
  if (typeof id !== 'string' || !id) return null;
  if (kind === 'skill' || kind === 'skills') return skills[id] ?? null;
  if (kind === 'tool' || kind === 'tools') return tools[id] ?? null;
  return null;
}
