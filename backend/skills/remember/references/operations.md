# Memory operations

Follow the discovered native `memory` schema. These are Freelancer's local
operations; retained content uses one memory object.

## Minimal calls

Every call supplies `operation`; query supplies `domain`. These examples use
current task values, a real registered project and successful returned receipts:

```javascript
const retained = await memory({operation: "remember",
  sourceRefJson: JSON.stringify(hit.originalSourceRef)})

const saved = await memory({operation: "remember", title: memoryTitle,
  body: memoryText, projectID: registeredProjectID})

const current = await memory({operation: "read", id: saved.id,
  revision: saved.revision})

await memory({operation: "revise", id: saved.id,
  expectedRevision: current.revision.revision,
  dataJson: JSON.stringify(memoryData)})

await memory({operation: "query", domain: "memories", query: memoryTitle,
  projectID: registeredProjectID, limit: 10})
```

File and chat saves take `sourceRefJson` and derive their title and base capture
without a form or summary. Use the returned source reference, including exact
revision/hash fields. File capture retains indexed extracted text and unit
references, with explicit limits; it does not copy original binary bytes. Chat
capture retains bounded user/assistant text, with unavailable or excluded content
reported. The receipt can show a pending capture; saved metadata does not mean
the source text has finished capturing. The same source reuses its memory ID.

For a current registered chat, `{kind: "conversation", projectID, sessionID}`
selects that actual source. Indexed chat references can select an exact retained
snapshot. File references require `sourceIdentity` and `revisionIdentity`; copy
them from the source hit instead of fabricating an identity from a path.

Custom saves require a title; body and structured data are optional. A memory
may contain narrative text, JSON values, source-linked observations, decisions
or preferences. `sourceType` identifies File, Chat or Custom; `origin` retains
its separate meaning as recorded epistemic metadata. `dataJson` is an object up to 1 MB;
`evidenceJson` is `{items: [...]}` with at most 1000 actual evidence references.
The ordinary save needs neither structured metadata nor external inference.

`revise` preserves omitted fields; explicit data/evidence replaces the object/list.
It keeps the memory ID and creates a new content revision. Prior title, text,
structured data and evidence remain readable. Capture members/boundaries stay
retained; an explicit edited snapshot narrative is marked as user-edited text.
Inspect the save receipt. A missing argument requires correcting the call.

## Retention properties

| Action | Inputs and effect |
| --- | --- |
| Read | `id`, optional exact positive `revision`; omitted reads latest |
| Revise | `id`, current content `expectedRevision`, supplied title/body/data/evidence; preserves history |
| Archive/restore | Existing memory `id`, current `archiveRevision` as `expectedRevision`; reversible |
| Refresh | Snapshot `id`; explicit source read creates a new captured revision |
| Forget | Memory `id`, optional `reason`; removes retained content and keeps an audit record |

Content and archive counters are independent. Re-read after conflicts.
Remembering a chat creates/finds a canonical memory snapshot through the
conversation flow; its initial capture may be pending or metadata-only. Inspect
the boundary and members, including unavailable or excluded source material.
Remembering a source alone is sufficient; no separate keep action exists. Optional authored or
model-written summaries stay separate from the retained source capture.
Refresh does not execute a chat. Forget does not delete the native source.

## Structured data and evidence

Use useful named JSON fields rather than forcing every memory into an assertion.
Values retain actual types. When relevant, data can include origin, validation
status, scope, observation/validity dates, confidence, units, predicates/values,
entity links or a correction explanation. These are optional metadata. The UI
and retrieval treat the item as a memory regardless of its content.

Use actual source references and preserve returned resolving fields:

- Memory: `kind: "memory-revision"`, actual `memoryID` and numeric `revision`.
  Evidence `id` is `memory:<memoryID>@<revision>` from those returned values.
- File unit: `kind: "content-unit"`, returned `sourceIdentity`,
  `revisionIdentity`, `locator` and `unitSha256` (or `unitHash`).
- Native text part: `kind: "opencode-text-part"`, actual `sourceSystemID`,
  `projectID`, `sessionID`, `messageID`, message `revisionSha256`, `partID` and
  `partSha256`. A conversation locator alone is insufficient for an exact part.

Evidence `relation` defaults to `supports`; other values are `contradicts`,
`qualifies` and `supersedes`. Retain useful contradictions. Opaque citations
remain recorded provenance; saving does not independently resolve sources or
prove truth. Source reads can report missing/invalid evidence. Preserve exact
hashes and capture limits; do not invent pointers to satisfy validation.

`opencode-read` requires a registered `projectID` and target `sessionID`; use
the hit's source system and snapshot revision hash when available. Retained
source coverage is independent of native live execution.

## Relationships

Graph tools provide optional relationship/navigation support for memories:

- `entity-search`: exact name/alias lookup through `query`.
- `entity-read`: node by `id`.
- `open-nodes`: exact `names` or `ids`, combined maximum 100, bounded one-hop neighborhood.
- `search-nodes`: substring search across names, types and retained observations.
- `read-graph`: independent entity/relation/observation offset pages, up to 100 rows each.

Graph pages follow a moving projection. Entities/relations preserve stable IDs,
provenance, temporal scope and revision history. Mutations retain native
permissions. Relationships do not authorize work or verify current state.

## Stored evidence judgments

`judgment-evidence`/`query-evidence` uses a memory `id`, domain `memories`, and
optional exact `revision`. The bounded packet identifies that retained revision.
Keep the packet unchanged. Evaluation inputs are:

- `stateJson`: `JSON.stringify(packet.state)`.
- `candidateIDsJson`: `JSON.stringify(packet.candidateIDs)`.
- `evidenceRefsJson`: `JSON.stringify(packet.evidenceRefs)`.

`judgment-evaluate` uses an existing `definitionID`/`definitionVersion`.
`judgment-evaluate-batch` uses `JSON.stringify([{id, version}, ...])` as
`definitionsJson`, with 1–20 existing definitions. Inline questions belong to
definition creation, not evaluation inputs.

`judgment-definition` uses primitive `check`, `classify` or `score`, JSON-encoded
question text/object, and criteria with `yes`/`no`, `options`, or ordered `levels`.
`runJson` belongs to `judgment-record` for actual observed receipts; evaluation
already records runs. Never invent hashes, answers, usage or model identity.
The separate `evidence_evaluation` adapter handles bounded supplied, catalog or
memory evidence. Native approval and user cost/disclosure constraints apply.
Typed answers are advisory and do not verify task success.
