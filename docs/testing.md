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

For a bounded integration run, use
`npm run test:contracts -- --test-timeout=180000`. An individual fixture's
explicit timeout may override that default; all selected batches must still
finish and pass. Avoid overlapping complete contract/browser runs with native
smokes when diagnosing a loaded Windows host.

Optional services created by a fixture must share its owned `localData` service
or close their own service before recursive cleanup. One ChatGPT preview fixture
omitted that dependency, opened an incidental database, and hung during Windows
cleanup. Production already supplied the shared service. The fixture now passes
the owned service and asserts that no fallback database was created. A killed
or incomplete worker is failed evidence, even if its preceding assertions passed.

Use asynchronous bounded child processes in HTTP fixtures. Synchronous CLI or
indexer calls block the fixture server and fetch client's shared event loop;
an expired keepalive socket can then be reused before its close is processed.
The conversation/knowledge contracts reproduced this connection-reset race and
now await bounded `execFile` calls. They retain their assertions and do not
retry failed HTTP requests or extend the server's timeout.

A native startup deadline fixture originally spent 140 ms in real stage delays
before awaiting tool readiness within its 180 ms total budget. Under concurrent
load, startup could correctly time out before that stage, leaving the fixture's
stage promise unresolved. The test now advances those same durations with Node
mocked Date/setTimeout and races each stage against startup settlement. Its
180 ms logical budget, 25 ms close delay and resolver/signal/closure assertions
are unchanged; product and smoke deadlines are unchanged. The first cancelled
run remains failed evidence, separate from the corrected full rerun.

### Native startup dependency fixtures

The native smokes seed dependency folders only inside their disposable temporary
roots using the source checkout's installed `node_modules` and lockfile. Run
`npm ci` first. Native settings, project JSONC, MCP configuration and provider
authentication remain separate from this fixture seeding; no user's OpenCode
directory is changed.

`nativeSmokeConfigPaths` uses `XDG_CONFIG_HOME=<fixture>/native-config` and
`OPENCODE_CONFIG_DIR=<fixture>/native-config/opencode`. The pinned native engine
appends `opencode` to the XDG root and deduplicates that directory with its
explicit config directory. Both variables therefore name one effective global
configuration. Receipts include both paths. Installed-source seeding writes
that directory once; cold mode seeds neither dependencies nor package caches.

Runtime, context, MCP, history, event and launcher smokes also redirect the
native home, user profile, AppData and temporary directories into their owned
fixtures. They use the installed executable and remove those directories after
their own processes stop.

This proves native plugin loading and the tested configuration interfaces with
installed dependencies. It does not prove a first-time npm registry install.
`node scripts/diagnose-native-startup.mjs` observes the cold dependency path;
adding `--seed-dependencies` measures the installed dependency fixture. It
isolates HOME/profile/AppData/TEMP/XDG and launches from its own disposable
backend directory, retaining source paths for Freelancer's real plugins.
The diagnostic explicitly observes native initialization through its agent
request; it does not use the product's tool-readiness preflight. The default
agent-request deadline is 45 seconds. For a separate longer
observation, use `--request-timeout-ms 180000` (maximum 300000); its report
records the actual window and duration. A longer observation does not turn a
failed 45-second sample into a pass. Cleanup requires the owned child to close;
an uncertain process preserves its fixture and log.

`--native-only` removes external plugins. `--empty-plugin` injects a native
file URL for a plugin that returns an empty object and emits an initialization
marker; that marker must be observed before the control can pass. The earlier
empty-plugin diagnostic incorrectly passed its absolute path as a Freelancer
plugin name, producing a malformed path. Its successful seeded result did not
prove plugin initialization and is superseded by the corrected controls.

