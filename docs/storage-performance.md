# Storage performance

Request receipts and observed usage now use row storage in
`backend/.state/webpage/records.sqlite`. This database belongs to the runtime
checkout: captured agent definitions and permission evidence must not be mixed
with another checkout or deleted during search-index maintenance. Organization,
drafts, imports and search continue to use the per-user `freelancer.sqlite`.
OpenCode remains the owner of its conversations and credentials.

## Candidate assessment

| Data | Decision | Reason |
| --- | --- | --- |
| Request receipts | Migrated to SQLite | Large immutable captures; frequent updates and single-request authorization reads |
| Observed usage | Migrated to SQLite | Growing ledger; rescans usually change only a few records |
| Goals and sender outbox | Migrated to SQLite documents | Server and native readers share authority; pending and uncertain delivery states survive migration without replay |
| Git operations | Migrated to SQLite documents | Preserve preview fingerprints and uncertain-operation recovery |
| Settings, schedules, runtime preferences, quota and outcome history | Migrated to SQLite documents | Transactional updates shared by Node, native Bun plugins and PowerShell helpers |
| Delegation receipts, worker claims and input observations | Migrated to SQLite documents | Preserve native identity and dispatch evidence across restarts |
| Navigation and remembered chats | Migrated to database settings | One-time browser preference import; future writes go through the server |

## Migration and compatibility

On first access, each legacy ledger is validated and imported in one SQLite
transaction. Its completion marker commits with the rows. A failed import leaves
no partial rows or marker and preserves the original JSON bytes. Requests and
usage migrate independently. Missing files become empty collections; malformed
or unsupported files stop the operation instead of being overwritten.

Legacy `requests.json` and `usage.json` remain untouched recovery backups.
After migration, SQLite is authoritative: edits made to those backups are not
reimported. Native execution-context readers use indexed receipt lookups and
perform the same transactional import when first encountered. There is no JSON
fallback after migration or after database errors. Restart the server and its native runtime together
when adopting this change; running an older writer concurrently is unsupported.

Before a rollback, stop both runtime processes and back up the entire private
state directory. Restoring only the original JSON would lose receipts and usage
recorded since migration. Export both collections with the current store's
`read('requests')` and `read('usage')` while stopped, and retain the SQLite file
and any sidecars before returning to an older version. Do not discard current
request evidence or substitute the stale pre-migration backups.

Normal receipt writes and observations touch only their own rows. An indexed
summary column excludes captured catalogs before sending chat receipt summaries
to the browser. Full `read()` remains available for explicit ledger consumers;
`recordRequest()` returns a document containing only the touched receipt.
Unchanged observations make no row writes. The server serializes mutations;
native tools share the document API for their own state. Short-lived SQLite connections use a busy timeout, WAL
and full synchronous durability and do not keep Windows test directories open.

Settings, Git operations and Goals use `server/document-store.mjs`; retired settings
migration is isolated in `server/settings-migration.mjs`. Request/usage SQL is
in `backend/tools/runtime/record-store.mjs`, with runtime receipt access in
`backend/tools/runtime/record-database.mjs`. The per-user store delegates imported
chats, model ratings and chat indexing to focused modules under `server/data/`.

`state-database.mjs` maps legacy filenames to stable database document keys.
Directory scans import once and then enumerate database records. Deletion retains
the migration marker, so an old backup cannot resurrect deleted state. OS process
locks remain filesystem coordination primitives. Authored routing catalogs,
OpenCode configuration/authentication, project registration markers, exported
files and test reports are not mutable database fallbacks.

## JSON request errors

HTTP writes retain bounded bodies: 9 MiB for `/api/send` (including base64
attachments) and 1 MiB elsewhere. Oversized fixed-length and chunked requests
return JSON with HTTP 413 and `BODY_TOO_LARGE`. Malformed or non-object JSON
returns HTTP 400 and `INVALID_JSON`. Serialization happens before success headers
are sent, so serialization failures can return a complete error response.
Database migration does not increase these transport limits or prove the cause
of an unspecified HTTP 500 in a test.

## Reproducible synthetic measurement

Run `node scripts/benchmark-store-growth.mjs`. It measures 10, 100 and 250
synthetic receipts with 64 KiB captures and three observation/read repetitions.
The first scoped read includes migration. Changed observations, identical
observations and subsequent scoped reads report wall time and CPU separately.
The report includes legacy backup size, database size and JSON replacement counts.
Row rollback, unchanged-write and native identity behavior have dedicated tests.

The benchmark creates disposable state and never accepts a live data path.
Aggregate samples are written to ignored `artifacts/performance/store-growth.json`.
Workloads are bounded to 64 MiB, with no machine-specific timing assertions.
Compare identical workloads on the same machine; migration cost and steady-state
latency are separate. These results do not prove live provider performance.
