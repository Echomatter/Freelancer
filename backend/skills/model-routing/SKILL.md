---
name: model-routing
description: Model routing, evidence and recovery guidance for bounded workers.
---

# Model routing

This skill teaches procedure and fallbacks only. It grants no write, paid-model, publication, or integration authority. Native permissions, paid consent, user constraints, project agreement, and worker limits remain authoritative. Delegation is optional and never required by this skill.

Use `delegate({agent, task, model?})` with expertise from the supplied catalog. `delegate()` with no arguments returns the current agent IDs and `budget.modelPool`; use those exact IDs instead of guessing aliases. Omit model for automatic eligible routing; use `freeOnly:true` when free capacity is required. Preserve explicitly requested provider/model choices. Free workers start in one call.

Use `freeOnly`, `inspectionOnly` or `independentReview` for real assignment constraints. These never grant authority. Native permission, paid consent, user constraints, project agreement and worker limits remain authoritative.

Follow up with `delegate({worker: childSessionID, task})` to keep the same specialist and context. Inspect uncertain delivery or stop before continuing overlapping work. Results label structured completion, fallback or partial output. Completion is not proof of correctness; validate the result. Three equivalent tool failures require diagnosis.

The backend owns eligibility, quota refresh, capability evidence, context, cost preference and exclusions. Unknown evidence is not proven capability. Missing quota is not unlimited capacity. Never replace the parent or use separately metered fallback. Native paid_delegate handles subscription consent without a duplicate choice menu.


Shared `knowledge` results can supply dated prior task evidence or source-backed
capability context. Verify model/provider identity and source revision against
current routing evidence before making a current recommendation. A memory,
claim or judgment cannot change eligibility, quota, permission, paid consent or
the selected-model receipt.
