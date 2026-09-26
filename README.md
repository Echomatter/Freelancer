# Freelancer

Freelancer is a local workspace for doing real project work with AI. Open a folder, choose how you want to work, describe the job in chat, and follow the work without losing sight of the files, tools, workers, questions, checks, or decisions behind the answer.

It runs on your Windows computer in a browser or Chrome app window, with [OpenCode](https://opencode.ai/) providing native conversations, models, authentication, tools, permissions, todos, and child sessions. Freelancer adds the workspace around that engine: projects, agents and workflows, specialist workers, local search, history, usage views, appearance controls, managed Git/GitHub, and durable recovery when work is interrupted.

![Freelancer application banner](assets/freelancer-banner.svg)

## Quick start (Windows)

1. Download the source ZIP from [the Freelancer repository](https://github.com/Echomatter/Freelancer) and extract it, or clone `https://github.com/Echomatter/Freelancer.git` with Git. Open **PowerShell** in the resulting folder.
2. Run the setup:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1
   ```

3. When setup finishes, Freelancer opens in a Chrome app window. The installer also creates desktop shortcuts for starting and restarting it.
4. Add a project folder, connect a model provider under **Application settings → Providers**, and start a chat. A useful first request is: “Look through this project and explain how to run it.”

Setup installs or checks Node.js, Git, GitHub CLI and OpenCode, plus Chrome for the desktop shortcuts, then builds and starts the app. You still sign in to model providers through their supported authentication flow. For a browser-only setup without desktop shortcuts, add `-NoShortcuts -NoLaunch` to the setup command. See [Getting started](docs/getting-started.md) for prerequisites, manual installation and troubleshooting.

## What Freelancer actually includes

Freelancer is intentionally more than a chat box. Most of the application is about keeping AI work understandable and controllable while it is happening.

### Project workspace and chat

Each project is a folder you choose. Its chats stay grouped with that project, and Freelancer remembers the working context around them.

- **Persistent project navigation** keeps projects, chats and recent work accessible without turning every task into a new setup flow.
- **Attachments and saved drafts** let you prepare a request before sending it. Draft revisions are saved locally and protected against stale-window overwrites and lost acknowledgements.
- **Immediate send feedback** shows a submitted request while chat creation or native dispatch is still completing, without pretending that transport acceptance means the work has finished.
- **Queued follow-ups** can wait for a safe boundary instead of colliding with active work.
- **Questions and permission requests** remain explicit decisions. They are not hidden inside model prose.
- **Request groups** keep the answer, tool activity, tasks and delegated work associated with the instruction that caused them.
- **Details and Files panels** provide drill-down without forcing all execution noise into the transcript.
- **Task presentation** can be kept in the dock or shown inline, while completion, dismissal and cancellation remain separate actions.
- **Interruption and recovery** distinguish a confirmed failure from an uncertain delivery. Freelancer checks native state rather than blindly replaying work after a lost acknowledgement.

Closing the browser window does not stop the local server or work already running. If you used the desktop shortcut, use the tray icon's **Exit Freelancer** command to stop it. If you started the server with `npm.cmd start`, keep that PowerShell window open and press **Ctrl+C** to stop it.

### Agents, workflows and specialist workers

Agents and workflows are reusable starting points for a request; they are not hidden permission systems.

**Agents** describe the perspective and working style you want. The built-in catalog includes roles such as Engineer, Researcher and Designer, and you can create your own. Agent settings include instructions, approach, response style, preferred model and reasoning variant.

**Workflows** describe how a kind of work should be approached. They can select an agent, mode, eligible model category, model choices, reasoning variant and whether independent work may run in parallel. Built-in workflows can be edited, and custom workflows can be added.

At the start of a chat you can choose an agent, workflow, parent model and supported reasoning variant. Project-level **Session defaults** define the starting choices for new chats without rewriting existing conversations.

A parent model can also hand a bounded assignment to a **worker**:

- ordinary eligible delegation can start in one call;
- each worker gets its own native child conversation;
- workers can research, implement, inspect or review focused concerns;
- a follow-up can continue the same worker with the same agent, model and context;
- worker cards expose progress and let you open the underlying conversation;
- structured results can report findings, evidence, changed files, checks, assumptions, risks, questions and next steps;
- the runtime verifies observed model/agent identity instead of trusting a worker's prose;
- child claims such as “tests passed” remain claims until the parent or runtime evidence validates them.

**Project settings → Delegation** controls project-specific worker behavior and limits. Concurrency and depth ceilings bound orchestration, but they do not create filesystem isolation. Concurrent writers should have disjoint scope; overlapping edits need deliberate sequencing. Freelancer does not silently replace the parent model or escalate to a paid model.

See [Architecture](docs/ARCHITECTURE.md) for the separation between guidance, capability, authority, scheduling and routing.

### Models, providers and available usage

Freelancer exposes the model layer instead of hiding it behind one generic selector.

**Application settings → Models** provides a browsable model catalog with provider, availability and model information. You can search and sort the catalog, filter to free models, inspect models by provider, and use the catalog when configuring agents and workflows. Model-rating jobs can collect dated comparative information without turning those ratings into automatic routing policy.

**Application settings → Providers** currently supports setup for OpenAI, GitHub Copilot, OpenCode Go and OpenCode Free. Depending on the provider, you can:

- connect or reconnect supported authentication;
- describe the plan as a monthly subscription or pay-as-you-go;
- record a subscription price for usage calculations;
- choose the display currency;
- assign a provider color used consistently throughout the interface.

Credentials remain with the native/provider authentication systems; Freelancer does not copy them into its own database.

**Application settings → Available Usage** turns provider/model telemetry into a practical view of remaining availability. It is designed around usable capacity rather than presenting token or dollar estimates as if they were provider billing records. Unknown, estimated and unavailable information stays distinguishable.

The workspace model picker can optionally hide depleted models. That preference lives under **Appearance**.

### Appearance and layout

Appearance is a first-class part of the application rather than a light/dark toggle.

Freelancer currently ships with **120 named palettes: 60 light and 60 dark**. Palettes use shared semantic tokens so the workspace, navigation, panels, controls and text change together instead of accumulating one-off colors. The catalog includes perceptual-separation checks in addition to contrast and CSS contract tests.

Under **Application settings → Appearance** you can:

- browse the light and dark palette collections visually;
- apply a palette to the whole application;
- control whether depleted-usage models remain visible in the workspace picker.

Provider colors are configured separately on **Providers**. They give OpenAI, Copilot, OpenCode Go and OpenCode Free a recognizable visual identity where provider context is useful, while status/error colors keep their semantic meaning.

Workspace layout is also adjustable. Resizable panels, the Details panel, Files panel, sticky composer, task/delivery presentation and reduced-motion behavior are designed to remain usable across different window sizes. Appearance and layout preferences persist locally.

### Files, local search and project knowledge

**Project settings → Files** gives the selected project a file-oriented workspace view.

Freelancer also maintains a local content index so project knowledge can be searched without making the model rediscover every file for every question. The index covers readable source, configuration and document content throughout registered project roots while skipping generated/private areas and unsupported binary formats.

**Application settings → Content index** lets you inspect and maintain that derived data. You can refresh project-file indexes, refresh the searchable conversation index, optimize full-text indexes, run a SQLite quick check, and compact free database pages.

The conversation index covers registered projects and can search titles plus user/assistant text, including archived chats and workers. It does not replace OpenCode as conversation authority and does not copy tool output, reasoning, attachments or drafts into the search index.

### History, imports and local data

**Application settings → History** is a cross-project conversation organizer rather than a simple recent-chat list.

It supports:

- Active, Archived and All views;
- conversation-content search across registered projects;
- pinning;
- multi-selection;
- reversible local hiding/archiving where the native API does not provide a reversible archive contract;
- Undo for supported organization actions;
- progressive loading of larger histories;
- selected-conversation export.

New-project setup can optionally perform a **one-time ChatGPT / Codex import** before indexing. Imported snapshots remain separate from OpenCode's native database, use the shared transcript view, and can orient a new native conversation without modifying the source history.

**Application settings → Data & Storage** shows where Freelancer and OpenCode data live, provides backup guidance, and exposes project organization such as **Put project away** / **Restore project**. Putting a project away hides it from active navigation; it does not delete the folder or rewrite its Git history.

Freelancer's organization/search database is normally stored in `%LOCALAPPDATA%\Freelancer\freelancer.sqlite`. Project files stay in their original folders. OpenCode continues to own its native conversations and provider sign-ins. See [Local data, history and archives](docs/local-data.md) for the exact ownership and backup model.

### Git and GitHub without making Git mandatory

GitHub is optional. A project can use Freelancer without being connected to GitHub, and connecting an account does not automatically upload a project.

**Project settings → GitHub** separates local history from online publication:

1. **Local project history** can initialize or adopt Git, set the checkpoint identity, and create reviewed local checkpoints.
2. **GitHub connection** uses GitHub CLI/browser authentication and keeps credentials in the system credential store.
3. A project can then be linked to an existing or new GitHub repository when you choose.
4. Upload/sync actions use explicit previews and confirmation.

Managed Git operations protect unrelated staged work, reject unsupported/conflicted selections, check common credential/private-file patterns, avoid force push, verify remote state, and record uncertain operations rather than replaying them blindly. Checkpoint means local history; connection means an account/repository relationship; neither means upload.

**Application settings → Git defaults** controls the starting Git agreement for newly configured projects. Each project can still have its own agreement. Inspect-only configurations prevent Freelancer-managed mutations.

See [Git and GitHub projects](docs/github-projects.md) for safeguards and boundaries.

## Settings map

Freelancer deliberately separates project-specific choices from application-wide preferences.

| Area | Setting | What it controls |
| --- | --- | --- |
| **Project** | **Files** | File-oriented view for the selected project |
|  | **Agents** | Built-in/custom working roles, instructions, model and response preferences |
|  | **Workflows** | Reusable execution approaches, agent/model eligibility and parallel-work preference |
|  | **GitHub** | Local Git history, GitHub authentication/linking, checkpoints and reviewed sync |
|  | **Session defaults** | Starting agent, workflow, model and reasoning choices for new chats in this project |
|  | **Delegation** | Project worker/delegation behavior and orchestration limits |
| **Application** | **Models** | Searchable model catalog, provider/model information and rating activity |
|  | **Available Usage** | Remaining provider/model availability and usage observations |
|  | **Providers** | Authentication, plan type, optional subscription cost, currency and provider colors |
|  | **Appearance** | 120 application palettes and depleted-model visibility |
|  | **Data & Storage** | Data locations, backup guidance, project archive/restore and storage information |
|  | **Content index** | File/chat index refresh, integrity/optimization and local search maintenance |
|  | **Git defaults** | Default managed-Git agreement for projects |
|  | **History** | Cross-project conversation search, pins, archive/hide, selection and export |

Settings are intentionally layered: changing an agent definition, workflow, theme or project default affects future behavior or presentation; it does not rewrite historical request receipts or native conversations.

## How the pieces fit together

A normal implementation request can stay simple:

1. Open a project and chat.
2. Choose an agent/workflow/model, or keep the defaults.
3. Ask for the change.
4. The parent model uses native OpenCode tools and permissions.
5. If useful, it delegates a bounded concern to a specialist worker.
6. Follow tasks, tool activity, questions and worker progress in the workspace.
7. Review the result and changed files.
8. Save a local Git checkpoint or sync to GitHub only if you choose.

The machinery is there to make more complicated work inspectable; it is not a ceremony required for every request.

## Local-first boundaries

Freelancer is a local application, but “local” does not mean inference never leaves the computer. Project files and Freelancer's own state stay on the machine unless you explicitly publish files, while prompts and relevant context are sent to the model providers you choose.

A few boundaries are deliberate:

- Freelancer does not copy provider credentials into its database.
- It does not edit OpenCode's native conversation database directly.
- Workers share the selected project folder; there is no automatic worktree or filesystem sandbox.
- Usage figures are observations/estimates, not provider invoices.
- Search indexes are derived local data and can be rebuilt.
- GitHub publication requires explicit setup and reviewed actions.
- Automated fixtures and startup smoke tests do not prove that a user's provider authentication or live inference works.

## Handbook

The README is the product overview. The handbook goes deeper:

- [Getting started](docs/getting-started.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Handbook index](docs/README.md)
- [Local data, history and archives](docs/local-data.md)
- [Git and GitHub projects](docs/github-projects.md)
- [State-aware sender](docs/state-aware-sender.md)
- [Release acceptance](docs/release-acceptance.md)

## For contributors and technical readers

Freelancer is a source-run React interface served by a local Node.js server. Native OpenCode handles conversations, inference, authentication, tools and permissions. Freelancer adds project UI, saved organization, search, worker coordination, usage presentation and managed Git actions. There is no hosted Freelancer service or packaged installer.

To run an already installed checkout manually, use Node.js **22.13 or newer** and the native OpenCode executable (`opencode-ai@1.18.31` is the [documented baseline](docs/getting-started.md#prerequisites)):

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd start
```

Open the local URL printed by the server. For frontend development, see [development setup](docs/getting-started.md#development-and-checks). Useful checks are:

```powershell
npm.cmd run test:fast
npm.cmd run test:git
npm.cmd run build
```

The full suite is `npm.cmd test`; after a build, `npm.cmd run test:browser` exercises browser journeys with simulated services. `npm.cmd run smoke:runtime` checks installed OpenCode startup without making a model request. Tests do not establish that your own provider sign-in or model inference works.

[Repository instructions](AGENTS.md) cover changes to this codebase.
