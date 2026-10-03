# Freelancer unified data, memory, and evidence warehouse

> **Current execution boundary (October 2, 2026):** this active goal migrates
> Freelancer user options, provider inventory/authentication, and MCP ownership
> toward native OpenCode configuration while retaining Freelancer-specific
> warehouse, memory, evidence, appearance and operational features. It does not
> import prior Freelancer databases, JSON state, settings profiles, or Memory
> files. Existing data stays at its current path and is not opened for import.
> The migration phases and import tooling below are design/reference material
> only; running them requires a separate explicit user request and verified
> backups. A clean install starts with empty Freelancer-owned data and the
> user's existing OpenCode configuration, providers, credentials and MCP.

## Implementation goal

Build Freelancer-owned application data in one fresh per-user SQLite database. Combine the useful domain behavior of the Memory reference server, useful SQLite query/introspection patterns, Freelancer's existing content extraction/indexing, conversation pins, and a provenance-preserving warehouse of OpenCode data. A new installation starts with an empty Freelancer database; this goal does not migrate a user's previous Freelancer databases, JSON state, settings, pins, or Memory files.

Build this as an internal Freelancer service with native OpenCode tool adapters and the existing application API. **Do not build or require a new MCP server, MCP client, protocol layer, or separate memory process for this feature.** OpenCode remains the owner of user-configured MCP services, including any existing Memory service; this goal does not disable, remove or import from them.

**All agents, models, and projects share the same toolkit and global memory.** Project, session, agent, model, and installation identifiers support provenance, correct operation targeting, and optional query filters. They are not entitlement or visibility assignments. Skills supply optional capability-use hints, not prerequisites for using tools.

Keep application-wide settings outside this database. Move operational data too: do not leave requests, usage, goals, queues, worker receipts, and Git-operation history in a second writable Freelancer data database. Existing domain services continue to control their own operations after storage moves.

### Status and source baseline

At proposal time, this was design and source investigation only; no application implementation, database migration, repository write, or new provider call had been performed. Implementation has since advanced on the storage-maintenance branch: normal source startup now initializes a fresh empty unified runtime before launching OpenCode. Warehouse coverage and retrieval requirements remain unfinished; see the implementation status in §12. The reviewed GitHub main at proposal time was `dd608415800635eedd053f67c3d0b6cd0d918756`, titled “Integrate shared native MCP capabilities.” This superseded the earlier plan based on `5976007` that proposed retaining a separate runtime database and exposing a custom knowledge MCP.

The current schema, pin path, content-query branch, search-repair routine, MCP presets, and storage documentation were checked directly. Additional application consumers are mapped from those sources and the preceding dependency inventory. Source review is not proof about a user's private installation or a completed end-to-end migration.

The companion **Code Port and Migration Map** identifies the actual source files and the nine outside implementations inspected. Proposed table/module/operation names in this plan describe the target design; they are not claims that those names already exist.

## 1. Architecture: one data database, several coherent domains

```text
Freelancer interface ── application API ─────────────┐
                                                   │
OpenCode agents ── native custom tools ──────────────┼── shared application/data services
                                                   │             │
Node/Bun/PowerShell consumers ── thin adapters ───────┘             │
                                                                 ├── freelancer.sqlite
OpenCode supported API / export ── ingest + reconcile ─────────────┤   • operational records
Project files / imported snapshots ── extract + index ─────────────┤   • source warehouse
                                                                 │   • memory and pins
Application-wide settings ── separate settings service            │   • facts and evidence
Native credentials/config ── remain with their existing owners    │   • search and judgments
                                                                 └── derived indexes
```

“One database” means one authoritative **Freelancer data** database. OpenCode retains its own execution database; source files and Git retain their filesystem authority. Warehouse copies of those sources belong in Freelancer's database, but do not become another execution engine. SQLite WAL/SHM files, temporary extraction databases, and verified backups are physical artifacts, not competing data authorities.

Use the resolved per-user `freelancer.sqlite` location. Replace path inference from old `.json` filenames with one explicit data-root resolver shared by the server, native tools, CLI, migration tools, and launcher adapters.

Keep business logic in focused modules. Do not turn `server/data/store.mjs` into a larger monolith or put every datum into a graph. The graph models knowledge relationships; relational tables model drafts, deliveries, usage, and other structured records.

### One implementation, multiple entry points

The UI, agent tools, command-line helpers, and background jobs must use the same query and mutation services. Porting the existing content tool into a new adapter without removing duplicate query logic would preserve its current inconsistencies.

Retain existing entry points temporarily as compatibility adapters, including content retrieval and history pin APIs. They call the new implementation rather than dual-writing old and new stores. Remove redundant internal implementations once their callers are migrated.

## 2. Exactly what is data versus application settings

Do not leave the entire old settings document outside merely because its historical filename is `settings.json`. It currently mixes preferences with domain records. Split by meaning.

| Keep outside: live application-wide settings | Put inside: application data |
| --- | --- |
| Theme, colors, panel widths, collapse states, docking and other display preferences | Project registrations, stable project IDs, paths/aliases, archive annotations and onboarding |
| Default selected project, global default model/agent choices, global budget/preferences | Authored custom agent definitions and revisions; captured definitions actually used on requests |
| Global defaults for future projects, including Git/delegation defaults | Actual project agreements, project-specific overrides, captured policy revisions, approved exceptions and operation receipts |
| Provider connection definitions, credential references and native MCP configuration | Observed model metadata, ratings, quota/usage observations, task outcomes and dated evidence |
| Launcher preference, configured application port, remote-access configuration and device trust settings | Goals, checkpoints, schedules and schedule runs, drafts, sender commitments, worker assignments and attempts |
| Location of the data store and bootstrap/version pointers | Memories, pins, content snapshots, imported chats, the OpenCode warehouse, facts, indexes and JEV judgments |

Use one versioned application-settings document/service, with atomic writes and revision checks. A JSON file is sufficient; this work does not require another settings database. Keep native provider/OpenCode authentication and MCP credentials in their existing configuration/credential owners rather than copying them into searchable data.

