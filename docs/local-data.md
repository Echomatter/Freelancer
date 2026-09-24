# Local data, history and archives

New-project setup offers an optional [one-time ChatGPT / Codex import](chatgpt-import.md) before indexing. Imported snapshots have their own tables, use the shared chat view, and can orient a new native chat without writing to OpenCode's database. They are an explicit exception to native conversation ownership described below; native conversations still belong to OpenCode. Cloud-only chats and general Freelancer backup imports are not supported.

## Start here

Use Node.js **22.13 or newer** and restart the application server after pulling.
The UI/application contract is checked against the current
[`domain/protocol.mjs`](../domain/protocol.mjs). A browser refresh alone cannot
upgrade the local server. There is no new database server or installer to run.

**History** is under Application settings in the left navigation. The current
chat's actions also offer **Archive, pin or export…**, preselecting that parent
conversation. History has Active, Archived and All views, one conversation-content
search across registered projects, pins, multiple selection, Undo, and progressive
**Load more history** when browsing a project. Search results use the same selection,
archive, and export controls; selection is limited to one project at a time.

**Application settings → Data & Storage** shows actual locations and explains ownership.
Use **Put project away** to hide a project from active navigation, and **Restore
project** to bring it back. Its folder and Git agreement remain untouched.

The backup checklist distinguishes a local copy of project folders and data locations from conversation export. Stop the server and OpenCode before copying live databases, and include SQLite sidecar files. Exports cover selected conversations only; Freelancer export bundles have no restore/import action. Both search indexes are derived data: **Application settings → Content index** refreshes files throughout every registered project root or native OpenCode messages across all registered projects. File indexing includes source code, configuration, documents, and other readable text throughout each root; generated folders, private state, and binary formats without an extractor are skipped. The conversation index includes titles and user/assistant text, including archived chats and workers, with model IDs; it does not copy tool output, reasoning, attachments, or drafts. OpenCode remains the conversation authority. The same page can optimize the full-text indexes, run SQLite quick check, and compact free pages; these jobs do not operate on OpenCode's native database.

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

Project archiving is a separate annotation. It hides all of the project's chats
from active navigation but does not rewrite their individual archive state.
Restore the project before changing individual conversation archives. Drafts
and exports remain accessible. Usage/accounting still includes archived work.

## What is stored where?

| Information                                                                          | Authority                              | Current storage                                                         | Archive/export behavior                                              |
| ------------------------------------------------------------------------------------ | -------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Project source and Git history                                                       | Filesystem / Git                       | User-selected folders                                                   | Never moved or deleted here                                          |
| Native sessions, messages, parts, tools, permissions, todos                          | OpenCode                               | Native engine database, located through the same executable's `db path` | Use native API/CLI; never write its database                         |
| Provider authentication                                                              | Existing native authentication systems | Existing credential locations                                           | Never copied into this store or exports as a credential collection   |
| Registered projects, plans, appearance, agent/workflow overrides, remembered choices | Existing Freelancer store              | `backend/.state/webpage/settings.json`                                  | Remains authoritative; no bulk migration                             |
| Request receipts and observed usage                                                  | Existing Freelancer store              | `requests.json`, `usage.json` in that directory                         | Not removed or reset by archive                                      |
| Waiting/uncertain delivery                                                           | Freelancer sender                      | `sender-outbox.json`                                                    | A delivery commitment, not a draft; archive cannot cancel it         |
| Runtime preferences, delegation receipts, outcomes and quota state                   | Existing runtime writers               | Other directories/files under `backend/.state/`                         | Kept in runtime JSON                                               |
| Project files and conversation search indexes                                        | Freelancer content indexer             | Project-scoped tables inside the same per-user `freelancer.sqlite`                  | Rebuildable derived indexes; project files and native chats remain authoritative |
| Pins, local hiding, project archives, unsent drafts                                  | Freelancer local data service      | `freelancer.sqlite` in the resolved user data directory                    | New feature authority                                                |
| Previously seen session headers                                                      | OpenCode; SQLite copy is a cache       | `session_headers`                                                       | Titles/IDs/ancestry/timestamps only, checked natively before actions |
| Agent/skill defaults                                                                 | Application source                     | Existing domain/backend files                                           | Definitions are not running jobs                                     |

The old JSON files already have version checks, mutation serialization and
atomic replacement. They have not been declared broken or silently abandoned.
This release deliberately leaves their scripts/plugins/readers intact. In
particular, The Git agreement remains in its existing store; there is no
second copy of its policy in SQLite.

## The parts and their relationships

- A **project** is a folder registration plus its setup; it has conversations.
- A **conversation** is an OpenCode session or an explicitly imported Codex snapshot. A worker is a native child session.
- A **request** is one user instruction. Its receipt preserves which agent,
  workflow, model and execution settings were used at that time.
- An **agent definition** describes working style; a **workflow definition**
  describes execution policy. Editing either does not rewrite past receipts.
- A **worker job** is a particular delegated assignment linked to its native
  child session and parent request, not another editable agent definition.
