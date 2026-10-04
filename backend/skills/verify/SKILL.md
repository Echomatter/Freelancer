---
name: verify
description: Establish a specific claim with appropriate checks and report what the evidence proves and leaves unknown.
---

# Verify

Use this for acceptance checks and validation of changed behavior. Start with
the claim to establish, not a habitual list of commands.

1. Read the current project's instructions and runner configuration. Choose the
   smallest meaningful check set and its required regression scope within the
   user's constraints. Use that project's commands, not Freelancer's defaults.
2. Perform the permitted checks. Retain the method, relevant output or artifact,
   expected result and observed result.
3. Classify each as **passed**, **failed**, **skipped**, **not-run**,
   **unavailable** or **unverified**. Keep task success separate from check
   execution; a completed tool or model response proves neither correctness nor
   a passing check.
4. Investigate a failure with `debug`; do not repeat an unchanged failing check
   or turn an unavailable check into a success.

## Match evidence to the claim

| Claim | Useful evidence |
| --- | --- |
| Current repository behavior | Exact source and local state |
| Implementation invariant | Project-native tests, type checks or data assertions |
| Rendered behavior or interaction | `playwright`, visible state and runtime errors |
| Expected API/version behavior | `web-research` / `context7-mcp` |
| Live service or provider operation | An actual permitted request and its response |

A fixture does not prove provider authentication, a build does not prove a
visible launch, and documentation does not prove the app's current behavior.
Report those limits. If a required check is unavailable, state the reason and
the next concrete way to establish it.

Use `review` for an independent critique rather than calling self-checking
independent. Use `record-outcome` only after the actual task result is established.
