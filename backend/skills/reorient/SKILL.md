---
name: reorient
description: Orient to a project or resume interrupted work by finding its current instructions, relevant source, constraints and useful checks.
---

# Reorient

1. Establish the user's objective and scope, working project and current state.
   Read its native-discovered instructions before deciding where to work.
2. Find the relevant entry points and trace enough source to explain current
   behavior, constraints and dependencies. Use native code search for symbols
   and call paths; `search-index` helps locate mixed documents and chat text.
3. Retrieve prior decisions through `knowledge` when they would change the
   approach. `remember` covers retained evidence and capture limits. Verify
   consequential remembered claims against current source or native receipts.
4. Identify the smallest useful next action and available checks. Reuse valid
   earlier orientation; recheck facts that may have changed. Use `web-research`
   only for external information the repository cannot establish.

Return a compact project map: relevant files, current behavior, constraints,
next action and unresolved coverage. Include exact source or revision references
when another agent will need them. Missing indexes or memory do not block
ordinary source inspection.

Delegate only when a bounded parallel investigation helps, using a named agent
ID from the supplied catalog. No worker or skill chain is required. An
orientation-only request ends with findings; implementation requires task
scope that includes changes. Respect inspection-only and no-subagent requests,
native permissions, cost/disclosure constraints and the saved Git agreement.
