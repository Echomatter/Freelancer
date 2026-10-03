# Freelancer extensions to native OpenCode execution

`server/execution.mjs` composes the captured Freelancer contract for each named
agent request. Native OpenCode permissions remain authoritative; agent and skill
text provide guidance, never permission.

OpenCode retains its provider/system prompts, project/global instruction
discovery, tool schemas, native skills, MCP lifecycle and execution. Freelancer
adds its named-agent request contract and shared runtime resources through the
native plugin and instruction interfaces. Do not copy those native prompts into
agent personas or infer tool availability from a catalog file.

Use registered native tools according to their published schemas and current
permissions. The captured execution contract supplies request-specific tool,
question, delegation, verification and saved-goal procedures. Skills are loaded
through OpenCode's native `skill` tool when useful; they teach process, not
authority. The captured contract also supplies shared capability-use hints:
optional advice about suitable methods and evidence, never access restrictions
or required calls. Connected MCP tools remain directly usable without a skill.

The internal `knowledge` tool supplies retained memory, canonical conversation
pins, source-linked facts and graph reads/writes in one per-user warehouse.
Use its published operations and exact revision/evidence references. Query pages
are bounded and may move during concurrent edits; missing coverage is unknown,
not deletion. Pin/unpin, archive/restore and forget have distinct effects, and
refresh requires explicit intent. Optional external Memory tools are separate;
they are not required for these internal operations.

Use `delegate` for optional worker work and managed `git_project` for history.
Saved project agreements and native permissions remain authoritative. Keep
provider, auth and quota failures separate from capability findings; tool
completion is not task verification. See the captured contract for delivery,
approval and recovery procedures.
