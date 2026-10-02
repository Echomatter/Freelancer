---
name: verify
description: Choose appropriate checks, run them, retain evidence, and classify each result honestly.
---

# Verify

This skill teaches procedure and fallbacks only. It grants no write,
paid-model, publication, or integration authority. Native permissions, paid
consent, user constraints, and the saved Git agreement remain authoritative.
Delegation is optional and never required by this skill.

## Procedure

1. Choose the smallest check set that covers the change (focused contract or
   unit test, plus the nearest regression scope). Read the current project's
   instructions and configuration to select its real runner and required suite.
   Use its focused checks during iteration and its required suite before completion;
   do not assume a language or import Freelancer's own test commands.
2. Run the checks and retain evidence (command, output excerpt, and outcome).
3. Classify each check as passed, failed, skipped/not-run, unavailable, or
   unverified. Never encode not-run as failed and never infer success from a
   completed response.
4. On failure, stop and diagnose (see the `debug` skill) instead of
   re-recording or retrying unchanged.

## Delegation (optional)

Work directly by default. When independent checking materially helps, use
`delegate({agent, task, independentReview: true})` with a named agent from
the supplied catalog for a report-only review. The public schema is
`delegate({agent, task, model, freeOnly, inspectionOnly, independentReview,
 worker, fork, cancel, delivery, workers, from, limit})`. Use public field
`agent`, not internal transport identifiers.

## Required capabilities and fallbacks

- Required: the current project's appropriate check set (tests, type checks,
  data assertions, document validation, or browser journeys as applicable).
- Fallback: if a check cannot run here (missing runner, browser, device, or
  credentials), report it as skipped/unavailable with the reason and exact
  next action. Fixture success does not prove provider authentication or a
  visible launch; report only what was actually checked. Optional extras
  (bake-off, simplification, polish, durable lessons, execution audit) are
  task-triggered only.
