# Freelancer execution

`server/execution.mjs` composes the captured Freelancer contract for each named
agent request. Native OpenCode permissions remain authoritative; agent and skill
text provide guidance, never permission.

Use registered native tools according to their published schemas and current
permissions. The captured execution contract supplies request-specific tool,
question, delegation, verification and saved-goal procedures. Skills are loaded
through OpenCode's native `skill` tool when useful; they teach process, not
authority. The captured contract also supplies shared capability-use hints:
optional advice about suitable methods and evidence, never access restrictions
or required calls. Connected MCP tools remain directly usable without a skill.

Use `delegate` for optional worker work and managed `git_project` for history.
Saved project agreements and native permissions remain authoritative. Keep
provider, auth and quota failures separate from capability findings; tool
completion is not task verification. See the captured contract for delivery,
approval and recovery procedures.
