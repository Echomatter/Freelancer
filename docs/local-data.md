# Local data, history and archives

New-project setup offers an optional [one-time ChatGPT / Codex import](chatgpt-import.md) before indexing. Imported snapshots have their own tables, use the shared chat view, and can orient a new native chat without writing to OpenCode's database. They are an explicit exception to native conversation ownership described below; native conversations still belong to OpenCode. Cloud-only chats and general Freelancer backup imports are not supported.

## Start here

Use Node.js **22.13 or newer** and restart the application server after pulling.
The UI/application contract is checked against the current
[`domain/protocol.mjs`](../domain/protocol.mjs). A browser refresh alone cannot
upgrade the local server. There is no new database server or installer to run.

The current chat's actions offer **Archive, pin or export…**, preselecting that
parent conversation. **Export conversations** in Content & Storage opens the same
conversation-history organizer. It has Active, Archived and All views, pins,
multiple selection, Undo, and progressive **Load more history** for one selected
project. Archive and export selection remains limited to one project at a time.

**Project settings → Search project content** searches indexed files and
conversations only in the selected project. **Application settings → Search all
content** searches both indexes across all registered projects, including archived
ones. A result opens either its conversation or its source file in **Project
settings → Files**. Refresh the search copies in **Application settings → Content &
Storage**; searching never changes project files or conversations. Putting a
project away first refreshes that project's file and conversation indexes. Later
global refreshes skip it until it is restored.

**Application settings → Content & Storage** shows actual locations and explains ownership.
Use **Put project away** to hide a project from active navigation, and **Restore
project** to bring it back. Its folder and Git agreement remain untouched.

The backup checklist distinguishes a local copy of project folders and data locations from conversation export. Stop the server and OpenCode before copying live databases, and include SQLite sidecar files. Exports cover selected conversations only; Freelancer export bundles have no restore/import action. Both search indexes are derived data: **Application settings → Content & Storage** refreshes files throughout every registered project root or native OpenCode messages across all registered projects. File indexing includes source code, configuration, documents, and other readable text throughout each root; generated folders, private state, and binary formats without an extractor are skipped. The conversation index includes titles and user/assistant text, including archived chats and workers, with model IDs; it does not copy tool output, reasoning, attachments, or drafts. OpenCode remains the conversation authority. The same page can optimize the full-text indexes, run SQLite quick check, and compact free pages; these jobs do not operate on OpenCode's native database.

File and conversation search share the same default query rule: up to twelve words are AND-matched. Exact phrase matching is an explicit option. File searches also accept optional source-path, source-role, and source-status filters; the app API, native content tool, and command-line indexer use the same fields and meaning. Path matching treats SQL wildcard characters as literal text.

Native knowledge judgments can reuse a successful single-question receipt when the caller pins a model ID that exactly matches the provider-reported model. The state, definition version, candidates, evidence revisions, and requested/reported provider and model identities must match. Moving aliases such as jev-latest are evaluated live. Batch requests reuse results only when every question has a complete matching successful receipt; a partial match reruns the whole batch. Cache hits return the original typed answer and receipt ID without counting historical token usage again.

Judgment evidence is checked against the local source store before a provider call. File citations use `kind: "content-unit"` with candidate/source identity, revision identity, locator and unit SHA-256; the corresponding `state.evidence` item repeats those identifiers and includes text found in that indexed unit. OpenCode citations use `kind: "opencode-text-part"` with source, project, session, message and captured revision IDs, text-part ID and part SHA-256. Their candidate ID is `opencode-session:` followed by base64url of the JSON tuple `[sourceSystemID, projectID, sessionID]`. Stale or unresolved citations are rejected. Current and prior project-file revisions and extracted units are retained through reindexing and resolve by stable reference.

