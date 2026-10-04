---
name: search-index
description: Locate evidence across indexed files, documents and native chat text; inspect coverage and verify decisive hits in original sources.
---

# Search Index

Use `content_index` for full-text location across mixed documents, structured
data and readable source files, including JSON/CSV, PDF, DOCX/XLSX and safe ZIP
members. For code symbols and call paths, use native
code search and reads. The index locates evidence; rank and extracted fact rows
do not establish truth.

## Choose the read

| Need | Operation and scope |
| --- | --- |
| File passages | `search` with `query`; defaults to the current project |
| Native chat text | `chats` with `query`; optional exact `model` filter |
| Index coverage/freshness | `status`; `sources` or `meta` for detail |
| Indexed unit | `unit` with returned `source` and `unit` number |
| Extracted structured values | `facts` with source/family/kind/label filters |

For `search` and `chats`, select another registered `projectID` or use
`global: true`; do not combine them. Start with exact names or phrases, expand
aliases deliberately, then deduplicate source/locator hits. Continue a
`nextCursor` with the same query, filters, scope and limit. Pages reflect a
moving index, not a stable snapshot.

Chat search includes titles and user/assistant text from workers and archived
chats. Tool output, reasoning, attachments and drafts are excluded. Read the
native conversation for decisive tool evidence. File units are indexed
extractions; read originals before relying on schemas, numbers or edit locations.
Preserve returned source IDs, revisions, capture dates and coverage limits.
Opening a current chat starts a background refresh; Application settings →
Content & Storage can refresh older conversations.

## Missing coverage

Use native source search when the index is missing, stale or incomplete.
Rebuild only when useful and index maintenance is within the assignment and
native permissions. `rebuild` uses `facts: none` by default; `general`, `special`
and `both` add derived extraction, not authored knowledge claims. Do not rebuild
each turn or interpret an explicit restriction on all writes as permission.

Use `remember` for retained memories/claims/graph evidence and `web-research` for
external sources. Neither a worker nor a sequence of skill loads is required.
