# Instruction sources

[Overview](../README.md) · [Architecture](ARCHITECTURE.md) · [Named agents](named-agents.md) · [Capabilities](capabilities.md)

An agent's behavior is shaped by native and application-authored instruction sources. This page identifies the sources and their ownership so a directive can be traced back to its origin. Native discovery can also load user-authored global/project instructions, skills, plugins and MCP instructions. The diagnostic does not reconstruct a hidden provider prompt or create another editable master prompt.

## Composition sources

Sources are composed at different points in native execution. The table is an inventory, not a new priority order. Personas, skills and routing preferences provide guidance; authority comes from native permissions and durable user/application records.

| # | Source | Exact location | Origin |
| --- | --- | --- | --- |
| 1 | Native configuration and Freelancer launch overlay | `server/runtime-config.mjs`, `server/host.mjs`; OpenCode's own global/project configuration | OpenCode resolves user configuration, models, providers/auth, MCP and compaction. The host preserves it and appends Freelancer plugin URLs and instruction files through `OPENCODE_CONFIG_CONTENT`. There is no `backend/opencode/opencode.jsonc` source file. |
| 2 | Shared instruction files | `backend/global/WORKSTYLE.md`, `backend/opencode/global-instructions.md` | WORKSTYLE supplies the common approach; global-instructions maps tasks to useful skills and explains tool evidence. `server/host.mjs` appends their absolute paths to native `instructions`; no second global config or provider prompt is written. |
| 3 | Repository instructions | The working project's native-discovered `AGENTS.md`; Freelancer's repository root has its own guide | Project-authored rules. Freelancer's root guide governs work in this repository; it is not copied into every registered project. |
| 4 | Agent catalog | `domain/workspace.mjs` | Sole authored agent catalog (engineer, researcher, designer) merged with private settings overrides. Role prompts supply expertise, consequential decision criteria and expected output; they grant no authority. |
| 5 | Captured execution prompt | `server/execution.mjs` | Composes the role prompt with request context and the unique application contract for captured identity/constraints, questions, consent, Git, Goals and worker delivery. Captured at the root request; later edits affect future roots, not running workers. |
| 6 | Shared skills | `backend/skills/*/SKILL.md`, manifest `backend/opencode/catalog.json`, registration in `backend/opencode/plugins/delegation.ts` | The plugin adds the shared root to native `skills.paths`, preserving user paths. OpenCode discovers and loads skill content on demand through `skill`; the manifest describes expected resources and is not an access gate. |
| 7 | Named native profile adapter | `backend/tools/runtime/agent-catalog.mjs`, native OpenCode identity/permission records | Application transport profiles use named catalog IDs and preserve authored native permissions. Empty profile prompts retain native provider defaults; the persona is supplied per request, not copied into profiles. |
| 8 | Provider prompt and lifecycle prompts | OpenCode runtime/provider implementation (installed native version) | Native-owned. Provider, compaction, title and summary prompts are internal; Freelancer does not copy them into personas. Full content is unavailable through the inventory API. |
| 9 | User global/project instructions | Native OpenCode configuration `instructions` and native `AGENTS.md` discovery | Native-owned discovery, user/project authored content. The repository guide above is one source, not the complete global discovery set. |
| 10 | Strategy and delegation guidance | `domain/delegation-policy.mjs`, `shared/strategy.mjs`, `server/application.mjs`, `backend/opencode/plugins/delegation.ts` | Root requests capture delegation guidance; the plugin adds shared strategy guidance. Model preferences do not grant paid use or remove tools. |
| 11 | Git/GitHub agreement | `domain/git-project.mjs`, `server/git-project.mjs`, saved per-project agreement | Authored user agreement, enforced through managed Git and native approval paths. Root prompt guidance is not itself authorization. |
| 12 | Worker assignment/result contract | `backend/tools/runtime/delegation.mjs`, `backend/tools/runtime/worker-result.mjs` | Supplies the dynamic task, working directory and assignment restrictions, plus compact reporting fields and evidence limits. Continuation retains identity and constraints; shared toolkit guidance is not another worker persona. |
| 13 | Sender handoff | `domain/sender.mjs`, `server/sender.mjs` | Explicit queued, delegated-concern and steering text is delivered to the native conversation. Durable transport state distinguishes accepted input from consumed input. |
| 14 | Retained legacy model-research requests | `domain/model-ratings.mjs`, `server/model-ratings.mjs`; source catalog in `server/model-data.mjs` | Historical prompts/receipts remain inspectable while legacy research is retired; new rating inference is not started. Published model-data updates download explicitly selected sources without composing a researcher prompt. |
| 15 | Goal contract and recovery | `domain/goals.mjs`, `server/goals.mjs`, `backend/skills/pursue-goal/SKILL.md` | Application-owned objective revision, checkpoint, run identity and recovery guidance composed into the existing native request. |
| 16 | MCP instructions and custom plugin/tool descriptions | Native MCP connections and OpenCode plugin/tool registration | Native-managed integration sources. Connection status and discovered tools can be inspected; instruction bodies and sensitive configuration are not copied into a second store. |
| 17 | User/native skills and optional commands | Native OpenCode skill/command discovery, including project/global paths | Native loading is the sole skill path. Commands are explicit optional invocation; skill provenance does not grant tool authority. |

## How the layers fit

