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
timeout stays bounded; a timeout or nonzero exit still fails the suite. Both
contract batches must pass.
