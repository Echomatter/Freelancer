---
name: pursue-goal
description: Continue a saved Freelancer goal in its persistent conversation and report evidence-based lifecycle checkpoints.
---

# Pursue goal

Use this inside an application-owned saved goal, including Resume, compaction
recovery or model replacement. Ordinary chats do not call `goal_checkpoint`.

## Recover and work

Read the current objective revision, interpretation, decisions, latest checkpoint,
native todos and outstanding workers. Preserve captured constraints and user
steering; internal goal activity continues the same assignment. Work from current
source and native receipts, retaining exact historical evidence where useful.

Perform useful work, `verify` the relevant results and reconcile the native plan.
The parent accepts worker output; workers retain their assignments. Use
`delegate-work` to rediscover, inspect and continue workers rather than duplicate
them. Reconcile routine stale statuses yourself. A verified stopped worker can
receive a fresh bounded follow-up in its existing chat; uncertain input is never
replayed. Native questions resolve missing user decisions; tool permission and
paid consent use their own native flows. Follow `git_project`'s returned
questions unchanged for an explicit agreement exception.

## Checkpoint

At meaningful progress, before ending a turn, or when context needs compaction,
report `goal_checkpoint` with `interpretation`, concrete `checkpoint`, specific
`reason`, `evidence` and an `outcome`:

| Outcome | Use when |
| --- | --- |
| `continue` | Useful work remains that the parent can perform |
| `waiting` | The next step depends on a worker, answer or capacity |
| `pause` | Inspection or explicit Resume is needed under the goal contract |
| `complete` | The interpreted objective and required checks are satisfied, with the native plan reconciled |

Independent workers may keep running while the parent checkpoints. A response
ending is not completion. Preserve partial work, unresolved evidence and specific
next actions; `handoff` provides the compact recovery shape.

The server owns continuation, recovery and free-model replacement. Do not create
a retry scheduler, switch the executor or auto-resume explicit Stop. A goal
provides no extra permissions or filesystem isolation. `reason-through`,
`bounded-judgment` and `remember` are optional aids when the task needs them,
never checkpoint stages or prerequisites.
