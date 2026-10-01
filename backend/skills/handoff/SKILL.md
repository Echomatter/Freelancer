---
name: handoff
description: Write a durable recovery checkpoint with objective, state, checks, decisions, remaining work, risks, and exact next action.
---

# Handoff

This skill teaches procedure and fallbacks only. It grants no write,
paid-model, publication, or integration authority. Native permissions, paid
consent, user constraints, and the saved Git agreement remain authoritative.
A handoff never auto-commits, stashes, publishes, or starts new work. Delegation is optional and never required by this skill.

## Procedure

Record a compact checkpoint containing:

1. Objective and current interpretation.
2. State: what changed, which files matter, and links to receipts or worker
   task IDs (use the receipt's `task_id` / `user_task_id` values; do not
   invent IDs).
3. Checks: verification evidence classified as passed, failed,
   skipped/not-run, unavailable, or unverified.
4. Decisions and constraints that future work must preserve.
5. Remaining work, risks, and the exact next action (one concrete command or
   assignment).

Keep it short enough to resume from; omit full logs and keep pointers to
evidence instead.

## Required capabilities and fallbacks

- Required: read access to current state (todos, receipts, changed files).
- Fallback: if state is partially unavailable (missing receipt, uncertain
  worker delivery), mark the gap explicitly, preserve partial output, and
  state the recovery probe. Never discard useful findings solely for age and
  never claim completion from an unfinished handoff.
