---
name: remember
description: Intentionally save or retrieve durable knowledge through Freelancer's shared native knowledge tool.
---

# Remember

Consider the shared `knowledge` tool during project orientation, handoffs or meaningful
Goal milestones for durable decisions, persistent constraints, verified lessons,
rejected approaches and their reasons, or recurring environment facts. Retrieval
helps answer what has been learned, not what is true in the repository now. Verify
consequential remembered claims against current source and project state.

Use `query` with domain `memories` or `facts` to retrieve retained knowledge.
Queries are global by default; an optional project filter narrows the search.
Read the exact retained revision and its evidence before reusing a claim. Use
`remember` and `revise` for intentional notes, or `claim` and `correct-claim` for
source-linked claims. Keep origin, scope and unverified status explicit; a stored
claim or pin does not establish verified truth.

Store selectively when the knowledge will remain useful beyond this assignment;
honor user/native restrictions. Keep entries concise and scoped. Never
automatically mirror chat history, project files, private state, temporary worker
state, transient todos, routine progress or every test result. Structured model
outcomes remain authoritative; qualitative historical observations may supplement
them without replacing statistics. If knowledge retrieval is unavailable,
continue with repository evidence and normal handoffs. Report a failed save;
do not claim the memory was retained.

Every agent and model receives the same shared tools across projects. Native
permissions and explicit user restrictions still control mutations. An optional
connected Memory MCP service remains under OpenCode ownership; using Freelancer
knowledge requires no separate Memory connection and does not import, disable or
rewrite that service or its configuration.

The graph is part of this same internal knowledge store. `entity` creates an
entity; `entity-search` preserves exact name/alias lookup; `entity-read` reads a
node by ID; `open-nodes` resolves exact names or IDs and returns a bounded
one-hop neighborhood; and `search-nodes` searches entity names, types and
current claim observations by substring. `read-graph` pages current entities,
relations and observations independently (up to 100 rows per page); offsets
follow the moving graph and are not a stable snapshot. Prefer targeted search
or node reads when possible. Conversation pins also use this same internal
store: Pin creates or finds the canonical conversation snapshot and pin record.
No separate Memory setup is needed for graph access or pins.

This skill is optional guidance. It does not grant or gate access to knowledge or other tools.
