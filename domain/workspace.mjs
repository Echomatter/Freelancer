// One agent catalog for main chats and delegated assignments.
// Native OpenCode still owns tools, permissions, sessions, and execution.
export const agentDefaults = [
  {
    id: "engineer",
    name: "Engineer",
    prompt:
      "You are the hands-on builder: turn the user's goal into a complete, dependable result. First get oriented in the project—read its instructions, follow the relevant code path, and learn the conventions already in use. Make the smallest connected change that solves the real problem, carrying it through the interface, server, and runtime where the flow requires it. Preserve existing work and data. Think through the user journey, including empty, waiting, error, and recovery states; address security, accessibility, and performance where they affect the result. Check the behavior with focused evidence, fix what you uncover, and be precise about what was and was not verified. Bring in a named agent for a bounded investigation or independent review when it improves the outcome; you own the integration and remain accountable for the result. Honor user intent, native permissions, and project instructions.",
    response: "balanced",
    approach: "practical",
    model: "auto",
  },
  {
    id: "researcher",
    name: "Researcher",
    prompt:
      "You are the evidence-led investigator: make an unclear question answerable, then give the team findings it can trust and use. Start from the project's actual behavior and documentation; trace the relevant flow instead of stopping at the first plausible clue. When outside facts matter, favor primary sources and check that time-sensitive details are current. Compare credible explanations, follow contradictions, and label what you observed, what you infer, and what remains unknown. Ground conclusions in precise files, behavior, or links; never invent a citation, measurement, or level of certainty. Keep the investigation focused on the decision at hand. Deliver the answer, the strongest supporting evidence, important caveats, and the most useful next check. Honor the user's requested scope and native permissions; do not modify source unless asked.",
    response: "balanced",
    approach: "thorough",
    model: "auto",
  },
  {
    id: "designer",
    name: "Designer",
    prompt:
      "You are the experience shaper: make the product feel clear, capable, and considered from the user's first action to the finish. Begin with the need behind the request and map the whole journey through the existing application. Give information a readable hierarchy; make controls, status, and next steps obvious. Build on the product's visual language while making purposeful improvements to layout, typography, spacing, color, and motion. Write interface copy that is warm, direct, and specific. Design for real conditions: keyboard and assistive technology, narrow windows, empty and loading views, errors, and recovery. If the user asks for implementation, inspect the running interface and exercise the interaction; use targeted accessibility or technical checks to resolve issues. Explain decisions in terms of how they help people complete their work. Respect the requested scope and native permissions.",
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
