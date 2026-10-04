# Retained knowledge operations

Follow the current native `knowledge` schema. The operations below are
Freelancer's local contract, not an external Memory server API.

## Minimal calls

All calls require `operation`. Query additionally requires one `domain`.
These examples use values from the user's task, a real registered project and
successful returned receipts; the variable names are not literal IDs.

```javascript
const saved = await knowledge({operation: "remember", title: noteTitle,
  body: noteText, projectID: registeredProjectID})

await knowledge({operation: "read", id: saved.id, revision: saved.revision})

await knowledge({operation: "query", domain: "memories", query: noteTitle,
  projectID: registeredProjectID, limit: 10})
```

Omit `projectID` only for an intentionally global note/query. Note creation
defaults to type `note` and requires a title and text body; evidence JSON,
entities, claims and TypeSafe are unnecessary. Inspect the save receipt before
using `saved.id`/`saved.revision`. Read/query calls do not require another save.
If a call lacks an operation/domain or another required input, correct that
input rather than changing record type or claiming the capability is absent.

## Read and write the right record

| Record | Operations and important inputs |
| --- | --- |
| Note/snapshot | `read` uses `id` and optional exact positive `revision`; `remember` uses `title`, `body`, optional `type` and `projectID` |
| Revised note | `revise` uses `id`, `body`, and `expectedRevision` from the current note revision |
| Source-linked claim | `read-claim` uses `id`; `claim`/`correct-claim` use explicit origin, scope and evidence |
| Pin | `pin` uses an existing memory `id`, `pinned: true/false`, and its current `pinRevision` as `expectedRevision` |
| Archive/restore | `archive` or `restore` uses memory `id` and its current `archiveRevision` as `expectedRevision` |
| Refresh | `refresh` uses the retained snapshot `id`; explicitly requested refresh creates a new captured revision |
| Forget | `forget` uses memory `id` and optional `reason`; it removes retained content, not merely its pin |

Prefer an ordinary note unless structured predicate/value/status/evidence and
correction or graph semantics are useful. `remember` and `claim` are operations
of the same tool, not separate memory systems or successive save stages.

`read` returns separate note, pin and archive revision values. Do not substitute
one for another. Re-read after a conflict; do not overwrite a concurrent edit.
Native conversation pinning creates/finds a canonical retained snapshot through
the conversation flow. `knowledge` pin changes retention of an existing memory
record. Unpin preserves its content; archive/restore is reversible; forget
removes retained content. Capture may be pending or metadata-only. Inspect the
returned boundary and members, including missing or excluded source material.

For `claim`/`correct-claim`, `evidenceJson` encodes an object with an `items`
array, `scopeJson` encodes the scope object, and `valueJson`, when used, encodes
the value. Creation requires a nonempty `predicate`, explicit `origin` and
`epistemicState`, and 1–1000 evidence entries, each with an `id`. Entity links
are optional. Corrections require the real existing claim ID, new status and
evidence; reuse the returned replacement ID afterward.

Use actual source references, not guessed message IDs or made-up source hashes.
Supported retained pointer shapes are:

- Memory: `kind: "memory-revision"`, real `memoryID` and exact numeric `revision`.
  Its evidence `id` must be `memory:<memoryID>@<revision>` constructed from those
  returned values; a bare memory UUID is not that evidence ID.
- File unit: `kind: "content-unit"`, returned `sourceIdentity`, `revisionIdentity`,
  `locator` and `unitSha256` (or `unitHash`).
- Native text part: `kind: "opencode-text-part"`, actual `sourceSystemID`,
  `projectID`, `sessionID`, `messageID`, message `revisionSha256`, `partID` and
  `partSha256`. A conversation locator alone does not identify an exact part.
- Claim: `kind: "claim-record"` and real `claimID`; preserve its returned record
  hash when available.

For file/claim pointers, the actual search result's `resultID` can label the
evidence entry; retain the resolving pointer fields. Memory evidence uses the
canonical ID above. `relation` defaults to `supports`; other values are
`contradicts`, `qualifies` and `supersedes`.

Saving a claim does not establish truth or verify every source pointer. Opaque
provenance remains recorded provenance; source resolution during query/judgment
reads can report missing or invalid evidence. Do not label an inference as
directly observed evidence or fabricate a pointer to overcome a validation error.

`opencode-read` requires a registered `projectID` and target `sessionID`; pass
the search hit's source system and snapshot revision hash when available.
Its retained source is independent of the caller conversation and has explicit
coverage limits. Native OpenCode remains authoritative for live chat execution.

## Graph

Prefer targeted reads over whole-graph inventories:

- `entity-search`: exact name/alias lookup through `query`.
- `entity-read`: node by `id`.
- `open-nodes`: exact `names` or `ids`, combined maximum 100, and bounded one-hop
  neighborhood.
- `search-nodes`: substring search across names, types and current claim
  observations.
- `read-graph`: independent `entityOffset`, `relationOffset` and
  `observationOffset` pages, up to 100 rows per page. These offsets follow a
  moving graph; they are not a snapshot.

`entity`, `claim`, `correct-claim`, `relate`, relation revisions and deletes are
mutations subject to native permissions. Preserve entity IDs, temporal scope,
provenance and actual evidence. Graph relations are retained knowledge, not
permission or verified current state.

## Stored evidence judgments

Use `judgment-evidence` or `query-evidence` with an existing record `id`, domain
`memories` or `facts`, and optional exact memory `revision`. Claims use record
hashes, not a memory revision. These two operations return a bounded packet for
that record; their names do not imply a whole-inventory batch.

Preserve the packet unchanged. Evaluation inputs are:

- `stateJson`: `JSON.stringify(packet.state)`.
- `candidateIDsJson`: `JSON.stringify(packet.candidateIDs)`.
- `evidenceRefsJson`: `JSON.stringify(packet.evidenceRefs)`.

`judgment-evaluate` uses an existing `definitionID` and `definitionVersion`.
`judgment-evaluate-batch` uses `definitionsJson` as
`JSON.stringify([{id, version}, ...])` with 1–20 existing definitions, not inline
questions. Reuse stored versions.

Only `judgment-definition` creates a definition: `primitive` is `check`,
`classify` or `score`; `questionJson` is JSON-encoded text or an object, and
`criteriaJson` is an object with `yes`/`no`, `options`, or ordered `levels`.
Serialize JSON properly rather than manually escaping it. `runJson` belongs
only to `judgment-record` for actual observed receipts; evaluation already
records its runs. Do not invent hashes, answers, usage or model identity.

Read `bounded-judgment` for framing and uncertainty; its separate
`evidence_evaluation` adapter also supports bounded supplied/catalog/warehouse
evidence. Native approval and user cost/disclosure constraints apply to either
route. A typed answer is advisory, not verified task success.
