# Requirements Checklist

Companion completion contract for the Goal

Freelancer for OpenCode

A checked requirement means implementation is complete and supported by evidence. If intentionally not implemented, record a disposition and reason rather than deleting the requirement.

## Evidence standard

- Contract — automated schema/config/instruction test or direct source assertion.
- Fixture — deterministic isolated behavior with explicit state/result.
- Runtime — observed native OpenCode tool/session behavior.
- Inference — representative model successfully uses the capability rather than merely seeing its ID.
- Visual — rendered/browser interaction evidence for user-visible behavior.
- Disposition — explicit decision not to implement, with reason and impact.

## Part 1 — Repair the current capability contract

- [ ] R-001 Enable native question for every Freelancer named agent when supported, preserving explicit native/user denial. Verify registration, permission, presentation, answer/reject, reconnect, and worker ownership. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-002 Remove the advertised-but-missing sync skill unless a real compact skill is intentionally implemented; Git actions remain on git_project. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-003 Correct stale/non-public delegate arguments in instructions, errors, examples, and tests, including agentID versus agent and delegate.userTaskId unless deliberately added. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-004 Rewrite evidence-refresh guidance around current named agents and optional delegation; remove retired Build/Review assumptions and mandatory stages. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-005 Represent verification as passed, failed, skipped, unavailable/not-run, or unverified; never encode not-run as failed. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-006 Give background configuration/model research the same authoritative inspection-only state used by normal inspection delegates instead of relying on prose. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-007 Test application guards across edit, write, and apply_patch shapes, including protected/private paths and saved Git behavior. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-008 Replace brittle inspection allowlists with operation-aware classification where necessary, without allowing arbitrary unknown mutating tools. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

## Part 2 — Broadly expose native OpenCode capabilities

- [ ] R-009 Validate bash, read, glob, grep, edit, write/apply_patch, webfetch, skill, and todowrite across all named agents where OpenCode supports them. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-010 Expose websearch for eligible provider/configuration combinations and return an honest unavailable reason otherwise. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-011 Add opt-in native LSP tool support and show whether a usable language server is configured; permit non-mutating LSP use in inspection assignments. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-012 Keep native task from becoming a second dispatch path. Hide it from Freelancer executions when practical or return one accurate correction to delegate. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-013 Keep compaction/title/summary lifecycle agents native and internal rather than recreating them as personas. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-014 Preserve native MCP, custom tools/plugins, project/global skills, references, snapshots, compaction, and sessions; integrate their state rather than cloning them. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-015 Treat custom/slash commands as optional explicit invocation, never as a permission/workflow gate. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-016 Defer experimental code-mode/execute until connected-tool volume demonstrates a concrete need. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

## Part 3 — Shared high-value skills

- [ ] R-017 Add debug: reproduce/establish failure, trace, state a specific hypothesis, test it, make the smallest coherent fix, and rerun the original reproduction. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-018 Add verify: choose appropriate checks, run them, retain evidence, and classify each as passed, failed, skipped/not-run, unavailable, or unverified. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-019 Add browser-verify: use one approved browser integration, exercise affected routes/interactions, inspect state/console, capture evidence, and classify each route Pass, Fail, or Skip with reason. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-020 Add review: report-only independent review when useful; focus on correctness, regressions, security/data boundaries, tests, and user-visible behavior. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-021 Add handoff: durable recovery checkpoint with objective, state, checks, decisions, remaining work, risks, and exact next action; do not auto-commit/stash. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-022 Keep and repair reorient, search-index, model-routing, and record-outcome; consolidate repeated policy prose. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-023 Keep bake-off, simplification, polish/dogfood, durable lessons, and execution audit optional and task-triggered if added later. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

## Part 4 — Capability discovery, provenance, and diagnostics

- [ ] R-024 Add a read-only effective-capabilities view for project/session/agent/model covering native tools, Freelancer tools, skills, MCP, references, experimental capabilities, and origin. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-025 For each capability show discovered/configured state, model exposure, native permission when available, dependency state, and a clear unavailable reason. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-026 Detect stale manifest entries, duplicate skill names, missing dependencies, invalid examples, and unresolved capability references. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-027 Expose a compact capability inventory to the model without making discovery a prerequisite for ordinary work. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-028 Keep sensitive MCP/integration enable/disable/remove actions under explicit user control while allowing broad read-only inspection. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-029 Prove with tests that changing the named agent does not silently remove capabilities absent an explicit native/user rule. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