The database may retain an immutable, non-secret **settings or instruction snapshot used for a request**. That is historical evidence, not a second writable settings authority. A stored old agreement never overrides the current agreement when an action runs.

Project-specific records belong in the database even when the UI edits them on a Settings page. Authored source assets such as packaged skills remain source files; their versions/hashes and captured content can be recorded as evidence when needed. Do not move the repository itself into SQLite.

OS process locks remain OS/filesystem coordination primitives. Transient PID/socket discovery does not need to become warehouse content. Eliminate the existing incidental launcher-derived records database by routing its preference through the settings service.

## 3. Current code to reuse and repair

### Reuse Freelancer rather than replace it

Carry forward the extraction support, source locators, archive-member handling, hashes, staged publication, fact parsing, history handling, revision-safe drafts, explicitly selected import features, and native execution receipts already implemented. Refactor them behind shared services; do not discard established behavior in favor of a generic memory package. Database schema upgrades operate only on Freelancer data already created in the selected data root; they are not a path for locating or importing another installation's state.

Relevant existing boundaries include:

- `backend/tools/project-content-indexer.mjs` and `backend/opencode/tools/content_index.ts` for file extraction, facts and retrieval.
- `server/data/store.mjs`, `server/data/chat-search.mjs`, and `server/history.mjs` for user data, search, organization and pins.
- `server/data/model-ratings.mjs`, `server/model-ratings.mjs`, `server/data/imported-chats.mjs`, and `server/chatgpt-import.mjs` for ratings and imported history.
- `backend/tools/runtime/record-database.mjs`, `record-store.mjs`, `state-database.mjs`, `state-cli.mjs`, and `backend/scripts/state-database.ps1` for existing runtime persistence.
- `server/document-store.mjs`, `server/store.mjs`, sender, goals, Git services, observer and scheduler for dependent behavior.

### Correct these issues as part of consolidation

**Project identity:** the current content CLI derives its query key from the project directory, including for chat search, while application chat data uses registered project IDs. Resolve both through the same project registry. Directory aliases and Windows case/path handling must not manufacture duplicate projects or cross-link unrelated folders.

**Search filter parity:** the current Node search SQL does not apply the source/role/status filters used by other operations. Every advertised filter must affect results identically through the UI, native tools and CLI. Keep ordinary phrase/keyword search distinct from an explicitly selected advanced FTS expression mode.

**Durable references (implemented, schema 17):** staged indexing still replaces the current search projection, but immutable source/unit revision tables retain prior evidence. Stable content references include source identity, revision identity, locator and unit hash; revision IDs incorporate source content hash, extractor version and method. Source history is seeded from the existing index and extended transactionally during reindexing. Current and historical references resolve after reindex and index repair; durable pin/fact links to this same mechanism remain future integration work.

**Search repair:** the current repair path rebuilds a replacement database by copying an explicit list of durable tables. That list does not include future memory or consolidated operational domains. Ordinary index repair must rebuild only derived projections, not replace the whole operational database. Severe database recovery needs a complete schema-level lifecycle registry and verified preservation, not an easily outdated list.

The prior investigation demonstrated query inconsistencies in disposable fixtures. The relevant code patterns were rechecked on the new baseline; this plan does not claim that the old fixtures were rerun against a running current installation.

## 4. Specific outside code to port or adapt

Inspect and preserve source provenance before copying. Port behavior and tests into the existing Node/TypeScript service stack; do not bring in a second Python application framework merely because a reference implementation uses it.

| Source | Specific code | Use in Freelancer | Deliberately do not carry over |
| --- | --- | --- | --- |
| MCP reference Memory | `KnowledgeGraphManager` in `src/memory/index.ts` | Entity/observation/relation CRUD semantics, exact duplicate handling, endpoint validation, clear delete results, serialized mutation behavior | MCP registration/stdio, JSONL whole-graph rewrites, unbounded graph dumps, silently skipped import errors |
| Archived MCP SQLite | `SqliteDatabase` and query/schema tool dispatch in `src/sqlite/src/mcp_server_sqlite/server.py` | Parameterized query/result patterns, table/schema descriptions, analysis-to-insight concept | Demo prompts, unrestricted production DDL, SQL-prefix-based safety, in-memory-only insights |
| Basic Memory | `search_repository.py`, `sqlite_search_repository.py` | A shared search contract, matching count/filter semantics, structured metadata, explicit fallback when optional retrieval is unavailable | Markdown as a competing writable authority; mandatory project-scoped tool instances |
| MCP Memory Service | `storage/sqlite_vec.py`, `storage/mixins/hybrid.py` | Focused storage modules, lexical/semantic result fusion patterns, retrieval diagnostics and superseded-memory handling | A mandatory embedding stack; arbitrary raw-score scaling; failures disguised as empty search results |
| Mem0 | `SQLiteManager` in `mem0/memory/storage.py` | Memory revision history with actor, previous/new value and event type; batch history operations | Automatic extraction of every conversation or adopting the entire cloud/vector system |
| Graphiti | `EntityEdge` in `graphiti_core/edges.py`; edge maintenance | Separate valid time from recorded/expired time, provenance episodes and evidence-backed supersession | A graph-server dependency or model-driven contradiction decisions treated as automatic truth |
| Simon Willison's LLM | `llm/migrations.py` | Normalized conversations/responses alongside original JSON, usage fields, attachments and hashed reusable fragments | Treating every captured response as correct or making Freelancer the native session executor |
| Datasette | `datasette/database.py` | A serialized write path, bounded analytical reads, result limits and useful schema inspection | Another application server or another user/agent permission matrix |
| sqlite-utils | `Table.enable_fts`, `populate_fts`, `rebuild_fts` in `sqlite_utils/db.py` | External-content FTS maintenance, insert/update/delete triggers and explicit rebuilds | Generic user-supplied DDL on the operational database or a new Python runtime dependency |

