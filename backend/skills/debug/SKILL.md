---
name: debug
description: Reproduce a failure, trace it, test one hypothesis, apply the smallest fix, and rerun the reproduction.
---

# Debug

This skill teaches procedure and fallbacks only. It grants no write,
paid-model, publication, or integration authority. Native permissions, paid
consent, user constraints, and the saved Git agreement remain authoritative.
Delegation is optional and never required by this skill.

## Procedure

1. Reproduce or establish the failure with the smallest concrete trigger
   (command, test, route, or input). Record the exact command and observed
   output.
2. Trace from the symptom to the narrowest suspect area with direct reads
   (read/grep/glob) before changing anything.
3. State one specific, falsifiable hypothesis.
4. Test the hypothesis with the smallest probe (focused test, log, or
   isolated run). Do not bundle unrelated changes.
5. Make the smallest coherent fix that addresses the confirmed cause.
6. Rerun the original reproduction and the nearest regression scope.
   Classify each check as passed, failed, skipped/not-run, unavailable, or
   unverified; never encode not-run as failed.

## Capability-use hints

Normal debugging is sufficient for straightforward failures. Consider Sequential
Thinking when plausible causes multiply, observations contradict a hypothesis or
a causal chain is hard to maintain. Context7 can help when current/version-specific
framework, library, SDK or API behavior matters; Fetch can retrieve an original
primary source or an external integration's response when appropriate. For a
user-facing defect, prefer Playwright when useful to observe the actual failure.
After collecting evidence, JEV may compare a few explicit competing hypotheses;
its ranking is advice, so test the cause. Observation, hypothesis exploration,
documentation, comparison and testing can complement one another without becoming
required stages. If an auxiliary service fails, continue normal debugging and
report the remaining evidence gap.

## Delegation (optional)

Work directly by default. When a separate specialist materially helps, use
`delegate({agent, task})` with a named agent from the supplied catalog and a
bounded task. Use `delegate({agent, task, inspectionOnly: true})` for
read-only tracing and `delegate({agent, task, independentReview: true})` for
   an optional report-only second look. Use only the public
   `delegate({agent, task, model, freeOnly, inspectionOnly, independentReview,
   worker, fork, cancel, delivery, workers, from, limit})` schema.

## Required capabilities and fallbacks

- Required: file read/search and a runnable check (focused test or repro
  command).
- Fallback: if the runner, file, or environment is unavailable, record what
  was not run, why, and the exact next action; do not claim a fix is
  verified. Optional extras (bake-off, simplification, polish, durable
  lessons, execution audit) are task-triggered only.
