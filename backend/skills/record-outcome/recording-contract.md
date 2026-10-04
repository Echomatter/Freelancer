# Outcome recording contract

Read this before recording or correcting an observation. The implementation is
`scripts/record-task-outcome.ps1` under `FREELANCER_RUNTIME_ROOT`; it is not a
project-relative script. The environment variable points at Freelancer's
`backend/` directory.

## Record explicit results

Use real receipt identities and observed values. After task success and its checks
have actually been established:

```powershell
$runtimeRoot = $env:FREELANCER_RUNTIME_ROOT
& "$runtimeRoot/scripts/record-task-outcome.ps1" -TaskId $taskId -Model $actualModel -Repo $repo -TaskType 'bounded_feature' -Success true -VerificationStatus passed
```

The parameters are `-Model`, `-TaskType`, `-Success` and
`-VerificationStatus`; there is no `-ActualModel`, `-TaskTypes` or `-Observed`.
With PowerShell `-File`, pass task types as one comma-separated string. Prose
about checks does not set their result values.

| VerificationStatus | Meaning |
| --- | --- |
| `passed` | The applicable checks ran and passed |
| `failed` | A check ran and failed |
| `skipped` | A known check was deliberately skipped |
| `unavailable` | A required dependency, device, credential or runner prevented it |
| `not-run` | Checks were not executed |
| `unverified` | Available evidence does not establish the result |

Nonexecuted or unknown states store `tests_passed: null`. Legacy `-TestsPassed`
accepts an explicit boolean; false means an actual failed check. Contradictory
boolean/state values and unknown boolean strings are rejected. Operational
execution failures default to `not-run` and do not imply failed tests.

## Identity, corrections and reviews

The recorder reads the matching runtime receipt, checks selected versus observed
model and imports child-specific usage. A correction updates one observation for
the same `TaskId`, retaining changed validation values in revisions.

- `-UserTaskId`: group related work using the receipt's `user_task_id`, or
  `parent_session` fallback. This field belongs to the recorder, not `delegate`.
- `-TaskId <id> -MarkReviewDefect`: attach a later defect to the original attempt.
- `-ReviewTaskId`: link the defect report to its reviewing observation.

Actual observations use the runtime's local `.state/task-history.json` state
record, never the public seed. Failed execution is recorded automatically as
operational evidence with actual usage when available; do not mark it successful.
Read back the persisted observation before reporting success.

## Consumption and audits

Usage belongs to the listed child session. Earlier failed-attempt usage remains
in `execution_attempts` and is not reassigned to the successful model. Preserve
attempt history, retries and paid escalation. Do not sum overlapping parent/child
cost records twice.

Inspect native parent/child sessions and matching durable receipts for an
orchestration audit. Legacy all-session CLI counters remain estimates because
concurrency and rounding cannot establish exact task consumption. Without a
comparable parent-only baseline, do not claim measured savings. Share of work,
recorded usage, subscription allocation and cash charges are different measures.
Do not invent model self-identification, zero balances or subscription-dollar
savings, or create another usage ledger.