- A **usage observation** records native activity; archiving does not erase it.
- A **draft** is editable unsent text. A **queue entry** is a requested delivery
  with a state machine. A send acknowledgement may clear only its captured
  draft generation, never newer typing.

The Freelancer SQLite store links by project/native session ID but has **no foreign
key into OpenCode's database**. Native IDs must be ownership-checked through the
API before mutations or exports. Missing native sessions are not recreated.

## SQLite schema 6

The executable schema is `server/data/schema.sql`. Application history/draft access goes through
`server/data/store.mjs` and `server/history.mjs`; the local content-index tool uses the same database through its Python indexer. React does not open SQLite directly.

| Table                 | Key and contents                                          | Purpose                                 |
| --------------------- | --------------------------------------------------------- | --------------------------------------- |
| `schema_migrations`   | Version, migration name, applied timestamp                | Explicit version history                |
| `project_annotations` | Project ID; archive timestamp; revision                   | Local project organization              |
| `session_headers`     | Project + native session ID; parent ID, title, timestamps | Rebuildable header cache; no transcript |
| `session_annotations` | Project + session ID; pin/hide timestamp; revision        | Local organization; FK to cached header |
| `drafts`              | Project + session ID or `new`; text, revision, timestamp  | Recoverable unsent text                 |
| `content_meta`        | Project key + build metadata                              | Per-project index manifest/status       |
| `content_sources`     | Project-scoped source metadata                            | Indexed files and archive members       |
| `content_units`       | Source retrieval units                                    | Searchable document sections            |
| `content_units_fts`   | FTS5 projection of retrieval units                        | Local full-text/BM25 search              |
| `content_facts`       | Derived source-linked facts                               | Optional analysis aid                   |
| `content_fact_stats`  | Project-scoped fact aggregates                            | Optional analysis summaries             |
| `chat_search` / `chat_search_state` | Indexed native messages and refresh timestamps | Rebuildable conversation search |
| `model_catalog` | Public native model metadata and dated estimated ratings | Models-page catalog; not routing policy |
| `model_rating_jobs` | Native configuration session, chosen model, state and summary | Background rating update recovery |
| `chatgpt_chats` / `chatgpt_messages` | Project-scoped imported headers, provenance and normalized messages | One-time source snapshots, separate from OpenCode |
| `chatgpt_continuations` | Imported ID to native session link and creation state | Supported-API continuation; guards uncertain creation |
| `project_onboarding` | Completed setup timestamp and import count | Prevents repeated imports or live sync |

Uses STRICT tables, prepared statements, foreign keys, short BEGIN IMMEDIATE
transactions, a busy timeout, WAL journaling and FULL synchronization. The file
has an application ID and version; foreign/newer/corrupt databases fail closed,
not reset. Empty draft rows retain revision tombstones so stale windows cannot
resurrect a cleared draft. New-chat draft rebinding clears the source and writes
the destination in one transaction; it refuses a nonempty destination.

The local store is opened by the server runtime and closed during its graceful
shutdown. Startup performs a passive WAL checkpoint, which does not wait for
active readers or truncate the log. Do not force-kill the server as a normal
restart method. Replacing the local database for a derived-index reset first
quiesces the model-ratings connection and closes the history connection, so
both stop using the old database file before the replacement is installed.

The UI debounces draft writes and drains edits serially. Every write checks a
revision. Cross-window conflicts and lost acknowledgements preserve local text
rather than silently overwriting a newer saved value. Switching chats cannot
redirect a pending save or acceptance to the newly selected chat. During native
chat creation, later typing follows the newly bound conversation.

## Paths and protection

Production resolves new data separately from the installation:

- Windows: `%LOCALAPPDATA%\Freelancer\freelancer.sqlite` (profile fallback when
  LOCALAPPDATA is unavailable).
- macOS: `~/Library/Application Support/Freelancer/freelancer.sqlite`.
- Linux: `$XDG_DATA_HOME/freelancer/freelancer.sqlite` or
  `~/.local/share/freelancer/freelancer.sqlite`.

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

## Verification and remaining live checks

Run `npm test`, `npm run build`, then (with Playwright installed as a temporary
test dependency) `node tests/local-data.browser.mjs`. The new CI matrix exercises
Ubuntu and Windows with normal navigation and uploads browser screenshots.
The Windows panel workflow exercises the same browser application.

Tests exercise real application/HTTP/SQLite/sender integration; only the native
OpenCode/provider interface is stubbed. Pure draft-controller tests cover save
races, exact-generation acceptance, multi-window conflicts, reload, lost
acknowledgements and rebinding. No paid model/provider calls or real user account
changes are used. Normal browser verification uses loopback HTTP/CSP. PANEL_OFFLINE=1 is an optional restricted-environment bridge and is not normal-navigation evidence.

Before relying on a real installation: restart the Windows app; save/reopen a
draft; archive/Undo an idle test conversation; inspect the displayed paths; download
one conversation export and inspect its contents; confirm a running worker or
queued request blocks archive. Do not run this check on destructive/private
fixtures or treat a transcript export as your only backup.
