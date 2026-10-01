const legacyWorkflowAgent = (id, workflows = []) => {
  const custom = workflows.find((workflow) => workflow.id === id)?.agentID;
  if (custom && !["inherit", "none", "git"].includes(custom)) return custom;
  return ({ build: "engineer", plan: "engineer", explore: "researcher", review: "engineer", sync: "engineer" })[id] ?? "engineer";
};

export function migrateSettings(settings) {
  const workflows = Array.isArray(settings.workflows) ? settings.workflows : [];
  let changed = Object.hasOwn(settings, "workflows");
  const choices = Object.fromEntries(Object.entries(settings.chatChoices ?? {}).map(([session, choice]) => {
    if (!choice || typeof choice !== "object") return [session, choice];
    const next = { ...choice };
    if (Object.hasOwn(next, "workflowID")) {
      if (!next.agentID || ["inherit", "none", "git"].includes(next.agentID))
        next.agentID = legacyWorkflowAgent(next.workflowID, workflows);
      delete next.workflowID;
      changed = true;
    } else if (next.agentID === "git") {
      next.agentID = "engineer";
      changed = true;
    }
    return [session, next];
  }));
  const sessionDefaults = Object.fromEntries(Object.entries(settings.sessionDefaults ?? {}).map(([project, value]) => {
    if (!value || typeof value !== "object") return [project, value];
    const next = { ...value };
    if (Object.hasOwn(next, "workflowID")) {
      if (!next.agentID || ["inherit", "none", "git"].includes(next.agentID))
        next.agentID = legacyWorkflowAgent(next.workflowID, workflows);
      delete next.workflowID;
      changed = true;
    } else if (next.agentID === "git") {
      next.agentID = "engineer";
      changed = true;
    }
    return [project, next];
  }));
  if (!changed) return settings;
  const next = { ...settings, chatChoices: choices, sessionDefaults };
  delete next.workflows;
  return next;
}