Memory's current upstream license file describes a MIT-to-Apache-2.0 transition; it is not enough to label every current line “MIT.” For direct ports, pin the exact commit/blob, retain applicable notices, document modifications and record the tests ported. The archived SQLite reference has an MIT license. For the other projects, confirm the license of the actual files/version before copying; pattern-inspired implementations are separate decisions from direct source ports.

## 5. Database design

### Design rules

Use stable string identities at domain boundaries, foreign keys within the Freelancer database, explicit revisions, and UTC timestamps. Keep normalized fields for joins, filters and state machines. Preserve original non-secret payload JSON for forward compatibility and forensic detail; avoid requiring repeated JSON scans for common queries.

Names below are a proposed logical schema. Existing tables may be extended or renamed with compatibility views where that reduces migration risk. Do not add a table solely to match this document when an existing coherent table already serves the purpose.

### A. Identity and provenance

| Proposed tables | Core fields / responsibility |
| --- | --- |
| `projects`, `project_aliases` | Stable project identity, canonical location, verified aliases and lifecycle |
| `runtime_instances` | Explicit installation/runtime identity, origin checkout, native endpoint identity and version observations |
| `source_systems` | OpenCode installation, imported file catalog or external source identity |
| `schema_migrations`, `migration_runs`, `migration_items` | Version/cutover records, legacy-origin mapping, counts, hashes and import dispositions |
| `mutation_receipts` | Idempotency keys, exact mutation result and revision; not proof that an external action happened |

Native identifiers are scoped by source-system identity. Two OpenCode installations with the same session string must not merge accidentally. Moving a checkout or restoring a backup must preserve intentional ownership mappings rather than infer ownership from a folder basename. Runtime-record imports require an explicit stable runtime ID and scope operational records, preserved documents, registrations and settings by that ID.

### B. Operational data

Move the existing request, usage, goal, sender, schedule, delegation and Git-operation records into the one database. Give frequently queried identities/states relational columns while preserving complete immutable captures.

| Proposed domain | Records to retain |
| --- | --- |
| Requests and captured instructions | Request ID, runtime/project/session, parent/root request, selected/observed model, agent-definition revision, instruction/config snapshot, acceptance and terminal states |
| Usage and outcomes | Native response identity, measured token details, actual/unknown usage, verification state, task category, outcome revisions and source evidence |
| Goals and checkpoints | Authored goal, revision, native conversation link, captured plan, checkpoint evidence and continuation state |
| Deliveries and schedules | Queue/Steer/worker handoff content, edit generation, idempotency/acceptance/uncertainty, scheduling definitions and run receipts |
| Worker execution | Assignment, attempts, parent/root identity, native binding, reservations, recorded choices, verified cancellation and forks |
| Git/GitHub | Project agreements and revisions, previews/fingerprints, actual approval records, execution receipts and uncertain-result recovery |
| Catalog and research | Model metadata, dated estimated ratings, research jobs, authored agent definitions/revisions, recorded eligibility evidence |
| Organization and drafts | Archives, imported continuation state, unsent drafts, revision tombstones and onboarding |

**Storage unification is not a rewrite of these state machines.** Use their existing domain services and preserve acceptance, ownership, uncertainty and no-replay behavior. An analytical query of worker history does not launch a worker. A remembered permission claim cannot substitute for the recorded user approval.

A temporary legacy-document table is acceptable during migration for records not yet normalized. It must have a declared owner, origin, lifecycle, disposition and indexed identifiers where needed. It is not permission to retain the old second database forever or to make a generic JSON bag the final analytics model.

### C. Warehouse and stable evidence references

| Proposed tables | Core fields / responsibility |
| --- | --- |
| `source_objects` | Stable object ID, source system, native/source identity, object kind, optional project, canonical locator and availability |
| `source_revisions` | Object ID, revision identity/content hash, source time, capture time, payload/representation, coverage and extraction status |
| `warehouse_sessions`, `warehouse_messages`, `warehouse_parts` | Normalized source-native IDs, parent/role/model/order/state, revision links and payload metadata |
| `ingest_runs`, `ingest_cursors` | Discovered range, completed range, resumable position, errors and coverage; a cursor alone never proves completeness |
| `evidence_refs` | Immutable revision plus precise text span/page/rows/message/part/tool-call locator and quoted-evidence hash |
| `attachments` | Content-addressed attachment identity, media type, original reference, captured availability and retained bytes when appropriate |

Warehoused payloads are source snapshots, not writable substitutes for the native objects. Avoid duplicating a transcript for each memory that points to it. Pinning retains references to specific already-warehoused revisions and captures missing pieces as necessary.

Default storage retains structured/text payloads and useful small evidence artifacts. Large media can remain managed, content-addressed files with database metadata and an explicit backup manifest; no second database is introduced. Missing or uncaptured attachment bytes must be visible rather than implied present. Source code and Git files remain original files; indexed/extracted representations are database content.

### D. Content extraction and search

Refactor the current source/unit/fact system to use stable objects and revisions. Retain extraction method, version, locator kind, source hash, coverage, skipped formats, errors, language and archive-member identity.

Use `content_segments` (or an evolved `content_units`) for retrievable sections. Segment identity derives from the source revision and extractor/locator, not a row number that happens to survive today. Separate metadata-only sources from successfully extracted sources.

`search_documents` holds normalized searchable projections. A corresponding FTS5 table covers title, text, aliases and useful labels. Index author/role/model/time/source-kind fields for structured filtering rather than stuffing all of them into one text blob.

### E. Memory and knowledge graph

| Proposed tables | Core fields / responsibility |
| --- | --- |
| `entities`, `entity_aliases` | Stable identities and human-readable names/types; aliases do not erase distinct similarly named entities |
| `memory_items`, `memory_item_revisions` | Durable notes, remembered decisions, saved conversations, lessons and reference collections |
| `memory_members` | Ordered membership of source revisions, evidence spans and claims in a memory item |
| `memory_pins` | The single canonical pin state, pin time, optional rank and revision |
| `claims` | Shared representation of observations and extracted facts, distinguished by origin, method and epistemic status |
| `claim_evidence`, `entity_relations` | Supporting/contradicting/context links and directed graph relations with provenance |
| `memory_changes` | Correction, supersession, merge and deletion records with explicit actor/source |

