# Reliability and release acceptance

A passing fixture suite is not proof that a user's provider sign-in, live inference,
or arbitrary parallel edits work. This document separates those claims and makes
release acceptance repeatable. Nothing here changes routing, consent, native
permissions, the selected parent model, or the saved Git agreement.

## Automated evidence

`Verify` now runs three independent job groups. An early contract failure no longer
prevents the production UI or installed-runtime smoke checks from reporting.

| Job | What it establishes | What it does not establish |
| --- | --- | --- |
| Application, Windows and Ubuntu | JavaScript contracts, real local Git fixtures, Python contracts, plugin typecheck, palette checks; Windows also runs PowerShell contracts | Live provider execution or browser behavior |
| Browser, Windows and Ubuntu | Production build and existing Chromium journeys with simulated services | Provider authentication, real inference, or a measured maximum workload |
| Native startup, Windows | Built assets and startup against the pinned OpenCode 1.18.31 baseline, using isolated test data | Inference, provider availability, or compatibility with every OpenCode version |

The aggregate **Verify** check fails if any required job fails, is cancelled, or is
skipped. No `continue-on-error` or automatic retry turns a failure green. Existing
Application check names remain intact. Repository administrators may require the
aggregate Verify check in branch protection; this PR does not change repository
protection settings.

Every job uploads `artifacts/verification/*.json` with the exact tested checkout,
PR head (which may differ from GitHub's test merge), run/attempt, Node/OS details,
and individual step outcomes. Unknown/skipped outcomes stay unknown/skipped.
These records deliberately exclude environment dumps, step outputs and credentials.
Browser artifacts retain their existing seven-day retention. Download evidence
needed for a release before it expires. A rerun is a new attempt; retain the failing
attempt's link when investigating a flaky result.

Local baseline commands, from a prepared checkout:

```powershell
npm.cmd test
python -m unittest discover -s backend/tests -p '*_test.py'
npx.cmd tsc --noEmit --target ES2022 --moduleResolution bundler --module esnext --skipLibCheck backend/opencode/plugins/delegation.ts backend/opencode/plugins/git-project.ts
node scripts/palette-css.mjs --check
npm.cmd run build
npx.cmd playwright install chromium
npm.cmd run test:browser
npm.cmd run smoke:runtime
```

The startup smoke needs an installed compatible runtime. The test suite includes
Windows path-alias controls and POSIX case-sensitive keys. A Windows-only filesystem
case skipped on Linux is not a Windows pass; the Windows job must execute it.

## Combined lifecycle regression

Run the recovery scenarios separately when investigating delivery bugs:

```powershell
node --test tests/sender-recovery.test.mjs
```

They exercise the production sender and state reducer with a real temporary outbox
and simulated native responses. They cover restart, repeated delivery IDs, lost
acknowledgements, unavailable state, approval gates, completion and isolation between
conversations. They are not a live multi-provider benchmark. Do not infer throughput
or an arbitrary safe worker count from their duration.

## Live acceptance: required before a release-readiness claim

**Status supplied by this PR: NOT RUN.** A checklist, a fixture pass, and a startup
smoke must never be substituted for observed results below.

Use a disposable project with no credentials or important files, local-only Git,
and an explicitly selected model. Prefer a free route; paid work requires the
operator's normal explicit permission. Do not upload the fixture to GitHub. Record
the exact Freelancer commit, OpenCode version, Node version, Windows version,
browser version, configured limits, and provider-qualified model identities.
Use the native child IDs and observed runtime metadata, not just the model's prose.

Start with a bounded workload: one parent and at most two child assignments, each
editing different named files. This is a test configuration, not a newly claimed
support limit or an assertion of automatic filesystem isolation.

| Case | Exercise | Required observations |
| --- | --- | --- |
| L1: normal work | Parent edits one file, then requests an independent read-only review | Parent identity unchanged; one actual child; actual checks/results agree with the report; no unauthorized edits or upload |
| L2: continuation | Ask the same worker one follow-up | Existing child ID and model retained; one follow-up, not another duplicate worker |
| L3: overlapping activity | Two disjoint child assignments, a queued parent follow-up, and navigation to another chat | Concurrency stays within the saved limit; pending approval blocks the right request; unrelated chat and draft stay intact; FIFO parent delivery occurs once |
| L4: interruption | Stop active work with another turn queued; then restart the local server | Native stop state is inspected; waiting work is cancelled rather than replayed; uncertain outcomes remain explicit; no replacement writer starts automatically |
| L5: lost connection | Disconnect/reconnect the UI or native transport during acceptance | A lost acknowledgement is not assumed to mean no execution; native history is checked; no duplicate request or worker; recovery is explicit |
| L6: failure | Encounter or safely simulate an unavailable route/provider | Failure is visible and distinguished from completion; partial output remains available; no silent paid fallback or invented test result |
| L7: capacity | Attempt more children than the configured ceiling, then finish one | Limit holds while children are starting and after reconnect; retry starts only genuinely unstarted work |
| L8: long workspace | Accumulate at least 100 request groups with tools, then resize and scroll while new activity arrives; open/collapse work, switch chats and reload | No duplicate work cards, lost text, incorrect question ownership, horizontal page overflow, or forced scroll to bottom while reading history |

For L8 record viewport sizes (include a narrow window), Windows display scaling and
browser zoom. Recheck the first-tool card, dock handoff in both scroll directions,
Details, composer and draft together. Measure noticeable input/scroll stalls and
record browser memory before/after repeated navigation; do not prescribe a performance
threshold without a measured baseline. A discovered limit belongs in the release
notes, not behind an unqualified 'scales well' claim.

Repeat L1-L5 at least five times. Checkpoint the disposable work and verify its Git
state between repetitions. Overlapping edits to the same files require deliberate
sequencing; neither a concurrency ceiling nor this runbook creates worktree isolation.

## Acceptance record

Copy the following into a private release record; redact sensitive transcript/tool
content before attaching evidence to a public PR. Do not commit user state, auth data,
native databases, or raw conversation exports.

```text
Candidate commit:
Tested checkout / CI run / attempt:
OpenCode / Node / OS / browser / scaling:
Parent model / child models / depth / concurrency:
Automatic Verify result and artifact links:
L1-L8: NOT RUN | PASS | FAIL | BLOCKED (one result per case)
Repetition count and observed failures:
Native request and child IDs (redacted when necessary):
Expected versus observed dispatch counts:
Files/HEAD/index before and after interruption:
Long-workspace size, measured stalls and memory observations:
Known limitations / issue links:
Reviewer and date:
Decision: NOT READY | ACCEPTED FOR THE RECORDED SCOPE
```

A blocked case is not a pass. A provider outage may explain a blocked result, but it
does not supply missing execution evidence. Fix one named failure at a time, rerun
its regression and the combined journey, and retain the original failure evidence.
