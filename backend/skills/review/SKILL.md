---
name: review
description: Critique a bounded change or proposal and return grounded findings without applying fixes.
---

# Review

Use this for an explicit review or when an independent critique materially helps
with a consequential change. Return findings; an inspection-only assignment
stays read-only. The parent may integrate fixes within an already authorized
implementation request without asking for the same authorization again.

1. Establish scope, acceptance criteria and relevant source state. Inspect the
   actual change and its surrounding behavior rather than relying on a summary.
2. Look for correctness defects, regressions, data/security boundary violations,
   missing checks and user-visible failures. Prioritize concrete impact.
3. For each actionable finding, report location, severity, triggering condition,
   consequence and supporting evidence. Label unverified suspicions and missing
   coverage; avoid speculative issues without a plausible failure path.
4. Summarize reviewed scope and remaining gaps. No findings means no grounded
   issue was found within that scope, not universal correctness.

## Independent view

When useful and permitted, assign a named agent through
`delegate({agent, task, inspectionOnly: true, independentReview: true})` with a
bounded question, relevant files and acceptance criteria. `delegate-work` covers
dispatch and worker recovery. Parent self-review is not independent, and a
finished reviewer does not prove the findings correct; integrate them against
the source and `verify` important claims.

Use `web-research` for uncertain API expectations and `playwright` for a
suspected rendered regression. `bounded-judgment` can help prioritize an already
grounded finding set; it supplies advisory judgments, never defect proof or
permission to publish. If another reviewer or service is unavailable, perform
the permitted direct review and clearly report the limitation.