Map the Memory reference server's observations into `claims`; do not establish two competing stores called “observations” and “facts” containing the same assertion. A memory item can organize one or many claims, and can also retain an exact source without claiming it is true.

Distinguish human-authored, user-stated, source-reported, directly observed, deterministically extracted and model-inferred content. “An assistant said X” is evidence of that statement, not proof of X. A pin signals intentional retention/priority, not factual validation.

### F. Fact shape and time

A fact/claim should support:

| Field group | Required meaning |
| --- | --- |
| Identity | Claim ID, subject entity, predicate, object entity or typed value |
| Value | Text/number/boolean/date/JSON, units, original literal and normalized representation |
| Context | Qualifiers such as version, platform, task type, project/source origin, polarity and condition |
| Epistemic state | Observed/reported/inferred, supported/disputed/superseded/unverified; separate from relevance or pinning |
| Time | When the source says it applied (`valid_from/to`), when it was observed, when Freelancer recorded it, and when superseded |
| Provenance | Evidence references, extraction method/version, asserting actor, actual model/provider where known |
| Relationship | Supports/contradicts/qualifies/supersedes, with reasons and evidence |

Unknown validity dates remain NULL. Do not infer an expiration date simply because a newer claim arrived. Two claims about different library versions or projects can both be correct. Preserve a contradiction until its scope and evidence resolve it.

### G. Judgments and reusable analytical views

Store JEV and other model judgments separately from underlying facts. Use `judgment_definitions`, `judgment_runs`, and `judgment_results`, plus optional validated labels for evaluation.

Provide documented views such as current source coverage, pinned memories, current supported claims, task outcomes, model evidence by task type, worker results, and query-specific judgment evidence. These are proposed view purposes, not another authorization system.

## 6. Pinned chats become pinned memory

This is a behavioral conversion, not a rename of `pinned_at`.

### Canonical behavior

A chat's Pin action creates or finds a `memory_item` of kind `conversation_snapshot` and pins that item. It retains the title, original project/source identity, native conversation link, capture boundary, captured revision membership and optional user note. The original chat remains where it is.

The conversation list's pin icon and the global Pinned Memory view derive from the same `memory_pins` record. Do not keep independently writable chat-pin and memory-pin flags.

The default capture is the selected conversation. Preserve links to verified child workers; capture/include their evidence according to the displayed snapshot membership rather than silently importing unrelated sessions. The memory can also retain selected messages or excerpts through the same membership model.

### Long-running or changing conversations

Save the pin request and a durable snapshot-materialization job first. Clearly distinguish **pin saved**, **snapshot capturing**, **captured through a stated boundary**, and **capture incomplete**. Do not block the UI until a long transcript has finished downloading, and do not claim a complete saved snapshot just because the pin transaction succeeded.

For an active conversation, capture a bounded observed revision; do not claim a perfectly atomic whole-conversation view unless the source API supports one. Further native messages update the warehouse but do not silently rewrite the curated memory. Show that newer source content exists; Refresh snapshot creates a new memory revision.

### Existing pins

Convert every old `session_annotations.pinned_at` into the canonical pinned-memory representation, once. Preserve the legacy pin timestamp, session/project link, annotation revision, and prior display order where reconstructible.

The old pin records do not contain a historical transcript snapshot. Record **originally pinned at** separately from **captured at**. Do not invent the text that existed at the older timestamp. If the original session is missing, preserve a pinned placeholder with its known title/identity and an explicit missing-source status.

### Unpin, forget and archive

Unpin removes priority, not the retained memory or original conversation. Forget/delete removes the identified memory according to its documented deletion policy, not the original OpenCode session. Archiving a conversation or project does not delete its memory. A later sync must not resurrect a deliberately forgotten memory from old pin annotations or a legacy JSONL file.

Provide search and readable details: saved source, retained snapshot, provenance, derived claims, related entities, later contradictions and revisions. Pinning never turns quoted instructions into current system instructions.

## 7. Bridge and warehouse OpenCode data

Use the current supported OpenCode API/export paths for live ingestion. The server advertises its API; inspect the installed contract rather than assume the SDK pin proves the executable version. A direct read-only snapshot importer can be a separately tested compatibility path, but it is not required for ordinary ingestion and must never write the native database.

### Capture what is useful and actually available

Warehouse session hierarchy, user/assistant text, message/part identities, source-visible tool calls and outcomes, timestamps, actual reported models, usage, files/attachments and native task snapshots where exposed. Preserve safe original payload fields alongside indexed normalized columns. Do not collect authentication documents or fabricate unsupported fields. Do not seek or infer hidden model reasoning; private/internal reasoning is not needed for the knowledge layer.

Capture operational facts such as “tool exited nonzero,” “worker reported this change,” and “verification was not run” with their original evidence. Do not derive “task successful” from a terminal response or idle session alone.

### Ingestion process

1. Register a stable source-system identity and record the API/runtime version observed.
2. Backfill sessions and messages in bounded pages, with a durable run/cursor and an overlap window for changing timestamps.
3. Treat native events as invalidation hints, not as an assumed durable replay log. Fetch the corresponding authoritative snapshot.
4. Upsert by source-system + native object identity + content/revision identity. Repeated events, reconnect and scans must not duplicate messages, usage or facts.
5. Coalesce streamed part updates. Preserve useful completed revisions rather than archiving every token delta as a new full object.
6. Commit the source update and a durable “needs derivation” marker in the same transaction. Extraction runs later, outside the write transaction.
7. Advance completion/coverage only after durable publication; record individual failures and gaps.
8. Reconcile periodically. Only confirmed deletions or a complete comparable inventory can establish removal; an outage, truncated page or changed permission cannot.

