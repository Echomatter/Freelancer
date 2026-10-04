# Freelancer handbook

Freelancer for OpenCode 1.0 is an AI coding harness for OpenCode. The application
keeps agents and skills composable and permissive while native
permissions, paid consent, delegation ceilings, and the saved GitHub agreement
remain the hard authority boundaries.

[Project overview](../README.md) · [Setup](getting-started.md) · [Architecture](ARCHITECTURE.md)

Start with what you are trying to do. These guides describe the **single browser/Chrome application**.

## Start here

| Your question | Read |
| --- | --- |
| What is Freelancer, and what can I use today? | [Project overview](../README.md) |
| Where does the question-mark help in the application come from? | [Interface help in the README](../README.md#interface-help) |
| How do I install dependencies, start it, and open my first project? | [Getting started](getting-started.md) |
| What are the server, React UI, OpenCode engine, database, agents, and tools? | [Architecture and component catalog](ARCHITECTURE.md) |
| How should an agent work on this repository? | [Repository instructions](../AGENTS.md) |

## Everyday use

| Feature | Guide |
| --- | --- |
| Combined usage meter, provider availability, unknown data, and reset timing | [Available Usage](available-usage.md) |
| Native model inventory, published source facts, source keys, and explicit data updates | [Published model data and legacy estimates](model-ratings.md) |
| Shared progress bars, index/SQLite jobs and first-open preparation | [Background progress](progress-jobs.md) |
| Shared popups, subagent priority, confirmations and build enforcement | [Echoflex dialogs](echoflex-dialogs.md) |
| Add a message while work runs; Queue, Delegate and Steer | [State-aware sender](state-aware-sender.md) |
| Save project goals, follow their linked chats, Resume and Stop | [Project goals](goals.md) |
| Message options, collapsible context cards, and current-turn tool dock | [Composer and tools](composer-design.md) |
| Turn navigation, scrolling, Details divider and native automatic compaction | [Conversation rail](conversation-rail.md) |
| One-time and recurring local prompts with project, agent and model choices | [Scheduled prompts](scheduled-prompts.md) |
| Share of work and native todo placement | [Contributions and todos](contributions-and-todos.md) |
| Agent-directed teams, project/chat budgets, subscription choices and preserved guards | [Delegation budget](delegation-budget.md) |
| Shared main/delegated agents, custom definitions and captured prompts | [Named agents](named-agents.md) |
| Read-only capabilities and effective instruction/tool inspection | [Capabilities](capabilities.md) · [Instruction sources](instruction-sources.md) |
| Prepare generic evidence, optional TypeSafe judgments and weighted scenarios | [Evidence evaluation](evidence-evaluation.md) |
| Shared file-target scope and native permission boundaries | [File access scope](file-access.md) |
| Local checkpoints, GitHub setup, working agreements, and managed Sync | [Project history & GitHub](github-projects.md) |
| Search indexed files across registered projects; inspect local data and history | [Local data and history](local-data.md) |
| Navigation/Details resizing and saved appearance at startup | [Panels and theme](panels-and-theme.md) |
| Fixed-port private-network access, QR pairing, and remembered devices | [Remote access](network-access.md) |
| Palettes, provider identities, semantic colors, and extension points | [Color system](color-system.md) |

For named agents and delegated assignments, start with the [component glossary](ARCHITECTURE.md#ownership). For first-chat model selection and project defaults, see [first use](getting-started.md#first-use).

## Development and verification

[Shared tool contracts](tools-library.md) maps native, Freelancer and MCP tool
purposes, operation boundaries and inventory coverage. [Shared skills](skills-library.md)
provides the canonical task map and instruction ownership.

Use [testing](testing.md) for interactive journeys, focused runs and coverage boundaries, [development and checks](getting-started.md#development-and-checks) for setup, and [the source map](ARCHITECTURE.md#code-map-and-validation) to find the owning module before editing.

[Local chat performance](local-performance.md) describes caching, scoped reads, and measurement limits.

[Model data sources](model-data-sources.md) documents the verified free API
contracts, field mapping, provenance and TypeSafe contract boundaries.
[Model catalog verification](model-data-verification.md) records the observed
checks and unverified live access.

[Goal execution](goals-execution.md) covers durable delivery, checkpoints, recovery
and the installed-native compatibility probe.

[Local-data smoke checks](local-data-smoke.md) cover installed-runtime observations. The feature guides above include their focused checks. The [unified verification workflow](../.github/workflows/verify.yml) runs contracts and browser journeys on Windows and Ubuntu.

A green fixture test, named-profile startup smoke, installed-runtime smoke check, and visible Windows window test are different evidence. Do not replace one with another, or turn a historical test count into a current release badge.
