// One agent catalog for main chats and delegated assignments.
// Native OpenCode still owns tools, permissions, sessions, and execution.
export const agentDefaults = [
  {
    id: "engineer",
    name: "Engineer",
    prompt:
      "You are Engineer, a software agent. Complete the user's requested engineering work in the current project. Read its instructions and relevant implementation, follow established patterns, and make the smallest coherent change across the interface, server and runtime. Preserve existing work and data. Handle empty, waiting, error and recovery states; consider security, accessibility and performance where they affect the result. Use current source, native tools and useful skills; retained knowledge can aid orientation but does not establish current behavior. Ask a focused native question when a material user decision blocks progress. Delegate bounded independent work when it helps, integrate the findings, and check the requested outcome. Report actual checks and unresolved limits. Honor user steering and native permissions.",
    response: "balanced",
    approach: "practical",
    model: "auto",
  },
  {
    id: "researcher",
    name: "Researcher",
    prompt:
      "You are Researcher, an evidence-focused agent. Answer the user's question from actual project behavior, original files and relevant documentation. Trace important claims, compare explanations, investigate contradictions, and distinguish observation, inference and unknowns. Use native source search, indexed documents or retained knowledge as appropriate, then read decisive original or exact retained evidence. For outside facts, prefer primary sources and check current or version-sensitive details. Never invent citations, measurements or certainty. Ask a focused native question when a missing user choice changes the investigation; otherwise state material assumptions. Keep work bounded and use independent agents when parallel evidence gathering helps. Deliver the answer with precise source references, coverage limits and any necessary next check. Honor user steering and native permissions; change source only when requested.",
    response: "balanced",
    approach: "thorough",
    model: "auto",
  },
  {
    id: "designer",
    name: "Designer",
    prompt:
      "You are Designer, a product and interface agent. Understand the user's need and the journey through the existing application. Use its established visual language and shared controls; make hierarchy, actions, status and recovery clear with readable layout, typography, spacing and direct copy. Design for keyboard and assistive technology, narrow windows, empty/loading states and errors. Inspect current implementation and rendered behavior when available; screenshots and interaction checks establish different evidence from source inspection. Ask a focused native question for a meaningful preference that cannot be inferred, and use reasonable defaults for routine choices. When implementation is requested, carry the design through and check the interaction. Explain material choices by their effect on the user. Preserve existing work, user steering, scope and native permissions.",
    response: "balanced",
    approach: "creative",
    model: "auto",
  },
];

const merge = (defaults, overrides = []) => [
  ...defaults.map((item) => ({ ...item, ...overrides.find((row) => row.id === item.id) })),
  ...overrides.filter((row) => !defaults.some((item) => item.id === row.id)),
];

export function workspaceCatalog(settings = {}) {
  return {
    agents: merge(agentDefaults, (settings.agents ?? []).filter((agent) => agent.id !== "git"))
      .map((agent) => ({ variant: "inherit", ...agent })),
  };
}

function field(value, label, max, empty = false) {
  if (
    typeof value !== "string" ||
    (!empty && !value.trim()) ||
    value.length > max
  )
    throw Error(`Enter a valid ${label}`);
  return value.trim();
}

export function normalizeAgent(value, id) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9][\w-]{0,100}$/.test(id) ||
      ["build", "plan", "explore", "general", "worker", "architect", "review", "title", "summary", "compaction"].includes(id))
    throw Error("Choose a valid named agent ID");
  if (
    !["concise", "balanced", "detailed"].includes(value.response) ||
    !["practical", "thorough", "creative"].includes(value.approach)
  )
    throw Error("Choose the agent's working preferences");
  const model = value.model;
  if (
    typeof model !== "string" ||
    (model !== "auto" && !/^[\w.:-]+\/[\w./:-]+$/.test(model)) ||
    model.length > 500
  )
    throw Error("Choose a default model or per-assignment selection");
  return {
    id,
    name: field(value.name, "agent name", 80),
    prompt: field(value.prompt, "agent prompt", 20000),
    response: value.response,
    approach: value.approach,
    model,
    variant: normalizeVariant(value.variant),
  };
}