Unsent drafts save after a short typing pause. **Draft saved on this computer**
means the server acknowledged that exact revision. A save error leaves the text
in the box. Retry saves it; **Load saved draft** explicitly replaces local text
only after the user confirms. Copy conflicting text before choosing that action.
Files added to the composer are temporary in-memory attachments until OpenCode accepts the message; draft backups contain text only. Native conversation exports refer to attachments but do not contain external attachment bytes.

Nothing in this release deletes conversations, project files, Git history or
usage records. It does not provide cloud synchronization, full-system backups,
automatic retention, or secure erasure.

## Archive is organization, not deletion

The installed OpenCode API is inspected for an explicit, reversible archive
contract. A numeric archive timestamp alone does **not** establish that it can
be cleared. When the API advertises a nullable archive timestamp, Freelancer
uses the native PATCH operation and reads back the resulting state. It never
edits OpenCode's SQLite file directly.

With the currently pinned SDK's numeric-only archive field, Freelancer uses
**Hidden in Freelancer** instead. This is a reversible local annotation, not a
claim that another OpenCode client has archived the chat. A conversation that
was already archived natively cannot be restored through an unsupported native
contract: the UI explains that it needs a compatible native client.

The parent conversation is organized as a group with its linked descendants.
Worker sessions are not copied, reparented or destroyed. In-app sends, queued
dispatch and native chat actions are blocked until the project/conversation is
restored. Other applications using the same OpenCode storage are not sandboxed
by Freelancer-only hiding.

Archive checks the parent/descendant native activity, questions, permissions and
sender outbox. Busy, retry, unknown activity, queued, submitted, failed or
uncertain delivery blocks the operation. Nothing is automatically stopped or
cancelled. A project fence also waits for an already-started prompt acceptance
before examining activity. Native work started by another process is outside
that fence; this is not a distributed lock over all OpenCode clients.

Project archiving is a separate annotation. Before it is saved, Freelancer
refreshes that project's file and conversation indexes; if either index cannot
be refreshed, the project remains active. It then hides all of the project's
chats from active navigation but does not rewrite their individual archive
state. Global index rebuilds omit put-away projects until restored. Restore the
project before changing individual conversation archives. Drafts and exports
remain accessible. Usage/accounting still includes archived work.

## What is stored where?

| Information                                                                          | Authority                              | Current storage                                                         | Archive/export behavior                                              |
| ------------------------------------------------------------------------------------ | -------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Project source and Git history                                                       | Filesystem / Git                       | User-selected folders                                                   | Never moved or deleted here                                          |
| Native sessions, messages, parts, tools, permissions, todos                          | OpenCode                               | Native engine database, located through the same executable's `db path` | Use native API/CLI; never write its database                         |
| Provider authentication                                                              | Existing native authentication systems | Existing credential locations                                           | Never copied into this store or exports as a credential collection   |
| Registered projects, project agreements and domain settings                         | Freelancer                              | `operational_records` in the fresh per-user `freelancer.sqlite`                               | Created empty on clean setup; no prior-install import                  |
| Request receipts and observed usage                                                  | Freelancer                              | `operational_records` in the fresh per-user `freelancer.sqlite`                               | New receipts preserve uncertainty; no prior-install import            |
| Waiting/uncertain delivery                                                           | Freelancer sender                       | `operational_records` in the fresh per-user `freelancer.sqlite`                               | A delivery commitment, not a draft; archive cannot cancel it         |
| Runtime preferences, delegation receipts, outcomes and quota state                   | Freelancer runtime adapters             | Unified tables in the fresh per-user `freelancer.sqlite`                                      | Node/Bun/PowerShell resolve the same registered runtime                |
| Project files and conversation search indexes                                        | Freelancer content indexer             | Project-scoped tables inside the same per-user `freelancer.sqlite`                  | Rebuildable derived indexes; project files and native chats remain authoritative |
| Pins, local hiding, project archives, unsent drafts                                  | Freelancer local data service      | `freelancer.sqlite` in the resolved user data directory                    | New feature authority                                                |
| Previously seen session headers                                                      | OpenCode; SQLite copy is a cache       | `session_headers`                                                       | Titles/IDs/ancestry/timestamps only, checked natively before actions |
| Agent/skill defaults                                                                 | Application source                     | Existing domain/backend files                                           | Definitions are not running jobs                                     |