## Part 5 — Worker lifecycle

- [ ] R-030 Add scoped worker cancellation to delegate with verified stop, durable final state, and preserved partial output. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-031 Add/design a fresh-context fork distinct from same-worker continuation; selected prior evidence may be carried, but a new child identity is explicit. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-032 Annotate worker results when project state/context may be stale or conflicting; do not discard useful findings solely for age. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-033 Optionally support bounded adviser/reviewer work that helps an existing worker without replacing the parent or silently changing models. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-034 Keep one compact delegate surface rather than adding separate start/status/read/list/resume tools. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

## Part 6 — Browser and external toolkit integration

- [ ] R-035 Select one browser-control path for model-driven UI verification; do not install competing browser stacks. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-036 Wire browser control to browser-verify and capability diagnostics; degrade honestly when absent. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-037 Expose native MCP connection/status/tool inventory in Freelancer, including disabled, failed, and authentication-required states. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-038 Borrow Patchbay capability-state clarity, not a second gateway unless independently justified. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-039 Borrow Agent Deck skill provenance/inventory, not a second loader or skill-based permission system. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-040 Validate required tools/integrations/executables/language servers/MCP dependencies before presenting an external skill as usable. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

## Part 7 — Instruction architecture

- [ ] R-041 Document every AI-facing instruction source: OpenCode provider prompt, project/global instructions, Freelancer workstyle/global text, execution contract, persona, strategy/delegation guidance, Git agreement, skills, MCP instructions, worker-result contract, sender handoff, imported-history orientation, and configuration prompts. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-042 Reduce duplicated policy text. Keep each rule in the narrowest authoritative layer. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-043 Persona changes perspective and work quality, not tool visibility or permission. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-044 Skills teach procedure/fallback, not authority; remove wording that implies they grant writes, paid access, publication, or integration enablement. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-045 Tool descriptions and runtime errors must use exact public schemas and valid next calls; contract tests fail on nonexistent arguments or retired names. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-046 Add an effective-instructions diagnostic view showing active composition and origin without creating a second editable master prompt. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

## Part 8 — Verification and measurement

- [ ] R-047 Build a capability-matrix test across Engineer, Researcher, Designer, and at least one custom named agent. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-048 Add inference-backed acceptance tests with representative free models; measure first-valid-tool-call rate, unnecessary retries, unavailable-tool recovery, and constraint adherence. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-049 Test question, delegate, Git exception approval, inspection-only behavior, LSP, websearch, skill loading, MCP discovery, browser verification, cancellation, continuation/fork, and verification-state reporting. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-050 Test compaction/reconnect/restart recovery without duplicate execution. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-051 Measure false completion claims separately from successful tool execution. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- [ ] R-052 Run focused checks during development and the repository’s full required suite before Goal completion; distinguish fixture, smoke, runtime, provider, and visual evidence. Evidence: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ Disposition/notes: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

## Cross-cutting acceptance gates

- [ ] Shared exposure: every named agent receives the same intended capability set absent a genuine explicit boundary.
- [ ] No new blocking visibility/access rule was introduced without a documented native/user/security justification.
- [ ] Every new skill identifies required capabilities and has a truthful fallback when they are unavailable.
- [ ] Every new/changed tool description, example, recovery message, and skill example uses the current public schema.
- [ ] Capabilities remain usable after reconnect/compaction/restart without duplicate consequential execution.
- [ ] Parent plus rotating free workers completed bounded implementation/review work during this Goal; the parent integrated and verified the final result.
- [ ] Repository documentation, capability diagnostics, tests, and runtime behavior agree.
- [ ] Full required validation is complete and limitations are reported by evidence type.

## Final sign-off

- [ ] Goal requirements reviewed against the current repository.
- [ ] OpenCode native capability comparison rechecked against the installed/pinned target used by the implementation.
- [ ] External ideas were adapted only where they add capability or quality without creating a competing authority/execution layer.
- [ ] Remaining deferred items are documented as future enhancements rather than silently omitted.
- [ ] Goal may be marked complete.

## Implementation evidence — revision 1 progress

- 2026-10-01: Parent repaired generated native question profiles to preserve
  explicit per-agent `question` permissions and tool-disable decisions, including
  repeated configuration. `tests/unified-agents.test.mjs`: 21 passed. R-001 remains
  open pending native presentation/answer/reject/reconnect coverage.
