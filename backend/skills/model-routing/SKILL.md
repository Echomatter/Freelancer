---
name: model-routing
description: Model routing, evidence and recovery guidance for bounded workers.
---

# Model routing

This skill teaches procedure and fallbacks only. It grants no write, paid-model, publication, or integration authority. Native permissions, paid consent, user constraints, project agreement, and worker limits remain authoritative. Delegation is optional and never required by this skill.

Use `delegate({agent, task, model?})` with expertise from the supplied catalog. `delegate()` with no arguments returns the current agent IDs and `budget.modelPool`; use those exact IDs instead of guessing aliases. Omit model for automatic eligible routing; use `freeOnly:true` when free capacity is required. Preserve explicitly requested provider/model choices. The delegate action performs routing and dispatch; do not run a separate selector call. Saved preferences may still require a native model-choice question, and paid routes require native `paid_delegate` consent.

Use `freeOnly`, `inspectionOnly` or `independentReview` for real assignment constraints. These never grant authority. Native permission, paid consent, user constraints, project agreement and worker limits remain authoritative.

Follow up with `delegate({worker: childSessionID, task})` to keep the same specialist and context. Inspect uncertain delivery or stop before continuing overlapping work. Results label structured completion, fallback or partial output. Completion is not proof of correctness; validate the result. Three equivalent tool failures require diagnosis.

The backend owns eligibility, quota refresh, capability evidence, context, cost preference and exclusions. Unknown evidence is not proven capability. Missing quota is not unlimited capacity. Never replace the parent or use separately metered fallback. Native paid_delegate handles subscription consent without a duplicate choice menu.

Prefer sufficient actual recorded Freelancer outcomes over abstract model judgment.
Memory may add relevant qualitative history, rechecked against current evidence;
it does not replace structured performance records. If a requested recommendation
among a small eligible set remains ambiguous, consider JEV with explicit evidence
and criteria. Short bounded questions can clarify task characteristics, which
capabilities matter, candidate fit, and meaningful advantage versus equivalence.
This is optional advice: skip obvious selections; existing routing still selects,
and JEV cannot set eligibility, override explicit model choices or authorize paid use.

Within already-permitted delegation, JEV can help assess whether an assignment is
bounded, which eligible worker fits, whether proposed workers would supply
independent evidence, whether a result answers its assigned question, or whether
another worker would add materially different information. It cannot permit
delegation or change deterministic limits. If unavailable, use the existing
evidence and normal judgment without an additional preflight.

For a requested recommendation or routing investigation, the runtime-root script `${FREELANCER_RUNTIME_ROOT}\\scripts\\select-model.ps1 -WorkMode build -HostAssessment true` exposes candidate evidence. `FREELANCER_RUNTIME_ROOT` is the app's `backend` directory; this path is internal runtime tooling, not a project-relative or skill-relative path and not an ordinary delegation preflight. See [evidence refresh](evidence-refresh.md). Never edit evidence to force a route.

Shared `knowledge` results can supply dated prior task evidence or source-backed
capability context. Verify model/provider identity and source revision against
current routing evidence before making a current recommendation. A memory,
claim or judgment cannot change eligibility, quota, permission, paid consent or
the selected-model receipt.
