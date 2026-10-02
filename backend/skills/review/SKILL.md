---
name: review
description: Report-only independent review focused on correctness, regressions, security and data boundaries, tests, and user-visible behavior.
---

# Review

This skill teaches procedure and fallbacks only. It grants no write,
paid-model, publication, or integration authority. Native permissions, paid
consent, user constraints, and the saved Git agreement remain authoritative.
A review never approves publication and never mandates delegation.

## Procedure

1. Request or perform review only when it is useful (risky change, unclear
   correctness, or an explicit user request). Reviews are report-only: list
   findings, file locations, and severity without applying fixes.
2. Focus on correctness, regressions, security/data boundaries, tests, and
   user-visible behavior. Distinguish measured findings from unverified
   suspicions.
3. For an independent model view, use
   `delegate({agent, task, independentReview: true})` with a named agent
   from the supplied catalog and a bounded review task. The public schema is
    `delegate({agent, task, model, freeOnly, inspectionOnly,
    independentReview, worker, fork, cancel, delivery, workers, from, limit})`.
4. The parent integrates review output against repository evidence and
   acceptance criteria. Review completion is not proof of correctness.

## Capability-use hints

After collecting source and evidence, consider JEV for bounded triage: blocker /
significant / minor / uncertain, likely regression, requirement violation versus
not established, or which finding to investigate first. Its classification is
not proof; the reviewer remains responsible for grounded findings and locations.
Context7 can clarify current expected library/API behavior, while Playwright can
check a suspected user-visible regression. If unavailable, review directly with
the evidence at hand and report gaps; no auxiliary service is a review gate.

## Required capabilities and fallbacks

- Required: read access to the changed files and any cited evidence.
- Fallback: if no independent reviewer is available or eligible, report the
  review as skipped/unavailable with the reason and continue with direct
  verification. Do not present parent self-review as independent. Optional
  extras (bake-off, simplification, polish, durable lessons, execution
  audit) are task-triggered only.
