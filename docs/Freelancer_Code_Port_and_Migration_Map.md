# Freelancer code-port and migration map

Companion to **Freelancer Unified Data, Memory, and Evidence Warehouse**.

**Baseline:** GitHub main `dd608415800635eedd053f67c3d0b6cd0d918756`, inspected October 2, 2026. This is an implementation specification and source-port assessment, not copied application code, a completed migration, or a pull request.

> **Current execution boundary:** use this map as feature and provenance
> reference. The active goal does not import any prior Freelancer data. Provider
> inventory/authentication, MCP configuration and general OpenCode options are
> native OpenCode concerns; only Freelancer-specific warehouse and presentation
> settings remain app-owned. Prior-data import requires a separate explicit
> user request and verified backups.

## 1. Source-port register

“Port” means adapting the useful domain behavior and corresponding tests. Transport removal does not remove license obligations. Freeze the actual source revision and retain notices before code enters Freelancer. A source blob hash identifies the inspected content; it is not the same as a repository commit or package version.

### P01 — MCP reference Memory

**Source:** `modelcontextprotocol/servers`, `src/memory/index.ts`.

**Inspected blob:** `d9f814877be5cdbd11b23c63f20e1788d6d7791f`.

**Implementation examined:** `KnowledgeGraphManager`, `withLock`, JSONL loading/saving, `createEntities`, `createRelations`, `addObservations`, and delete behavior.

**Adapt directly:** familiar entity/type/observation and directed-relation semantics; idempotent duplicate handling; validation that relation endpoints exist; precise mutation results; failures must not permanently stall the mutation queue.

**Replace:** array scans and whole-file rewrites with indexed SQL and short transactions. Use stable IDs rather than globally identifying everything only by a display name. Preserve useful original names as aliases. Map observations to provenance-aware claims and returned delete outcomes to the shared service's normal result envelope.

**Do not port:** MCP server registration, stdio transport, resource subscriptions, package-relative persistence, complete-graph prompt dumps, or silently skipped bad lines as successful migration. The importer must account for every legacy record, including malformed/quarantined rows.

**Tests to carry or implement:** duplicate inputs within one batch; repeated identical calls; missing relation endpoints; concurrent writers; failed mutation followed by a valid mutation; deleting an entity and its relations; Unicode; malformed import accounting; restart persistence.

**License note:** inspected root LICENSE explicitly describes an MIT/Apache-2.0 transition. Record applicable file/version notices rather than assigning one guessed license to the whole current tree.

### P02 — Archived SQLite MCP reference

**Source:** `modelcontextprotocol/servers-archived`, `src/sqlite/src/mcp_server_sqlite/server.py`.

**Inspected blob:** `44913c817f6456b20db780f7cabba91795637328`. Root license inspected: MIT.

**Implementation examined:** `SqliteDatabase._execute_query`, `_synthesize_memo`, `handle_call_tool`, `list_tables`, `describe_table`, `read_query`, `write_query`, `create_table`, `append_insight`.

**Adapt:** named-parameter query execution concept, column-keyed rows, table/schema discovery and explicit analysis-to-insight capture. “Append insight” becomes a durable memory/claim operation with its query/evidence references.

**Rewrite rather than copy:** SQL mode detection. The example uses `startswith('SELECT')` and interpolates a table name into `PRAGMA table_info`; that is not the target design for a production operational store. Use safe schema APIs/identifier quoting and an engine-enforced read-only analytical connection, with cancellation and bounds.

**Do not port:** the long synthetic-data demo prompt, automatic data creation, unrestricted DDL over operational tables, ephemeral `insights` list, or MCP resources/transport. This archived example is a small donor/reference, not the foundation to install wholesale.

**Tests:** column names with punctuation/quotes; empty results; valid CTEs; invalid queries; readonly/ATTACH/PRAGMA/extension behavior; parameter binding; row/byte/time limits; durable insight linkage; no incidental creation of a new database on a read typo.

### P03 — Basic Memory

**Source commit:** `194afe165b3e7676496aaa53b70e39a78ea5aa4f` in `basicmachines-co/basic-memory`.

**Files:** `src/basic_memory/repository/search_repository.py`; `sqlite_search_repository.py`.