Source startup now creates or validates an empty `workspace-v1` runtime before launching OpenCode, then activates the unified database for the app and its child processes. A non-empty, unregistered database is rejected; no previous Freelancer database, JSON state, settings profile, pins, Memory files, or browser-local navigation preferences are opened or imported. Native OpenCode owns general options, provider inventory and authentication, and MCP configuration. Freelancer-only appearance and billing preferences remain in a separate application-settings surface. Process locks and launch rendezvous remain filesystem coordination. The source-level [storage consumer inventory](storage-consumer-inventory.md) maps current consumers and remaining verification. Quiescence-gated import commands are maintenance utilities and are not part of first-run setup. See [storage performance](storage-performance.md) for current validation and boundaries.

## The parts and their relationships

- A **project** is a folder registration plus its setup; it has conversations.
- A **conversation** is an OpenCode session or an explicitly imported Codex snapshot. A worker is a native child session.
- A **request** is one user instruction. Its receipt preserves which agent,
  model and execution settings were used at that time. Older receipts may still
  carry a retired captured workflow value for compatibility.
- An **agent definition** describes working style. Editing it does not rewrite past receipts.
- A **worker job** is a particular delegated assignment linked to its native
  child session and parent request, not another editable agent definition.
- A **usage observation** records native activity; archiving does not erase it.
- A **draft** is editable unsent text. A **queue entry** is a requested delivery
  with a state machine. A send acknowledgement may clear only its captured
  draft generation, never newer typing.

The Freelancer SQLite store links by project/native session ID but has **no foreign
key into OpenCode's database**. Native IDs must be ownership-checked through the
API before mutations or exports. Missing native sessions are not recreated.

## SQLite schema 17

The executable schema is `server/data/schema.sql`. Application history/draft access goes through
`server/data/store.mjs` and `server/history.mjs`; the local content-index tool uses the same database through its Python indexer. React does not open SQLite directly. A schema-6 fixture copied from main commit `dd60841` now exercises the full migration chain to schema 17, preserving a draft and indexed source evidence and checking SQLite integrity and foreign keys. It is a small fixture; migration cost and preservation across the active full-size profile database remain unverified.

