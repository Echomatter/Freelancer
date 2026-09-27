# Storage performance

Freelancer keeps the existing JSON authorities in `backend/.state/webpage/` for
settings, usage, request receipts and Git operations. This preserves on-disk
compatibility for scripts and external readers: files are still versioned JSON,
written by atomic replacement, and corrupt or unsupported documents fail closed
instead of being repaired or overwritten.

The request receipt file can be large because every request keeps immutable
captured agent and workflow definitions. The server store now keeps an internal
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
