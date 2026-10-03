# Instruction sources

[Overview](../README.md) · [Architecture](ARCHITECTURE.md) · [Named agents](named-agents.md) · [Capabilities](capabilities.md)

An agent's behavior is shaped by native and application-authored instruction sources. This page identifies the sources and their ownership so a directive can be traced back to its origin. Native discovery can also load user-authored global/project instructions, skills, plugins and MCP instructions. The diagnostic does not reconstruct a hidden provider prompt or create another editable master prompt.

## Composition sources

Sources are composed at different points in native execution. The table is an inventory, not a new priority order. Personas, skills and routing preferences provide guidance; authority comes from native permissions and durable user/application records.

| # | Source | Exact location | Origin |
| --- | --- | --- | --- |
| 1 | Native configuration and Freelancer launch overlay | `server/runtime-config.mjs`, `server/host.mjs`; OpenCode's own global/project configuration | OpenCode resolves user configuration, models, providers/auth, MCP and compaction. The host preserves it and appends Freelancer plugin URLs and instruction files through `OPENCODE_CONFIG_CONTENT`. There is no `backend/opencode/opencode.jsonc` source file. |
| 2 | Shared instruction files | `backend/global/WORKSTYLE.md`, `backend/opencode/global-instructions.md` | Application-authored guidance. `server/host.mjs` appends their absolute paths to native `instructions`; no second global config or provider prompt is written. |
| 3 | Repository instructions | The working project's native-discovered `AGENTS.md`; Freelancer's repository root has its own guide | Project-authored rules. Freelancer's root guide governs work in this repository; it is not copied into every registered project. |
| 4 | Agent catalog | `domain/workspace.mjs` | Sole authored agent catalog (engineer, researcher, designer) merged with private settings overrides. Names and expertise guide approach; they grant no authority. |
| 5 | Captured execution prompt | `server/execution.mjs` | Application-owned composition: agent prompt + Freelancer execution contract + request context. Captured at the root request; later edits affect future roots, not running workers. |
| 6 | Shared skills | `backend/skills/*/SKILL.md`, manifest `backend/opencode/catalog.json`, registration in `backend/opencode/plugins/delegation.ts` | The plugin adds the shared root to native `skills.paths`, preserving user paths. OpenCode discovers and loads skill content on demand through `skill`; the manifest describes expected resources and is not an access gate. |
| 7 | Named native profile adapter | `backend/tools/runtime/agent-catalog.mjs`, native OpenCode identity/permission records | Application transport profiles use named catalog IDs and preserve authored native permissions. Empty profile prompts retain native provider defaults; the persona is supplied per request, not copied into profiles. |
| 8 | Provider prompt and lifecycle prompts | OpenCode runtime/provider implementation (installed native version) | Native-owned. Provider, compaction, title and summary prompts are internal; Freelancer does not copy them into personas. Full content is unavailable through the inventory API. |
| 9 | User global/project instructions | Native OpenCode configuration `instructions` and native `AGENTS.md` discovery | Native-owned discovery, user/project authored content. The repository guide above is one source, not the complete global discovery set. |
| 10 | Strategy and delegation guidance | `domain/delegation-policy.mjs`, `shared/strategy.mjs`, `server/application.mjs`, `backend/opencode/plugins/delegation.ts` | Root requests capture delegation guidance; the plugin adds shared strategy guidance. Model preferences do not grant paid use or remove tools. |
| 11 | Git/GitHub agreement | `domain/git-project.mjs`, `server/git-project.mjs`, saved per-project agreement | Authored user agreement, enforced through managed Git and native approval paths. Root prompt guidance is not itself authorization. |
| 12 | Worker assignment/result contract | `backend/tools/runtime/delegation.mjs`, `backend/tools/runtime/worker-result.mjs` | Application-owned captured assignment and result-reporting guidance, attached to native child requests. Continuation retains identity and constraints. |
| 13 | Sender handoff | `domain/sender.mjs`, `server/sender.mjs` | Explicit queued, delegated-concern and steering text is delivered to the native conversation. Durable transport state distinguishes accepted input from consumed input. |
| 14 | Imported-history orientation | `server/chatgpt-import.mjs`, `server/application.mjs` | Application-owned orientation supplied as a message part when imported history needs explanation; imported text remains historical context, not native execution evidence. |
| 15 | Configuration/model-research prompts | `domain/model-ratings.mjs`, `server/model-ratings.mjs` | Task-specific background research prompts. Inspection state must be captured authoritatively, not inferred from prose. |
| 16 | Goal contract and recovery | `domain/goals.mjs`, `server/goals.mjs`, `backend/skills/pursue-goal/SKILL.md` | Application-owned objective revision, checkpoint, run identity and recovery guidance composed into the existing native request. |
| 17 | MCP instructions and custom plugin/tool descriptions | Native MCP connections and OpenCode plugin/tool registration | Native-managed integration sources. Connection status and discovered tools can be inspected; instruction bodies and sensitive configuration are not copied into a second store. |
| 18 | User/native skills and optional commands | Native OpenCode skill/command discovery, including project/global paths | Native loading is the sole skill path. Commands are explicit optional invocation; skill provenance does not grant tool authority. |