**Inspected blobs:** `fb554a5f92003b8eb189b8626ed2799836a20b1d`; `40920e91deace5de9712f7f32d5bca3f4c79b460`.

**Adapt:** the common search interface, matching search/count filter semantics, metadata/item-type/time filters, transactional projection operations, search traces, and effective runtime checks for optional semantic retrieval.

**Notable behavior:** optional vector dependencies can fail while keyword search remains usable; runtime availability is checked rather than inferred solely from a saved flag.

**Do not inherit:** separate project-bound tool instances, Markdown-file authority or a Python ORM stack just to gain a search interface. Freelancer uses one global service with optional project filters and native SQLite access.

**Tests:** UI/native/CLI parity; date/filter/count consistency; unknown semantic state; keyword fallback; index refresh and source deletion; trace states that distinguish configured from effective.

### P04 — MCP Memory Service

**Source:** `doobidoo/mcp-memory-service`.

**Files:** `src/mcp_memory_service/storage/sqlite_vec.py`; `storage/mixins/hybrid.py`.

**Inspected blobs:** `25744257b84fe042b17865e39e9668ab673ff1f1`; `d29137d3af2d04833bf349cdc77b8038ac8cac56`.

**Adapt:** separation of migrations/storage/retrieval/deletion/metadata, lexical and semantic candidate streams, `_fuse_rrf` rank fusion and explanation of which retrieval channels produced a hit.

**Avoid copying blindly:** fixed consensus boosts, arbitrary normalization of raw BM25 values, or catch-all exceptions that return a seemingly valid empty result. Treat query errors and unavailable retrieval channels explicitly.

**Not required now:** embedding-model download, sqlite-vec or remote vector storage. FTS and graph/relational queries are useful without them. A future semantic channel must preserve the lexical fallback and the single-database design.

**Tests:** candidate deduplication; exact-ID matches; short/Unicode queries; superseded memory visibility; one failed retrieval channel; stable ordering; explicit relevance provenance; no doubled facts from duplicate hits.

### P05 — Mem0 SQLite history

**Source:** `mem0ai/mem0`, `mem0/memory/storage.py`.

**Inspected blob:** `5bd5512436cc6f3cbd5ce03d10808d3e6eef067b`.

**Implementation examined:** `SQLiteManager`, history/message schema creation, `add_history` and batch history writes.

**Adapt:** explicit memory revisions/events, previous and new content, actor/role and timestamps, and batch transaction behavior. Keep source provenance alongside those fields.

**Do not inherit:** an assumption that this SQLite history alone is the complete Mem0 memory architecture, automatic semantic extraction of all input, or destructive migration shortcuts such as dropping a leftover backup table without reconciling it.

**Tests:** conflicting revisions; preserved prior evidence; null/unknown actor distinctions; rollback; forgetting versus revising; bounded retention for deleted sensitive text.

### P06 — Graphiti temporal knowledge

**Source:** `getzep/graphiti`, `graphiti_core/edges.py` and `graphiti_core/utils/maintenance/edge_operations.py`.

**Revision note:** inspected source through upstream code views; freeze the chosen commit during implementation. This is a pattern adaptation, not a claim that Graphiti's entire ingestion stack is suitable for Freelancer.

**Adapt:** `EntityEdge` temporal fields and provenance-episode linkage; distinguish when a statement applied from when it was recorded or superseded. Preserve support from more than one source.

**Do not inherit:** external graph-database requirements or automatic LLM contradiction/invalidation as authority. Use ordinary SQLite entity/relation/evidence tables. Proposed contradictions remain evidence-labeled judgments until resolved.

**Tests:** two valid versions; historical-as-of queries; source corrections; conflicting sources; repeated supporting episodes; provenance retention after an old source becomes unavailable.

### P07 — LLM conversation logging

**Source commit:** `764dc386c58b625f3ad9d203e699715ad208455f` in `simonw/llm`.

**File:** `llm/migrations.py`; inspected blob `bc26a5759497d0f899f6201fefef1648e6fdbb38`.

**Adapt:** normalized conversation/response records with original JSON, response duration/model/usage fields, explicit ordered attachment relationships and hashed reusable content fragments. These are useful warehouse patterns.

**Do not inherit:** another native conversation runtime or an assumption that stored response text establishes successful work.

