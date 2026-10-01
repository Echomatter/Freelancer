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
