# Optional Sequential Thinking

This MCP records steps supplied by the caller and returns sequence/branch metadata.
It does not investigate, fetch evidence or independently verify conclusions.
Discover the live name/schema: official registration uses `sequentialthinking`,
while its README says `sequential_thinking`; native prefixes may differ.

- Required: `thought`, `thoughtNumber`, `totalThoughts`, `nextThoughtNeeded`.
  Start numbering at 1; the total is an adjustable estimate. Keep entries concise:
  decision summaries, observations, assumptions or next checks.
- Revision: `isRevision: true` and `revisesThought`.
- Branch: `branchFromThought` and a distinct `branchId`.
- Continuation: adjust `totalThoughts` or `needsMoreThoughts` as useful; set
  `nextThoughtNeeded: false` when this exploration is complete.

Use actual sources/observations for material conclusions. If the service is
unavailable, continue ordinary reasoning. Neither the trace nor a typed judgment
grants permissions or establishes task success.

Checked through Context7 and official
[README](https://github.com/modelcontextprotocol/servers/blob/f46d9578190b476b3501923ea8977d899e8db2cb/src/sequentialthinking/README.md),
[registration](https://github.com/modelcontextprotocol/servers/blob/f46d9578190b476b3501923ea8977d899e8db2cb/src/sequentialthinking/index.ts)
and [implementation](https://github.com/modelcontextprotocol/servers/blob/f46d9578190b476b3501923ea8977d899e8db2cb/src/sequentialthinking/lib.ts)
on 2026-10-04. Follow observed schemas for another version.