**Tests:** response/update deduplication; attachment availability; actual versus selected model; missing token usage; source fragments shared across multiple memories; FTS continuity after schema changes.

### P08 — Datasette database execution

**Source:** `simonw/datasette`, `datasette/database.py`.

**Revision note:** upstream implementation inspected; pin a commit if extracting specific code. No Datasette service deployment is proposed.

**Adapt:** `execute`/write-execution separation, queued write functions, bounded analytical reads, time limits, result truncation and schema discovery. Keep main UI operations responsive while analytical work runs elsewhere.

**Do not inherit:** a second web application, database-per-project setup, or permission/actor machinery as an agent tool-assignment model.

**Tests:** cancellation; lock contention; long query isolation; interrupted counts reported unknown; identifiers/parameters; read-your-write behavior; worker failure and resource cleanup.

### P09 — sqlite-utils FTS lifecycle

**Source:** `simonw/sqlite-utils`, `sqlite_utils/db.py`.

**Implementation examined:** `Table.enable_fts`, `populate_fts`, `disable_fts`, `rebuild_fts` and generated update/insert/delete triggers in upstream source.

**Adapt:** external-content FTS synchronization and deliberate index replacement/rebuild when definitions change. Keep all projections reconstructible from canonical rows.

**Do not inherit:** generic table-altering tools as the default agent interface to Freelancer's operational schema. A generated schema query must never become a migration authority.

**Tests:** inserting/updating/deleting source rows updates search; reindex has no stale rows; schema migration preserves FTS; repair preserves memories/operations; rollback leaves projection and source consistent.

## 2. Freelancer implementation map

The new names in the destination column are logical responsibilities. Prefer extending an existing focused module over creating redundant wrappers solely to match a proposed name.

| Existing boundary | Target responsibility | Required preservation / correction |
| --- | --- | --- |
| `server/data/schema.sql` | One data schema and versioned migrations | Import both prior DB domains; classify canonical/snapshot/derived tables; exclude application settings |
| `server/data/store.mjs` | Shared connection/lifecycle and focused repositories | Replace whole-database search reset; preserve revisions and query semantics |
| `server/data/chat-search.mjs` | Conversation warehouse/search projection | Stable source-native identities, shared project resolution, explicit coverage |
| `server/history.mjs` | History/domain behavior plus pinned-memory adapter | Preserve archive/restore/export semantics; pin goes through canonical memory service |
| `backend/tools/project-content-indexer.mjs` | Extraction, segment generation and derivation | Preserve supported formats, archive safety, locators, hashes and errors; move SQL query logic out of the CLI |
| `backend/opencode/tools/content_index.ts` | Thin native compatibility adapter | Same queries as UI; no path-key/project-ID mismatch; no ignored filters |
| `server/content-index.mjs`, `server/index-jobs.mjs` | Shared index/derivation jobs | Durable job/cursor state; cancellation, pending status and bounded publication |
| `server/data/maintenance.mjs`, reset utilities | Explicit index repair versus data recovery | No memory/operations loss; consistent backup and exhaustive durable-table handling |
| `backend/tools/runtime/record-database.mjs`, `record-store.mjs` | Unified operational repositories | Same DB path; request/usage row indexing; runtime-instance identity |
| `backend/tools/runtime/state-database.mjs`, `state-cli.mjs` | Legacy-key compatibility and shared native access | Remove inferred per-key database roots; no JSON fallback after cutover |
| `backend/scripts/state-database.ps1` and helper callers | Shared DB bridge | Preserve Unicode, argument validation and operational outcomes; no alternative SQL implementation |
| `server/document-store.mjs`, `server/store.mjs` | Split live settings from data ownership | Do not retain goals/outbox/Git receipts outside as “settings” |
| `server/goals.mjs`, `server/sender.mjs`, scheduler | Existing state machines on unified storage | No duplicate continuation, send or scheduled work; uncertainty survives |
| Git services and runtime guards | Project agreements and operation records in DB | Current domain validation/approval remains authoritative and overridable through existing permission flow |
| `server/model-ratings.mjs`, `server/data/model-ratings.mjs` | Ratings/research evidence | Distinguish estimates, observed outcomes and provider metadata |
| Observer, runtime measurements and quota helpers | Normalized task/model evidence | Deduplicate native response observations; unknown is not zero; selection doesn't overwrite observed identity |
| `server/chatgpt-import.mjs`, imported-data module | Imported source system | Preserve original provenance, continuation links and one-time import markers |
| `src/IndexedSearch.tsx` | Unified knowledge retrieval | Files/conversations/memories/facts with shared filters and source expansion |
| `src/ChatManagement.tsx`, `src/NavigationMenus.tsx` | Pin-as-memory presentation | Same canonical pin state; saved versus refresh-failed feedback; no dropped legacy pins |
| `src/mcp-catalog.mjs`, runtime memory-path setup | Retire standalone Memory after import | No second writable Memory JSONL authority; keep other external MCP capabilities |
| Capabilities UI and actual shared skills | Native-tool visibility and capability-use hints | Collapsible panels don't change access; no invented skill names/required tool calls |
| Tray/launch/stop helpers | Settings-only preferences and explicit lifecycle access | Eliminate incidental extra records database; preserve startup/shutdown without a dependency cycle |

