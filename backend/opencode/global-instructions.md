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
  Use `delegate` for optional worker work when another named agent materially helps;
  direct work remains valid. Keep provider, auth and quota failures separate.

## Interpret tool evidence

Native read/search describes current source. `content_index` finds indexed mixed
content; check coverage and originals, with native search/read as fallback.
`memory` reads and retains one memory object: text, optional structured data,
evidence, source provenance, relationships and revisions. Archive state
is a property of the same item. The optional `remember` skill guides it.
Use `operation: "remember"` with `sourceRefJson` containing a returned file or chat reference;
this uses the same base capture as the UI's one-click save, with no summary required.
Custom content uses a title and optional body or structured `dataJson`.
Read and `revise` an existing memory to enrich it; captured source remains separate.
`revise` keeps the ID and earlier revisions. `query` requires a domain;
`memories` covers all retained content. Correct missing arguments in the intended
operation. Scope global queries when needed; retain exact revisions, meaningful
contradictions and provenance. Saved status does not establish live truth.
Refresh is explicit; archive and forget have different effects. External
Memory MCP is independent and unnecessary for internal memory.
Memory SQL analysis is bounded to Freelancer's warehouse; project databases
need an available database tool or connection and its actual schema.

`model_catalog` reads stored published observations. Preserve release/deployment
identity, benchmark configuration, dates, units and unknowns. Reading does not
refresh sources; published pricing is not account cost or consent.
`evidence_evaluation` prepares these or supplied values and optionally calls Jev.
Its local contract differs from vendor API/MCP schemas. Typed answers and confidence
are advisory; code owns exact calculations and actions. Sequential Thinking records
supplied reasoning steps and adds no independent observations.
