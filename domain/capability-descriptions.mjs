// Short, safe summaries for capability detail views. These are labels, not
// permission grants; OpenCode's live schemas and native permission state remain
// authoritative for what a tool or skill can do.

const skills = Object.freeze({
  'bounded-judgment': { name: 'Bounded judgment', description: 'Check, classify or score explicit evidence with optional Jev judgments.' },
  debug: { name: 'Debug', description: 'Trace a failure, check its cause, and make a focused fix.' },
  fetch: { name: 'Fetch', description: 'Read a known URL and continue truncated source text.' },
  handoff: { name: 'Handoff', description: 'Preserve a compact checkpoint for continuing work.' },
  'managed-git': { name: 'Managed Git', description: 'Inspect and apply Git actions under the saved project agreement.' },
  'delegate-work': { name: 'Delegate work', description: 'Assign or recover bounded work for named agents.' },
  'compare-builds': { name: 'Compare builds', description: 'Build two alternatives and compare their results.' },
  playwright: { name: 'Playwright', description: 'Inspect browser pages and verify interactions, layouts and visible errors.' },
  'pursue-goal': { name: 'Pursue goal', description: 'Continue a saved goal and record its progress.' },
  'reason-through': { name: 'Reason through', description: 'Compare choices and dependencies using evidence.' },
  'record-outcome': { name: 'Record outcome', description: 'Record or correct a task observation from actual receipts.' },
  remember: { name: 'Remember', description: 'Remember files, chats or custom content, then retrieve or edit the saved memory.' },
  reorient: { name: 'Reorient', description: 'Recover the project context relevant to the current task.' },
  review: { name: 'Review', description: 'Inspect a change or proposal and return grounded findings.' },
  'search-index': { name: 'Search index', description: 'Locate indexed files or chats and check source coverage.' },
  'typesafe-ai': { name: 'TypeSafe AI', description: 'Design and build TypeSafe integrations using official API and SDK guidance.' },
  verify: { name: 'Verify', description: 'Establish a specific claim with appropriate checks.' },
  'web-research': { name: 'Web research', description: 'Research external facts or technical contracts and cite primary sources.' },
  'context7-mcp': { name: 'Context7', description: 'Look up current library and API documentation through the shared Context7 tools.' },
  'model-advice': { name: 'Model advice', description: 'Recommend a model from current capabilities and evidence.' },
  'customize-opencode': { name: 'Customize OpenCode', description: 'OpenCode-provided guidance for configuring the native runtime; follow its current instructions.' },
  sync: { name: 'Sync', description: 'Synchronize requested project work within its Git agreement.' },
});

const tools = Object.freeze({
  apply_patch: { name: 'Apply patch', description: 'Apply a patch to source files.' },
  bash: { name: 'Shell', description: 'Run a command with the active native permissions.' },
  content_index: { name: 'Content index', description: 'Find indexed file passages, chat text and extracted data.' },
  computer: { name: 'Computer use', description: 'Observe and interact with browser pages and desktop applications through available providers.' },
  delegate: { name: 'Delegate', description: 'Assign and manage bounded work for named agents.' },
  edit: { name: 'Edit', description: 'Edit an existing file.' },
  evidence_evaluation: { name: 'Evidence evaluation', description: 'Judge selected evidence and inspect its source coverage.' },
  git_project: { name: 'Managed Git', description: 'Inspect and apply project Git actions under its saved agreement.' },
  glob: { name: 'Find files', description: 'Find files matching a path pattern.' },
  goal_checkpoint: { name: 'Goal checkpoint', description: 'Record progress for the active saved goal.' },
  grep: { name: 'Search source', description: 'Find matching text in source files.' },
  invalid: { name: 'Invalid tool request', description: 'Explain an unsupported tool call or argument.' },
  memory: { name: 'Memory', description: 'Save files, chats or custom memories. Read, edit or organize them.' },
  knowledge: { name: 'Memory', description: 'Read retained memories through the legacy tool name.' },
  model_catalog: { name: 'Model catalog', description: 'Read published model specifications, prices and benchmarks with their source coverage.' },
  lsp: { name: 'Language server', description: 'Inspect code symbols and language diagnostics.' },
  question: { name: 'Ask a question', description: 'Ask for user input through the native question flow.' },
  read: { name: 'Read file', description: 'Read current files and source.' },
  skill: { name: 'Load skill', description: 'Load task guidance from an available skill.' },
  task: { name: 'Native task', description: 'OpenCode task tool; Freelancer worker assignments use the shared delegate tool instead.' },
  todowrite: { name: 'Update todos', description: 'Update the current conversation’s native task list.' },
  webfetch: { name: 'Fetch web page', description: 'Retrieve text from a known web page.' },
  websearch: { name: 'Search the web', description: 'Find web sources and URLs.' },
  write: { name: 'Write file', description: 'Create or replace a file.' },
});

export function describeCapability(kind, id) {
  if (typeof id !== 'string' || !id) return null;
  if (kind === 'skill' || kind === 'skills') return skills[id] ?? null;
  if (kind === 'tool' || kind === 'tools') return tools[id] ?? null;
  return null;
}
