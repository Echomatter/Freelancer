# Shared skill library and source provenance

Reviewed **2026-10-03**. Skills are discoverable guidance for the shared native
OpenCode toolkit. They do not install services, prove connection health, grant
permissions, restrict access by agent/model/project, or authorize paid use.
Native configuration, current tool schemas, explicit denial, delegation limits,
and saved Git agreements retain their existing authority. See
[Capabilities](capabilities.md) for the connection and inventory UI.

## Official external sources

| Runtime skill | Source and revision | What was retained or adapted |
| --- | --- | --- |
| `context7-mcp` | Upstash [official OpenCode skill](https://github.com/upstash/context7/blob/bfa02ea67b5707fe0e0a673faa49d0f50b28c80b/packages/opencode/skills/context7-mcp/SKILL.md), commit `bfa02ea67b5707fe0e0a673faa49d0f50b28c80b` (2026-10-02) | Official body retained with a local native-discovery, scope, privacy, version, and fallback note. MIT notice copied to `LICENSE.upstream`. |
| `typesafe-ai` | TypeSafe [official agent skill](https://github.com/typesafe-ai/skills/blob/65a39f393687675ce170e6094757de20370365b9/skills/typesafe-ai/SKILL.md), commit `65a39f393687675ce170e6094757de20370365b9` (2026-09-12) | Official body retained with a local note explaining existing knowledge judgments, evidence freshness, paid consent, and SDK/MCP credential separation. MIT notice copied to `LICENSE.upstream`. |
| `playwright` | Microsoft [MCP documentation](https://github.com/microsoft/playwright-mcp/blob/f183dad4a52965583e3cc1d59b88cdc279e2e57d/README.md), commit `f183dad4a52965583e3cc1d59b88cdc279e2e57d` (2026-09-28), Apache-2.0 | Native MCP guidance derived from documented browser operations. No official MCP `SKILL.md` was found in that revision's repository tree. |
| `fetch` | MCP reference [Fetch documentation](https://github.com/modelcontextprotocol/servers/blob/f46d9578190b476b3501923ea8977d899e8db2cb/src/fetch/README.md) and [parameter definitions](https://github.com/modelcontextprotocol/servers/blob/f46d9578190b476b3501923ea8977d899e8db2cb/src/fetch/src/mcp_server_fetch/server.py), commit `f46d9578190b476b3501923ea8977d899e8db2cb` (2026-09-22), MIT | New native-tool guidance for URL retrieval, bounded character continuation, source citation, and documented Windows encoding troubleshooting. No official skill was found in the repository tree. |
| `reason-through` | MCP reference [Sequential Thinking documentation](https://github.com/modelcontextprotocol/servers/blob/f46d9578190b476b3501923ea8977d899e8db2cb/src/sequentialthinking/README.md) and [registration](https://github.com/modelcontextprotocol/servers/blob/f46d9578190b476b3501923ea8977d899e8db2cb/src/sequentialthinking/index.ts), same commit/date, MIT | Existing optional reasoning guidance expanded with real required, revision, and branch parameters. No official skill was found in the repository tree. |

Microsoft does publish an [official Playwright CLI skill](https://github.com/microsoft/playwright-cli/blob/b85c7a736bb473bf55b584e54a09ffa698d6d871/skills/playwright-cli/SKILL.md)
at commit `b85c7a736bb473bf55b584e54a09ffa698d6d871` (2026-09-28).
It invokes a separate CLI, manages CLI sessions, and includes CLI-specific setup.
It was inspected as a comparison; it was not installed or presented as MCP
guidance. Freelancer's browser interaction remains in native OpenCode MCP.

The copied vendor skill source bytes had these SHA-256 values before adding the
local integration notes:

- Context7: `29ef59d342876991f1a07297959748b57647063b1f7c7db4761fd36137655ade`
- TypeSafe: `71ea90d7906c6554c4f4c460ef7361b2d26f59116ccdae986dc6d997b9389f52`

## Operation equivalence and version differences

| Capability | Guidance matches | Boundary or version difference |
| --- | --- | --- |
| Playwright MCP | Native tab selection/navigation, accessibility snapshots, click/type/fill/select, waiting for visible state, screenshots, discovered console/network diagnostics | Current Microsoft docs use `target` for references/selectors; older servers may expose `ref`. Follow the actual native schema. Optional server capabilities remain optional; the skill does not enable them. |
| Context7 MCP | `resolve-library-id` with `libraryName`/`query`, then `query-docs` with `libraryId`/`query`; exact supplied library IDs can be queried directly | OpenCode may prefix tool names. Documentation ranking is advisory, and selected version/source must be reported. General code review and business-logic debugging do not require a remote lookup. |
| TypeSafe | Official Choice, Noul, Score, current SDK/API documentation, uncertainty, batching, and source-grounded design | Existing `knowledge` maps `classify`→Choice, `check`→Noul, `score`→Score. Configured provider status is not inference proof. A separately configured community Jev MCP exposes its own schema and auth boundary. |
| Fetch MCP | `fetch` with `url`, `max_length`, `start_index`, and `raw`; continuation offset counts characters | A fetch is neither a search nor an authenticated browser session. Truncation and configured robots/permission refusals remain visible. Native commands/environment are not changed by this skill. |
| Sequential Thinking MCP | `thought`, `thoughtNumber`, `totalThoughts`, `nextThoughtNeeded`, revision fields, and branch fields | At the checked revision, the README says `sequential_thinking` but registration uses `sequentialthinking`. Use the discovered name. Reasoning output is not source verification or permission. |

TypeSafe's live [documentation index](https://docs.typesafe.ai/llms.txt),
[agent-skill page](https://docs.typesafe.ai/agent-skill),
[JavaScript SDK](https://docs.typesafe.ai/sdk/javascript),
[Score reference](https://docs.typesafe.ai/primitives/score), and
[confidence guide](https://docs.typesafe.ai/confidence) were consulted during the
refresh. A single Context7 resolve/query pair checked Microsoft Playwright MCP
API references against its primary source. These were documentation reads;
no paid judgment, model inference, MCP service setup, or credential transfer ran.

## Application skills and existing native tools

OpenCode **1.18.31** supplies native tools from its
[tool registry](https://github.com/anomalyco/opencode/blob/v1.18.31/packages/opencode/src/tool/registry.ts),
with adjacent `.ts` input schemas and `.txt` descriptions as the defaults.
That tagged repository has no official per-tool `SKILL.md`; its development and
fixture skills are not vendor manuals for native file, shell, web or todo tools.
Freelancer retains those native defaults and adds concise UI summaries and
application guidance rather than copying a competing tool implementation.

The upstream [native task tool](https://github.com/anomalyco/opencode/blob/v1.18.31/packages/opencode/src/tool/task.ts)
uses `subagent_type`, optional `task_id`, and foreground execution by default.
Freelancer's existing `delegate` adaptation uses the authored named-agent catalog,
background assignments, durable inspection, continuation, steering, FIFO queue,
forking and cancellation through native sessions. Direct native `task` is blocked
in the application to keep one worker dispatch path. Follow the discovered
`delegate` schema; native task examples are not compatible arguments for it.

The authored manifest is [backend/opencode/catalog.json](../backend/opencode/catalog.json).
Short UI descriptions come from
[domain/capability-descriptions.mjs](../domain/capability-descriptions.mjs).
They describe observed capabilities; they are not another permission system.
Native or user-installed skills outside that manifest retain their own sources
and fall back to their source-provided summaries.

| Guidance | Existing surface and equivalence |
| --- | --- |
| `remember` | Shared `knowledge` memories, facts/claims, relations, exact entity reads, opening nodes, graph pages, node search, and canonical pins. Freelancer internal memory needs no external Memory MCP; an independent custom Memory connection remains distinct. |
| `search-index` | Shared `content_index` and knowledge queries for project files/chats, source freshness, and decisive evidence. It complements native code search. |
| `model-routing`, `record-outcome` | Existing model evidence, execution receipts, and the public bounded `delegate` surface; typed advice never grants eligibility or task success. |
| `reorient`, `debug`, `review`, `verify`, `browser-verify` | Project instructions, source/behavior inspection, focused verification, report-only review, and explicit evidence limits. Browser guidance applies across supported connected browser MCP tools. |
| `pursue-goal`, `handoff` | Persistent same-chat goal continuation, inspectable durable checkpoints, explicit Stop/Resume, and uncertain-delivery safeguards. |
| `managed-git` | Existing `git_project` actions, read/preview versus approved execution, saved agreements, and explicit permission exceptions. It adds guidance without creating another Git executor. |
| `web-research`, `docs-research`, `bounded-judgment` | Task-oriented research/judgment hints, complementary to the provider-specific skills above. They do not duplicate service credentials or create mandatory stages. |

Named-agent/delegation contracts remain in [Named agents](named-agents.md),
the native plugin, and existing skill guidance. Managed `git_project` keeps its
own current actions and saved-agreement authority, with `managed-git` documenting
the existing procedure. No duplicate delegation skill or second execution engine
was introduced by this refresh.

## Discovery and evidence limits

The refresh edits repository-owned skill sources only. User-global skills,
provider authentication, native MCP configuration, and connection commands remain
unchanged. A source file or catalog entry does not prove runtime discovery:
after the normal application refresh/restart, the native `/skill` observation
and Capabilities inventory must establish which skills loaded. Connection status
and harmless tool-call receipts establish separate service-use evidence. This
upstream-source audit itself did not run paid inference or change native setup.
Build, contract, browser and installed-runtime checks are separate integration
evidence recorded with the installation's deployment receipt.
