# Freelancer for OpenCode

Freelancer is a relaxed, user-directed multi-model coding harness. Work with one primary coding model and bring in independent specialists when useful, while keeping projects, workers, model availability, permissions and Git history under your control.

![Freelancer](assets/freelancer-banner.svg)

Choose a project → choose a model if desired → ask for work → watch it happen.

## Run on Windows

Install Node.js 22.13 or newer, the native OpenCode executable, and Git. Then, in this source folder:

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd start
```

Open the loopback URL printed by the server. For a Chrome app window:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/launch-web.ps1 -ChromeApp
```

Optional desktop links are created by `scripts/create-desktop-shortcut.ps1` and `scripts/create-restart-shortcut.ps1`. Closing the browser does not stop the independent server or cancel work. After source updates, rebuild and restart that checkout's server.

[Setup and troubleshooting](docs/getting-started.md) · [Architecture](docs/ARCHITECTURE.md) · [Handbook](docs/README.md)

## Work naturally

- **Chat:** project conversations, recoverable drafts, attachments, native questions and permissions. The selected parent model stays yours.
- **Workers:** one-call eligible free delegation, optional nested specialists, same-worker follow-up, visible progress and compact results. Simple work stays with the parent.
- **Queue / Delegate:** schedule another parent request or hand it a bounded concern while work continues. Dismissing a card hides it; canceling a queued message is a separate action.
- **Managed Git:** save locally, synchronize or put changes up for review through the saved project agreement. A local checkpoint is not an upload. GitHub is optional.
- **Models and Available Usage:** browse connected models and estimated capacity. Share of Work measures participation, not correctness or quality.
- **Appearance:** consistent provider colors, four palettes, resizable panels, compact dismissible task cards and reduced-motion support.

| Term | Meaning |
| --- | --- |
| Agent | Reusable expertise or working style; Engineer, Researcher, Designer, Git or your own. |
| Workflow | Conversational guidance: Build, Plan, Explore, Review or Sync. |
| Worker | A running assignment using an agent and model. |
| Model | The provider-qualified inference route. |
| Skill | Reusable operating knowledge. |

Agents, workflows and skills guide work; they do not grant tool authority. The normal worker call is `delegate({agent, task, workflow?, model?})`. Catalog discovery is optional. Omit the model for runtime routing or name an exact route. Eligible free work starts without a second model-selection call. Subscription work goes through native paid-delegation consent without a duplicate model-choice menu. Separately metered worker capacity is unavailable.

Project/chat worker settings control automatic workers, free preference, paid capacity, simultaneous workers and depth. Native permissions, explicit user constraints and the project agreement remain authoritative. Worker results label structured completion, fallback or partial output; execution completion never proves task correctness. Follow up with `delegate({worker, task})` to keep the same specialist and context.

## OpenCode relationship and data

Freelancer is a React browser interface and local Node server around native OpenCode. OpenCode owns conversations, inference, provider authentication, tools, permissions, todos and child sessions. Freelancer owns organization, drafts, search, worker coordination, usage presentation and managed Git. It never edits OpenCode's database or copies credentials.

Private JSON lives under ignored `backend/.state/`. Organization, drafts and retrieval data use `%LOCALAPPDATA%\Freelancer\freelancer.sqlite`; an absolute `FREELANCER_DATA_HOME` overrides that folder. Native OpenCode data remains in its existing location. This fresh tree imports no old application history, registrations, databases, receipts or caches. [Data ownership](docs/local-data.md)

This is a Windows-oriented source-run application, with no hosted service or installer. Provider observations can be missing or stale. Native permissions are not a filesystem sandbox, and independent writers must use disjoint scope. Native questions are answered in their worker's own session. No real provider inference or authentication is implied by fixture tests.

## Development

```powershell
npm.cmd run test:fast
npm.cmd run test:git
npm.cmd test
npm.cmd run build
node scripts/palette-css.mjs --check
npm.cmd run test:browser
npm.cmd run smoke:runtime
```

Browser journeys run against production assets and simulated native services. Runtime smoke separately starts installed OpenCode without inference. See [the architecture](docs/ARCHITECTURE.md) for ownership, safeguards and code entry points. This local source repository has no configured publication destination.

[Consolidation verification](docs/consolidation-verification.md) records the exercised checks and their limits.
