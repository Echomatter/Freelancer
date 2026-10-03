# Storage performance

> **Fresh-install boundary:** this page documents the current storage design and
> preserves details of explicit maintenance utilities. A normal install creates
> an empty Freelancer database and never imports an earlier Freelancer
> database, JSON store, settings profile, pin set or Memory file. Do not run the
> maintenance import examples below against prior user data as part of this
> goal. OpenCode configuration, credentials, conversations and MCP services
> remain native to OpenCode.

## Unified storage and fresh bootstrap

The current per-user SQLite store uses schema 22. Schema 17 introduced
`runtime_instances`, retained indexed source/unit revisions, runtime-scoped
`operational_records`, `application_documents`, `project_registrations` and
`runtime_settings`, `settings_update_journal`, plus stable content source/revision identities and `data_migration_runs` with a `data_table_lifecycle` registry in the per-user
`freelancer.sqlite`. The registry classifies every owned schema table as
durable or derived and identifies its owner. Content sources have deterministic identities derived from project key and virtual path; revision identities include source SHA-256, extractor version and extraction method. Schema 17 retains immutable source and unit revisions through reindexing and index repair. Search results, units, facts and source listings return these durable references, so they remain usable when publication replaces internal integer row IDs. Search-index repair derives its
preservation list from that registry and refuses to rebuild if it finds an
unregistered table or view; SQLite FTS5 shadow tables are recognized as
internal derived structures. Typed judgment definitions, run receipts and
results are durable registered tables. They retain immutable question and
criteria versions, SHA-256 identities for bounded state/candidate/evidence
packets, requested and provider-reported identities, nullable measured usage,
latency, typed answers, probability distributions and supplied confidence.
Native OpenCode history refresh also captures session headers and normalized message revisions in durable warehouse tables, keyed by a hashed source-database locator and registered project/session IDs. The observed native API version is retained only when valid; otherwise it is null. Revisions hash canonical safe message metadata and parts. Text, tool, patch, file metadata and step summaries are bounded; reasoning parts are omitted, sensitive object keys and bearer strings are redacted, and file payloads are represented only by hash and byte count. Search repair leaves these durable snapshots intact. The native knowledge bridge exposes bounded registered-project reads, capture coverage and an explicit resumable backfill action.

Schema 21 commits an immutable bounded session/message membership manifest and
a pending derivation job in the same transaction as each source snapshot. A
retained-input worker publishes full-text search only when that exact manifest
is still current; it commits the projection and completion receipt together.
The `projectionSafe` bit records whether the observed bounded window is valid
for search, separately from `snapshotCompleteness`: active complete windows can
be searchable while remaining partial for absence/deletion reconciliation.
Unsafe, malformed, truncated or oversized manifests do not replace the last
safe search projection. Source changes create newer work, and an old worker
cannot publish or acknowledge that newer revision.

Schema 22 binds each published conversation search projection to its immutable
derivation manifest. Hits report the source origin, exact snapshot and header
hashes, capture/index dates, and evidence availability. A newer native capture
does not silently change the retained source behind an older search hit. The
shared query preserves worker and orphan session IDs; the browser's history
adapter adds parent navigation separately. Unpinned conversation results can
open retained evidence or their live conversation independently. Older or
directly indexed projections without a recorded manifest remain searchable
with an explicit unavailable-evidence label until refreshed.
Their cached-text digest is recorded during indexing and keeps result IDs
stable across identical reindexing; it does not establish native provenance.

The common file, conversation, memory and fact query returns `nextCursor` and
page metadata. Each page is limited to 200 results plus one overflow row;
continuation offsets stop at 100,000. Cursors bind the database, current project
registry, query, filters and page size. They do not pin an immutable database
snapshot: indexing or authored changes can move results between pages. The UI
replaces each result group's page and offers Next, Previous and Start over,
keeping at most 100 visible results per group. Failed continuation preserves
the current page and retries the same cursor; scope changes cancel pending
reads and begin a new search. Native tools and the read-only CLI accept the
same continuation.

Each domain returns explicit per-hit result identity/type, source references,
revision/hash metadata, known or null capture/observation/index dates, match
reasons, coverage, evidence/claim status and at most 2,000 characters of model
text. Memory cards read an excerpt and bounded source summaries without loading
the full retained reader. Claim hashes use the canonical evidence resolver;
unavailable or excessive hash work leaves a searchable, labelled result with a
null hash. Memory-body and claim-source hashing each have a 4 MB page work
budget, with claim preflight additionally limited to 8,192 stored rows. Returned
result arrays have a separate 4,000,000-byte limit. Oversized values, scopes and
source lists carry explicit omission flags. Exact retained reads remain separate;
the fact editor reads an omitted value/scope before preparing a correction and
keeps the original claim and evidence in history. An unchanged retained value
keeps its JSON type, including numbers, booleans and objects. Unchanged scope
is retained by the transactional API; choosing a different project preserves
the other applicability fields. A global claim stays global. A correction is
a new claim with an explicit method, reason, epistemic state and evidence.

