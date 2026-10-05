# Shared skill library and source provenance

Reviewed **2026-10-04**. Skills are discoverable guidance for the shared native
OpenCode toolkit. They do not install services, prove connection health, grant
permissions, restrict access by agent/model/project, or authorize paid use.
Native configuration, current tool schemas, explicit denial, delegation limits,
and saved Git agreements retain their existing authority. See
[Capabilities](capabilities.md) for the connection and inventory UI.

## Choose guidance by the result

Load the smallest useful set through native `skill` discovery. A related skill
is a transition when the task needs its result, not a required sequence. Direct
tool use remains available.

| Task | Canonical skill | Distinct result |
| --- | --- | --- |
| Recover working context | `reorient` | Current objective, instructions, source state and next action |
| Find local files or chats | `search-index` | Bounded indexed hits checked against decisive originals |
| Retain or revise a memory | `remember` | One retained record with text, structured data, evidence, relationships and revision/pin/archive state |
| Investigate external evidence | `web-research` | A sourced answer with version, disagreement and uncertainty |
| Confirm a library/API contract | `context7-mcp` | Version-specific documentation through the native Context7 tools |
| Read a known URL | `fetch` | Retrieved source text with truncation and citation limits |
| Interact with rendered pages | `playwright` | Observed browser state and focused interaction checks |
| Diagnose an observed failure | `debug` | Supported cause and a scoped repair or proposal |
| Work through a decision | `reason-through` | Explicit assumptions, dependencies, alternatives and conclusion |
| Judge bounded evidence | `bounded-judgment` | Advisory typed answers with missingness and uncertainty retained |
| Develop a TypeSafe integration | `typesafe-ai` | Official primitives, SDK/API contracts and integration guidance |
| Build competing approaches | `compare-builds` | Two implementations compared under the same brief and criteria |
| Assign or recover a worker | `delegate-work` | Named-agent dispatch, native receipt inspection and safe continuation |
| Check a concrete claim | `verify` | Actual checks, results and remaining evidence limits |
| Critique a bounded change | `review` | Grounded findings; the parent integrates authorized fixes |
| Leave a durable checkpoint | `handoff` | Objective, state, decisions, checks, risks and next action |
| Continue a saved goal | `pursue-goal` | Same-chat work and reconciled lifecycle checkpoints |
| Record task evidence | `record-outcome` | Outcomes tied to actual task/verification receipts |
| Act under a Git agreement | `managed-git` | Managed preview, approved execution and observed publication state |

For example, a failing SQL aggregate starts with `debug` and the actual schema.
A two-approach implementation starts with `compare-builds`. A consequential
comparison may use `bounded-judgment` after gathering evidence; it does not need
a durable memory definition. A paused or uncertain worker needs native receipt
inspection through `delegate-work` before any new dispatch.