Keep `source_updated_at`, `captured_at`, `indexed_at`, coverage and source availability distinct. Handle native compaction, restore and schema changes without losing saved source revisions. Old warehouse data remains available as historical data while the engine is offline; live execution still requires native confirmation.

## 8. Index and build facts

### First: deterministic facts

Retain and strengthen the existing extractors for structured values, headings, tables, file metadata, manifests and source-linked text. Derive deterministic operational facts from actual records: durations, retries, exit states, model identities, observed usage and verification categories.

Maintain labels/units before aggregating. Never average unlike measurements or treat NULL, skipped, unavailable and failed as the same outcome. Distinguish a model's estimated rating from a measured task result.

### Then: optional semantic enrichment

For material where semantic understanding helps, an explicitly enabled enrichment job can propose entities, topics, task characteristics, decisions, requirements, lessons, relation candidates and claim/evidence links. Store the extractor/model/version, source revisions, actual scope, and unverified status.

JEV can classify or compare already-supplied alternatives and evidence spans. It should not be asked to invent arbitrary missing entity names, facts or prose summaries. Use deterministic parsing or an appropriate generative model for those tasks, then retain source links and validate.

Never add an unconditional model/JEV call to every transaction, file read, pin, or completed todo. A service outage or exhausted budget leaves enrichment pending/unavailable while storage and ordinary search continue working.

### Idempotency and rebuilding

Derivation identity includes source revision, extractor/question version and relevant options. A rerun with identical inputs does not multiply facts. A changed extractor creates a new derivation version; it does not erase manually corrected memories.

Reindexing rebuilds projections. It must preserve operational records, authored memories, pins, provenance, explicit corrections, and captured source revisions retained for evidence. Deleting a source cannot cascade-delete an independently authored memory merely because the original evidence is now unavailable.

## 9. Standard and JEV-centric query

### Standard retrieval

Support natural-language keyword/phrase search, structured filters, exact source/object reads, graph neighborhood expansion, typed fact aggregation and read-only relational analysis. Global is the default knowledge scope; project-local UI searches apply an explicit filter. All agents can issue either scope.

Start with FTS5 and indexed relational metadata. Combine candidate lists through a rank-based method when multiple channels are used; do not add incomparable raw BM25, vector and model-confidence values as though they shared a scale. Embeddings can be added inside the same database later if measured retrieval gaps justify them. They are not a prerequisite for basic retrieval.

Keep pins as a bounded, explainable priority signal, not an instruction to return irrelevant pinned content. Support querying current, historical, contradicted and superseded records explicitly. Exact source references remain usable even when not highly ranked.

### SQL analysis

Borrow SQLite MCP's schema-discovery and query ergonomics, but use a dedicated read-only analytical connection/worker. Provide column meanings, origins, stable views, named parameters, bounded results, execution budget, cancellation and clear truncation.

Use engine-backed read-only controls and authorizer/driver facilities supported by the selected runtime, not “SQL starts with SELECT” as the enforcement mechanism. Test CTEs, comments, PRAGMA, ATTACH and extension-function behavior. Do not assume a specific Node driver version exposes a feature without checking.

Memory writes and operational changes use the same typed service methods available to every agent. An analytical tool is not a route for directly rewriting delivery/approval receipts. This is API integrity applied equally to the platform, not an access matrix.

### A common result envelope

Return stable result IDs, type, original source reference, source revision/hash, observed/captured/indexed dates, coverage, applied filters, match reasons, evidence/claim status, truncation and next-page information. Include machine-readable result fields and compact model-readable text.

“No matches” is a successful query with zero results. Missing database, unavailable source, malformed query, index error and incomplete coverage are different results. Never convert those failures into an empty list that looks authoritative.

### JEV-ready evidence packets

A bounded decision packet should contain the question purpose, explicit candidates with stable IDs, relevant structured attributes, cited source spans, unknown/conflicting attributes, source revisions/hashes, and the criteria definitions. It should be small enough for its actual purpose, not a dump of the database.

Use the installed JEV capability or a single shared judgment-provider adapter. Do not create another MCP service to connect the knowledge layer to JEV. Centralize request/result normalization; do not let multiple wrappers create inconsistent billing or confidence semantics.

Separate **source-level reusable annotations** from **query-specific judgments**. “This passage concerns cancellation” may be reusable. “This passage best answers query Q” is not a permanent property of that passage.

### Judgment metadata

Store:

- Query/state hash, candidate IDs and candidate-set hash, evidence-reference IDs and source-revision hashes.
- Question ID **and complete question/criteria text or immutable version reference**, primitive, optional ordered score-level definitions and definition version.
- Requested and actually reported provider/model identities; capture date, latency, status and actual usage when available.
- Raw typed answer and probability distribution; confidence only where that primitive supplies it; NULL for missing measurements.
- Derived ranking/margin features clearly labeled as computed, not provider-reported.
- The eventual caller decision, overrides and optional independently verified outcome for evaluation.

The current TypeSafe primitives are Choice, Noul and Score. Choice compares alternatives; Noul returns a yes probability without a separate confidence value; Score uses defined ordered levels. Independent questions over the same state can be batched. A dependent next question needs a new request with the earlier result explicitly supplied.

Cache by state/query/evidence/candidate/criteria/model identity, not just by natural-language query. Invalidate when relevant evidence or criteria changes. A probability is a model judgment—not calibrated factual correctness, authorization or proof of a test result.

### Useful JEV applications

| Routine | Bounded judgment | What remains authoritative |
| --- | --- | --- |
| Search | Relevance or answer-support judgments over retrieved candidates | The source text and its capture/coverage |
| Model choice | Compare the small eligible set using recorded outcomes and task requirements | Existing eligibility, explicit user choice and consent |
| Debugging | Compare explicit hypotheses after observations are collected | Reproduction and discriminating tests |
| Review | Triage grounded findings; assess whether cited evidence supports a stated violation | Source/requirements and actual verification |
| Memory maintenance | Flag likely duplicates, contradictory scope or useful durable candidates | Explicit corrections, original evidence and user intent |
| Goal orientation | Rank relevant decisions/lessons for the current task | The current goal, repository and runtime state |

