---
name: record-outcome
description: Record or correct validated task results using actual execution receipts. Link reviews and consumption once; distinguish measured, estimated and unknown.
---

# Record Outcome

Do not infer successful implementation from a completed model response. Validate the requested behavior first. Do not rerun the task merely to record it.

Resolve the runtime root from `FREELANCER_RUNTIME_ROOT` (the app's `backend/` directory). Call `scripts/record-task-outcome.ps1` there with the real task ID returned by `delegate`, actual model, repo, task types and observed test/result values. Pass task types as one comma-separated string when using PowerShell `-File`.

Use the exact parameter names `-Model`, `-TaskType`, `-Success` and
`-TestsPassed`. The script has no `-ActualModel`, `-TaskTypes` or `-Observed`
parameter. Explicitly pass the two result values; prose describing passed tests
does not set them. For example, after independently verifying success and tests:

```powershell
& "$root/scripts/record-task-outcome.ps1" -TaskId $taskId -Model $actualModel -Repo $repo -TaskType 'bounded_feature' -Success true -TestsPassed true
```

If no tests ran, pass `-TestsPassed false` even when the other acceptance checks
succeeded. Read the returned/persisted observation before claiming it was recorded.

The recorder reads a matching runtime receipt, checks selected versus observed model, and imports child-specific usage. Same task ID updates one observation. A later review defect uses `-TaskId <id> -MarkReviewDefect` and remains attached to the original attempt. Do not create a new success to hide it.

Use `-UserTaskId` (and `delegate.userTaskId`) to group related child/fallback work under one user task. Each receipt retains its execution attempts; correcting a TaskId updates that observation and retains changed validation values in revisions. `-ReviewTaskId` links a defect report to the reviewing observation. Receipt usage belongs to the listed child session; earlier failed-attempt usage stays in execution_attempts and is not charged to the successful model.

Parent/child costs are related, not separate charges to sum twice. A fallback leaves an honest attempt history. Legacy all-session CLI measurements remain estimates because same-model concurrency and rounded counters cannot establish exact task consumption.

For an orchestration audit, inspect the actual parent/child native sessions and
matching durable delegation receipts. Do not launch an old export-summary script
or make a second usage ledger. Share of work and recorded usage remain separate
from subscription availability. Without a comparable parent-only baseline, do
not claim measured savings. Investigation is not implementation; retries and
paid escalation remain distinct observations.

Binding, provider, quota and deployment failures are operational observations, not poor coding performance by the intended model. No fabricated model self-identification, measured zero balances, or subscription-dollar savings. Explicitly inspection-only assignments return findings for authorized recording; a Review workflow alone is not a write restriction.

Actual observations are stored locally in `.state/task-history.json`, never in the public seed. Failed execution is recorded automatically as operational evidence with its actual usage when available; do not mark it successful or treat it as a capability verdict. Correctness still requires explicit validation.
