---
name: record-outcome
description: Record or correct a task observation from real execution receipts and explicit validation results.
---

# Record outcome

Use this after establishing a task result, or to correct its existing observation.
Do not rerun work merely to record it. Execution completion and task correctness
are separate facts; `verify` establishes the latter.

1. Read the actual execution receipt, observed model, task identity and validation
   evidence. Missing identity or uncertain execution remains unknown; leave
   correctness pending when its evidence cannot establish a result.
2. Read [the recording contract](recording-contract.md) before invoking the
   recorder under `FREELANCER_RUNTIME_ROOT` (the app's `backend/` directory).
   Supply explicit `-Success` and `-VerificationStatus`; preserve failed, skipped,
   cancelled, unavailable and unverified evidence rather than promoting it to pass.
3. Update the same `TaskId` for corrections. Attach review defects to the original
   attempt and link related work using receipt identities; never invent a new
   success to conceal failure.
4. Read the persisted observation before claiming it was recorded. Keep usage,
   subscription availability and measured performance distinct.

Provider, authentication, quota, binding and deployment failures are operational
observations, not coding-quality verdicts. Matching native receipts and the local
outcome ledger supply execution evidence; `knowledge`, remembered lessons and
Jev judgments cannot replace them or create a second statistics ledger.
