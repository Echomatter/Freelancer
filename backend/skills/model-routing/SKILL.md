---
name: model-routing
description: Model routing, evidence and recovery guidance for bounded workers.
---

# Model routing

Use `delegate({agent, task, model?})` with expertise from the supplied catalog. `delegate()` with no arguments returns the current agent IDs and `budget.modelPool`; use those exact IDs instead of guessing aliases. Omit model for automatic eligible routing; use `freeOnly:true` when free capacity is required. Preserve explicitly requested provider/model choices. Free workers start in one call.

Use `freeOnly`, `inspectionOnly` or `independentReview` for real assignment constraints. These never grant authority. Native permission, paid consent, user constraints, project agreement and worker limits remain authoritative.

Follow up with `delegate({worker: childSessionID, task})` to keep the same specialist and context. Inspect uncertain delivery or stop before continuing overlapping work. Results label structured completion, fallback or partial output. Completion is not proof of correctness; validate the result. Three equivalent tool failures require diagnosis.

The backend owns eligibility, quota refresh, capability evidence, context, cost preference and exclusions. Unknown evidence is not proven capability. Missing quota is not unlimited capacity. Never replace the parent or use separately metered fallback. Native paid_delegate handles subscription consent without a duplicate choice menu.

For a requested recommendation or routing investigation, the runtime-root script `${FREELANCER_RUNTIME_ROOT}\\scripts\\select-model.ps1 -WorkMode build -HostAssessment true` exposes candidate evidence. `FREELANCER_RUNTIME_ROOT` is the app's `backend` directory; this path is internal runtime tooling, not a project-relative or skill-relative path and not an ordinary delegation preflight. See [evidence refresh](evidence-refresh.md). Never edit evidence to force a route.
