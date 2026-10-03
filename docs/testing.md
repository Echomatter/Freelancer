# Testing Freelancer

Start with the browser. `npm run test:ui` builds the application and opens
Playwright's interactive test list. Select a journey, run it, inspect its actions
and DOM snapshots, or watch its test and fixture files. Rebuild after changing
application source; the production journeys deliberately use `dist/`.

| Task | Command |
| --- | --- |
| Build, browser journeys, then all JavaScript contracts and real Git fixtures | `npm test` |
| Interactive browser runner with a fresh build | `npm run test:ui` |
| All browser journeys against the current build | `npm run test:browser` |
| Focus on busy-chat delivery | `npm run test:browser -- action-feedback send-feedback` |
| All chat journeys | `npm run test:browser -- --grep @chat` |
| Watch a visible browser | `npm run test:browser -- dialogs --headed --workers=1` |
| Step through a journey | `npm run test:browser -- chat-dock --debug` |
| List journeys without running them | `npm run test:browser -- --list` |
| Inspect the last HTML report and failure traces | `npm run test:report` |
| Exhaustive 180-palette browser sweep | `npm run test:themes` |
| Contracts without real Git fixtures | `npm run test:fast` |
| Focused storage and HTTP contracts | `npm run test:fast -- store http-body` |
| List selected contracts without running | `npm run test:contracts -- --list store` |
| All JavaScript contracts, including real Git | `npm run test:contracts` |
| Real Git fixtures only | `npm run test:git` |

Install Chromium once with `npx playwright install chromium`. All commands work
in PowerShell; use `npm.cmd`/`npx.cmd` if your execution policy blocks `.ps1` shims.
Playwright accepts filenames and `--grep` filters. A filter matching no tests
fails. `--last-failed` is useful while fixing a failure, but is not a full-suite
result. Independent journeys continue after a failure; automatic retries are off.

The contract runner executes regular files first, real Git fixtures separately
with at most two workers, then the Windows recorder with one worker. Every
selected batch runs even if an earlier batch fails, and any failed batch makes
the command fail. Explicit concurrency can lower the isolated limits. Run full
browser journeys separately from the process-heavy Git fixtures when collecting
responsiveness evidence.

## What belongs where

User-visible behavior belongs in `tests/*.browser.mjs`: interact through buttons,
keyboard and forms, then assert visible results, persistence and native request
shape where relevant. Prefer accessible names, `expect(locator)` and explicit
request gates to fixed sleeps, source regexes and server-rendered markup.
Use `test.step` to name meaningful user actions. Every journey automatically
fails on uncaught page errors, including errors from secondary pages.

The production journeys run real React assets, HTTP handlers and isolated stores.
Native provider transport is simulated. The dock uses a dedicated React
presentation fixture; browser capability fallbacks use a small HTML fixture.
Neither is counted as a production application journey. Helpers live under
`tests/support/` and are never counted as passing journeys by themselves.

Two workers reuse browser processes but create fresh contexts, servers and
temporary data for each journey. The shared `own` fixture closes registered
resources even when setup or an assertion fails. Servers use disposable data;
tests must never use a user's native database or authenticated provider.

Keep contracts for authority checks, routing, idempotency, uncertain delivery,
restart recovery, data migrations, filesystem races, Git safety, mathematical
properties and hostile inputs. Browser clicks cannot replace those checks.
The shared contract runner selects all, fast, Git, application or backend suites.
Trailing filename fragments are OR filters; unmatched selections fail. Node test
options such as `--test-name-pattern` remain available. Listings are not test results.
Node contract workers are bounded to avoid flooding the Windows process pool.
Python, PowerShell and installed-native startup checks remain separate in CI.

## Consolidated coverage

| Former markup/source-only proof | Browser proof |
| --- | --- |
| Chat handoff privacy, assignments/reports, tool output and reasoning | `chat-tweaks`: navigate a worker and open each disclosure |
| Activity ordering and collapsed summaries | `chat-tweaks`: inspect Details; `panels-theme`: open the child |
| Todo placement and sender controls | `polish`, `unfinished-work`, `action-feedback`, `send-feedback` |
| Decision banners and native question constraints | `dialogs`: defer, reopen, answer single/multiple/custom choices, verify native answers |
| Model options, intelligence controls, session defaults and agent-owned models | `model-defaults`: edit, save and reload through the production UI |
| Shared sidebar/conversation-history activity wiring | `history-search`: observe native worker busy/idle in both views |
| Quota summaries, disclosures, billing isolation and unknown data | `usage`: rendered geometry, keyboard actions, expiry and failed refresh |

Numerical color contracts still check every palette and custom swatch on every
contract run. The normal browser run exercises eight representative light/dark,
warm/cool and tinted palettes. `test:themes` applies all 300 through the browser;
run it for palette or color-rendering changes. The report records which sweep ran.
This reduces repetitive navigation without dropping the numerical coverage.
Each palette is a named step in the interactive runner. Routine screenshots use
the eight representative palettes; every palette gets a named browser step,
and failures retain their own screenshot and trace.
The exhaustive color-picker journey uses every palette through the settings UI.
The exhaustive usage journey saves eight representative palettes through the UI
with compact and expanded checks, then renders the other palettes using the same
theme tokens for meter geometry, provider contrast, overflow and surface checks.
The exhaustive command records actions and source references without a DOM
snapshot at every transition, avoiding oversized trace archives. Normal and
interactive runs keep DOM snapshots for debugging.

## Read results critically

