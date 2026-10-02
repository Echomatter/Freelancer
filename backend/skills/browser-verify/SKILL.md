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

- Model-driven browser control uses an already configured browser MCP from the
  shared platform toolkit. Prefer a suitable existing integration (such as
  Playwright); its tools are not reserved for a persona, model, or project.
  Connection setup is a user action in Application settings → Capabilities.
  Do not silently connect services or change native authentication during a task.
- Discover the current project's browser journeys and test commands from its
  instructions. For example, Freelancer's `npm run test:browser` journeys use
  simulated services; that command is not a requirement for other projects.
  A fixture run is not a model-controlled path.
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
