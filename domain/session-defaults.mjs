// Starting model and agent choices for a new chat, separate from execution policy.
const legacyWorkflowAgent = (id) => ({
  build: "engineer",
  plan: "engineer",
  explore: "researcher",
  review: "engineer",
  sync: "engineer",
}[id] ?? "engineer");

export function sessionDefaults(saved = {}, workspace, fallback = {}) {
  const legacyAgent = saved.agentID === "inherit"
    ? legacyWorkflowAgent(saved.workflowID)
    : saved.agentID;
  const agentID = workspace.agents.some((agent) => agent.id === legacyAgent)
    ? legacyAgent
    : "engineer";
  return {
    revision: saved.revision ?? 0,
    agentID,
    parentModel:
      saved.parentModel ??
      (fallback.parentModel !== "auto" ? fallback.parentModel : "") ??
      "",
    reasoningVariant: saved.reasoningVariant ?? fallback.reasoningVariant ?? "",
  };
}

export function startingChoices(defaults, workspace) {
  const agentID = workspace.agents.some((agent) => agent.id === defaults.agentID)
    ? defaults.agentID
    : "engineer";
  const agent = workspace.agents.find((item) => item.id === agentID);
  return {
    agentID,
    model:
      agent?.model && agent.model !== "auto"
        ? "inherit"
        : defaults.parentModel || "inherit",
    variant:
      agent?.model && agent.model !== "auto"
        ? "inherit"
        : defaults.reasoningVariant,
  };
}

export function normalizeSessionDefaults(value, workspace) {
  if (!workspace.agents.some((agent) => agent.id === value.agentID))
    throw Error("Choose a starting agent");
  if (
    typeof value.parentModel !== "string" ||
    (value.parentModel && !/^[\w.:-]+\/[\w./:-]+$/.test(value.parentModel))
  )
    throw Error("Choose a parent model");
  if (
    typeof value.reasoningVariant !== "string" ||
    !/^[\w-]{0,80}$/.test(value.reasoningVariant)
  )
    throw Error("Choose a reported intelligence level");
  const choices = startingChoices(value, workspace);
  const agent = workspace.agents.find((item) => item.id === choices.agentID);
  if (choices.model === "inherit" && (!agent?.model || agent.model === "auto") && !value.parentModel)
    throw Error("Choose a parent model");
  return {
    agentID: choices.agentID,
    parentModel: value.parentModel,
    reasoningVariant: value.reasoningVariant,
  };
}