| Table                 | Key and contents                                          | Purpose                                 |
| --------------------- | --------------------------------------------------------- | --------------------------------------- |
| `schema_migrations`   | Version, migration name, applied timestamp                | Explicit version history                |
| `project_annotations` | Project ID; archive timestamp; revision                   | Local project organization              |
| `session_headers`     | Project + native session ID; parent ID, title, timestamps | Rebuildable header cache; no transcript |
| `session_annotations` | Project + session ID; pin/hide timestamp; revision        | Local organization; FK to cached header |
| `drafts`              | Project + session ID or `new`; text, revision, timestamp  | Recoverable unsent text                 |
| `content_meta`        | Project key + build metadata                              | Per-project index manifest/status       |
| `content_sources`     | Project-scoped source metadata, deterministic source and content-revision identities | Indexed files and archive members; stable references survive staged publication |
| `content_units`       | Source retrieval units                                    | Searchable document sections with stable source/revision references            |
| `content_units_fts`   | FTS5 projection of retrieval units                        | Local full-text/BM25 search              |
| `content_facts`       | Derived source-linked facts                               | Optional analysis aid                   |
| `content_fact_stats`  | Project-scoped fact aggregates                            | Optional analysis summaries             |
| `chat_search` / `chat_search_state` | Indexed native messages and refresh timestamps | Rebuildable conversation search |
| opencode_sources, opencode_sessions, opencode_session_revisions, opencode_messages, opencode_message_revisions | Hashed native database locator, current session/message projections and immutable safe revisions | Native OpenCode source warehouse; stable revision references; reasoning parts excluded; file payload bytes are hashed, not copied |
| opencode_ingest_runs, opencode_ingest_cursors, opencode_ingest_failures | Per-project backfill state, numeric API offset plus prior-session boundary cursor, discovered/captured counters, and failed-session receipts | Bounded resumable API ingestion; failed sessions resume from their earliest offset and detected ordering shifts restart from zero while coverage remains partial |
| opencode_source_coverage | Per-source session, message and revision counts | Read-only capture coverage |
| `model_catalog` | Public native model metadata and dated estimated ratings | Models-page catalog; not routing policy |
| `entities`, `entity_aliases`, `claims`, `claim_evidence`, `entity_relations` | Provenance-aware shared knowledge graph | Claims retain origin, epistemic state, scope, time and evidence |
| `memory_items`, `memory_item_revisions`, `memory_members`, `memory_pins`, `memory_changes` | Versioned durable notes and conversation-pin records | A pin records a metadata-only snapshot placeholder until transcript capture completes |
| History pin compatibility | Canonical memory_pins for new pin/unpin writes; legacy session_annotations.pinned_at is read only as migration fallback | Pin state and annotation revision change in one transaction; unpin retains the conversation memory |
| `runtime_instances`, `runtime_collection_markers` | Explicit runtime ID, source path/schema/hash, import time and legacy one-time markers | Identity mapping and fail-closed cutover eligibility; source path is provenance, not inferred identity |
| `operational_records`, `application_documents`, `project_registrations`, `runtime_settings`, `settings_update_journal` | Runtime-scoped operational rows and documents, project agreements and domain settings, plus recovery for split settings writes | Staged migration target; global preferences are stored in per-user `application-settings.json` outside SQLite |
| `model_rating_jobs` | Native configuration session, chosen model, state and summary | Background rating update recovery |
| `knowledge_pinned_memories`, `knowledge_current_claims`, `knowledge_claim_evidence`, `knowledge_memory_evidence`, `knowledge_source_coverage` | Read-only warehouse views | Bounded native knowledge queries over pins, evidence and indexed-source coverage |
| `chatgpt_chats` / `chatgpt_messages` | Project-scoped imported headers, provenance and normalized messages | One-time source snapshots, separate from OpenCode |
| `chatgpt_continuations` | Imported ID to native session link and creation state | Supported-API continuation; guards uncertain creation |
| `project_onboarding` | Completed setup timestamp and import count | Prevents repeated imports or live sync |
| `judgment_definitions`, `judgment_runs`, `judgment_results` | Immutable primitive/question/criteria versions, hashed bounded evidence packets, requested and reported provider/model metadata, typed answers, probabilities, confidence and optional usage | Preserves model judgments separately from underlying facts; provider failures and missing measurements remain explicit |

The native knowledge tool can ask for permission and send a bounded caller-supplied state packet to the shared TypeSafe SDK adapter. Single and batched evaluation calls accept up to twenty immutable question definitions in one System One request. Before provider use, each candidate and evidence citation must resolve to a retained indexed content revision/unit or a captured OpenCode text part, and the packet text must occur in the resolved source. It stores typed answers and provenance hashes, not the state content or API key. Batch receipts share one ID and record token usage once to avoid double-counting. `judgment-provider-status` reports credential configuration without claiming live connectivity, and evaluation failure does not block ordinary search or memory operations. Exact pinned model IDs can reuse complete successful cache matches; moving model aliases and partial batch matches run live. A cached result does not count historical token usage again. The same native `knowledge` tool supports exact entity lookup, duplicate-safe entity and relation creation, bounded relation listing, and audited relation/entity deletion. Entity deletion removes its aliases and graph edges only when no claim references it; otherwise it reports the retained claim count and makes no change. Relation and entity deletion results are explicit and repeatable.

