# Implement Skills, Tools, Agent, workflow and instructions upgrade

Goal prompt and execution charter

Freelancer for OpenCode

## Goal prompt

**TOP RULE — CAPABILITY FIRST.** Add capabilities, toolkit integrations, tools, and skills and expose them broadly to all named agents. Do not add blocking rulesets merely to shape model behavior. When in doubt about a visibility or access rule, remove or relax it. All tools and skills should work seamlessly with all agents. Keep only genuine native permission, explicit user-consent, security, destructive-action, paid-model, and saved project-agreement boundaries. Personas, workflows, skill names, and routing preferences are guidance—not authority.

Upgrade Freelancer so Engineer, Researcher, Designer, and user-created agents share one coherent permissive toolkit. Repair instruction/schema drift, expose useful native OpenCode capabilities, add high-value shared skills and selected external ideas, and make effective capability state visible and diagnosable. Extend OpenCode rather than creating a competing execution, skill, workflow, permission, or session system.

## Execution model

- The parent model owns integration, sequencing, architecture, and final verification, while also completing bounded implementation tasks itself.
- Rotate eligible free models often across bounded development tasks. Use different free models for implementation, investigation, tests, documentation, and independent review when useful.
- Do not delegate tiny work ceremonially. Give concurrent writers disjoint files/surfaces and sequence overlapping writes.
- Reuse a worker when continuity matters; rotate models when independence or a fresh approach matters.
- The parent reviews and integrates worker output against repository evidence and acceptance criteria. Worker completion is not proof of correctness.
- Keep the Goal task list synchronized with actual state. Paid workers remain subject to native consent; never silently switch the selected parent model.

## Operating principles

- Capability exposure is the default. Agent identity changes approach, not tool authority.
- Native permissions, explicit user choices, paid consent, destructive-action confirmation, and the saved Git/GitHub agreement are the authority model.
- Use one tool path per job: delegate for workers, git_project for managed history, native skill for skill loading.
- Skills teach repeatable procedures and evidence standards; they do not grant capabilities or force routing ceremonies.
- Denied/missing/unsupported capability returns actionable state, not an invitation to bypass it.
- Evidence distinguishes executed, passed, failed, skipped, unavailable/not-run, and unverified.

## Part 1 — Repair the current capability contract

- [ ] Enable native question for every Freelancer named agent when supported, preserving explicit native/user denial. Verify registration, permission, presentation, answer/reject, reconnect, and worker ownership.
- [ ] Remove the advertised-but-missing sync skill unless a real compact skill is intentionally implemented; Git actions remain on git_project.
- [ ] Correct stale/non-public delegate arguments in instructions, errors, examples, and tests, including agentID versus agent and delegate.userTaskId unless deliberately added.
- [ ] Rewrite evidence-refresh guidance around current named agents and optional delegation; remove retired Build/Review assumptions and mandatory stages.
- [ ] Represent verification as passed, failed, skipped, unavailable/not-run, or unverified; never encode not-run as failed.
- [ ] Give background configuration/model research the same authoritative inspection-only state used by normal inspection delegates instead of relying on prose.
- [ ] Test application guards across edit, write, and apply_patch shapes, including protected/private paths and saved Git behavior.
- [ ] Replace brittle inspection allowlists with operation-aware classification where necessary, without allowing arbitrary unknown mutating tools.

## Part 2 — Broadly expose native OpenCode capabilities

- [ ] Validate bash, read, glob, grep, edit, write/apply_patch, webfetch, skill, and todowrite across all named agents where OpenCode supports them.
- [ ] Expose websearch for eligible provider/configuration combinations and return an honest unavailable reason otherwise.
- [ ] Add opt-in native LSP tool support and show whether a usable language server is configured; permit non-mutating LSP use in inspection assignments.
- [ ] Keep native task from becoming a second dispatch path. Hide it from Freelancer executions when practical or return one accurate correction to delegate.
- [ ] Keep compaction/title/summary lifecycle agents native and internal rather than recreating them as personas.
- [ ] Preserve native MCP, custom tools/plugins, project/global skills, references, snapshots, compaction, and sessions; integrate their state rather than cloning them.
- [ ] Treat custom/slash commands as optional explicit invocation, never as a permission/workflow gate.
- [ ] Defer experimental code-mode/execute until connected-tool volume demonstrates a concrete need.

## Part 3 — Shared high-value skills

- [ ] Add debug: reproduce/establish failure, trace, state a specific hypothesis, test it, make the smallest coherent fix, and rerun the original reproduction.
- [ ] Add verify: choose appropriate checks, run them, retain evidence, and classify each as passed, failed, skipped/not-run, unavailable, or unverified.
- [ ] Add browser-verify: use one approved browser integration, exercise affected routes/interactions, inspect state/console, capture evidence, and classify each route Pass, Fail, or Skip with reason.
- [ ] Add review: report-only independent review when useful; focus on correctness, regressions, security/data boundaries, tests, and user-visible behavior.
- [ ] Add handoff: durable recovery checkpoint with objective, state, checks, decisions, remaining work, risks, and exact next action; do not auto-commit/stash.
- [ ] Keep and repair reorient, search-index, model-routing, and record-outcome; consolidate repeated policy prose.
- [ ] Keep bake-off, simplification, polish/dogfood, durable lessons, and execution audit optional and task-triggered if added later.