## 3. Data migration disposition by dependent feature

| Current data / feature | Final disposition | Notes |
| --- | --- | --- |
| Existing `freelancer.sqlite` content, annotations, drafts, imports, ratings | Migrate/extend in the one target database | Preserve current durable records, not just rebuilt search |
| `records.sqlite` requests and usage collections | Move into the target DB | Retain immutable captures and indexed response identity |
| Goals and checkpoints | Target DB | Goals are authored work/state, not application settings |
| Sender queue, Steer and worker handoffs | Target DB | Preserve exact text/generation, submitted/uncertain states and idempotency |
| Schedules and run records | Target DB | Do not turn migration into a catch-up burst |
| Delegation receipts, attempts, bindings and choices | Target DB | Keep selected/observed model and actual parent/root/native identity |
| Concurrency reservations and provider health evidence | Target DB for durable records | OS locking primitives remain outside as runtime coordination |
| Git operations/previews/approvals | Target DB | A searchable copy of an approval is not a new permission source |
| Actual per-project Git agreement | Target DB | Global default preset remains an app setting; capture exact policy revision |
| Per-project/session execution defaults | Target DB as project/session data | Global defaults remain settings; old captures remain historical |
| Model catalog/ratings/research jobs | Target DB | Unify queryable history without converting estimates into outcomes |
| Quota observations and measured task history | Target DB | Do not warehouse service credentials or invent missing prices/usage |
| Project registrations and path aliases | Target DB | Do not leave authoritative project entities in the general settings document |
| Authored custom agents and version history | Target DB | Packaged defaults remain source assets; current default selection is a setting |
| Pins | Convert into canonical `memory_pins` | Related memory retains source snapshot membership and original pin time |
| Standalone Memory JSONL | One-time imported memory graph | Resolve the actual configured file; quarantine/count invalid records |
| Chat/source history from OpenCode | Target warehouse snapshots | Native APIs remain authority for live operation; offline reads label age/coverage |
| Imported Codex snapshots | Target warehouse/source family or compatible existing tables | Avoid duplicate source objects; preserve uncertain continuation |
| Session header cache | Normalize/reuse warehouse/session identity | Keep annotation references and cached-source status |
| File/chat FTS and extracted fact aggregates | Derived tables in target DB | Rebuildable; never erase canonical data during repair |
| Unsent drafts | Target DB | Recovery data, not automatic global prompt content |
| Theme/layout/collapse/default app choices | Separate application settings | Version/revision checked; no agent entitlement semantics |
| Global provider/MCP connection configuration | Existing native/configuration ownership | Not mirrored into searchable facts as secret payloads |
| Provider/authentication/device-trust secrets | Existing credential or security-settings ownership | No general-purpose SQL exposure |
| Tray/browser/startup preference and configured port | Separate application settings | Stop incidental launcher DB creation |
| PID/socket/OS lock files | Ephemeral runtime coordination where appropriate | Not durable memory; no arbitrary “all files must be DB rows” requirement |
| Exports, source trees, Git history, large artifacts | Filesystem originals/managed artifacts plus DB references | One database does not mean replacing the filesystem or Git |

## 4. Public entry points affected

These are existing interface families to preserve or deliberately version during implementation. Exact current route schemas should be rechecked before editing; the route map is not permission to bypass domain checks.

