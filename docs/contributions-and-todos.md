# Contributions and todo placement

## Display contract

Available Usage now uses one wide availability tile and an expandable bottom
meter. Provider-reported current availability, not subscription value, drives
both. Unknown shares stay unknown. The optional subscription-price editor and
internal accounting remain; prices do not affect the availability estimate.
See `available-usage.md` for the current display and reset contract.

Chat Details starts with **Share of work**, above the activity/changes tabs.
Model and agent are separate views of the same recorded activity, not shares to
add together. The overview shows the corresponding workspace-month breakdowns.
There are no model/agent/chat dollar badges or raw usage counters. Existing
context-capacity controls, observed-model evidence, validation and child
navigation remain available. User-authored text and ordinary tool output are
not scrubbed or rewritten.

## Internal contribution basis

`domain/contributions.mjs` derives activity shares from recorded native token
volume (including input, output and cache activity) without using prices. It
reuses the existing native total/fallback normalization. This is a resource-use
proxy for activity, not a measure of quality, completed tasks or subscription
consumption. Repeated context and retries therefore count as activity. Free
models are included. Raw usage, prices and routing estimates remain internal;
the presentation projection includes identity, percentage and coverage flags.

Native message IDs deduplicate observations. A chat's denominator includes only
that session and its recorded descendants; unrelated sessions, billing settings
and current connection state cannot change its shares. Model and agent shares
are rounded independently to 100 using largest remainders with stable ID ties.

The existing observer has limited coverage, so the display explicitly says
recorded activity for the selected month rather than whole-lifetime work or
all provider usage. Older ancestry records are retained for linking. Cyclic
ancestry is bounded and flagged. Unknown/partial measurements are identified;
a zero denominator yields unavailable shares, not fabricated percentages.
Legacy positive measurements remain usable; legacy zero measurements are
uncertain until refreshed with the new `usageKnown` marker.

## Todo placement

Docked above the composer is the default when no placement has been saved.
Existing explicit `inline` choices are retained. Application settings > Appearance > Todo
placement changes the choice, saves automatically, and provides saving/error
feedback. A successful save updates the workspace immediately and invalidates
older bootstrap responses. A failed save restores the prior selection.

In docked mode the task card stays with the sticky composer and is not duplicated
in Details. It can collapse or dismiss, with Show tasks restoring it; changed
tasks reappear. In inline mode the dock is hidden and the Details Tasks tab becomes
available. Dismissing a card never changes native todo storage or execution permissions.

When a response ends with unfinished native tasks, both placements explain that
a follow-up is needed. An idle `in_progress` item displays as **unfinished**
without a spinner; the native record is preserved. Work summaries say **Response
ended**, or flag unfinished tasks and failures, rather than claiming task success.
A shell command with a nonzero native exit code is shown as failed even if its
tool invocation finished. **Connected** in the header describes the application
connection, not the outcome of the task. Future requests instruct agents to
reconcile native todos and resolve recoverable command failures before concluding.

The UI/runtime contract is version 10. Restart the local application server
after installing this change; an older running server must not silently accept
a newer interface whose settings or contribution projection it cannot supply.

## Verification

Run `npm test` and `npm run build`, then check browser/Chrome behavior:

1. With no saved placement, a nonempty task list is docked above the composer.
2. Switch to inline, reopen settings and restart the app. Inline remains selected;
   tasks appear under Details > Tasks, not in both locations. Switch back to docked.
3. Interrupt a settings save. The error is visible and the prior selection remains.
4. Open Details for a delegated chat. Shares appear above all detail tabs, include
   free helpers, and do not move when an unrelated chat runs or a plan price changes.
5. Confirm app-owned monetary amounts remain only in provider-price setup;
   raw usage counters do not appear in activity UI. Both usage summaries show
   the same current estimated availability, provider colors and next reset.


Focused pure/source-contract tests are in `contributions.test.mjs` and
`contribution-presentation.test.mjs`. `todo-persistence.test.mjs` exercises the
real application save handler and reopens its on-disk store without model inference.