## How the layers fit

- **Native config (1)** remains authoritative for native settings and discovery. The launch overlay adds shared resources; the profile adapter supplies Freelancer named identities, while application policy separately bounds delegation.
- **Shared instructions (2)** provide common Freelancer guidance. **Project rules (3)** come from the actual working project through native discovery.
- **Agent catalog (4)** supplies the per-agent prompt and working preferences. The catalog is the only authored agent source; custom agents are settings overrides here, not a separate prompt store.
- **Execution prompt (5)** is composed at the root request and captured. It carries the agent prompt, the application-owned execution contract, and the request context. Running workers retain their captured definition.
- **Skills (6)** are task-specific guidance loaded through the native `skill` tool. They teach procedure and fallbacks and disclaim authority.
- **Native profiles (7)** carry identity and permission integration. Native permission decisions remain authoritative; profiles do not contain another authored persona.

## Native baseline and project rules

Freelancer extends OpenCode's normal development-agent behavior with its named
catalog, managed delegation/Git, goals and retained knowledge. It keeps the native
provider prompt and lifecycle prompts rather than duplicating them as defaults.
The installed native package audited here is OpenCode **1.18.31**. Its
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

## Capability-use hints

The existing captured contract in `server/execution.mjs` carries the general
meaning and limitations of shared tools, internal knowledge and MCP services for every main and
delegated named-agent request. Existing skills add concise contextual hints for
routing/delegation, debugging, verification, browser investigation, research,
orientation, handoffs, model outcomes, reviews and Goals. Skills load only when
useful; direct native MCP use never requires one.

Hints advise suitable methods and evidence. They do not call services while
composing prompts, add a workflow/permission stage, change deterministic routing
or delegation contracts, or store Memory automatically. Native discovery and
permissions remain the source of actual tool exposure; an unavailable auxiliary
capability leaves ordinary reasoning and other valid methods available.

Internal memory, canonical conversation pins and the graph use `knowledge` in the
same per-user warehouse. Common `query` domains are `files`, `conversations`,
`memories` and `facts`; results include bounded coverage and continuation metadata.
Queries are global unless scoped. Read exact revisions and retained evidence
before relying on consequential findings. Conversation pins preserve snapshots, unpin retains
memory, archive/restore is reversible, and forget removes retained content.
Refresh creates a new retained revision only on explicit request; a newer
retained source indicator does not say all live content was inspected. External
Memory MCP configuration is independent and is not required for these features.

Context7 (`context7-mcp`) supplies provider documentation guidance; `docs-research`
adds source selection and verification methods. `playwright` and `browser-verify`
support rendered checks; `fetch` and `web-research` cover primary-source retrieval;
`reason-through` guides optional Sequential Thinking. `typesafe-ai` and
`bounded-judgment` guide optional Jev use. Judgments can use exact
internal evidence packets through the TypeSafe SDK bridge without a separate
Jev MCP service. A connected external Jev service remains a native MCP capability.
Neither route is called during prompt composition, and native approvals plus
user cost/disclosure constraints still apply. Health, credentials, typed answers
and confidence are distinct from verified task success.
The `managed-git` skill describes the existing managed agreement/approval path,
never another Git engine or permission source. See
[Skills library](skills-library.md) for upstream provenance and local adaptations.

## Effective instruction diagnostics

Application settings → **Capabilities** provides a simple read-only list of tools,
skills and MCP status; it is not a complete effective-instruction diagnostic. The
captured persona/execution contract is composed by `server/execution.mjs`. Native-internal,
on-demand, not-observed and unverified states are meaningful limits, not proof that a
source was applied. The view does not expose private provider prompts, credentials or
a second editable composition.