Retained-memory readers report newer source data separately from a newer memory
revision. The source status compares only retained local metadata: native
conversation snapshot/header hashes are scoped by source system, project and
session; file members use canonical source/revision identities. Legacy members
can use their recorded update/observation metadata. The comparison does not
read live native sources or retained bodies, and it never rewrites a capture,
pin or revision. Missing bindings, unavailable comparisons and over-limit input
remain unknown; the UI states that live source data has not been checked.
One read-only analytics-worker request is bounded to one row, 4,000 bytes and
one second, after at most 5,000 members, 1 MiB of cumulative identifiers and
8 KiB per identifier. Ordinary authored notes with no comparable members skip
that worker. An explicit Refresh still creates a new immutable memory revision.

Native `message.part.updated` and `message.part.delta` hints use a 100 ms quiet
window capped at 350 ms per session/subscription generation. Dirty markers are
durable before scheduling and the final authoritative read carries the newest
marker revision for compare-and-swap acknowledgement. Immediate header/status
or removal hints flush deferred work; shutdown cancels timers while retaining
durable markers for restart. Deferred sessions obey the same bounded queue as
other hints, with overflow recorded as project-level reconciliation work.

Live Freelancer SQLite roots must be on a local filesystem. Windows checks
canonical junction/alias paths and native volume type before opening storage;
volume observations are cached for the process lifetime, so remapping a drive
requires restarting Freelancer. Canonical paths are checked again on each open.
Offline backup archives may live elsewhere. Backup/restore containment uses
canonical paths and Windows case comparison to keep archives out of active
data and prevent a restored copy from overlapping its source or current store.

Backfill reads `/experimental/session` with `archived=true`, a registered project
directory and the native `x-next-cursor` response header. Its `cursor` is an
exclusive updated-time upper bound; native `start` is an inclusive updated-time
lower bound, not a row offset. Equal-timestamp boundary buckets are drained with
`start=t`, `cursor=t+1` and one bounded request of up to 5,000 rows before
advancing below `t`; a larger bucket remains partial. Durable cursors record the
`opencode-updated-v1` contract, timestamp boundary, failed native IDs, the
initial head signature, and an unfinished page signature with successfully
captured IDs. A page cache is reused only when the newly fetched page still has
the same signature. Each source capture commits separately; page progress
advances only after committed captures and completed bucket reads. Cancellation,
source failures, unsupported paging or an over-limit tie bucket retain partial
coverage and a resumable boundary. Changed head or page signatures invalidate
cached progress. Old offset cursors cannot be treated as timestamps. Concurrent
native updates can still move sessions during traversal; this is not an atomic
inventory or a direct native-database reconciliation. Coverage describes the
API responses actually read.

Native event notifications are hints, not deletion proof. Schema-21
`opencode_refresh_needed` stores coalesced source/project/session scopes,
revision tokens and bounded retry state. A failed, overflowed or unaddressable
hint remains recoverable across restart; compare-and-set clearing cannot erase a
newer hint. Startup drains due markers and derivation jobs after registered
projects load. The coordinator's periodic pass runs every 30 minutes and
reconciles one registered project per pass, with page size 50, at most 8 page
reads, 100 sessions and 20 seconds per slice. It resumes durable backfill
cursors. No event or partial inventory is used to delete retained warehouse
records. Focused fixture contracts cover recovery and deadline cancellation.
The schema-22 OpenCode 1.18.31 SSE and timestamp-paging smokes passed. The SSE
receipt matched stored API-version metadata to `/global/health`. Complete
contract and production browser results are recorded separately in
[warehouse-completion-audit.md](warehouse-completion-audit.md).

Successful-result cache lookup includes the definition version, state digest,
ordered candidate IDs, evidence references/revisions, and both requested and
reported provider/model identities; failures are never cache hits.
Failed, unavailable, cancelled and invalid-response attempts remain
distinguishable from successful empty answers. Persisted judgments are advisory
and do not become fact, permission or verification authority.

Disposable native checks on the development host verified Node.js 24.16.0,
OpenCode's embedded Bun 1.3.14, and SQLite 3.53.0, including a shared-store
roundtrip. Both engines reported FTS5, JSON, STRICT tables and named bindings.
The Node engine reported authorizer support; the Bun driver did not. Analytical
SQL therefore runs in the dedicated Node worker. These checks used installed
dependencies and do not establish cold installation or provider inference.

The repository retains explicit maintenance utilities for an operator who
separately selects a source runtime, verifies a backup, and requests a controlled
restore/import. They are not called by setup, startup, or the migration in this
goal. `scripts/migrate-runtime-records.mjs` supports marked runtime records,
selected runtime-state files and legacy pin reconciliation; it requires an
explicit source/root/runtime identity and quiescence. `scripts/local-data-backup.mjs`
supports validated unified-store backups and separate source archives. Normal
source startup does not invoke these commands, inspect their source locations,
or fall back to legacy JSON. Use the command help and inspect its preflight
requirements only if a separate user request explicitly authorizes a selected
maintenance operation. The source-level consumer inventory is in
[storage-consumer-inventory.md](storage-consumer-inventory.md).

