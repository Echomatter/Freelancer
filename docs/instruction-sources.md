# Instruction sources

[Overview](../README.md) · [Architecture](ARCHITECTURE.md) · [Named agents](named-agents.md) · [Capabilities](capabilities.md)

An agent's behavior is shaped by native and application-authored instruction sources. This page identifies the sources and their ownership so a directive can be traced back to its origin. Native discovery can also load user-authored global/project instructions, skills, plugins and MCP instructions. The diagnostic does not reconstruct a hidden provider prompt or create another editable master prompt.

## Composition sources

Sources are composed at different points in native execution. The table is an inventory, not a new priority order. Personas, skills and routing preferences provide guidance; authority comes from native permissions and durable user/application records.

| # | Source | Exact location | Origin |
| --- | --- | --- | --- |
| 1 | Native engine and app config | `backend/opencode/opencode.jsonc` | Application-owned native config: default agent, subagent depth, instruction files, compaction, watcher. Does not pin a parent model. |
| 2 | Global instruction files | `backend/global/WORKSTYLE.md`, `backend/opencode/global-instructions.md` | Application-authored global instructions, loaded via the `instructions` array in `opencode.jsonc`. |
| 3 | Repository instructions | `AGENTS.md` (repository root) | Repository guide: product boundaries, data rules, validation paths. |
| 4 | Agent catalog | `domain/workspace.mjs` | Sole authored agent catalog (engineer, researcher, designer) merged with private settings overrides. Names and expertise guide approach; they grant no authority. |
| 5 | Captured execution prompt | `server/execution.mjs` | Application-owned composition: agent prompt + Freelancer execution contract + request context. Captured at the root request; later edits affect future roots, not running workers. |
| 6 | Shared skills | `backend/skills/*/SKILL.md` (17 skills) | Application shared skills, listed in `backend/opencode/catalog.json`. Loaded on demand through the native `skill` tool; procedure and fallbacks only, no authority. |
| 7 | Native profiles | OpenCode native identity/permission records | Native-owned. Identity and permissions, never a duplicate persona or prompt store. |
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

- **Native config (1)** sets the runtime shape: which agent is default, how deep delegation may go, and which global instruction files load.
- **Global instructions (2)** and **repository instructions (3)** provide durable guidance that applies across projects.
- **Agent catalog (4)** supplies the per-agent prompt and working preferences. The catalog is the only authored agent source; custom agents are settings overrides here, not a separate prompt store.
- **Execution prompt (5)** is composed at the root request and captured. It carries the agent prompt, the application-owned execution contract, and the request context. Running workers retain their captured definition.
- **Skills (6)** are task-specific guidance loaded through the native `skill` tool. They teach procedure and fallbacks and disclaim authority.
- **Native profiles (7)** supply identity and permissions. They are authoritative and are never mirrored into a second prompt.

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

## Effective instruction diagnostics

Application settings → **Capabilities** provides a simple read-only list of tools,
skills and MCP status; it is not a complete effective-instruction diagnostic. The
captured persona/execution contract is composed by `server/execution.mjs`. Native-internal,
on-demand, not-observed and unverified states are meaningful limits, not proof that a
source was applied. The view does not expose private provider prompts, credentials or
a second editable composition.
