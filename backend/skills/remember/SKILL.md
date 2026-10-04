---
name: remember
description: Retrieve or intentionally retain durable notes, source-linked claims, graph knowledge and conversation snapshots through the shared knowledge tool.
---

# Remember

`knowledge` is the tool. `remember` names both this optional skill and the
operation that saves a note. Search domain `memories` contains notes/snapshots;
`facts` contains structured claims. They share the warehouse with pins and
graph knowledge. External Memory MCP is unnecessary and remains a separate,
native-owned service.

## Choose what to retain

Use `operation: "remember"` by default for useful decisions, preferences,
source locations, constraints, lessons and rejected approaches. Supply `title`
and `body`, plus the real registered `projectID` for a project note. Use values
from the task and current project:

```javascript
knowledge({operation: "remember", title: noteTitle, body: noteText,
  projectID: registeredProjectID})
```

Use `claim` when structured predicate/value, origin, status, evidence and
correction/graph semantics help. An ordinary note needs no claim, entity or
judgment setup. Do not convert or duplicate notes automatically.

Every call requires `operation`; `query` also requires `domain`. Title/body
alone is incomplete. Correct missing fields in the intended operation; a
malformed note-save request does not establish unsupported notes or require
a claim fallback.

## Retrieve

Use `query` with domain `memories` or `facts`. Queries default globally;
`projectID`/`projectDirectory` narrows them. Continue `nextCursor` with unchanged
query, filters, scope and limit. Read exact revisions/evidence before relying on
consequential hits; retain source IDs, hashes, dates, capture limits and status.

Partial, metadata-only, disputed or stale content stays explicit. Verify current
behavior against source or native receipts. A pin retains content; it proves no
truth or permission. Missing memory does not block repository work.

## Retain deliberately

Keep useful durable knowledge within user/native permissions, with scope,
reason and actual sources. `revise` updates notes; `correct-claim` preserves
correction history. Retain meaningful contradictions. Reuse successful receipt
IDs and report failed saves honestly.

Do not automatically mirror chats, files, secrets, private state, temporary
worker state, todos or routine results. Structured model outcomes remain
authoritative; qualitative memories do not replace them.

Read [operation details](references/operations.md) for examples, graph, retention
mutations, claims or judgments. `search-index` locates file/chat evidence;
`bounded-judgment` guides optional evaluation. Skills grant no authority or tool gate.