Do not silently send the full local warehouse to an external judgment service. Reuse existing configured authorization/cost behavior and send only the bounded evidence needed. Missing JEV never blocks ordinary search, reasoning, pinning or storage.

## 10. UI and native tools

### One knowledge interface

Evolve the current indexed search and pinned-chat surfaces into a unified knowledge view with Files, Conversations, Memories and Facts as result-type filters. Add Pinned Memory as the home for deliberately retained knowledge. Keep a clear route back to the original conversation/file and distinguish opening the retained snapshot from opening the live source.

Use existing theme, controls, dialogs, loading/error patterns and project navigation. Provide concise provenance and expandable evidence details rather than a graph visualization as the default. A graph view can be optional; it is not required to understand or edit memory.

Tools and Skills panels in Capabilities remain collapsible, as do service details where appropriate. Collapse is presentation state in application settings; it cannot change the toolkit received by models.

### Native operation surface

Expose the shared service using compact native OpenCode tools with exact schemas. The functional groups are search/read, memory mutation and graph relations, pin management, schema/query, evidence-packet preparation, and refresh/status. Select actual names after inspecting the current registration surfaces; avoid a new tool for every table.

Tools must work directly without loading a skill. No mandatory catalog discovery, JEV judgment, special persona or workflow is needed. Keep the current content tool as a temporary delegating adapter where compatibility warrants it, not as a second query engine.

### Guidance updates

Update the actual current orientation, search, memory, model-selection, handoff, review and goal guidance. Explain when global memory, source-backed facts or JEV-ready comparisons help; preserve local-source-first investigation. Do not blindly invent new skill names or repeat full capability descriptions in every persona.

## 11. Reliability, privacy, backup and performance

Use one coordinated short-transaction write path, read workers for analytical SQL, and extraction workers outside transactions. Do not hold a write lock while calling OpenCode, reading a large source, running a model, or waiting for a browser. Persist job claims/checkpoints so a failed process does not lose work.

Operational writes have priority over rebuild batches. Bound ingestion batches and analytical queries; report partial progress. Preserve the existing fast request/usage lookups and avoid repeated whole-document rewrites in hot paths. Backpressure must not make the UI appear to have saved a draft before its revision commits.

Verify the **actual embedded SQLite engine version**, not just the Node/npm package name. SQLite documents a WAL-reset bug fixed in 3.51.3 and in specified backports (including 3.44.6 and 3.50.7). Check the selected Node/Bun/other drivers against that guidance before using multi-connection WAL. This is a compatibility acceptance requirement, not a claim that the user's installed database is affected.

Require local filesystem storage, foreign-key checks, migration/version validation, bounded busy handling, deliberate WAL checkpoints and consistent backups. The completed database backup and the separate settings snapshot need a matching manifest/revision; two files cannot be made atomic merely by renaming each one. Keep user-visible recovery instructions and validate restoration on a disposable copy.

Treat transcripts, tool output, memories and drafts as potentially sensitive local data. Do not copy credential stores into the database or enable cloud synchronization. Drafts are stored for recovery but are not automatically included in general agent knowledge search. An explicit task can use the appropriate draft domain API; storage does not imply automatic broadcast into prompts.

Deletion must distinguish unpin, archive, forget, source deletion, derived-index cleanup and explicit permanent purge. Document backup retention and do not claim secure erasure. A forgotten memory must not reappear because a legacy importer runs again. Preserve a minimal tombstone or import marker without unnecessarily retaining deleted sensitive text forever.

## 12. Runtime status and cutover

### Implementation status (2026-10-02)

The branch has schema 17, memory/pin and evidence-backed claim foundations, and fail-closed Node/Bun adapters. The source-level inventory in [storage-consumer-inventory.md](storage-consumer-inventory.md) covers in-repository consumers. Normal source startup checks the fresh `workspace-v1` directory before opening SQLite for writes. It initializes an empty runtime, validates its stable registration on later starts, and activates unified storage before OpenCode starts. A non-empty unregistered directory/database is rejected without importing prior Freelancer data. Old storage adapters and importers remain available for explicitly invoked maintenance workflows; clean first-run setup never opens or imports a user's previous Freelancer data.

Schema 13 adds stable content-source identities and revisions. Schema 17 retains immutable source and unit revisions through reindexing and index repair. Schema 14 adds typed judgment definitions and receipts; schema 16 repairs definition versioning without changing existing receipts. Schema 15 adds safe OpenCode session/message snapshots and bounded API backfill; reasoning parts are omitted and file payload bytes are hashed, not copied. The native knowledge adapter can evaluate immutable question definitions against bounded caller-supplied state packets, requests native permission before provider use, and records typed answers and provenance. A synthetic eight-pair relevance fixture ranked every labeled candidate first (top-1 accuracy and mean reciprocal rank 1.0); representative live retrieval evaluation remains open.

The graph tool supports exact entity lookup, relation and entity deletion guards, and pin/unpin writes to canonical memory pins. UI, native-tool, CLI and file searches share AND-term/phrase behavior and file filters. Backup/restore utilities preserve the Freelancer database and settings but do not bundle project sources, OpenCode native state or credentials. The app-local startup smoke verified bootstrap, named agents and native tools without requesting inference; it does not verify provider authentication or inference. Remaining work includes routing and checking every consumer, expanding warehouse coverage and retrieval acceptance, and verifying restore behavior. Do not treat the existing maintenance import commands as authorization to import prior Freelancer state.

### Phase 1 — Inventory and shared contract