- **Native config (1)** remains authoritative for native settings and discovery. The launch overlay adds shared resources; the profile adapter supplies Freelancer named identities, while application policy separately bounds delegation.
- **Shared instructions (2)** divide common working approach from the skill/task map and tool evidence semantics. **Project rules (3)** come from the actual working project through native discovery.
- **Agent catalog (4)** supplies role-specific expertise and working preferences. The catalog is the only authored agent source; custom agents are settings overrides here, not a separate prompt store.
- **Execution prompt (5)** captures request identity, constraints and runtime procedures together with the role prompt and context. Running workers retain their captured definition; assignment/result guidance (12) adds their dynamic task constraints and reporting contract.
- **Skills (6)** are task-specific guidance loaded through the native `skill` tool. They teach procedure and fallbacks and disclaim authority.
- **Native profiles (7)** carry identity and permission integration. Native permission decisions remain authoritative; profiles do not contain another authored persona.

## Native baseline and project rules

Freelancer extends OpenCode's normal development-agent behavior with its named
catalog, managed delegation/Git, goals and retained memories. It keeps the native
provider prompt and lifecycle prompts rather than duplicating them as defaults.
The provider composition described here was audited against OpenCode **1.18.31**. Its
[request composition](https://github.com/anomalyco/opencode/blob/v1.18.31/packages/opencode/src/session/llm/request.ts#L50)
uses the provider prompt when `agent.prompt` is empty, then combines native system
content and the request's `system` text. Freelancer's profile adapter leaves the
prompt empty; root and worker requests supply the captured application contract.
Default Engineer, Researcher and Designer text provides role-specific working
guidance. Saved catalog overrides still take precedence over those defaults.

[OpenCode rules](https://opencode.ai/docs/rules/) are discovered natively from
the working directory and global configuration. `AGENTS.md` takes precedence
over compatible alternatives within each discovery category; configured
`instructions` files are combined with discovered rules. Follow the native
version's actual behavior rather than introducing a Freelancer precedence list.
An `@file` mention in prose is not an automatic include; read a referenced guide
when the task needs it, or configure its inclusion through native `instructions`.

[Native skills](https://opencode.ai/docs/skills/) use a `SKILL.md` file with
`name` and `description` frontmatter. The name matches its folder and is a
lowercase hyphen-separated identifier. Project/global discovery and configured
skill roots remain native. Load useful guidance through `skill({name: ...})`;
no external capability requires a Freelancer skill as an access prerequisite.

## Boundaries

- There is **no second editable prompt**. The agent catalog (`domain/workspace.mjs`) plus private settings overrides are the sole authored agent definitions; native profiles are not a parallel persona store.
- There is **no integration gateway** in the instruction path. Sources are files and native records composed by `server/execution.mjs`; they do not call external services to build prompts.
- Edits to the catalog or execution prompt affect future root requests. Running workers keep their captured instructions until they finish.
- Native permissions, paid-model consent, delegation ceilings, and the saved GitHub agreement remain the hard authority boundaries across every layer.

## Toolkit guidance and evidence

`backend/global/WORKSTYLE.md` defines the common working approach.
`backend/opencode/global-instructions.md` maps tasks to useful skills and explains
how to interpret shared tool evidence. The captured contract in
`server/execution.mjs` owns the request-specific runtime procedures and constraints;
role prompts supply expertise rather than another copy of those instructions.
The [Skills library](skills-library.md) is the canonical task map, including
upstream provenance and local adaptations. Read detailed skill references only
when their operation is relevant.

Guidance does not add a required workflow, call external services during composition,
change routing, store memory automatically or grant tool access. Native discovery,
schemas and permissions govern actual exposure. Unavailable auxiliary services
leave ordinary reasoning and other permitted methods available.

The shared `memory` tool retrieves and intentionally retains memories in the
per-user warehouse; the optional `remember` skill guides its use. One memory
holds text, optional structured data, evidence, provenance and relationships.
Pinning and archiving organize the same record, and edits preserve revisions.
File and chat sources save through `sourceRefJson`, using the same base capture
as the UI's one-click Remember action. Summaries and further details are optional;
custom memories use a title and optional text. Captured source and edited narrative
remain distinct on the same record.
No external Memory MCP is required.
Read exact retained revisions, capture boundaries and source evidence. Retention
is not proof of current source state, and refresh requires explicit intent.
`model_catalog` supplies stored published observations; its identities, dates,
tested configurations and missing values remain part of the evidence.

`evidence_evaluation` applies optional typed judgments to bounded stored or
supplied evidence. The internal TypeSafe SDK bridge and a connected Jev MCP have
distinct contracts; neither refreshes sources or authorizes consequences.
See [Evidence evaluation](evidence-evaluation.md) for the local schema and limits.
Connection health, typed answers and confidence remain distinct from verified
task success. Native approval and user cost/disclosure constraints apply.

## Effective instruction diagnostics

Native automatic compaction followups inherit the original captured request only
when OpenCode's `compaction_continue` marker follows a completed native compaction
in the same conversation and agent. The runtime traces that native lineage to
the durable root request or worker receipt; it retains inspection, goal and
delegation constraints. Recap text cannot authorize work. Unmarked followups,
failed compactions and unknown native continuation formats fail closed.

Application settings → **Capabilities** provides a simple read-only list of tools,
skills and MCP status; it is not a complete effective-instruction diagnostic. The
captured persona/execution contract is composed by `server/execution.mjs`. Native-internal,
on-demand, not-observed and unverified states are meaningful limits, not proof that a
source was applied. The view does not expose private provider prompts, credentials or
a second editable composition.
