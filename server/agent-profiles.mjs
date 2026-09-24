// Native profiles only carry identity and permission defaults. Edited prompts
// are supplied from the immutable per-request catalog, not this native cache.
export async function ensureAgentProfiles(
  host,
  directory,
  agents,
  mayRefresh,
  setRefreshing = () => {},
) {
  const read = () => host.request("/agent", { directory });
  const complete = (rows) =>
    Array.isArray(rows) &&
    agents.every((agent) =>
      rows.some((row) => row.name === agent.id && row.mode === "all"),
    );
  if (complete(await read())) return;
  if (!mayRefresh())
    throw Error(
      "Another request is starting. Retry when it has started or finished; no agent was launched.",
    );
  setRefreshing(true);
  try {
    const [status, questions, permissions] = await Promise.all([
      host.request("/session/status", { directory }),
      host.request("/question", { directory }),
      host.request("/permission", { directory }),
    ]);
    if (
      !status ||
      typeof status !== "object" ||
      Array.isArray(status) ||
      !Array.isArray(questions) ||
      !Array.isArray(permissions) ||
      Object.values(status).some((row) => row?.type !== "idle") ||
      questions.length ||
      permissions.length ||
      !mayRefresh()
    )
      throw Error(
        "A new agent is saved. Let running chats and pending approvals finish before starting it. Existing work was not interrupted.",
      );
    await host.request("/instance/dispose", { directory, method: "POST" });
    if (!complete(await read()))
      throw Error(
        "The native agent catalog could not be refreshed. Restart Freelancer before using the new agent.",
      );
  } finally {
    setRefreshing(false);
  }
}