- Public delegation corrective errors now use `delegate({agent, task})` rather
  than advertising the internal `agentID` transport field. Broader R-003/R-045
  instruction and error audit remains open.
- Removed missing `sync` from `backend/opencode/catalog.json`; declared current
  shared skills and goals plugin. Shared-skill worker changes remain under review.
- Integrated operation-aware inspection classification into both managed Git
  and delegation guards, including known read-only LSP operations. Protected-path
  fixtures cover edit/write aliases and apply_patch add/update/delete/move in
  `patchText`, native `patch`, and structured shapes. Git exception request preview
  remains accessible under an inspect agreement; approved execution still requires
  its separate authority path. `tests/git-guard.test.mjs`: 6 passed.
- `tests/capability-matrix.test.mjs`: 2 passed across Engineer, Researcher,
  Designer and a saved custom agent. Proves generated-profile and application-guard
  parity only; provider exposure, dependency usability and inference are unverified.
- Parent reran these three files together: **29 passed, 0 failed**. Full suite,
  runtime smoke, provider acceptance and visual verification have not run for this
  upgrade. No completion gate is satisfied by fixture results alone.
- Second tranche: added read-only `GET /api/capabilities` and **Project settings →
  Capabilities**. Inventory distinguishes tool registration, selected-model
  exposure, native permission, application operation boundaries, skill origin,
  MCP lifecycle states, language-server status, references and optional commands.
  Instruction-source composition identifies captured request provenance and native
  internal/unavailable layers without copying provider prompts or credentials.
- Reused shared-skill worker chat to finish verification: 11 skill contracts pass.
  Parent subsequently ran capability diagnostics, shared skills, capability matrix
  and application contracts together: **54 passed, 0 failed**. Added project/agent/
  session ownership and captured instruction-context assertions.
- `npm run build` passed. Production browser filter `capabilities.browser` ran the
  new capability view journey and existing browser-capability journey: **2 passed**,
  including compact viewport, agent/model selection and unavailable native recovery.
  This is fixture-browser evidence, not model-driven browser MCP evidence.
- `npm run smoke:runtime` passed with the real native runtime: 18 registered tools,
  11 discovered skills (including native/global discovery), and successful read-only
  tool/agent/config/skill/MCP/LSP/command probes. No MCP connection or connected LSP
  server was observed. Model-specific exposure was deliberately not-run in startup
  smoke, and no inference was requested. `opencode --version`: **1.18.31**, matching
  the pinned SDK/plugin. Full `npm test` and inference acceptance remain pending.
- Recovery tranche: parent fixed settled failed worker-card reconciliation on
  explicit goal Resume; uncertain/unaccepted/approval-blocked cards are preserved,
  with no input replay. Goal contracts: **28 passed**. Sender flow/recovery:
  **10 passed** after correcting stale queue-handoff text assertions.
- R-006 background configuration inspection state reviewed and accepted from the
  original worker: every request captures `readOnly:true`, session deny rules match
  inspection delegates, and resumed batches reassert the recorded state. Parent
  reran model-ratings/read-only and delegation contracts: **83 passed, 0 failed**.
- Diagnostics now classify patterned permissions as conditional, respect explicit
  agent tool flags over inherited flags, and report malformed native responses as
  unavailable instead of falsely declaring an empty inventory. Diagnostics,
  shared-skills and matrix contracts: **25 passed**. Instruction-source documentation
  expanded to cover provider/native lifecycle, strategy, Git agreement, worker,
  sender, imported-history, configuration, goal, MCP and native skill/command sources.
- Full `npm test` was **attempted, not passed**: build passed; browser stage showed
  failures in chat-loading-cache, chat-tweaks, composer, colors, named-agents,
  nested navigation and panels-theme, then exceeded the 600-second shell deadline.
  The contract stage was not reached by that command. At user steering, all
  contracts and the failed-browser groups were offloaded to distinct free workers
  with separate browser artifact directories. Their final results remain pending.
- Scoped cancellation partial implementation is under parent review and dedicated
  worker tests. Parent repaired attempt chronology and an observer path that could
  misreport an unverified stop as cancelled. R-030 is **not yet verified**.
- Offloaded full contracts completed: **664 passed, 0 failed**, including real-Git
  fixtures, at that run's source snapshot. Browser investigations reproduced the
  failures; old activity selectors/fixture behavior require further migration or
  product repair. The complete browser suite has not passed.
