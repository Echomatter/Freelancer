# Storage performance

Freelancer keeps the existing JSON authorities in `backend/.state/webpage/` for
settings, usage, request receipts and Git operations. This preserves on-disk
compatibility for scripts and external readers: files are still versioned JSON,
written by atomic replacement, and corrupt or unsupported documents fail closed
instead of being repaired or overwritten.

The request receipt file can be large because every request keeps immutable
captured agent definitions. Older receipts may retain a retired captured workflow value for compatibility. The server store now keeps an internal
validated cache for each JSON document and invalidates it with file metadata
before use. Public `read()` returns a clone so callers cannot mutate the cached
copy. Mutations still run through one in-process queue, and a changed file is
validated again before it becomes the cached snapshot.

Observation updates avoid cloning and comparing the full request document. They
copy only the top-level records map and touched receipts, preserve captured
definitions verbatim, and skip the request write when a rescan reports the same
response IDs, models and completion state. Usage attribution reuses that request
snapshot instead of rereading `requests.json` in the common path. Actual changes
still stringify the full JSON once because external readers require the existing
single-file format.

The observer keeps session update versions only for sessions still returned by
the current scan. Directory matching is normalized with platform-aware path
rules so Windows case differences do not create duplicate version entries.

## Limits

- This is not a data migration and does not delete or rewrite live state except
  for normal request and usage updates.
- Other processes can still update the JSON files. The cache notices replacement
  through file metadata before the next store read or write, then parses and
  validates the new content.
- `execution-context.mjs` still reads `requests.json` directly for authorization
  outside the store. The store avoids that extra read only for normal observation
  attribution when the receipt is already present in the request snapshot.
- A real request change still pays the cost to serialize the compatible
  single-file JSON document. Avoiding that would require a separate storage
  format and a migration plan.

## Reproducible synthetic measurement

Run `node scripts/benchmark-store.mjs`. It creates and removes isolated temporary
state, comparing the previous observation algorithm with the current store on
100 captured receipts totaling about 30 MiB. It reports wall time and process CPU
separately. One local run produced:

| Observation | Previous elapsed / CPU | Current elapsed / CPU |
| --- | --- | --- |
| Changed response, cold cache | 557 / 562 ms | 278 / 266 ms |
| Identical rescan, warm cache | 412 / 391 ms | 1 / 0 ms (rounded) |

These are single-run synthetic measurements, not end-to-end application latency
or a guarantee on other machines. The previous algorithm already skipped disk
writes for unchanged content; the improvement removes repeated parsing, cloning
and whole-document comparisons on that path. Captured receipts remain intact.

## Growth measurements before a storage migration

Run `node scripts/benchmark-store-growth.mjs` from a prepared checkout. It
measures 10, 100 and 250 synthetic receipts with 64 KiB captured payloads and
three observation/read repetitions per workload. Cold scoped reads, changed
observations, identical observations and warm scoped reads are reported
separately, with wall time, process CPU, file size and actual atomic-replacement
counts. This is a diagnostic, not a timing gate or a safe-workload guarantee.

Only newly created temporary state is used; it is removed in a `finally` block.
The command accepts no live data path and makes no provider or GitHub request.
Aggregate results and samples, without receipt contents or local paths, are
written to ignored `artifacts/performance/store-growth.json`. Imported callers
can choose smaller bounded synthetic workloads; each is capped at 64 MiB and
no more than ten repetitions. CI contracts use a tiny fixture to check bounds,
write counts and output shape without enforcing machine-specific timing limits.

Retain measurements with the exact checkout and environment used. Compare
like-for-like workloads on the same machine. Use `Server-Timing` and the
long-chat browser journey described in [Local chat performance](local-performance.md)
to determine whether an observed delay actually comes from local writes,
native reads or rendering before changing persistence. Full-document writes
remain a known format cost; this benchmark does not remove that cost.

The default diagnostic was run during PR #3/#4 integration on 2026-09-29
(Windows x64, Node 24.16.0). Median changed-observation times for 10/100/250
receipts were 16/44/90 ms; warm scoped reads were 0.34/0.39/0.55 ms.
Each changed observation replaced the request and usage documents. Identical
observations and both read paths made zero replacements. These isolated local
measurements do not establish live provider latency or a maximum safe workload.

A migration is separate work: it needs evidence of a user-visible bottleneck,
external-reader compatibility, preserved captured authority, backup/rollback
and interruption tests. Do not delete historical receipts, relax permission
checks or rewrite native OpenCode storage merely to improve a benchmark.
Live inference and sustained multi-session acceptance still use the
[release acceptance record](release-acceptance.md), not synthetic timings.