The store also has an internal bounded analytical SQL primitive. It accepts
one parameterized SELECT/CTE, opens a read-only SQLite connection, enables
`query_only` and `trusted_schema=OFF`, and enforces an engine authorizer
allowlist, statement timeout, row/byte caps, and cancellation. Results include
column names and explicit truncation/partial indicators. The shared native
`knowledge` tool exposes it to named agents. Documented read-only views include
`knowledge_pinned_memories`, `knowledge_current_claims`,
`knowledge_claim_evidence`, `knowledge_memory_evidence`, and
`knowledge_source_coverage`; these expose current memory membership, provenance,
claim evidence and extraction coverage without creating another authority.

Evidence-backed claims can accumulate evidence from multiple sources and be
corrected transactionally through the `knowledge` tool. Duplicate claim
additions merge distinct evidence references without duplicating them. A
correction requires new evidence and an explicit epistemic state; it
marks the prior claim superseded and records the prior/replacement IDs, actor,
source references, and reason. The prior claim and its evidence remain
available for audit. This operation does not adjudicate conflicting facts.

New source startup uses `operational_records` in the fresh per-user
`freelancer.sqlite` for request receipts and observed usage, scoped by stable
runtime identity. The old `backend/.state/webpage/records.sqlite` is retained
for explicit maintenance import workflows, and clean setup never reads it.
OpenCode remains the owner of its conversations and credentials.

## Historical storage migration disposition

The table below records why the unified schema has these domains. It does not
describe first-run behavior or authorize an import. Clean setup initializes
empty Freelancer-owned data; selected restoration or import is a separate
operator action and is outside the active fresh-install goal.

| Data | Decision | Reason |
| --- | --- | --- |
| Request receipts | Stored in SQLite | Large immutable captures; frequent updates and single-request authorization reads |
| Observed usage | Stored in SQLite | Growing ledger; rescans usually change only a few records |
| Goals and sender outbox | Stored as SQLite documents | Server and native readers share authority; pending and uncertain delivery states survive restarts without replay |
| Git operations | Stored as SQLite documents | Preserve preview fingerprints and uncertain-operation recovery |
| Settings, schedules, runtime preferences, quota and outcome history | Split by authority | Transactional domain state in SQLite; Freelancer-only app-wide settings in a separate file; OpenCode options remain native |
| Delegation receipts, worker claims and input observations | Stored in SQLite | Preserve native identity and dispatch evidence across restarts |
| Navigation and remembered chats | Stored in application settings | Fresh installs use defaults; no prior browser preference import |

## Current runtime and compatibility boundary

Normal source startup initializes or validates the registered per-user
`workspace-v2` database before launching OpenCode. New request receipts, usage,
goals, sender state, project registrations, search indexes and warehouse data
use that runtime. App-wide Freelancer preferences use the separate,
revisioned `application-settings.json`. Legacy paths are adapters for
explicitly selected maintenance operations; clean startup does not probe them,
fall back to them, or import from them.

Normal receipt writes and observations touch only their own rows. An indexed
summary column excludes captured catalogs before sending chat receipt summaries
to the browser. Full `read()` remains available for explicit ledger consumers;
`recordRequest()` returns a document containing only the touched receipt.
Unchanged observations make no row writes. The server serializes mutations;
native tools share the document API for their own state. Short-lived SQLite connections use a busy timeout, WAL
and full synchronous durability and do not keep Windows test directories open.

Settings, Git operations and Goals use `server/document-store.mjs`; retired settings migration is isolated in `server/settings-migration.mjs`. The unified settings adapter stores Freelancer-only global preferences in a separate per-user settings document, keeps project agreements and domain settings in SQLite, and journals cross-store writes for recovery. Source startup activates this runtime after fresh bootstrap. The Windows tray launch preference uses the shared versioned settings document through `application-settings-cli.mjs`, rather than an incidental `launcher.json` file.
Request/usage SQL is
in `backend/tools/runtime/record-store.mjs`, with runtime receipt access in
`backend/tools/runtime/record-database.mjs`. The per-user store delegates imported
chats, model ratings and chat indexing to focused modules under `server/data/`.

`state-database.mjs` maps legacy filenames to stable database document keys
when a maintenance/runtime adapter is explicitly activated. It does not use
legacy JSON as a fallback after activation. Directory scans enumerate registered
database records, and retained markers prevent stale source files from
resurrecting deleted state. OS process locks remain filesystem coordination
primitives. Authored routing catalogs, OpenCode configuration/authentication,
project source files, exports and test reports remain outside the data database.

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
