---
name: reason-through
description: Use native Sequential Thinking to structure difficult problems with revisable steps and branches, then verify conclusions against evidence.
---

# Reason through

Based on the official [Sequential Thinking server documentation](https://github.com/modelcontextprotocol/servers/blob/f46d9578190b476b3501923ea8977d899e8db2cb/src/sequentialthinking/README.md)
and [tool registration](https://github.com/modelcontextprotocol/servers/blob/f46d9578190b476b3501923ea8977d899e8db2cb/src/sequentialthinking/index.ts),
reviewed on 2026-10-03. No official `SKILL.md` was found in that repository;
this is local guidance for its documented MCP tool.

Consider Sequential Thinking for ambiguous problems, conflicting evidence,
several plausible causes, or dependencies that need revision. Use ordinary
reasoning when the task is straightforward. Discover the actual native tool name
and schema: this source revision registers `sequentialthinking`, while its README
calls it `sequential_thinking`. OpenCode may prefix either with the connection name.

## Use the tool

- Supply `thought`, `thoughtNumber`, `totalThoughts`, and `nextThoughtNeeded`.
  Keep each entry focused on a useful hypothesis, assumption, observation, or
  next check. Number steps from 1; `totalThoughts` is an adjustable estimate.
- Revise an earlier step with `isRevision: true` and `revisesThought`.
- Explore an alternative with `branchFromThought` and a distinct `branchId`.
- Adjust `totalThoughts` or `needsMoreThoughts` when the scope changes. Set
  `nextThoughtNeeded: false` when the current exploration is complete.
- Return to source inspection, observations, or authorized project checks to
  verify material conclusions. Tool completion does not prove a hypothesis.

Do not send secrets or unrelated private information as reasoning state. Native
permissions, paid-use consent, delegation limits, and Git agreements remain in
force. If unavailable or failing, continue ordinary reasoning and report the
evidence you actually obtained; do not block the task on this optional service.

This skill is optional guidance. It does not grant or gate access to Sequential Thinking or other tools.
