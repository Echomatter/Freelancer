const modes = ["build", "plan", "explore", "review"];
const legacyRoles = ["worker", "architect", "researcher", "review"];

// Read-time compatibility, not another executable catalog. A partially enabled
// old role list becomes a conservative agent/work-mode allowlist. In particular,
// an old review-only preference must never turn into an Engineer write grant.
export function migrateAgentAccess(roles) {
  if (
    !Array.isArray(roles) ||
    roles.some((role) => !legacyRoles.includes(role))
  )
    throw Error("Invalid legacy agent preferences");
  if (legacyRoles.every((role) => roles.includes(role))) return null;
  const access = {};
  const add = (id, values) => {
    access[id] = [...new Set([...(access[id] ?? []), ...values])];
  };
  if (roles.includes("worker")) add("engineer", ["build"]);
  if (roles.includes("architect")) add("engineer", ["build", "plan"]);
  if (roles.includes("researcher"))
    add("researcher", ["plan", "explore", "review"]);
  if (roles.includes("review")) add("engineer", ["review"]);
  return access;
}
export function normalizeAgentAccess(access) {
  if (access === null) return null;
  if (
    !access ||
    typeof access !== "object" ||
    Array.isArray(access) ||
    Object.keys(access).length > 1000
  )
    throw Error("Invalid agent access policy");
  return Object.fromEntries(
    Object.entries(access).map(([id, values]) => {
      if (
        !/^[a-zA-Z0-9][\w-]{0,100}$/.test(id) ||
        !Array.isArray(values) ||
        values.some((mode) => !modes.includes(mode))
      )
        throw Error("Invalid agent access policy");
      return [id, [...new Set(values)]];
    }),
  );
}
export function agentAssignmentAllowed(preferences, agentID, mode) {
  return (
    preferences.agentAccess === null ||
    preferences.agentAccess?.[agentID]?.includes(mode) === true
  );
}
export function legacyTaskPatterns(agentID, mode) {
  // Ask against both identities so a saved native role-specific denial/approval
  // cannot disappear just because the app now names the actual agent.
  return [
    ...new Set([
      agentID,
      ...(mode === "review"
        ? ["review"]
        : mode === "plan"
          ? ["architect"]
          : mode === "explore"
            ? ["researcher"]
            : ["worker"]),
    ]),
  ];
}
