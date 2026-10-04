# Tool contracts and overlap

Reviewed **2026-10-04**. OpenCode owns native tools, MCP schemas, execution and
permissions. Freelancer adapts seven shared tools through its existing plugins;
the [manifest](../backend/opencode/catalog.json) is their inventory, not an access
gate. Short card descriptions live in
[capability-descriptions.mjs](../domain/capability-descriptions.mjs).
The [skill task map](skills-library.md#choose-guidance-by-the-result) supplies
task methods; models do not need a skill before calling a tool.

## Freelancer tools

| Tool | Distinct result | Consequential input and evidence boundaries |
| --- | --- | --- |
| `content_index` | Locate extracted file passages, native chat text and derived index facts | Search/chats require `query` and default to the current project; `projectID` and `global` are alternatives. Filters and limits are operation-specific. Repeat cursor inputs; check originals and coverage. Extraction facts are not retained claims. |
| `knowledge` | Query or intentionally retain warehouse notes/snapshots, optional structured claims, graph data and pins | Query domains, graph pages and exact revisions have distinct read semantics. Mutations retain native permission. `analyze` runs bounded read-only SQL in Freelancer's warehouse, not arbitrary project databases. Stored judgment definitions are optional reusable knowledge. |
| `model_catalog` | Read sourced model, deployment and benchmark-configuration observations | `schema` supplies canonical keys; list/search find source IDs; detail preserves separate records and unknowns. Follow byte-bounded pages with unchanged inputs. Requested source downloads differ from model inference, availability, account costs and consent. |
| `evidence_evaluation` | Prepare selected evidence, judge it optionally, and inspect receipts | Its local contract is not vendor MCP/SDK JSON. Prepare runs no inference; evaluate uses a contract or receipt; inspect does not replay. Keep questions narrow, unknowns explicit and full receipt coverage visible. Code owns exact composition. |
| `delegate` | Assign and recover named-agent work through native sessions | Use catalog `agent`, bounded `task` and an exact eligible `model` only when constrained. Child session IDs and task IDs differ. Steer/Queue/Fork/Cancel have different combinations; uncertain stop/delivery is not success or replay authority. |
| `git_project` | Preview and apply history work under a saved project agreement | Use the exact returned preview `id` as `planID`. Follow native permission and the tool's recorded exception-question flow. Kind/files/message and initial request/agreement arguments belong to their specific operations; no shell publication fallback. |
| `goal_checkpoint` | Record a saved-goal parent's proposed lifecycle checkpoint | Objective/run identity comes from the calling context. The controller reconciles todos, workers and activity before final status; a receipt or response ending is not completed work. Ordinary chats/workers do not checkpoint goals. |

`knowledge` is the shared tool. `remember` names its ordinary note-save operation
and an optional skill. Memory means a retained note or snapshot, queried through
domain `memories`; `claim` optionally stores a structured predicate/value with
evidence and status, queried through `facts`. A request to remember repository
locations or decisions normally saves a note with `operation: "remember"`,
`title` and `body`, scoped to the real project when appropriate. Correct missing
arguments in that operation; do not switch to a claim because a note call was
incomplete. See the [operation reference](../backend/skills/remember/references/operations.md).

Public fields, types, enums, limits and operation names remain stable, as do
native permissions. Knowledge now identifies a missing `operation` or query
`domain` before permission/data work, with guidance for correcting that input.
It never infers a save operation or changes a note into a claim. The refresh
shortens purpose descriptions and moves operation detail onto the input fields.

Source registrations:

- [Content index](../backend/opencode/tools/content_index.ts)
- [Knowledge](../backend/opencode/plugins/knowledge.ts)
- [Model catalog](../backend/opencode/plugins/model-catalog.ts)
- [Evidence evaluation](../backend/opencode/plugins/evidence-evaluation.ts)
- [Delegation](../backend/opencode/plugins/delegation.ts)
- [Managed Git](../backend/opencode/plugins/git-project.ts)
- [Goal checkpoint](../backend/opencode/plugins/goals.ts)

## Native and MCP routes

| Need | Appropriate route and distinction |
| --- | --- |
| Current source or symbols | Native read/glob/grep/LSP; indexed text complements source inspection |
| Source changes | Native edit/write/apply_patch; captured restrictions and permissions still apply |
| Commands and local inspection | Native shell; inspect actual results and honor project/history restrictions |
| Unknown web sources | Native websearch when registered and exposed |
| Known source text | Native webfetch or Fetch MCP; Fetch supports character continuation; neither establishes rendered interaction |
| Rendered state and browser interaction | Connected Playwright with current snapshots and discovered parameters |
| Version-specific library contract | Context7 resolution and documentation query; match the actual version/source |
| Structured reasoning record | Sequential Thinking stores supplied steps/revisions/branches; it adds no independent observations |
| Direct typed judgments | Connected Jev's actual MCP arguments; these differ from Freelancer's evidence contract |
| Source-bearing local judgments | `evidence_evaluation`; `knowledge` retains intentionally reusable definitions |
| User decisions and ordinary progress | Native question and todowrite; neither grants tool permission or proves task success |
| Guidance | Native skill discovery; source instructions remain guidance |

Native task is retained as an observed native surface, while Freelancer dispatches
workers through `delegate`. Vendor implementations/descriptions and MCP services
are not replaced by another engine or client. Overlap in retrieval or judgment
routes is useful when their inputs and results differ; it does not justify
disabling a service.

## Discovery limits and version checks

Capabilities derives Freelancer tool origins from the authored manifest.
Native registry IDs and selected-model definitions establish native/plugin
registration/exposure. In the audited installed runtime, those endpoints do
not return MCP definitions even while all five services report connected.
An empty MCP tool list therefore means incomplete inventory coverage. Connection
health, tool schema exposure and a successful invocation are different evidence.

The UI exposes this limit under Tools help and technical details. No per-agent,
model or project tool allowlist is introduced. Discovery is read-only; no provider
inference or paid judgment was performed during this audit.

Context7 checked official [Playwright MCP](https://github.com/microsoft/playwright-mcp),
[Fetch](https://github.com/modelcontextprotocol/servers/tree/main/src/fetch)
and [Sequential Thinking](https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking)
references. Current OpenCode development docs can differ from the installed
runtime; follow actual native schemas. Browser reference/selector parameters
likewise vary by server version. Upstream provenance and TypeSafe contracts are
documented in [Skills library](skills-library.md).