`artifacts/browser-report/` contains the interactive HTML report. Failed runs
retain screenshots, error context and traces under `test-results/`.
`artifacts/verification/browser-journeys.json` records the selected tests,
individual outcomes, duration, unrun tests and global errors after each result.
Skipped, interrupted, timed-out and missing tests are never promoted to success.
Each run replaces that summary; a focused rerun is clearly a smaller selection.
Listing tests does not replace an executed run's evidence or HTML report.
The exhaustive theme sweep writes `browser-themes.json` and
`artifacts/browser-theme-report/` separately, preserving the main journey report.
Interactive runs also use their own output directory and `browser-interactive.json`,
so opening the UI cannot delete traces belonging to a running command-line suite.

A fixture result proves behavior only under its stated inputs. A passing source
assertion does not prove that a control works, and a screenshot without an
assertion is not an acceptance check. Diagnose failures before changing the
expected result or increasing a timeout. Model inference, authentication,
physical-phone access and visible Windows launch require separate evidence.


### Shared MCP acceptance

`npm run smoke:mcp` launches the pinned native engine with disposable native
configuration/data and a harmless local stdio service. It validates shared
configuration save/readback, two-project inheritance, connection, disable and
re-enable. No model inference, external connection or OAuth account is used.
`FREELANCER_SMOKE_OPENCODE` may specify an explicit native executable for an
isolated test environment; otherwise the existing Windows resolver is used.

MCP unit/HTTP tests and the Capabilities browser journeys use stateful native
fixtures. They cover global scope, error redaction, missing endpoints, stale
revisions and explicit setup. These do not prove live browser-MCP model use.
The source/profile matrix checks shared tools for named/custom agents; it does
not forecast any provider's ability to use them.

PowerShell recorder integration tests are Windows-only and report explicit skips
on other systems. On Windows the contract runner executes that process-heavy
file separately from other contract-file workers. The 30-second per-command
timeout stays bounded; a timeout or nonzero exit still fails the suite. Every
selected contract batch must pass.

### Native startup dependency fixtures

The native smokes seed dependency folders only inside their disposable temporary
roots using the source checkout's installed `node_modules` and lockfile. Run
`npm ci` first. Native settings, project JSONC, MCP configuration and provider
authentication remain separate from this fixture seeding; no user's OpenCode
directory is changed.

Runtime, context, MCP, history, event and launcher smokes also redirect the
native home, user profile, AppData and temporary directories into their owned
fixtures. They use the installed executable and remove those directories after
their own processes stop.

This proves native plugin loading and the tested configuration interfaces with
installed dependencies. It does not prove a first-time npm registry install.
`node scripts/diagnose-native-startup.mjs` observes the cold dependency path;
adding `--seed-dependencies` measures the installed dependency fixture. Both
write redacted stage logs, bound the first native request to 45 seconds and
dispose their own runtime without model inference. On OpenCode 1.18.31, the cold
fixture waited beyond that bound before plugin initialization, while the seeded
fixture loaded the shared tools in under five seconds. Its persisted driver
observation reported embedded Bun 1.3.14 and SQLite 3.53.0 with FTS5, JSON,
STRICT tables and named bindings. Authentication, inference and cold installation
need their own evidence.

`--native-only` removes Freelancer plugins from the diagnostic. A fresh native
control initialized in about eight seconds. `--empty-plugin` loads only a local
plugin that returns an empty object, without imports; its cold first request
still exceeded 45 seconds. That comparison narrows the delay to OpenCode's
dependency wait for external plugins. The
[upstream headless installation issue](https://github.com/anomalyco/opencode/issues/44684)
describes the same control result and incomplete dependency installation; an
individual registry fetch failure has not been observed in our redacted logs.

`node scripts/smoke-history-pagination.mjs` checks the actual OpenCode 1.18.31
history API with disposable empty conversations, including an archived chat and
a child chat. It sets deterministic equal-time session timestamps only while
that fixture's native database is stopped, then restarts the engine and checks
native HTTP lower-bound `start`, exclusive experimental `cursor`,
`x-next-cursor`, complete boundary-bucket capture and common search retrieval of
the oldest conversation with a page size of two. It uses installed dependencies,
changes no user's native database or configuration, and performs no inference.
Contract fixtures model these timestamp filters; they do not mimic an offset API.

`node scripts/smoke-warehouse-events.mjs` checks actual OpenCode SSE with two
disposable empty chats, one parent and one child. Initial and changed titles
must retain distinct immutable header revisions and match exact native,
warehouse and common-search identities. Its isolated home, app data, temporary
and native configuration directories are removed after shutdown. This checks
event transport and source identity with installed dependencies; message
capture is covered by contracts, and authentication, inference and cold
dependency installation require separate evidence.

### TypeSafe judgment evidence

The shared TypeSafe SDK adapter reads `TYPESAFE_API_KEY` and
`TYPESAFE_DEFAULT_MODEL` from the Freelancer server's process environment. It
does not copy credentials or service-local environment values from OpenCode.
A Jev MCP service configured in OpenCode remains available to native agents
through that engine independently of the SDK adapter. A configured status only
confirms that an environment key exists; it does not prove authentication or
inference. This optional adapter is not required for ordinary installation.

`judgment-evidence` returns bounded, exact record references for stored memories
and facts. Contracts exercise immutable revisions, forgotten sources, changed
claim provenance, source hashes, stale cache keys and evidence changes while a
provider request is pending. Provider responses in these contracts are fixtures;
no paid or live inference is performed. Historical receipts retain actual
answers and usage, while stale evidence prevents successful cache reuse.