## Part 4 — Capability discovery, provenance, and diagnostics

- [ ] Add a read-only effective-capabilities view for project/session/agent/model covering native tools, Freelancer tools, skills, MCP, references, experimental capabilities, and origin.
- [ ] For each capability show discovered/configured state, model exposure, native permission when available, dependency state, and a clear unavailable reason.
- [ ] Detect stale manifest entries, duplicate skill names, missing dependencies, invalid examples, and unresolved capability references.
- [ ] Expose a compact capability inventory to the model without making discovery a prerequisite for ordinary work.
- [ ] Keep sensitive MCP/integration enable/disable/remove actions under explicit user control while allowing broad read-only inspection.
- [ ] Prove with tests that changing the named agent does not silently remove capabilities absent an explicit native/user rule.

## Part 5 — Worker lifecycle

- [ ] Add scoped worker cancellation to delegate with verified stop, durable final state, and preserved partial output.
- [ ] Add/design a fresh-context fork distinct from same-worker continuation; selected prior evidence may be carried, but a new child identity is explicit.
- [ ] Annotate worker results when project state/context may be stale or conflicting; do not discard useful findings solely for age.
- [ ] Optionally support bounded adviser/reviewer work that helps an existing worker without replacing the parent or silently changing models.
- [ ] Keep one compact delegate surface rather than adding separate start/status/read/list/resume tools.

## Part 6 — Browser and external toolkit integration

- [ ] Select one browser-control path for model-driven UI verification; do not install competing browser stacks.
- [ ] Wire browser control to browser-verify and capability diagnostics; degrade honestly when absent.
- [ ] Expose native MCP connection/status/tool inventory in Freelancer, including disabled, failed, and authentication-required states.
- [ ] Borrow Patchbay capability-state clarity, not a second gateway unless independently justified.
- [ ] Borrow Agent Deck skill provenance/inventory, not a second loader or skill-based permission system.
- [ ] Validate required tools/integrations/executables/language servers/MCP dependencies before presenting an external skill as usable.

## Part 7 — Instruction architecture

- [ ] Document every AI-facing instruction source: OpenCode provider prompt, project/global instructions, Freelancer workstyle/global text, execution contract, persona, strategy/delegation guidance, Git agreement, skills, MCP instructions, worker-result contract, sender handoff, imported-history orientation, and configuration prompts.
- [ ] Reduce duplicated policy text. Keep each rule in the narrowest authoritative layer.
- [ ] Persona changes perspective and work quality, not tool visibility or permission.
- [ ] Skills teach procedure/fallback, not authority; remove wording that implies they grant writes, paid access, publication, or integration enablement.
- [ ] Tool descriptions and runtime errors must use exact public schemas and valid next calls; contract tests fail on nonexistent arguments or retired names.
- [ ] Add an effective-instructions diagnostic view showing active composition and origin without creating a second editable master prompt.

## Part 8 — Verification and measurement

- [ ] Build a capability-matrix test across Engineer, Researcher, Designer, and at least one custom named agent.
- [ ] Add inference-backed acceptance tests with representative free models; measure first-valid-tool-call rate, unnecessary retries, unavailable-tool recovery, and constraint adherence.
- [ ] Test question, delegate, Git exception approval, inspection-only behavior, LSP, websearch, skill loading, MCP discovery, browser verification, cancellation, continuation/fork, and verification-state reporting.
- [ ] Test compaction/reconnect/restart recovery without duplicate execution.
- [ ] Measure false completion claims separately from successful tool execution.
- [ ] Run focused checks during development and the repository’s full required suite before Goal completion; distinguish fixture, smoke, runtime, provider, and visual evidence.

## Explicit non-goals

- No workflow catalog that gates tools or agents; no helper/general-worker resurrection or mandatory team topology.
- No second skill loader, MCP gateway, session engine, or Git implementation without a demonstrated native limitation.
- No persona-specific tool allowlists as product behavior.
- No silent paid use, parent-model switching, publication, merge, release, deployment, destructive migration, credential access, or integration enablement.
- No claim of parity based only on registration; effective capability must be verified.

## Definition of done

- [ ] Every companion requirement is satisfied with evidence or explicitly dispositioned with a documented accepted reason.
- [ ] Engineer, Researcher, Designer, and a custom agent receive the same intended shared toolkit subject only to genuine native/user boundaries.
- [ ] Question, search/retrieval, LSP where enabled, MCP discovery, shared skills, managed Git, delegation, cancellation, and verification use valid public contracts.
- [ ] No stale skill/agent/tool names remain in active instructions or corrective errors.
- [ ] No new persona/workflow visibility rules were added merely to make models behave.
- [ ] Focused tests and the full repository-required validation pass, with runtime/provider/browser limitations reported separately.
- [ ] Documentation explains the effective capability model and how to diagnose missing capability.
