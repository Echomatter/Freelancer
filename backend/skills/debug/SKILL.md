---
name: debug
description: Diagnose an observed failure with direct evidence, focused probes, and a narrow fix.
---

# Debug

Use for a concrete defect: an error, unexpected result, broken interaction, or
regression. Establish the expected behavior and the observed behavior first.
For planning or comparing designs without a failure, use ordinary reasoning or
`reason-through`.

## Procedure

1. Capture the smallest failing trigger and relevant environment. Preserve the
   exact error, input, command or route, and what actually happened. Separate a
   reported symptom from a failure you reproduced.
2. Trace the path using source reads, runtime state and relevant logs. Keep
   observations separate from assumptions; a remembered explanation is a lead.
3. Form a falsifiable hypothesis and choose a focused probe that distinguishes
   it from plausible alternatives. Revise the hypothesis when evidence disagrees.
4. When implementation is authorized, apply the smallest coherent fix for the
   supported cause and keep unrelated changes separate. For an explanation or
   proposal, report the diagnosis and correction without editing source.
5. When permitted by the task, rerun the original trigger and appropriate nearby
   checks. Report what ran and its result, plus any unavailable or unverified
   path. A plausible patch does not establish that the symptom is fixed.

## Capability-use hints

- Use native source reads and execution receipts for local facts. Context7 helps
  when an API or version-specific library behavior is uncertain.
- Browser tools can observe a failing user flow, visible state and console/network
  errors. `playwright` covers focused browser checks and tool mechanics.
- `reason-through` can organize competing causes or dependencies. Optional
  Sequential Thinking records your supplied steps; it does not discover the
  cause or independently verify it.
- `bounded-judgment` can compare explicit hypotheses against collected evidence
  when that comparison helps choose a probe. A JEV result is advisory; confirm
  the cause through the relevant source or runtime check.
- Delegate a bounded investigation when independent work materially helps. Use
  the discovered `delegate` schema and a named agent; no worker is required.

Continue with other permitted evidence if an optional tool fails. If the relevant
environment is unavailable, give the supported diagnosis and the smallest next
check; retain the verification gap. Skills and model judgments do not change
native permissions, user constraints, paid-use consent or the saved Git agreement.
