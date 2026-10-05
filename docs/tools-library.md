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
| `content_index` | Locate extracted file passages, native chat text and derived source attributes | Search/chats require `query` and default to the current project; `projectID` and `global` are alternatives. `observations` reads extracted attributes; rebuild uses `extraction` and `specialRules` when requested. Filters and limits are operation-specific. Repeat cursor inputs; check originals and coverage. Extracted attributes are derived index data, not retained memories. |
| `memory` | Query or intentionally retain memories with text, structured data, evidence, provenance and relationships | Query domains are files, conversations and memories. Exact revisions retain their own title/content/data/evidence. Pin and archive are properties of the same record. Mutations retain native permission. `analyze` runs bounded read-only SQL in Freelancer's warehouse, not arbitrary project databases. |
| `model_catalog` | Read sourced model, deployment and benchmark-configuration observations | `schema` supplies canonical keys; list/search find source IDs; detail preserves separate records and unknowns. Follow byte-bounded pages with unchanged inputs. Requested source downloads differ from model inference, availability, account costs and consent. |
| `evidence_evaluation` | Prepare selected evidence, judge it optionally, and inspect receipts | Its local contract is not vendor MCP/SDK JSON. Prepare runs no inference; evaluate uses a contract or receipt; inspect does not replay. Keep questions narrow, unknowns explicit and full receipt coverage visible. Code owns exact composition. |
| `delegate` | Assign and recover named-agent work through native sessions | Use catalog `agent`, bounded `task` and an exact eligible `model` only when constrained. Child session IDs and task IDs differ. Steer/Queue/Fork/Cancel have different combinations; uncertain stop/delivery is not success or replay authority. |
| `git_project` | Preview and apply history work under a saved project agreement | Use the exact returned preview `id` as `planID`. Follow native permission and the tool's recorded exception-question flow. Kind/files/message and initial request/agreement arguments belong to their specific operations; no shell publication fallback. |
| `goal_checkpoint` | Record a saved-goal parent's proposed lifecycle checkpoint | Objective/run identity comes from the calling context. The controller reconciles todos, workers and activity before final status; a receipt or response ending is not completed work. Ordinary chats/workers do not checkpoint goals. |

`memory` is the shared tool; `remember` is its save operation and an optional
skill. One memory covers files, chats and custom content. `remember` with a
returned `sourceRefJson` saves a base capture without a title or summary; the UI
uses that same operation. Custom saves take a title with optional text or an
arbitrary `dataJson` object. Later edits or model summaries enrich the same memory;
source capture stays separate. Evidence, provenance,
origin, status, dates and relationships are optional recorded information.
`revise` keeps the same memory ID and creates another revision. Omitted content,
data and evidence preserve their prior values. Pinning and archiving organize
the same record without replacing its retained content.

Every call supplies an explicit `operation`; `query` also supplies its domain.
Correct a missing argument in the intended call. Retention neither verifies
source content nor grants permission. See the
[operation reference](../backend/skills/remember/references/operations.md).

Source registrations:

- [Content index](../backend/opencode/tools/content_index.ts)
- [Memory](../backend/opencode/plugins/knowledge.ts)
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
| Source-bearing local judgments | `evidence_evaluation`; `memory` retains intentionally reusable definitions |
| User decisions and ordinary progress | Native question and todowrite; neither grants tool permission or proves task success |
| Guidance | Native skill discovery; source instructions remain guidance |

Native task is retained as an observed native surface, while Freelancer dispatches
workers through `delegate`. Vendor implementations/descriptions and MCP services
are not replaced by another engine or client. Overlap in retrieval or judgment
routes is useful when their inputs and results differ; it does not justify
disabling a service.

## Technical compatibility

The internal plugin file and selected warehouse views retain older names.
Legacy `knowledge` API routes and `facts` selectors adapt to the canonical
memory records; they are compatibility entry points, not separate task choices.
Schema 24 migrates prior assertions with their IDs and history intact. The old
`claims` and `claim_evidence` names are read-only compatibility views over
memories. Use `memory` and the three current domains in new calls.

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