| Entry point family | Dependent features | Migration requirement |
| --- | --- | --- |
| `/api/bootstrap`, `/api/chat`, `/api/activity`, events | Initial workspace, transcript, request/worker state, usage, navigation | Join unified data with native live state without claiming warehouse freshness |
| `/api/projects`, selection/setup/import-preview | Project registry, setup and imports | Stable project IDs and validated path aliases |
| `/api/index/search`, `/api/history/search` | File/chat/global search | Shared service, filter parity, result type/coverage |
| `/api/index/jobs`, `/api/history/index`, content-index rebuild | Index refresh, first-open preparation, progress | Durable jobs and transactional source/dirty markers |
| `/api/index/stats`, `/api/index/maintenance`, `/api/storage` | Storage UI, health, repair and locations | Show one data DB; distinguish memory/source/index size/coverage and separate settings |
| `/api/history`, pin/archive/project/export | Chat organization, pinned memory, archive and exports | Canonical memory pin state and preserved archive semantics |
| `/api/drafts`, rebind | Autosave and send acknowledgement | Same revision/rollback behavior after storage move |
| `/api/models/ratings` and stop/dismiss | Catalog research jobs and evidence | Durable recovery; ratings remain estimates |
| `/api/goals` and action/checkpoint | Goal lifecycle and continuation | Read/indexing never triggers continuation |
| `/api/sender`, `/api/send`, `/api/stop`, delegate handoff | Queue, delivery, active work and cancellation | Preserve no-replay guarantees and input generations |
| `/api/schedules` | Scheduled work | Correct restart and uncertain-delivery state |
| `/api/git/*` | Setup, defaults, project agreements, previews and publication | Storage changes don't change consent or agreement semantics |
| `/api/agents`, preferences/context/session defaults | Agent data versus global/per-project settings | Split by record meaning; versioned captures remain data |
| `/api/plans`, usage refresh | Live plan preferences versus observed usage | Settings stay settings; measurements stay data |
| `/api/appearance`, `/api/view-state` | UI settings | Continue through separate settings service, including collapse state |
| `/api/auth`, remote-access, MCP management | Connections, native credentials, pairing | Keep secret/native configuration outside general knowledge; no new access matrix |
| Native `content_index`, capabilities, delegation/Git/goal tools | Model-visible operations | One shared service; exact public argument compatibility and legitimate domain ownership |
| CLI/native/PowerShell/storage/launch helpers | Background/native readers and bootstrap | One resolver, no mixed-version writers or hidden second data store |

## 5. Minimum migration evidence

Capture the source schema/version, origin identity and record counts for each input database/file before migration. Record exact target counts, preserved IDs/revisions and checksums for representative immutable captures. Preserve all input bytes until target verification completes.

Explicitly test these failure points:

1. Interruption after copying user data but before runtime records.
2. Interruption after database verification but before settings cutover.
3. A legacy writer attempting to start during cutover.
4. An existing uncertain sender/Git/worker operation when the new service starts.
5. A lost migration or mutation acknowledgement retried after restart.
6. Two source installations with overlapping native identifiers.
7. A malformed Memory JSONL line, missing referenced entity, duplicate name or missing pinned source.
8. Old backup files present after successful migration; they must not resurrect deleted state.
9. Search repair and schema upgrades after new memories and operational records exist.
10. Restore of the matching database/settings backup, including attachment/retention coverage.

Record what each test proves. Fixture success is not native-runtime success; native ingestion success is not model-quality evidence; a green SQL query is not a verified factual conclusion.

## 6. Example evidence packets and analytical questions

These are behavioral examples, not fixed mandatory tool names or required workflow stages.

**Model decision:** retrieve a small eligible candidate set's actual task outcomes, sample counts, relevant capabilities, current availability evidence and qualified historical lessons. Supply the task and criteria to JEV only when the comparison is ambiguous. Record its typed judgment without allowing it to change eligibility or paid consent.

**Debugging history:** find previously verified failures involving the same operation/library/version, retrieve the original tool evidence and the correction, and separate remembered hypotheses from verified causes. A query can include failed and superseded approaches intentionally.

**Pinned project knowledge:** retrieve the retained conversation snapshot explaining a design choice, its original pin time and actual capture boundary, and any later source revision or contradicting decision. Pinning prioritizes the item; it does not assert that all conversation claims are current.

