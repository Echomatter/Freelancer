---
name: model-routing
description: Model routing, evidence and recovery guidance for bounded workers.
---

# Model routing

Use `delegate({agent, task, workflow?, model?})` with expertise from the supplied catalog. Omit model for automatic eligible routing; preserve explicitly requested provider/model choices. Free workers start in one call. Catalog discovery is optional.

Use `freeOnly`, `inspectionOnly` or `independentReview` for real assignment constraints. These never grant authority. Native permission, paid consent, user constraints, project agreement and worker limits remain authoritative.

Follow up with `delegate({worker: childSessionID, task})` to keep the same specialist and context. Inspect uncertain delivery or stop before continuing overlapping work. Results label structured completion, fallback or partial output. Completion is not proof of correctness; validate the result. Three equivalent tool failures require diagnosis.

The backend owns eligibility, quota refresh, capability evidence, context, cost preference and exclusions. Unknown evidence is not proven capability. Missing quota is not unlimited capacity. Never replace the parent or use separately metered fallback. Native paid_delegate handles subscription consent without a duplicate choice menu.

For a requested recommendation or routing investigation, `scripts/select-model.ps1 -WorkMode build -HostAssessment true` exposes candidate evidence. It is not an ordinary delegation preflight. See [evidence refresh](evidence-refresh.md). Never edit evidence to force a route.