export function resolveChoices(
  workspace,
  { agentID = "engineer", model = "inherit" } = {},
  defaults = {},
) {
  const resolvedAgentID = ["inherit", "none", "git"].includes(agentID) ? "engineer" : agentID;
  const agent = workspace.agents.find((item) => item.id === resolvedAgentID);
  if (!agent) throw Error("Choose an agent from the catalog");
  const chosenModel =
    typeof model === "object" && model
      ? `${model.providerID}/${model.modelID}`
      : model;
  const resolvedModel =
    chosenModel === "inherit"
      ? agent.model && agent.model !== "auto"
        ? agent.model
        : (defaults.parentModel ?? "auto")
      : chosenModel;
  if (
    resolvedModel !== "auto" &&
    (typeof resolvedModel !== "string" ||
      !/^[\w.:-]+\/[\w./:-]+$/.test(resolvedModel))
  )
    throw Error("Choose a valid model");
  return {
    agent,
    model: resolvedModel,
    explicitModel: !["inherit", "auto"].includes(chosenModel),
  };
}

export function executionPrompt(agent) {
  const response = {
    concise:
      "Lead with the result. Keep the response brief while retaining essential evidence, limitations, and next steps.",
    balanced:
      "Lead with the result, then provide enough context and evidence to make it understandable and useful. Avoid unnecessary detail.",
    detailed:
      "Explain the relevant reasoning, alternatives, evidence, and verification in enough detail for someone to understand and review the work. Stay focused on the request.",
  };
  const approach = {
    practical:
      "Prefer established patterns and direct, maintainable solutions. Keep the effort proportional to the task while completing the requested outcome.",
    thorough:
      "Investigate important dependencies and edge cases, challenge assumptions, and check the evidence before concluding. Prioritize checks by their impact.",
    creative:
      "Consider useful alternatives when the problem benefits from exploration. Choose a coherent direction that serves the user's goal and validate it against practical constraints.",
  };
  return [
    agent &&
      `Agent: ${agent.name}\n${agent.prompt}\n\nResponse style: ${agent.response}. ${response[agent.response]}\nApproach: ${agent.approach}. ${approach[agent.approach]}`,
    "Use the installed retrieval and delegation tools when they help. Keep assignments bounded, combine the useful findings, and verify the final result against the request.",
    "The named agent provides working direction. A request to plan is ordinary task text; honor its intent without treating it as a separate execution mode. Follow native tool permissions and project instructions. Keep delegated agent output in its child conversation; report only your own conclusions in this conversation.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

// Authored filesystem scope for the application file guard. Persisted as
// top-level `fileAccessScope` in the existing saved settings document.
// 'project'  -> Files in this project (current project directory only).
// 'projects' -> Files in all projects (any registered settings.projects directory).
// 'computer' -> Files on my computer (default; preserves current
//   capability-first external-native-boundary behavior: non-private paths
//   outside projects remain subject to native permissions, not a sandbox).
// Private Git/application state (.git/.state) stays blocked in every scope
// and native external-directory permissions still apply; 'computer' never
// permits credential/private state or bypasses native authority.
export const fileAccessScopes = Object.freeze(["project", "projects", "computer"]);

export function normalizeFileAccessScope(value) {
  if (value === undefined || value === null || value === "") return "computer";
  if (!fileAccessScopes.includes(value))
    throw Error("Choose which files tools may use.");
  return value;
}

export function fileAccessScopeText(scope) {
  if (scope === "project") return "Files in this project";
  if (scope === "projects") return "Files in all projects";
  return "Files on my computer";
}
export function normalizeVariant(value = "inherit") {
  if (typeof value !== "string" || !/^[\w-]{0,80}$/.test(value))
    throw Error("Choose a valid intelligence level");
  return value;
}
export function resolvedVariant(value, defaults) {
  return value == null || value === "inherit"
    ? (defaults.reasoningVariant ?? "")
    : value;
}

// A parent's intelligence menu is supplied by that exact native model.
export function modelVariant(variants = [], value = "inherit", inherited = "") {
  const chosen = value === "inherit" ? inherited : value;
  return variants.includes(chosen) ? chosen : "";
}
export function commonVariants(models) {
  if (!models.length) return [];
  return (models[0].variants ?? []).filter((value) =>
    models.every((model) => model.variants?.includes(value)),
  );
}
export function modelAllowed(model, connected) {
  return connected.includes(model.provider) ||
    (model.provider === "opencode" && model.costClass === "free");
}
// Historical v3/v4 request receipts keep their captured workflow restriction.
export function legacyModelAllowed(workflow, model, connected) {
  if (!model || !modelAllowed(model, connected)) return false;
  if (workflow?.category === "free") return model.costClass === "free";
  if (workflow?.category === "subscriptions") return model.costClass === "subscription";
  if (workflow?.category === "specific") return workflow.models?.includes(model.id) === true;
  return true;
}
export function workspaceModels(models, connected, showDepleted = true) {
  return models.filter(
    (model) =>
      modelAllowed(model, connected) &&
      (showDepleted || model.quota !== 0),
  );
}
