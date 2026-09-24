# Consolidation verification

Verified on Windows, 23 September 2026, from the fresh Freelancer source tree.

## Product changes

- Universal Freelancer identity, source-relative startup and fresh application data naming. The source includes the existing concurrent UI, history and model-rating improvements.
- One-call eligible free delegation; a small public schema and optional catalog discovery. Subscription workers retain native consent, resource ceilings and the managed Git agreement.
- Continuing workers retain agent/model affinity and native context. Structured, fallback and partial results are labeled. Liveness distinguishes input waits; repeated equivalent failures require diagnosis.
- Shared dismissible Tasks and Queue/Delegate cards. Dismissal does not cancel work or mutate native todos; changed state reappears. Cancellation stays explicit.
- Full-height chat scrolling beside the bottom-aligned composer; content-sized, right-aligned user messages. Chat position survives page navigation. Secondary pages load on demand, and transitions honor reduced motion.
- Shared provider tokens cover the main model selector and other model/provider controls. Workflow settings describe approach; worker settings describe resource limits and native consent.
- Shorter runtime instructions and current architecture, setup and feature guides.

## Executed checks

| Check | Result and scope |
| --- | --- |
| `npm ci` | Clean dependency installation succeeded. No dependency or build directory was copied from the old checkout. |
| `npm test` | 439 tests passed, including real Git fixtures in isolated repositories. |
| Final runtime prompt/worker checks | 60 focused application, todo, delegation and worker tests passed after instruction simplification. |
| `npm run build` | TypeScript and production Vite build passed; main JS bundle approximately 447 kB with separate secondary-page chunks. This is bundle evidence, not a measured latency guarantee. |
| Palette CSS | Generated CSS check passed. |
| Production browser journeys | All 11 journeys passed: colors, git-project, local-data, named-agents, panels-theme, usage, usage-meter, polish, chat-tweaks, history-search and model-ratings. Runs used normal loopback navigation and simulated native model transport. |
| Final layout check | Rebuilt and reran polish after the user-bubble change; desktop and narrow widths, right alignment, compact short bubbles, long-message width, bottom alignment, navigation position and dismissal/cancellation passed. Screenshots were visually inspected. |
| Native startup smoke | Installed OpenCode loaded the app-local named agents, five skills, tools, built assets and bootstrap successfully. No model inference requested. |
| Windows launcher | Windows PowerShell launched the independent server from this source folder. A browser checked HTTP 200, Freelancer title, project composer and Agents navigation against that real native runtime. |
| Desktop links | Created Freelancer and Freelancer Restart shortcuts targeting this checkout. Native visible Chrome-window interaction was not part of the automated check. |

## Handoff and evidence limits

The new local repository uses branch `main` and project-local identity Echomatter,
retaining the source repository's configured email. Intended source is staged
through the managed Git service's exact preview and credential/private-file checks.
There is no commit history, remote or upload. Runtime state, native configuration
markers, dependencies, builds and new verification artifacts are ignored.

The original checkout, its working changes and running work were preserved. No old
application registrations, drafts, conversations, receipts or databases were
imported. Existing OpenCode authentication remains native and was not copied.

Fixtures do not prove real provider inference, paid dispatch, account authentication
or GitHub publication. No such actions were exercised. Source instruction tests
verify contracts, not how every model will follow them. Native worker questions
remain answerable in their child session; no duplicate question-relay service was
introduced. Application permissions are not an operating-system filesystem sandbox.

Local run logs and screenshots are under ignored `artifacts/`; rerun the commands
above for evidence on later source changes.