Recheck the current branch and map in-repository runtime consumers and access timing in `storage-consumer-inventory.md`; it covers shared-adapter callers, PowerShell CLI bridges, native/source-owned stores, settings and OS coordination boundaries. Inventory code paths and contracts, not the user's previous installation or private state. Keep the standalone JSON importer and stopped-runtime backup/restore commands out of first-run bootstrap; do not run them against prior Freelancer data. Define the Freelancer/OpenCode ownership split explicitly. Record schema versions and fixture coverage for data created by this application. Add port provenance and license notices before copied code enters the repository.

Extract common query/memory/domain interfaces and fix retrieval identity/filter parity first. Add compatibility tests before changing persisted formats.

### Phase 2 — Target database and compatibility adapters

Create target migrations and add runtime/source identity. Implement normalized data access while retaining complete old payloads during the transition. Make existing application, Node, native Bun and PowerShell consumers use the same resolver and adapter. Preserve boot/shutdown paths that run before the application server is available; do not introduce an HTTP-only circular startup dependency.

### Phase 3 — Fresh runtime bootstrap

Create the per-user Freelancer data root and initialize its database from the current schema with no scan or import of previous Freelancer directories, JSON stores, databases, settings profiles, pins, or Memory files. Initialize Freelancer-only preferences with application defaults. Load provider inventory, authentication methods, general OpenCode options and MCP configuration from the user's native OpenCode environment. Keep schema migrations for subsequent versions of this newly initialized database. Explicitly selected import features remain opt-in and separate from bootstrap.

### Phase 4 — Fresh runtime authority

Route every Freelancer consumer to the fresh per-user database and separate Freelancer-only settings document. Do not reconcile or copy records from a previous installation. Keep a single write authority: a lost acknowledgement cannot cause a duplicate send, Git operation, worker or scheduled run. Uncertain state remains uncertain until the original domain reconciles it.

Back up and restore the newly created Freelancer data using the verified backup contract. Schema rollback or restore must never silently fall back to a previous installation's stale data. Document the boundary between restoring a backup the user explicitly selected and importing state during first-run setup.

### Phase 5 — Warehouse, memory and pins

Enable bounded OpenCode backfill/reconciliation, source revisions, fact derivation and global memory/pin surfaces. Show coverage and partial states from the first usable release. Leave the user's native MCP configuration and existing Memory service under OpenCode ownership; do not retire, rewrite or import that service as part of this goal. No new MCP transport is needed.

### Phase 6 — Query quality and optional JEV enrichment

Add schema/analytical queries, evidence packets and versioned judgment storage. Exercise JEV reranking/comparisons through the existing authorized capability, with a no-JEV fallback. Measure retrieval/evidence quality before enabling background enrichment broadly. Optional vectors remain a later optimization, not unfinished basic functionality.

### Phase 7 — Remove obsolete paths

Remove obsolete writable runtime data stores, duplicated query implementations, legacy pin authority and phantom capability descriptions. Update storage UI, backup/reset scripts, tests and documentation. Leave source files, credentials, global settings and upstream OpenCode ownership intact.

Implementation can use bounded parallel work with disjoint ownership. Rotate eligible free workers for isolated implementation/tests/review where useful; the parent also implements bounded parts and reviews/integrates all changes. Do not add a permanent routing ceremony to the product to enforce this development method.

## 13. Acceptance checklist

### Consolidation and authority

- [ ] A clean installation initializes one empty per-user Freelancer data database for operational, content, warehouse, memory, pin and judgment records without searching or importing prior Freelancer data.
- [x] Freelancer-only application preferences have a separate authority; general OpenCode options, provider inventory/authentication, and MCP configuration remain native. Host-overlay contracts verify native config/env preservation; provider inventory/auth paths use OpenCode APIs and dynamic IDs.
- [x] Native OpenCode storage, credentials and source/Git authority remain untouched by clean bootstrap and Freelancer's plugin-only config overlay.
- [ ] Node, Bun, PowerShell, CLI and launcher consumers resolve the intended store and cannot create incidental alternate databases.
- [ ] Multiple runtime/source origins retain identity without creating agent/model/project knowledge-access matrices.
- [ ] Uncertain sends, worker attempts and Git operations created in the current data store cannot be replayed by reading or indexing their records.

### Memory and pins

- [ ] Reference Memory domain operations have tested native equivalents without an MCP dependency.
- [ ] Concurrent duplicate-safe additions, corrections, relation updates and delete results are transactional and deterministic.
- [ ] New chat pins become canonical pinned memories, preserving time, identity and recoverable order.
- [ ] Legacy pin time is not misrepresented as snapshot capture time.
- [ ] Missing sources produce retained labeled placeholders rather than fabricated content or lost pins.
- [ ] Active-chat capture shows the actual boundary and incomplete state; refresh creates a new revision.
- [ ] Unpin, forget, archive and original-source deletion have distinct tested behavior.
- [ ] Search repair, source refresh and extractor upgrades preserve authored memory, pins and retained evidence.

### Warehouse and facts

- [ ] Repeated native events, rescans and reconnects do not duplicate sessions, parts, usage, attachments or claims.
- [ ] Backfill resumes and reports exact scope/coverage; partial inventories do not imply deletion.
- [x] Current and historical source revisions can be read by stable evidence references after reindexing.
- [ ] Facts identify source, method, scope, validity and epistemic state; unsupported inference is never labeled observed.
- [ ] Outcome aggregates distinguish passed, failed, skipped, unavailable, not-run, unknown and cancelled states as appropriate.
- [ ] Full-text, relation and fact indexes can be rebuilt without replacing the whole operational database.

### Query and JEV

- [ ] Equivalent UI, native-tool and CLI queries use identical identities, filters and retrieval semantics.
- [ ] Global queries and optional project/model filters are available to every agent and supported model.
- [ ] Empty results, missing capability, failed query and partial coverage remain distinguishable.
- [ ] Analytical SQL supports documented views and named parameters with tested engine-backed read-only behavior and cancellation.
- [ ] JEV packets contain actual candidate/evidence references, explicit criteria and unknowns rather than invented model facts.
- [ ] JEV results retain their primitive semantics, actual model identity, input revisions and measured/unknown usage.
- [x] Independent questions can batch; cache invalidation responds to changed evidence and criteria.
- [ ] JEV failure or non-use never prevents ordinary database operations, search or model reasoning.
- [ ] Judgment confidence does not authorize work or promote an inference into verified truth.

