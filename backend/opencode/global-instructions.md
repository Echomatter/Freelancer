# Freelancer's shared toolkit

OpenCode owns provider prompts, project/global discovery, sessions, models/auth,
native tools, permissions, skills and MCP execution. Freelancer adds shared plugins
and instructions through native interfaces. Agent roles and skills guide work;
they grant no authority and do not gate the platform-wide toolkit. Discover actual
tools/schemas rather than inferring access or health from catalog entries.
The captured execution contract carries request identity, consent, Goals and
worker-delivery rules; do not duplicate it in agent prompts.

## Choose useful guidance

- Orient and retrieve: `reorient` maps the current task; `search-index` locates
  indexed files/chats; `remember` reads or intentionally retains knowledge.
- Investigate: `web-research` selects external sources; `context7-mcp` checks
  library/API docs; `fetch` retrieves a known URL; `playwright` inspects browser behavior.
- Solve and assess: `debug` traces failures; `reason-through` compares decisions;
  `bounded-judgment` prepares typed evidence questions; `typesafe-ai` covers
  integration development; `compare-builds` builds and compares two alternatives.
- Finish and continue: `verify` selects claim-specific checks; `review` returns
  independent findings; `handoff` preserves a checkpoint; `pursue-goal` handles
  saved Goals; `record-outcome` records observed model results.
- Coordinate: `delegate-work` guides named delegation; `managed-git` guides
  the existing project agreement. Roles are expertise, not different tool kits.

## Interpret tool evidence

Native read/search describes current source. `content_index` finds indexed mixed
content; check coverage and originals, with native search/read as fallback.
`knowledge` is the tool; a memory is a retained note or snapshot. The optional
`remember` skill guides it, and `operation: "remember"` saves an ordinary note
with title/body. `operation: "query"` requires a domain: `memories` for notes or
`facts` for structured claims. Use `claim` only when a predicate/value assertion,
evidence/status tracking or graph structure helps, not as a fallback for a missing
argument. This is one warehouse, not separate memory services. Scope global queries when needed;
retain exact revisions and provenance. A retained claim or pin is not live truth.
Refresh is explicit; unpin, archive and forget have different effects. External
Memory MCP is independent and unnecessary for internal memory.
Knowledge SQL analysis is bounded to Freelancer's warehouse; project databases
need an available database tool or connection and its actual schema.

`model_catalog` reads stored published observations. Preserve release/deployment
identity, benchmark configuration, dates, units and unknowns. Reading does not
refresh sources; published pricing is not account cost or consent.
`evidence_evaluation` prepares these or supplied values and optionally calls Jev.
Its local contract differs from vendor API/MCP schemas. Typed answers and confidence
are advisory; code owns exact calculations and actions. Sequential Thinking records
supplied reasoning steps and adds no independent observations.