The optional `remember` skill guides the shared `memory` tool. Its `remember`
operation saves a file or chat from `sourceRefJson` without requiring a summary,
or custom content from a title and optional text/data. The UI and model use the
same capture. `revise` updates that record while preserving earlier revisions.
Evidence, provenance, dates, status
and relationships are optional information on the memory, and pin/archive state
organizes it. Query domain `memories` retrieves retained records; `files` and
`conversations` retrieve indexed source content. Correct incomplete arguments
in the intended call; see the
[tool naming and operation contract](tools-library.md#freelancer-tools).

## Instruction ownership and detail

Agent prompts describe expertise, priorities and the expected deliverable.
They do not repeat tool manuals, universal safety rules or fixed multi-step
protocols. The Engineer, Researcher and Designer defaults are deliberately brief;
custom agents retain their authored identity and preferences. Detailed SQL
correctness guidance belongs in the relevant task or reference, while its agent
prompt keeps grain, keys, joins, missing values, lineage, transactions, security
and measured optimization visible.

- `backend/global/WORKSTYLE.md` supplies the common working approach.
- `backend/opencode/global-instructions.md` supplies the task map and meanings
  of shared tool evidence.
- `server/execution.mjs` owns captured request identity, constraints, native
  permission boundaries, worker delivery and saved-goal behavior.
- `backend/tools/runtime/delegation.mjs` adds assignment-specific context and
  restrictions; the result contract describes the actual child report.
- Skill entries explain when to use a procedure and the useful next actions.
  Their references hold detailed operations, schemas or receipts.

Most local entries need only a few hundred words. This is a sizing guide rather
than a hard limit: official vendor bodies remain intact, and operational detail
is loaded when needed. Shared rules have one owner; a skill repeats a boundary
only when it is necessary to use that specific procedure correctly.

| Detailed reference | Read when |
| --- | --- |
| `remember/references/operations.md` | Performing retention, graph or reusable judgment operations |
| `fetch/references/setup.md` | Diagnosing native Fetch setup or Windows encoding |
| `playwright/references/mcp-operations.md` | Choosing browser operations or checking version-specific parameters |
| `reason-through/references/sequential-thinking.md` | Calling optional Sequential Thinking |
| `bounded-judgment/references/contracts.md` | Preparing local evidence contracts, stages, composition or receipt pages |
| `delegate-work/evidence-refresh.md` | Maintaining internal delegation evidence |
| `record-outcome/recording-contract.md` | Writing outcome receipts with the exact script parameters |

`delegate-work` is the renamed `model-routing` skill. `docs-research` was
consolidated into `web-research`; `browser-verify` was consolidated into
`playwright`. `compare-builds` is new. These changes organize guidance around
distinct results without introducing another executor or capability gate.

## Official external sources

| Runtime skill | Source and revision | What was retained or adapted |
| --- | --- | --- |
| `context7-mcp` | Upstash [official OpenCode skill](https://github.com/upstash/context7/blob/bfa02ea67b5707fe0e0a673faa49d0f50b28c80b/packages/opencode/skills/context7-mcp/SKILL.md), commit `bfa02ea67b5707fe0e0a673faa49d0f50b28c80b` (2026-10-02) | Official body retained with a local native-discovery, scope, privacy, version, and fallback note. MIT notice copied to `LICENSE.upstream`. |
| `typesafe-ai` | TypeSafe [official agent skill](https://github.com/typesafe-ai/skills/blob/65a39f393687675ce170e6094757de20370365b9/skills/typesafe-ai/SKILL.md), commit `65a39f393687675ce170e6094757de20370365b9` (2026-09-12) | Official body retained with a local note explaining stored memory judgments, evidence freshness, paid consent, and SDK/MCP credential separation. MIT notice copied to `LICENSE.upstream`. |
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
| TypeSafe | Official Choice, Noul, Score, current SDK/API documentation, uncertainty, batching, and source-grounded design | Everyday `bounded-judgment` uses `evidence_evaluation`; explicitly reusable definitions remain available through `memory`. The tool supplies a generic local evidence-contract workflow; its JSON is Freelancer-owned, not TypeSafe wire format. Configured provider status is not inference proof. A separately configured community Jev MCP exposes its own schema and auth boundary. |
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

The task map above is the canonical organization. Memories and their pin state
use `memory` in the per-user warehouse; no external Memory MCP is needed.
`content_index` complements native source search. `model_catalog` and recorded
outcomes provide evidence, while native eligibility and consent still govern
delegation. The [evidence evaluation guide](evidence-evaluation.md) documents the
local typed-judgment contract and its receipt limits.

Named-agent and worker lifecycle contracts remain in [Named agents](named-agents.md)
and the runtime. Skills describe use of those existing surfaces; they do not
create another prompt store, dispatch engine or managed Git implementation.

## Streamlining review: 2026-10-04

The latest Alpha_Packer conversation exposed caller JSON and packet-size failures
before a successful Jev evaluation. Its five-candidate comparison combined several
dimensions in each score, used leading candidate descriptions, treated a later
Choice confidence as a strong recommendation despite uncertain input scores, and
mistook per-request bounds for a limit on a larger comparison. Those observations
do not establish Jev accuracy on the project's actual coding tasks.

`bounded-judgment` now owns generic everyday judgment guidance. It covers neutral
criteria, exact evidence/configuration identity, small projected state, comparable
batches for larger requested sets, and distinct missingness versus model uncertainty.
Its reference holds a minimal local contract and advanced receipt/composition details.
`typesafe-ai` retains the official body for integration development; durable
definitions remain available through `memory` for reusable questions.

`debug` handles an observed failure; `reason-through` handles decisions and
dependencies. Sequential Thinking records supplied steps/revisions and adds no
independent observations. `playwright` now combines browser mechanics and focused
verification; the redundant `browser-verify` skill was removed. Tools remain shared.

Current TypeSafe primitives/state/confidence were checked through Context7 against
official documentation. Its [coding-agent guide](https://docs.typesafe.ai/introduction/coding-agents)
and [Jev 1.13 limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13)
inform the distinction between typed decisions, explanations and observed results.
Microsoft Playwright MCP and the official Sequential Thinking implementation were
also checked through Context7. This review made no new paid inference calls.

## Native global guidance

The installed native discovery also loads five user-global entrypoints under
`~/.config/opencode/skills`. The older global `model-routing` entry is now
`model-advice`, focused on requested recommendations rather than worker dispatch.
Global `reorient`, `search-index` and `record-outcome` fallbacks now inspect the
active runtime and defer to Freelancer's app-managed guidance here. Global `sync`
explicitly follows the saved Freelancer agreement and managed Git path.

Their original toolkit instructions remain as scoped legacy references, with
actual schema compatibility required before use. They cannot supply retired
role/selectedModel arguments, compulsory handoffs or recorder assumptions to
Freelancer. Native discovery must confirm that the app's matching names resolve
to its installed skill files. These are guidance edits; native configuration,
credentials and service commands are unchanged.

## Discovery and evidence limits

The refresh updates repository-owned guidance and the scoped global fallbacks
above. Provider authentication, native MCP configuration and connection commands
remain unchanged. A source file or catalog entry does not prove runtime discovery:
after the normal application refresh/restart, the native `/skill` observation
and Capabilities inventory must establish which skills loaded. Connection status
and harmless tool-call receipts establish separate service-use evidence. This
upstream-source audit itself did not run paid inference or change native setup.
Build, contract, browser and installed-runtime checks are separate integration
evidence recorded with the installation's deployment receipt.
