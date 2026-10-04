---
name: handoff
description: Preserve a compact recovery checkpoint when work pauses, changes hands or needs conversation compaction.
---

# Handoff

Leave enough current evidence for the next turn or worker to continue without
repeating completed work. A handoff records state; it never starts work, replays
input or performs Git actions.

## Checkpoint

- **Objective:** the user's goal, current interpretation and preserved exclusions.
- **State:** completed changes, relevant files, native todos and outstanding workers.
  Use actual receipt `task_id` / `user_task_id` and child session IDs.
- **Evidence:** checks performed and their outcomes; link exact source revisions,
  receipts or logs rather than copying full transcripts.
- **Decisions:** accepted choices, rejected approaches and constraints that matter
  to the remaining work.
- **Next:** remaining work, unresolved risks and one concrete next action.

Label checks passed, failed, skipped, not-run, unavailable or unverified. Keep
historical findings useful but distinguish them from current source or execution
state. If a receipt, source or worker status is missing, retain partial findings
and name the smallest recovery probe; never replay uncertain delivery.

## Related work

Use `reorient` to recover the next working context, `delegate-work` to inspect or
continue workers, and `verify` to establish claims. A saved Freelancer goal uses
`pursue-goal` and its native `goal_checkpoint` instead of another goal store.
Use `remember` only for selectively retained durable knowledge; routine progress
and temporary worker state belong in this checkpoint.