`node scripts/evaluate-knowledge-retrieval.mjs` runs eight synthetic candidate pairs that cover exact IDs, Unicode, paraphrases, contradictory current/history evidence, historical questions, pinned conversation snapshots, missing-source placeholders and project identity. The live JEV 1.13.0 run scored top-1 accuracy 1.0 and mean reciprocal rank 1.0 across these eight labeled pairs (5,041 input tokens, 301 output tokens, 367 ms). This measures the judgment layer against fabricated fixtures; it does not establish retrieval quality on real projects or the full search pipeline.

Uses STRICT tables, prepared statements, foreign keys, short BEGIN IMMEDIATE
transactions, a busy timeout, WAL journaling and FULL synchronization. The file
has an application ID and version; foreign/newer/corrupt databases fail closed,
not reset. Empty draft rows retain revision tombstones so stale windows cannot
resurrect a cleared draft. New-chat draft rebinding clears the source and writes
the destination in one transaction; it refuses a nonempty destination.

The local store uses one lazy connection shared by the server's history,
ratings, import and indexing services. The server runtime closes it during
graceful shutdown. Startup performs a passive WAL checkpoint, which does not
wait for active readers or truncate the log. Do not force-kill the server as a
normal restart method. A derived-index reset pauses the shared connection while
its worker replaces the database file; services reopen it after the reset.

The UI debounces draft writes and drains edits serially. Every write checks a
revision. Cross-window conflicts and lost acknowledgements preserve local text
rather than silently overwriting a newer saved value. Switching chats cannot
redirect a pending save or acceptance to the newly selected chat. During native
chat creation, later typing follows the newly bound conversation.

## Paths and protection

Production resolves new data separately from the installation:

- Windows: `%LOCALAPPDATA%\Freelancer\workspace-v1\freelancer.sqlite` (profile fallback when
  LOCALAPPDATA is unavailable).
- macOS: `~/Library/Application Support/Freelancer/workspace-v1/freelancer.sqlite`.
- Linux: `$XDG_DATA_HOME/freelancer/workspace-v1/freelancer.sqlite` or
  `~/.local/share/freelancer/workspace-v1/freelancer.sqlite`.

An absolute `FREELANCER_DATA_HOME` explicitly chooses another directory. It is
not a data migration; pointing it elsewhere opens that directory's independent
store. The default Windows path keeps new data out of the Git checkout. Test
fixtures pass their own disposable data root. Existing backend JSON data stays
where it is, so a toolkit folder copy is not a complete backup.

Use a local filesystem, not a shared/network or live cloud-synchronized database
folder. SQLite sidecars are part of its live state. The UI reports main-file
sizes only and says so; a shared OpenCode database size is not a project size.

SQLite is **not encrypted by Freelancer**. New Unix data folders/files use
restrictive permissions; Windows relies on the user's profile ACLs. Drafts,
exports, existing runtime files and conversation history may contain private
text. Do not commit them. No API key or auth document is intentionally copied
into the new store. User-authored text can itself contain secrets.

The Open-folder API only accepts fixed, server-resolved location IDs. It cannot
accept a browser-supplied path or command. The existing loopback Host, Origin,
client-header, body-size and CSP protections remain in place.

## Export is not backup

Select 1–20 conversations, choose Markdown or JSON, and explicitly choose
whether workers are included. The backend validates ownership and linked
workers, requires idle selected sessions, and invokes the installed native
`opencode export <session>` with fixed argv in the same runtime environment.
It limits the total result to 32 MB and 100 sessions. A failed component does
not return a falsely complete bundle.

JSON contains a versioned Freelancer envelope holding native session exports.
It is **not** passed off as a single directly importable OpenCode file. These export bundles do not have a restore/import UI; the separate Codex setup import reads local Codex history. Markdown is a readable rendering of
those exports. Native user/system message contents and tool outputs may be
sensitive. External attachment bytes, source files, Git history, account login
state, application settings, unsent drafts and live execution are not backed up.
Native file references or embedded data already present in a session export
remain part of the native JSON; no separate file collection is traversed.

