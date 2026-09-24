# Freelancer repository guide

Freelancer is a Windows-oriented, source-run web application: React in a
browser or Chrome app window, a loopback Node server, and the local
`backend/` runtime. OpenCode is the execution engine. There is no Tauri shell,
separate terminal product, hosted Freelancer service, or installer.

## Product boundaries

- OpenCode owns conversations, model inventory and authentication, tools,
  permissions, native todos, and execution. Extend its integration; do not build
  a competing engine or copy credentials.
- `domain/workspace.mjs` and saved settings are the sole authored agent and
  workflow catalog. Every main and delegated assignment uses a named agent.
  A worker is a running assignment, not an agent definition. Do not restore
  retired role prompts or generated native profiles as a second prompt store.
- Compose captured agent and workflow instructions through
  `server/execution.mjs`. Edits affect future root requests; running requests
  retain their captured definitions.
- Treat persona, workflow, skills, and model arguments as guidance or input,
  never as authority. Resolve permissions from native identity and durable
  records. Preserve native permissions, paid-model consent, saved GitHub
  agreements, subagent depth/concurrency limits, and uncertain-delivery
  safeguards. Distinguish execution completion from verified task success.
- Route Git and GitHub history actions through the managed `git_project` tool
  and the saved project agreement. Do not publish through shell, stage unrelated
  work, or claim that a local checkpoint was uploaded.

## Data and implementation

- Keep private JSON in ignored `backend/.state/`; organization and drafts belong
  in the resolved per-user data folder. Never commit credentials, native
  databases, provider state, `node_modules`, builds, or caches.
- Preserve existing project data and unrelated working-tree changes. Inspect
  repository instructions and current state before editing; follow established
  boundaries across the browser UI, server, domain, and runtime.
- Use the browser/Chrome entry point for product behavior. Closing the browser
  does not stop the independent server or cancel its jobs.
- Keep PowerShell scripts compatible with Windows PowerShell 5.1. Work from
  this repository's runtime sources, not retired global toolkit deployments.

## Validation

- `npm run test:fast` covers application and backend contracts without real-Git
  fixtures; `npm run test:git` runs those. `npm test` and `npm run build`
  validate the complete contracts and web build. Real-Git fixtures run
  concurrently in isolated repositories.
  `node scripts/palette-css.mjs --check` validates generated palette CSS.
- After building, `npm run test:browser` runs the production browser journeys.
  `npm run smoke:runtime` is a separate native startup check.
  Fixture success does not prove real provider authentication or a visible
  Windows launch; runtime smoke does not prove model inference. Report only the
  checks actually performed and their limits.
- Read `docs/named-agents.md` for catalog, delegation, and agent lifecycle
  details. Read the relevant feature guide before changing a product flow.
