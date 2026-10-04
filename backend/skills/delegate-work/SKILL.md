---
name: delegate-work
description: Assign or recover bounded named-agent work using eligible models, current receipts and native consent.
---

# Delegate work

Use this when delegating, recovering a worker or investigating model fit. The
runtime owns eligibility, quota, exclusions and routing; advice cannot change
them. Keep the parent model and explicit user model choices intact.

## Assign

- Use a named `agent` from the supplied catalog and a bounded `task`: objective,
  relevant context, constraints, owned files and acceptance criteria. Give
  concurrent writers disjoint areas.
- `delegate()` discovers current agent IDs and eligible `budget.modelPool` when
  needed. `delegate({agent, task})` routes and dispatches together; it needs no
  separate selector preflight.
- Omit `model` for automatic eligible routing. An explicit model is an exact
  provider/model ID from that pool. Use `freeOnly:true` for a real free-capacity
  requirement, `inspectionOnly:true` for no source edits, and
  `independentReview:true` for independent critique.
- Paid routes use native `paid_delegate` consent. Unknown capability is unknown;
  missing quota is not unlimited capacity. Honor denials without another route.
  Do not use a separately metered fallback.

## Recover

`delegate({workers: true})` rediscovers this parent's assignments;
`delegate({worker: childSessionID})` reads current native transcript and status.
Continue an idle worker with `worker` and `task` to retain its agent/model/context.
Use the tool's published Steer, Queue, Fork and Cancel fields for those distinct
actions. Inspect uncertain stop or delivery before overlapping work; never replay
uncertain input. Preserve partial results and attempt history. Three equivalent
tool failures require diagnosis, not another unchanged retry.
Structured completion, fallback and partial output describe the report received,
not verified correctness.

## Judge fit

Prefer relevant recorded outcomes and exact current source facts. `model_catalog`
reads stored model observations; `bounded-judgment` can compare eligible choices
when actual evidence leaves a meaningful ambiguity. Neither supplies entitlement,
paid consent or verified task success. Use `verify` to accept worker output and
`record-outcome` to record the observed result.

For requested routing-cache maintenance or selector diagnostics, read
[evidence refresh](evidence-refresh.md). That internal path is separate from
ordinary delegation and from refreshing published `model_catalog` sources.
