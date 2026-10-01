---
name: browser-verify
description: Exercise affected routes with one approved browser path, inspect state and console, and classify each route.
---

# Browser Verify

This skill teaches procedure and fallbacks only. It grants no write,
paid-model, publication, or integration authority. Native permissions, paid
consent, user constraints, and the saved Git agreement remain authoritative.
Delegation is optional and never required by this skill.

## Browser integration

- Model-driven browser control uses the official native Playwright browser MCP
  as its single path, within the existing Playwright ecosystem. Use it only when
  the user has already configured and enabled it; never install, add, or enable
  a competing browser stack or MCP during a task.
- The repository browser journeys (`npm run test:browser`, with filename
  filters during iteration) are deterministic fixtures, not a model-controlled
  path.
- These are distinct evidence types: distinguish live native browser-MCP
  observation from fixture journey results in every report. Never present
  fixture success as live user-visible proof, and never claim provider
  authentication from a journey run.

## Procedure

1. Pick the affected routes or interactions only; do not sweep the whole
   application unless the change warrants it.
2. For each route: navigate, exercise the interaction, inspect visible state
   and console errors, and capture evidence (journey name or MCP
   observation plus output excerpt).
3. Classify each route as Pass, Fail, or Skip with a reason. A skipped route
   states what was not exercised and the exact next action.
4. Keep user-visible assertions in browser journeys; report fixture, smoke,
   runtime, provider, and visual evidence separately.

## Required capabilities and fallbacks

- Required: either a configured browser MCP path or the repo journey runner
  with a built application.
- Fallback: when no browser path is available here, classify affected routes
  as Skip (unavailable browser integration), state which path was missing,
  and continue with non-visual checks. Never present fixture success as live
  user-visible proof, and never claim provider authentication from a
  journey run.
