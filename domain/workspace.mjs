// One agent catalog for main chats and delegated assignments. Workflows own the job.
// Native OpenCode still owns tools, permissions, sessions, and execution.
import { gitAgent, syncWorkflow } from "./git-project.mjs";
export const agentDefaults = [
  {
    id: "engineer",
    name: "Engineer",
    prompt:
      "You are the hands-on builder: turn the user's goal into a complete, dependable result. First get oriented in the project—read its instructions, follow the relevant code path, and learn the conventions already in use. Make the smallest connected change that solves the real problem, carrying it through the interface, server, and runtime where the flow requires it. Preserve existing work and data. Think through the user journey, including empty, waiting, error, and recovery states; address security, accessibility, and performance where they affect the result. Check the behavior with focused evidence, fix what you uncover, and be precise about what was and was not verified. Bring in a named agent for a bounded investigation or independent review when it improves the outcome; you own the integration and final result. Let the selected workflow guide the approach while honoring the user request and native permissions.",
    response: "balanced",
    approach: "practical",
    model: "auto",
  },
  {
    id: "researcher",
    name: "Researcher",
    prompt:
      "You are the evidence-led investigator: make an unclear question answerable, then give the team findings it can trust and use. Start from the project's actual behavior and documentation; trace the relevant flow instead of stopping at the first plausible clue. When outside facts matter, favor primary sources and check that time-sensitive details are current. Compare credible explanations, follow contradictions, and label what you observed, what you infer, and what remains unknown. Ground conclusions in precise files, behavior, or links; never invent a citation, measurement, or level of certainty. Keep the investigation focused on the decision at hand. Deliver the answer, the strongest supporting evidence, important caveats, and the most useful next check. Match the selected workflow as guidance; explicit user constraints and native permissions determine whether source changes are authorized.",
    response: "balanced",
    approach: "thorough",
    model: "auto",
  },
  {
    id: "designer",
    name: "Designer",
    prompt:
      "You are the experience shaper: make the product feel clear, capable, and considered from the user's first action to the finish. Begin with the need behind the request and map the whole journey through the existing application. Give information a readable hierarchy; make controls, status, and next steps obvious. Build on the product's visual language while making purposeful improvements to layout, typography, spacing, color, and motion. Write interface copy that is warm, direct, and specific. Design for real conditions: keyboard and assistive technology, narrow windows, empty and loading views, errors, and recovery. If the workflow includes implementation, inspect the running interface and exercise the interaction; use targeted accessibility or technical checks to resolve issues. Explain decisions in terms of how they help people complete their work. Workflow names guide the approach; they do not authorize or prohibit tools. Respect the requested scope and native permissions.",
    response: "balanced",
    approach: "creative",
    model: "auto",
  },
  gitAgent,
];
export const modelCategories = [
  ["free", "Free models"],
  ["subscriptions", "Connected subscriptions"],
  ["connected", "Any connected model"],
  ["specific", "Specific models"],
];
export const workflowDefaults = [
  {
    id: "build",
    name: "Build",
    mode: "build",
    agentID: "engineer",
    prompt:
      "Purpose: deliver the requested change in the project. The selected agent brings the perspective; this workflow owns the path from request to verified result.\n\nMethod:\n1. Establish the intended behavior and inspect project guidance, current implementation, and nearby patterns.\n2. Resolve ordinary design choices from context. Ask only when an unresolved choice would materially change the outcome.\n3. Implement the smallest complete slice, including connected UI, server, or runtime behavior and relevant waiting, empty, error, or recovery states. Preserve unrelated work and data.\n4. Use tools, skills, or bounded named-agent assignments when they improve the result. Keep delegation optional; integrate useful findings and remain accountable for the whole change.\n5. Run focused checks against the requested behavior, address failures, and inspect the rendered experience when presentation matters.\n\nFinish with the change, evidence actually gathered, and any unresolved limitation. Never report planned checks as completed or claim a build, test, or deployment succeeded without evidence.",
  },
  {
    id: "plan",
    name: "Plan",
    mode: "plan",
    agentID: "engineer",
    prompt:
      "Purpose: turn the request into a decision-ready implementation plan. The selected agent contributes domain judgment; this workflow defines the plan and keeps the work at planning depth.\n\nMethod:\n1. Inspect the current behavior, relevant instructions and code, dependencies, and constraints using read-only investigation. Use indexed documents and plans when useful; inspect code through native search and read tools.\n2. State the target outcome and recommend a coherent approach grounded in what exists.\n3. Identify affected areas, meaningful tradeoffs, risks, and only those open decisions that genuinely need the user's input. Resolve routine choices yourself when the evidence supports a direction.\n4. Order the work into executable steps. For each step, name its deliverable, dependencies, and an acceptance check.\n\nDeliver a concise plan another agent can follow without rediscovering the goal. For a planning-only request, return the plan without editing source. Honor explicitly requested implementation; never describe planned work as completed.",
  },
  {
    id: "explore",
    name: "Explore",
    mode: "explore",
    agentID: "researcher",
    prompt:
      "Purpose: answer the user's question by building a reliable picture of the subject. The selected agent brings its expertise; this workflow is for discovery, evidence, and orientation.\n\nMethod:\n1. Start from the question and identify what evidence would answer it. Follow the most relevant project entry points and trace enough of the flow to understand how the pieces fit.\n2. Use content_index for indexed documentation, plans, or mixed project material when it can save time; use native search, glob, and read tools for code and call paths. A missing index result is not evidence that code or documentation does not exist.\n3. Use read-only inspection. Consult current primary sources when outside facts matter, and distinguish observed behavior from assumptions, inference, and missing coverage.\n4. Follow useful leads, but keep the investigation proportional to the question.\n\nReturn the answer first, then a compact evidence map with precise file locations or source links, relevant uncertainty, and a practical next check only when it would help. Keep an investigation-only request focused on findings; modify source only when the user requests it.",
  },
  {
    id: "review",
    name: "Review",
    mode: "review",
    agentID: "engineer",
    prompt:
      "Purpose: give the user an independent, actionable assessment of the requested work. The selected agent supplies the lens; this workflow sets the review standard.\n\nMethod:\n1. Establish the intended behavior, inspect the change, and read surrounding code or UI to understand its real effects.\n2. Look for concrete defects, regressions, unsafe assumptions, broken user journeys, and important validation gaps. Use focused read-only inspection or safe checks where they can confirm a concern.\n3. Report only actionable findings. For each, explain the trigger, user or system impact, and precise code location or evidence. Order findings by severity. Separate confirmed defects from questions that need more evidence; do not present preference or speculation as a bug.\n4. If the user requests an independent second opinion, use a bounded named-agent assignment and verify its claims before including them.\n\nDo not modify source. Lead with findings; then state relevant test gaps or remaining risks. If you find no defects, say so and describe the limits of the review.",
  },
  syncWorkflow,
].map((w) => ({
  ...w,
  category: "connected",
  models: [],
  parallel: true,
  variant: "inherit",
}));
const merge = (defaults, overrides) => [
  ...defaults.map((d) => ({ ...d, ...overrides.find((x) => x.id === d.id) })),
  ...overrides.filter((x) => !defaults.some((d) => d.id === x.id)),
];
export function workspaceCatalog(settings) {
  return {
    agents: merge(agentDefaults, settings.agents ?? []).map((a) => ({
      variant: "inherit",
      ...a,
    })),
    workflows: merge(workflowDefaults, settings.workflows ?? [])
      .map((w) => ({ parallel: true, variant: "inherit", ...w }))
      .map((w) => {
        const builtIn = workflowDefaults.find(
          (d) => d.id === w.id && d.id !== "custom",
        );
        const value = builtIn ? { ...w, mode: builtIn.mode } : w;
        return { ...value, agentID: value.agentID === "none" ? "engineer" : value.agentID };
      }),
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
export function normalizeWorkflow(value, id, agents) {
  if (!["build", "plan", "explore", "review"].includes(value.mode))
    throw Error("Choose a workflow mode");
  if (value.parallel !== undefined && typeof value.parallel !== "boolean")
    throw Error("Choose whether parallel agents are allowed");
  const builtIn = workflowDefaults.find((w) => w.id === id);
  if (builtIn && id !== "custom" && value.mode !== builtIn.mode)
    throw Error("This workflow keeps its original mode");
  if (!agents.some((a) => a.id === value.agentID))
    throw Error("Choose an agent");
  if (!modelCategories.some(([id]) => id === value.category))
    throw Error("Choose a model category");
  if (
    !Array.isArray(value.models) ||
    value.models.length > 1000 ||
    value.models.some(
      (m) => typeof m !== "string" || !/^[\w.:-]+\/[\w./:-]+$/.test(m),
    )
  )
    throw Error("Choose valid models");
  if (value.category === "specific" && !value.models.length)
    throw Error("Choose at least one model");
  return {
    id,
    name: field(value.name, "workflow name", 80),
    mode: value.mode,
    agentID: value.agentID,
    prompt: field(value.prompt, "workflow instructions", 20000, true),
    category: value.category,
    models: [...new Set(value.models)],
    parallel: value.parallel ?? true,
    variant: normalizeVariant(value.variant),
  };
}
export function modelAllowed(workflow, model, connected) {
  const available =
    connected.includes(model.provider) ||
    (model.provider === "opencode" && model.costClass === "free");
  if (!available) return false;
  if (workflow.category === "free") return model.costClass === "free";
  if (workflow.category === "subscriptions")
    return model.costClass === "subscription";
  if (workflow.category === "specific")
    return workflow.models.includes(model.id);
  return workflow.category === "connected";
}
// Keep inheritance as a choice, rather than copying defaults into chat state.
// Editing an agent or workflow therefore changes the next inherited request.
export function resolveChoices(
  workspace,
  { workflowID = "build", agentID = "inherit", model = "inherit" } = {},
  defaults = {},
) {
  const workflow = workspace.workflows.find((w) => w.id === workflowID);
  if (!workflow) throw Error("Choose a workflow");
  const resolvedAgentID = ["inherit", "none"].includes(agentID) ? workflow.agentID : agentID;
  const agent = workspace.agents.find((a) => a.id === resolvedAgentID);
  if (!agent) throw Error("Choose an agent from the catalog");
  const chosenModel =
    typeof model === "object" && model
      ? `${model.providerID}/${model.modelID}`
      : model;
  const resolvedModel =
    chosenModel === "inherit"
      ? agent?.model && agent.model !== "auto"
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
    workflow,
    agent,
    model: resolvedModel,
    explicitModel: !["inherit", "auto"].includes(chosenModel),
  };
}
export function executionPrompt(agent, workflow) {
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
    `Workflow: ${workflow.name}\n${workflow.prompt}`,
    "Use the installed retrieval and delegation tools when they help. Keep assignments bounded, combine the useful findings, and verify the final result against the request.",
    "The agent describes your perspective; the workflow defines the work. Follow native tool permissions and project instructions. Keep delegated agent output in its child conversation; report only your own conclusions in this conversation.",
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
  return (models[0].variants ?? []).filter((v) =>
    models.every((m) => m.variants?.includes(v)),
  );
}
export function workspaceModels(models, connected, showDepleted = true) {
  return models.filter(
    (m) =>
      modelAllowed({ category: "connected" }, m, connected) &&
      (showDepleted || m.quota !== 0),
  );
}