Each session is individually exported; multiple exports are not an atomic
project snapshot. The browser uses an explicit download; the browser controls the
save location and any save prompt. A click acknowledgement means the download
was requested, not that Freelancer verified a final on-disk save. No export is
uploaded automatically.

## Future migration boundary

Do not permanently dual-write JSON and SQLite copies of the same authority.
Before moving existing records: inventory every application/plugin/PowerShell
reader and writer, quiesce writers, preserve a verified backup, import in one
transaction with counts/IDs validated, perform an explicit cutover, and retain
a tested rollback route. Reject unknown future schemas. Do not point native
OpenCode at this database, copy its credential store, or give editable agent
prompts direct SQL access.

Schema 17 includes the provenance-aware memory service, versioned immutable JEV
question definitions, retained indexed source/unit revisions, and shared `knowledge` OpenCode tool. Pinning creates a canonical memory item and preserves the original
pin time, but the current capture boundary is explicitly `metadata_only`; no
historical transcript is fabricated. Memory search uses a rebuildable FTS
projection. The maintenance importer copies the v1 runtime records database and
registered standalone state JSON after explicit quiescence. Migration and
backup CLIs acquire the runtime's normal application lock so they reject an
active Freelancer server and prevent a new server from starting during the
operation; `FREELANCER_MIGRATION_QUIESCED=1` remains an operator assertion for
independent OpenCode plugins and runtime helpers. The stopped-runtime backup
packages Freelancer's SQLite database, sidecars, settings snapshot and
per-runtime settings profiles with a hash manifest. Run
`node scripts/local-data-backup.mjs migration-sources --runtime-root <absolute-runtime-root> --output <absolute-new-bundle-directory>`
to make a second verified bundle of the legacy `records.sqlite` database (and
sidecars) plus every valid standalone `.state` JSON migration input. The source
bundle excludes the unified-storage pointer, live launch rendezvous and
dispatch-lock owner files; it never copies OpenCode's database, credentials,
lock files, or non-JSON runtime artifacts. It records hashes and byte lengths
without putting JSON contents in the manifest, validates legacy database
identity/schema/integrity, and rejects symlinks and invalid JSON. Restore
validates the target bundle before writing to a new directory. Rehearse recovery
of the legacy inputs into an empty runtime root with
`node scripts/local-data-backup.mjs restore-sources --bundle <absolute-bundle-directory> --to <absolute-new-runtime-root>`.
That copies only the archived migration inputs; it does not restore the live
launch rendezvous or storage pointer. Neither command
creates a runtime pointer or makes copied operational rows authoritative;
settings-profile reconciliation and production cutover remain explicit
migration work.

## Verification and remaining live checks

Run `npm test`, `npm run build`, then (with the Chromium test browser installed) `npm run test:browser -- local-data`. The new CI matrix exercises
Ubuntu and Windows with normal navigation and uploads browser screenshots.
The Windows panel workflow exercises the same browser application.

Tests exercise real application/HTTP/SQLite/sender integration; only the native
OpenCode and TypeSafe provider interfaces are stubbed. Pure draft-controller tests cover save
races, exact-generation acceptance, multi-window conflicts, reload, lost
acknowledgements and rebinding. The focused judgment-provider tests use a mock;
a separate synthetic call verified the live TypeSafe API response without project
data. No paid OpenCode model calls or real user account changes are used. Normal browser verification uses loopback HTTP/CSP. PANEL_OFFLINE=1 is an optional restricted-environment bridge and is not normal-navigation evidence.

Before relying on a real installation: restart the Windows app; save/reopen a
draft; archive/Undo an idle test conversation; inspect the displayed paths; download
one conversation export and inspect its contents; confirm a running worker or
queued request blocks archive. Do not run this check on destructive/private
fixtures or treat a transcript export as your only backup.
