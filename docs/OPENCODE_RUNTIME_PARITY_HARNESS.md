# OpenCode Runtime Parity Harness

## Purpose

The existing external OpenCode integration is not only legacy code; it is the **behavioral oracle** for runtime fusion.

Before replacing a runtime boundary, Freelancer should run the current external runtime and the candidate owned runtime against equivalent bounded scenarios and compare observable behavior.

The target is not byte-for-byte identity. IDs, timestamps, provider-specific noise and internal ordering may legitimately differ. The target is preservation of the behavior Freelancer relies on, with intentional differences explicitly recorded.

## Harness shape

Conceptually:

```text
Scenario
  ├── Baseline adapter → installed/current OpenCode runtime
  └── Candidate adapter → vendored/owned Freelancer Runtime

Normalize observable results
  ↓
Compare required invariants
  ↓
Pass / intentional difference / regression / unknown
```

Create implementation tests under `tests/runtime-parity/` when the candidate runtime exists.

## Comparison rules

Compare stable semantics such as:

- request accepted/rejected;
- session ownership;
- observed model/provider identity;
- tool registration and invocation;
- permission/question state;
- child-session lifecycle;
- stream/event ordering constraints;
- cancellation acknowledgement;
- retry state;
- compaction/context behavior;
- MCP connection lifecycle;
- persisted/recovered runtime state;
- explicit errors and uncertainty.

Do not compare unstable fields unless they are themselves requirements:

- random IDs;
- timestamps;
- incidental log text;
- nondeterministic token counts;
- provider-generated natural language.

## Minimum scenario catalog

### P01 — Runtime boot and health
Start runtime with disposable state. Verify readiness, version identity, shutdown and restart.

### P02 — Tool inventory
Observe registered tool IDs and required Freelancer plugin tools. Missing tools fail loudly; empty inventory is not success.

### P03 — Provider/model inventory
Read connected/configured provider and model metadata. Preserve exact known/unknown distinctions.

### P04 — Session create/read
Create a session, verify project/directory ownership, read it back and reject cross-project access.

### P05 — Basic streamed turn
Run a harmless deterministic or fixture-backed turn. Compare lifecycle states, stream completion and final persisted message state.

### P06 — Tool call lifecycle
Execute a harmless tool and compare call-start, result/error and completion state. Tool success must remain distinct from task success.

### P07 — Permission denial
Trigger a bounded operation requiring permission, deny it, and verify zero unauthorized side effect.

### P08 — Permission approval
Approve the same class of operation and verify the approval is scoped correctly and does not broaden unrelated authority.

### P09 — Question lifecycle
Create, observe, answer and recover a native question. Pending input must remain distinct from active execution.

### P10 — Child session / worker substrate
Create a child session through the runtime substrate, observe identity and status, and verify cancellation/continuation semantics.

### P11 — Cancellation
Cancel active work and distinguish requested cancellation, acknowledgement, partial output and final stopped state.

### P12 — Retry/failure state
Inject or fixture a provider/tool failure and compare retry status, error provenance and bounded retry behavior.

### P13 — Context/compaction
Drive a session to a known compaction boundary or fixture it. Verify context/compaction signals remain observable and resumable.

### P14 — MCP lifecycle
Use a harmless disposable MCP server to verify registration, connection, tool visibility, disable/reload and failure reporting.

### P15 — Configuration refresh
Change a safe runtime configuration value and verify refresh/dispose behavior does not corrupt active unrelated work.

### P16 — Restart/recovery
Restart runtime with durable disposable state and verify sessions and required runtime identity recover without blind replay.

### P17 — Authentication boundary
Where automation is safe, verify auth state reporting and sign-out/reconnect semantics. Do not fake provider authentication with fixtures and call it verified.

### P18 — Database/storage boundary
Verify each runtime writes only to its intended disposable store and does not mutate the other candidate/baseline state.

## Authority invariants

These are release-blocking:

- capability does not grant permission;
- paid-model consent remains explicit;
- project/directory ownership remains enforced;
- inspection-only constraints stay narrower than ordinary execution;
- denied permission causes no side effect;
- a child session cannot silently escape parent/runtime ownership;
- restart does not replay uncertain delivery;
- success claims remain separate from verified evidence.

## Difference ledger

Every parity failure must be classified:

- **regression** — candidate violates required behavior;
- **intentional improvement** — behavior intentionally changes and is documented;
- **upstream bug preserved temporarily** — candidate matches baseline by choice;
- **baseline translation artifact removed** — difference is desired because the old adapter distorted runtime truth;
- **unknown** — insufficient evidence; do not mark pass.

Maintain a machine-readable difference ledger once implementation begins.

## Promotion gate

A runtime domain may replace the external OpenCode path only when:

1. its applicable parity scenarios pass;
2. authority invariants pass;
3. intentional differences are documented;
4. rollback to the old adapter remains possible for at least one migration step;
5. the old translation code for that domain can be deleted or materially reduced.

The point of the harness is not to preserve every old implementation detail. It is to make every semantic change visible.
