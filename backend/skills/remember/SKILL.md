---
name: remember
description: Remember files, chats or custom content; retrieve and edit the same saved memory through the shared memory tool.
---

# Remember

Use the shared `memory` tool for retained decisions, preferences, source
locations, lessons, observations and conversation snapshots. Every retained
item is a memory. Structured values, evidence, relationships and archive
state are optional properties of that same object. This skill guides its use;
native permissions govern mutations.

## Save or revise

For a file or chat, use `operation: "remember"` and `sourceRefJson` from its
returned source reference. This is the same save as the UI's one-click action:
no title, summary or structured fields are required. The server derives a base
memory and retains the source within explicit capture limits. Inspect its receipt
and pending capture state. Repeating the same source saves to the same memory.

```javascript
memory({operation: "remember",
  sourceRefJson: JSON.stringify(hit.originalSourceRef)})
```

For custom content, supply a concise `title` and optional `body`. Use the real
registered `projectID` for project scope. `dataJson` adds an optional structured
object; text and structured data can coexist:

```javascript
memory({operation: "remember", title: memoryTitle, body: memoryText,
  projectID: registeredProjectID})
```

Optional summaries and details enrich a source memory; they do not replace its
captured source. Read an existing memory and use `revise` to add or correct them.
Optional `evidenceJson` contains `{items: [...]}` from actual returned source
references. Optional provenance and structured metadata can preserve origin,
validation status, scope, dates, entity links and meaningful contradictions.
Ordinary retention needs no evidence setup or Jev inference.

`revise` updates the same memory ID and retains prior revisions. Supply its
current content revision as `expectedRevision`; omitted content/data/evidence
fields remain intact. Explicit data/evidence replaces the supplied object/list.
Keep relevant uncertainty and sources; re-read after conflicts.

Every call requires `operation`; `query` also requires `domain`. Correct missing
arguments in the intended call. Inspect receipts before reporting a successful
save or using a returned ID.

## Retrieve

Use `query`, domain `memories`, for all retained content. Queries default globally;
project selectors narrow them. Continue
`nextCursor` with unchanged criteria, scope and limit. Read exact revisions and
evidence before relying on consequential hits.

Partial, metadata-only, disputed or stale content stays explicit. Verify current
behavior against source or native receipts. Saved status proves no truth
or permission. Missing memory does not block repository work. Downloaded catalog
attributes and extracted index values remain source observations; retain useful
interpretations deliberately.

Do not automatically mirror chats, files, secrets, private state, temporary
worker state, todos or routine results. Structured model outcomes remain
authoritative. External Memory MCP is unnecessary for this internal store.

Read [operation details](references/operations.md) when editing structured
content, source links, graph relationships, retention state or stored judgments.
`search-index` locates file/chat sources; `bounded-judgment` guides optional
evaluation. Skills grant no authority or tool gate.