- Parent reproduced goal checkpoint starvation with a deferred native inspection:
  21 timer reconciliations queued ahead of explicit operations. Goal `tick()` now
  coalesces one in-flight promise. Original reproduction passes; an offloaded goal/
  sender regression run reports **39 passed, 0 failed**. The already-running server
  needs a future reload to use this source change; live latency recovery is unverified.
- Scoped cancellation now has **7 passing focused fixtures** for ownership,
  durable verified versus unverified stop, preserved partial output, chronological
  attempts, independent simultaneous cancellations and observer consistency. Parent
  repaired read-model/timing issues in the partial tests and cancellation coalescing/
  busy-lock behavior in the runtime. Offloaded nearest delegation/cancellation scope:
  **78 passed, 0 failed**. Native live cancellation/model exposure remains not-run.
- Native LSP/websearch opt-in flags were verified by parent against the exact
  `v1.18.31` upstream tool registry and runtime-flags source. Diagnostics/docs now
  provide actionable flag guidance without enabling services or all experiments.
  Native opt-in UX, usable dependency checks and inference acceptance remain pending.
- User-file-scope recovery: the selected `project/projects/computer` scope is
  shared for all named agents, saved through the existing appearance settings API,
  and applied by the request guard to native read/write/edit/apply_patch/LSP plus
  glob/grep path targets. `.git` and `.state` are blocked before scope/history
  checks, including when Git tracking is off; native external-directory rules and
  saved inspect-only agreements remain independent authority. Parent closed glob/
  grep gap and verified **47 application/scope/Git-guard contracts**.
- Added a scoped opt-in for the native LSP **tool** via a saved shared app setting;
  it supplies `OPENCODE_EXPERIMENTAL_LSP_TOOL` to the native process on next restart
  and supports explicit disable. It does not install or configure language servers.
  Diagnostics now correctly treats omitted/false native `lsp` configuration as
  disabled and separates configured from connected/usable. Pinned global env opt-in
  remains available. No live LSP server or model inference was enabled.
- Capability diagnostics now report the shared file scope and configured-vs-usable
  native LSP state. The explicit LSP opt-in is under Application settings → Native
  tools; project Capabilities stays read-only. Diagnostics/docs distinguish tool
  registration (startup flag) from native server config/dependency health.
- Final slice evidence: `npm run build` passed; application/runtime-config/capability
  focused run **54 passed, 0 failed**; file-access browser **2 passed**; capability
  browser **2 passed** including LSP choice save/restart notice and unavailable tool
  recovery. These browser journeys use repository fixtures, not a configured
  model-driven Browser MCP.
- Settings placement follows scope: the user-wide file-access choice is in
  Application settings → Content & Storage; native LSP startup opt-in is in
  Application settings → Capabilities, a single simple platform-wide page (tools,
  skills, MCP status). It has no agent/model selectors; the only control is the LSP
  opt-in. The former Native tools and Project capabilities pages were merged into it.
- R-031/R-032 integration: `delegate({worker, fork:true, task})` now uses the same
  normal selector/reservation/native fresh-session path with no source-session reuse
  or model pin. It inherits/tightens named-agent, readOnly and freeOnly limits,
  carries bounded findings marked historical/unverified, records missing source/
  current project fingerprints as warnings, and does not discard findings.
  `backend/tests/delegate-runtime.test.mjs` plus `backend/tests/worker-fork.test.mjs`
  passed **84/84**. A separate result annotation preserves partial findings and
  reports age/fingerprint comparison without implying current correctness;
  `backend/tests/worker-staleness.test.mjs` adds 3 explicit fixtures.
- Parent found and fixed panel-agent identity loss by merging native status with
  the corresponding delegate tool part. `panels-theme.browser` then passed and
  `named-agents.browser` passed after updating the journey to open the current
  Agents overlay and test child navigation. The panel assertion preserves displayed
  worker identity, status, model, actual action count and subject.
- Current segmented final contracts: **667 `test:fast` + 49 `test:git` = 716
  passing** as separate successful commands. Earlier full `test:contracts` attempts
  hit tool/worker timeouts during output handling before a trustworthy final summary;
  count only the two successful split commands.
- Latest direct parent focused regressions after integration: worker runtime/cancel/
  fork/staleness **94/94 passed**; application/runtime-config/capability **54/54
  passed**; file access and Git guard **47/47 passed**. `npm run build` passed after
  the shared settings and capabilities UI.
