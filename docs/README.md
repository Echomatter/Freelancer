# Freelancer handbook

Freelancer for OpenCode 1.0 is an AI coding harness for OpenCode. The application
keeps agents, skills, and workflows composable and permissive while native
permissions, paid consent, delegation ceilings, and the saved GitHub agreement
remain the hard authority boundaries.

[Project overview](../README.md) · [Setup](getting-started.md) · [Architecture](ARCHITECTURE.md)

Start with what you are trying to do. These guides describe the **single browser/Chrome application**.

## Start here

| Your question | Read |
| --- | --- |
| What is Freelancer, and what can I use today? | [Project overview](../README.md) |
| How do I install dependencies, start it, and open my first project? | [Getting started](getting-started.md) |
| How do I import local ChatGPT / Codex chats when adding a project? | [One-time project import](chatgpt-import.md) |
| What are the server, React UI, OpenCode engine, database, agents, and tools? | [Architecture and component catalog](ARCHITECTURE.md) |
| How should an agent work on this repository? | [Repository instructions](../AGENTS.md) |

## Everyday use

| Feature | Guide |
| --- | --- |
| Combined usage meter, provider availability, unknown data, and reset timing | [Available Usage](available-usage.md) |
| Models-page scores, source guidance, and background rating updates | [Model ratings contract](model-ratings.md) |
| Shared progress bars, index/SQLite jobs and first-open preparation | [Background progress](progress-jobs.md) |
| Shared popups, subagent priority, confirmations and build enforcement | [Echoflex dialogs](echoflex-dialogs.md) |
| Add a message while work runs; Queue versus Delegate | [State-aware sender](state-aware-sender.md) |
| Share of work and native todo placement | [Contributions and todos](contributions-and-todos.md) |
| Agent-directed teams, project/chat budgets, subscription choices and preserved guards | [Delegation budget](delegation-budget.md) |
| Shared main/delegated agents, custom definitions and captured prompts | [Named agents](named-agents.md) |
| Local checkpoints, GitHub setup, working agreements, and managed Sync | [Project history & GitHub](github-projects.md) |
| Pins, archives, recoverable drafts, exports, SQLite, and storage locations | [Local data and history](local-data.md) |
| Navigation/Details resizing and saved appearance at startup | [Panels and theme](panels-and-theme.md) |
| Palettes, provider identities, semantic colors, and extension points | [Color system](color-system.md) |

For agents versus workflows versus delegated assignments, start with the [component glossary](ARCHITECTURE.md#ownership). For first-chat model selection and project defaults, see [first use](getting-started.md#first-use).

## Development and verification

Use [development and checks](getting-started.md#development-and-checks) for the actual commands, and [the source map](ARCHITECTURE.md#code-map-and-validation) to find the owning module before editing.

[Local-data smoke checks](local-data-smoke.md) cover installed-runtime observations. The feature guides above include their focused checks. The [unified verification workflow](../.github/workflows/verify.yml) runs contracts and browser journeys on Windows and Ubuntu.

A green fixture test, named-profile startup smoke, installed-runtime smoke check, and visible Windows window test are different evidence. Do not replace one with another, or turn a historical test count into a current release badge.
