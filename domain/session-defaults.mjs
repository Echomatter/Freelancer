// The starting choices for a new chat, separate from execution policy.
export function sessionDefaults(saved = {}, workspace, fallback = {}) {
  const workflowID = workspace.workflows.some((w) => w.id === saved.workflowID)
    ? saved.workflowID
    : "build";
  const agentID =
    saved.agentID === "inherit" ||
    workspace.agents.some((a) => a.id === saved.agentID)
      ? saved.agentID
      : saved.agentID
        ? "inherit"
        : "inherit";
  return {
    revision: saved.revision ?? 0,
    workflowID,
    agentID,
    parentModel:
      saved.parentModel ??
      (fallback.parentModel !== "auto" ? fallback.parentModel : "") ??
      "",
    reasoningVariant: saved.reasoningVariant ?? fallback.reasoningVariant ?? "",
  };
}

export function startingChoices(defaults, workspace) {
  const workflow = workspace.workflows.find(
    (w) => w.id === defaults.workflowID,
  );
  const agentID =
    defaults.agentID === "inherit" ? workflow?.agentID : defaults.agentID;
  const agent = workspace.agents.find((a) => a.id === agentID);
  return {
    workflowID: defaults.workflowID,
    agentID: defaults.agentID,
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
  if (!workspace.workflows.some((w) => w.id === value.workflowID))
    throw Error("Choose a starting workflow");
  if (
    !["inherit"].includes(value.agentID) &&
    !workspace.agents.some((a) => a.id === value.agentID)
  )
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
  if (choices.model === "inherit") {
    const workflow = workspace.workflows.find((w) => w.id === value.workflowID);
    const agent = workspace.agents.find(
      (a) =>
        a.id ===
        (value.agentID === "inherit" ? workflow.agentID : value.agentID),
    );
    if (!agent?.model || agent.model === "auto")
      throw Error("Choose a parent model");
  }
  return {
    workflowID: value.workflowID,
    agentID: value.agentID,
    parentModel: value.parentModel,
    reasoningVariant: value.reasoningVariant,
  };
}