On OpenCode 1.18.31 the corrected native-only agent request took 883 ms; the
seeded empty plugin initialized and responded in 569 ms. The cold empty-plugin
request failed at 45 seconds. A separate unseeded 180-second observation loaded
the plugin in 85.67 seconds and completed both native dependency directories.
The full Freelancer plugin set then exceeded its 180-second observation without
completing dependency lockfiles. These historical samples used two distinct
global configuration directories; they do not establish the ordinary
single-directory cold result. The [upstream headless installation issue](https://github.com/anomalyco/opencode/issues/44684)
describes related dependency-wait behavior, but a specific registry fetch
failure has not been observed in our logs. Current Context7 plugin docs confirm
async hook exports and file-URL configuration; installed-version source and
actual native observations determine installer behavior. Authentication and
model inference require separate evidence.

Runtime and launcher smokes accept `--cold-dependencies` to exercise unseeded
native configuration directories. The launcher smoke retains its 90-second
outer process deadline and 60-second API deadline. Product startup has one
75-second native budget, including executable resolution, listening, health
and tool readiness; the PowerShell launcher waits at most 85 seconds for the
published web endpoint. On restart, warming the selected saved project consumes
that same native budget. A new project has a 55-second native preflight before
Freelancer policy, marker and registration writes. HTTP disconnect cancels the
registration waiter. The normal browser GET deadline remains 30 seconds, and
the capability observation remains 15 seconds. Readiness is actual native tool
inventory observation, never permission approval or a successful cache.
The pinned [OpenCode 1.18.31 registry](https://github.com/anomalyco/opencode/blob/v1.18.31/packages/opencode/src/tool/registry.ts)
builds the complete registry through native plugin loading before returning
`ids`; model-specific tool selection occurs later. Freelancer preserves the
observed IDs, including an empty response, and the real native smoke separately
asserts its required shared registrations. Native tool permission denial does
not become a startup entitlement check.

The earlier corrected schema-22
cold Windows launcher reached `GET /api/bootstrap` but timed out after 60,001 ms
(`artifacts/storage-launcher-cold-schema22-final.log`). Its receipt confirms
the owned server/native process tree closed, launch record and lock disappeared,
native config and authored backend sources were unchanged, and temporary data
was removed. The earlier failed process-audit sample provides no capability
evidence. Installed-source runtime success is recorded separately and cannot
establish cold installation. A subsequent standalone unseeded sample returned
bootstrap in 59,286 ms, then failed the 15-second project capability observation
(`artifacts/storage-launcher-cold-schema22-standalone.log`). Its owned processes
and temporary data also closed cleanly. This exposed premature HTTP readiness
and project acknowledgment; both failures predate the readiness preflight.
The first unseeded sample after that repair failed the 75-second native
preflight before the web endpoint was published
(`artifacts/storage-launcher-cold-readiness-schema22.log`). No launch record was
created. Its original harness recorded no process IDs before HTTP readiness,
so its empty process receipt does not independently prove native shutdown;
the lock/config/source/temp checks and host close contracts remain separately
scoped. The [native installer](https://github.com/anomalyco/opencode/blob/v1.18.31/packages/core/src/npm.ts)
uses npm Arborist with [native npm configuration](https://github.com/anomalyco/opencode/blob/v1.18.31/packages/core/src/npm-config.ts).
The exact installer substep in those historical two-directory failures has not
been observed. The corrected standard-layout cold launcher passed on source
commit `17e6f18` (`artifacts/storage-launcher-cold-integrated-schema22.log`):
bootstrap returned in 2,421 ms, project registration in 436 ms, complete shared
tool observation in 271 ms and restart bootstrap in 2,432 ms. All eight observed
owned process IDs closed; config/backend bytes, launch record/lock cleanup and
temporary-data removal were checked. It seeded no native dependencies or
package caches and retained the normal 90-second outer/60-second API deadlines.
The source checkout had its normal installed npm dependencies. The smoke does
not establish a registry download trace, arbitrary custom two-directory
configuration behavior, provider sign-in, inference or a visible browser launch.

The native-config sentinel includes OpenCode's `$schema` field before startup,
then compares exact bytes. One earlier run omitted that field and failed the
comparison after OpenCode added it. Its native child was closed; automatic
approval review rejected cleanup with only `blocked by policy`, so that failed
temporary fixture remains preserved. It is not an active Freelancer data store.

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
