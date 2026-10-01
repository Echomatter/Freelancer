# Goal lifecycle and delivery contracts

[User guide](goals.md) · [Architecture](ARCHITECTURE.md) · [Testing](testing.md)

`server/goals.mjs` owns durable scheduling; OpenCode owns sessions, model responses,
tools, native todos, permissions and worker execution. The Goals document in
`backend/.state/webpage/records.sqlite` stores the goal, linked session, objective revisions,
captured settings, stable run/root request, checkpoint, failure count and events.
Accepted conversation history stays native. Archive annotations use the existing
per-user organization store.

Creation claims its client id before creating a native session. Duplicate calls
return the same record; interrupted creation remains uncertain. The one-active-goal
check and lifecycle mutations are serialized. A goal checkpoint requires the
private native bridge and a verified native parent assistant linked through an
application receipt to the current goal/run/objective revision. Prompt text and
model-supplied identity cannot establish that authority.

The shared execution contract and `pursue-goal` skill orient, work, verify/reconcile,
then propose continue, wait, pause or complete. The controller waits for raw native
activity and descendants, checks native tasks and evidence, and schedules one compact
continuation. Responses without a checkpoint pause. Three repeated checkpoints
without changed native work/tasks pause. Failure counts and worker ownership survive
request changes and free-model replacement. They are not completion percentages.
For a native free-tier retry, the controller aborts only the limited parent turn,
verifies native idle and its submitted delivery, then chooses another eligible
free model. It preserves queued input and descendants; an unconfirmed abort
pauses for inspection instead of overlapping inference.

Automatic outbox entries are checked against the current durable goal before
dispatch. Explicit queued input wins over a waiting automatic continuation. Stop
persists inhibition before aborting the parent and descendants, rescans for late
workers, and verifies idle status. The runtime tool guard prevents stopped goal
assignments from starting subsequent tools. Restart pauses scheduling and inhibits
waiting automatic entries; it never turns an ambiguous send into a retry.

Delegate and Steer share the durable non-aborting outbox. Their instructions differ:
Delegate asks the parent for a bounded worker; Steer asks it to incorporate the
correction. Both retain captured parent choices and constraints. Queue retains its
own FIFO model choices. Only waiting items are editable, under an edit revision;
sent/uncertain items cannot be rewritten or replayed through Edit.

The native `delegate` tool also accepts `delivery: "steer" | "queue"` with an
existing worker and task. A private bridge verifies native parent/child ownership
and builds the worker's captured execution from durable receipts. This uses the
same sender, with the worker's original root identity, model, reasoning, read-only
and free-only boundaries. Native paid consent happens before admission. Current
restrictions can tighten the saved budget. Plugin dispatch and sender admission
share durable per-root slot reservations under a short admission lock. The lock
is released before native creation or inference, preserving parallel execution;
the reservation covers creation and acknowledgement gaps across both senders.
Goal reconciliation includes pending worker deliveries, and Stop cancels them.

Saved transport intent, native admission, model-input inclusion and observed action
are different facts. The native messages transform records input ids. Inclusion
requires that observation plus a native response/step; HTTP acceptance alone is
insufficient. A correlated successful delegate result records the worker action.
Steer is not marked acted-on based merely on model prose. Input records remain
inspectable even when no applied-action claim can be made.

An idle, confirmed unprocessed handoff can receive one compact same-session recovery
message referencing the existing handoff, without repeating its original task.
Missing input evidence, ambiguous transport or failed recovery requires inspection.
Old Interrupt outbox entries are retained as uncertain rather than reinterpreted.

`scripts/probe-native-handoff.mjs` uses the installed CLI with isolated native data
and a deterministic local provider. It exercises inference input, executing tools,
pending permission, rapid steers, turn completion, compaction and a simulated lost
client acknowledgement. Its model-input capture can be compared with provider
requests in `artifacts/verification/native-handoff.json`. These are runner probes,
not proof of authenticated external-provider behavior. Production HTTP/browser
fixtures cover idempotency, lost acknowledgement, queue priority, lifecycle and UI.
