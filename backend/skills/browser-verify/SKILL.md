---
name: browser-verify
description: Choose focused browser evidence for affected interactions, inspect rendered state and console, and classify each route.
---

# Browser Verify

This skill teaches procedure and fallbacks only. It grants no write,
paid-model, publication, or integration authority. Native permissions, paid
consent, user constraints, and the saved Git agreement remain authoritative.
Delegation is optional and never required by this skill.

## Browser integration

- Model-driven browser control uses an already configured browser MCP from the
  shared platform toolkit. The shared OpenCode MCP connection named `playwright` supplies browser tools
  such as `browser_navigate`, `browser_snapshot` and `browser_click`. Native
  tool schemas are presented to each eligible model by OpenCode; they are not
  reserved for a persona, model, or project. The `playwright` skill offers optional
  usage notes; tools can be called directly without loading it.
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

## Capability-use hints

Prefer Playwright when useful to learn what the application actually renders or
does: UI verification, responsive layouts, navigation, forms, dialogs, error
states, console/runtime evidence, screenshots and reproduction of user-facing
defects. A UI-related code edit alone need not open a browser. When an interaction
and network request succeed but visible state is wrong, Sequential Thinking may
help trace browser, network and application state; Context7 can clarify a relevant
framework contract. Browser observation complements project-native regression
checks and does not establish every implementation invariant. If browser access
is unavailable, use other appropriate checks and leave rendered claims unverified.

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