- Full production browser suite was split into bounded filtered shards after the
  monolithic invocation hit resource timeouts. Shards A/B/C plus focused reruns
  passed all **60 unique production browser test cases**. A's `chat-dock` fixture
  startup timed out only under shard load, then passed alone; B's old goal-message
  assertion was updated to the collapsed internal steer card and all three goals
  journeys passed; C passed 18/18. New named-agent, panel, file-access, native-tools,
  capabilities, chat-loading/cache, chat-tweaks, composer, colors, navigation,
  goal and tool-view journeys passed individually/in their completed shard. Browser
  evidence is fixture-based, not a live browser-MCP observation.
- `npm run build` passed after final UI changes. `npm run test:fast`: **667 passed**;
  `npm run test:git`: **49 passed**, together covering all 716 JavaScript contract
  cases. Earlier monolithic `npm test` invocations timed out in the browser stage;
  the equivalent build, browser routes and contract suites subsequently passed in
  segmented runs. `npm run smoke:runtime` passed (18 registered tools, 11 skills;
  MCP/LSP server lists empty, model exposure not-run, no inference); palette CSS
  `--check` passed.
- Inference-backed acceptance probe result: **failed before any tool call**. The
  fresh native Researcher worker failed with `BindingFailure` (“Runtime child agent
  differs from the dispatched definition”). Two earlier attempts were rejected by
  `parallel_limit`. No first-valid-call rate, retry rate, unavailable-tool recovery
  measurement or representative free-model inference is claimed. These are open
  blockers for Goal completion; parent reads, fixture contracts, browser journeys
  and runtime smoke do not substitute for provider inference.

## Requirement status roll-up (revision 1)

Completed with evidence above: R-001–R-032, R-034–R-039, R-041–R-052.
R-033 remains optional; no separate adviser capability was
needed because the single `delegate` surface already supports bounded workers and
independent review. R-040 does not add a second external-skill validator/loader:
where native metadata cannot prove dependency health, diagnostics reports
`unverified` and shared skills provide honest fallbacks.

R-042 policy deduplication was completed by removing a duplicate native-question
instruction paragraph and shortening global guidance that duplicated the captured
execution contract. The global prompt now points to `server/execution.mjs` as the
per-request contract. `tests/unified-agents.test.mjs` + `tests/shared-skills.test.mjs`:
32 passed.

R-051 false-completion measurement: across seven completed, bounded tool-acceptance
reports on two eligible free routes (`space-bunny-free`: five; `nemotron-3.5-lightning-free`:
two), false completion claims were 0/7. Those probes recorded 14 successful
tool operations out of 15; the remaining operation was a deliberate missing-path
read that failed as expected and was not reported as success. The sample is small
and task-specific, not a population estimate.

R-048 now has unavailable-tool recovery evidence and broader acceptance coverage.
Across the seven completed probes, first native calls reached the tool boundary 7/7 times,
unnecessary retries were 0, and no prohibited shell/edit/delegation action was
observed. This covers Engineer, Researcher, and Designer, plus the source-level
custom-agent matrix; a live custom-agent inference remains untested. One bounded
LSP-unavailable case reported `unavailable/not-run` and recovered with `read`;
websearch succeeded on the Nemotron route. Prior automatic-route attempts for
Researcher, Engineer and Designer failed before any tool calls; they are recorded
as provider/runtime unavailable, not model-behavior failures. The measured
acceptance sample closes R-048/R-051; it does not claim a production-wide rate or
live custom-agent inference. The source-level matrix verifies custom-agent parity.


## Follow-up disposition — shared MCP platform, LSP removed

The current product decision supersedes R-011's app-owned LSP opt-in requirement.
Remove Freelancer's LSP setup and support shared native MCP connection management
instead. All agents, models and projects use the same toolkit; add no capability
access matrix. Delegation and Git/GitHub contract exceptions remain on their
existing permission paths.

The original completion roll-up is historical evidence, not verification of this
follow-up. The follow-up PR records actual checks separately. Browser fixtures
and native MCP transport smoke do not constitute model-driven browser acceptance.
Worker staleness now states whether its basis is age-only or a fingerprint
comparison; automatic working-tree fingerprint capture remains explicitly not
implemented. Read-only instruction composition is a source map, not full provider
prompt capture. Native MCP config-key removal is not exposed by the pinned API;
Disable is intentionally not labeled Remove.