**Knowledge maintenance:** find claims with missing sources, changed source hashes or unresolved contradictions; present source-grounded candidates for correction. Do not delete or rewrite a user's memory merely because a model gives it a low confidence score.

## 7. Source links

### Freelancer

- [Schema](https://github.com/Echomatter/Freelancer/blob/dd608415800635eedd053f67c3d0b6cd0d918756/server/data/schema.sql)
- [Current pin server behavior](https://github.com/Echomatter/Freelancer/blob/dd608415800635eedd053f67c3d0b6cd0d918756/server/history.mjs#L448)
- [Pin UI](https://github.com/Echomatter/Freelancer/blob/dd608415800635eedd053f67c3d0b6cd0d918756/src/ChatManagement.tsx#L195)
- [Content indexer and query branches](https://github.com/Echomatter/Freelancer/blob/dd608415800635eedd053f67c3d0b6cd0d918756/backend/tools/project-content-indexer.mjs#L234)
- [User-data store and index repair](https://github.com/Echomatter/Freelancer/blob/dd608415800635eedd053f67c3d0b6cd0d918756/server/data/store.mjs#L156)
- [Storage ownership and adapters](https://github.com/Echomatter/Freelancer/blob/dd608415800635eedd053f67c3d0b6cd0d918756/docs/storage-performance.md)
- [MCP presets and actual Memory path variable](https://github.com/Echomatter/Freelancer/blob/dd608415800635eedd053f67c3d0b6cd0d918756/src/mcp-catalog.mjs)
- [TypeSafe skill and integration note](https://github.com/Echomatter/Freelancer/blob/dd608415800635eedd053f67c3d0b6cd0d918756/backend/skills/typesafe-ai/SKILL.md)

### Outside code

- [P01 Memory code](https://github.com/modelcontextprotocol/servers/blob/main/src/memory/index.ts); [license transition](https://github.com/modelcontextprotocol/servers/blob/main/LICENSE)
- [P02 SQLite code](https://github.com/modelcontextprotocol/servers-archived/blob/main/src/sqlite/src/mcp_server_sqlite/server.py); [MIT license](https://github.com/modelcontextprotocol/servers-archived/blob/main/LICENSE)
- [P03 Basic Memory common search](https://github.com/basicmachines-co/basic-memory/blob/194afe165b3e7676496aaa53b70e39a78ea5aa4f/src/basic_memory/repository/search_repository.py); [SQLite search](https://github.com/basicmachines-co/basic-memory/blob/194afe165b3e7676496aaa53b70e39a78ea5aa4f/src/basic_memory/repository/sqlite_search_repository.py)
- [P04 Memory Service storage](https://github.com/doobidoo/mcp-memory-service/blob/main/src/mcp_memory_service/storage/sqlite_vec.py); [hybrid code](https://github.com/doobidoo/mcp-memory-service/blob/main/src/mcp_memory_service/storage/mixins/hybrid.py)
- [P05 Mem0 history](https://github.com/mem0ai/mem0/blob/main/mem0/memory/storage.py)
- [P06 Graphiti temporal edges](https://github.com/getzep/graphiti/blob/main/graphiti_core/edges.py); [edge maintenance](https://github.com/getzep/graphiti/blob/main/graphiti_core/utils/maintenance/edge_operations.py)
- [P07 LLM migrations](https://github.com/simonw/llm/blob/764dc386c58b625f3ad9d203e699715ad208455f/llm/migrations.py)
- [P08 Datasette database](https://github.com/simonw/datasette/blob/main/datasette/database.py)
- [P09 sqlite-utils database/FTS](https://github.com/simonw/sqlite-utils/blob/main/sqlite_utils/db.py)

### Native contracts and database behavior

- [OpenCode server](https://opencode.ai/docs/server/)
- [SQLite FTS5](https://sqlite.org/fts5.html)
- [SQLite WAL and engine-version advisory](https://sqlite.org/wal.html)
- [SQLite backup API](https://sqlite.org/backup.html)
- [SQLite authorizer](https://sqlite.org/c3ref/set_authorizer.html)
- [TypeSafe API](https://docs.typesafe.ai/api) and [question primitives](https://docs.typesafe.ai/primitives)