### UI, bootstrap and reliability

- [ ] Pinned chat indicators and Pinned Memory read one canonical pin state with no dual-write divergence.
- [ ] Tools/Skills collapse behavior persists as UI settings only.
- [ ] Full-text rebuild, database recovery and destructive reset are separate operations with appropriate preservation.
- [ ] Backup/restore validates the selected Freelancer database and settings consistency, references, operational uncertainty and pin/memory counts; restore is an explicit user action, never first-run import.
- [ ] Actual embedded SQLite engines and required driver facilities are verified and recorded.
- [ ] Full relevant repository validation passes on supported platforms; fixture, native-runtime, model-inference and visual evidence are reported separately.
- [ ] A representative retrieval evaluation covers exact IDs, Unicode, paraphrases, contradictions, historical questions, pinned chats, missing sources and multi-project results.
- [ ] Large backfills and analytical queries do not starve drafts, sends, cancellation or ordinary UI reads.

## 14. Definition of done

Freelancer has one authoritative data database and a separately managed application-settings surface. Existing operations retain their behavioral contracts. Global memory, saved/pinned conversations, indexed source evidence and native execution history can be queried together without confusing one for another. Useful Memory/SQLite reference code has been adapted with provenance, not wrapped in another MCP process. Every agent receives the same native capabilities, and optional JEV reasoning operates on evidence rather than creating a new control layer.

## Source references

### Freelancer source baseline

- [Current schema](https://github.com/Echomatter/Freelancer/blob/dd608415800635eedd053f67c3d0b6cd0d918756/server/data/schema.sql)
- [Pin implementation](https://github.com/Echomatter/Freelancer/blob/dd608415800635eedd053f67c3d0b6cd0d918756/server/history.mjs#L448)
- [Pin UI and acknowledgement behavior](https://github.com/Echomatter/Freelancer/blob/dd608415800635eedd053f67c3d0b6cd0d918756/src/ChatManagement.tsx#L195)
- [Content query/publication implementation](https://github.com/Echomatter/Freelancer/blob/dd608415800635eedd053f67c3d0b6cd0d918756/backend/tools/project-content-indexer.mjs#L228)
- [Search repair preservation behavior](https://github.com/Echomatter/Freelancer/blob/dd608415800635eedd053f67c3d0b6cd0d918756/server/data/store.mjs#L156)
- [Storage ownership and runtime migration](https://github.com/Echomatter/Freelancer/blob/dd608415800635eedd053f67c3d0b6cd0d918756/docs/storage-performance.md)
- [Current Memory/JEV connection templates](https://github.com/Echomatter/Freelancer/blob/dd608415800635eedd053f67c3d0b6cd0d918756/src/mcp-catalog.mjs)
- [Current TypeSafe integration guidance](https://github.com/Echomatter/Freelancer/blob/dd608415800635eedd053f67c3d0b6cd0d918756/backend/skills/typesafe-ai/SKILL.md)

### Source-port examples and technical references

- [MCP Memory implementation](https://github.com/modelcontextprotocol/servers/blob/main/src/memory/index.ts) and [current licensing statement](https://github.com/modelcontextprotocol/servers/blob/main/LICENSE)
- [Archived SQLite reference implementation](https://github.com/modelcontextprotocol/servers-archived/blob/main/src/sqlite/src/mcp_server_sqlite/server.py) and [license](https://github.com/modelcontextprotocol/servers-archived/blob/main/LICENSE)
- [Basic Memory search contract](https://github.com/basicmachines-co/basic-memory/blob/194afe165b3e7676496aaa53b70e39a78ea5aa4f/src/basic_memory/repository/search_repository.py) and [SQLite implementation](https://github.com/basicmachines-co/basic-memory/blob/194afe165b3e7676496aaa53b70e39a78ea5aa4f/src/basic_memory/repository/sqlite_search_repository.py)
- [MCP Memory Service storage composition](https://github.com/doobidoo/mcp-memory-service/blob/main/src/mcp_memory_service/storage/sqlite_vec.py) and [hybrid retrieval](https://github.com/doobidoo/mcp-memory-service/blob/main/src/mcp_memory_service/storage/mixins/hybrid.py)
- [Mem0 SQLite history implementation](https://github.com/mem0ai/mem0/blob/main/mem0/memory/storage.py)
- [Graphiti temporal edge model](https://github.com/getzep/graphiti/blob/main/graphiti_core/edges.py) and [edge maintenance](https://github.com/getzep/graphiti/blob/main/graphiti_core/utils/maintenance/edge_operations.py)
- [LLM conversation/usage/fragment migrations](https://github.com/simonw/llm/blob/764dc386c58b625f3ad9d203e699715ad208455f/llm/migrations.py)
- [Datasette database execution](https://github.com/simonw/datasette/blob/main/datasette/database.py)
- [sqlite-utils FTS implementation](https://github.com/simonw/sqlite-utils/blob/main/sqlite_utils/db.py)
- [OpenCode server API](https://opencode.ai/docs/server/)
- [SQLite FTS5](https://sqlite.org/fts5.html), [WAL and current bug advisory](https://sqlite.org/wal.html), [online backup](https://sqlite.org/backup.html), [authorizer API](https://sqlite.org/c3ref/set_authorizer.html)
- [TypeSafe API](https://docs.typesafe.ai/api), [question primitives](https://docs.typesafe.ai/primitives), [citation checking](https://docs.typesafe.ai/cookbooks/citation_check)

Source links to an unpinned main branch describe the inspected example, not a dependency pin. The implementation's port manifest must freeze exact revisions before copying those files. Known inspected blob/commit identifiers are recorded in the companion map.
