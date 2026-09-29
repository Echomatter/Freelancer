# Conversation rail

## User guide

The right edge of a chat combines turn navigation and scrolling beside a
separate Details divider. Each dot represents one turn. Select it to jump to that turn and open
its tool dock. Hover or keyboard-focus a dot for the prompt excerpt, status,
action/helper counts, reported input and output, model and elapsed time when
available. Missing native statistics are labeled rather than estimated.

Drag the pulsing ring to scroll, or select empty track space to move it directly.
The ring's rim remains draggable when its center crosses a turn dot. With Details
open, drag the narrow divider at the panel edge horizontally to change its width.
Double-click the divider resets the width. Escape cancels
either drag; the previous width survives failed saves. The rail replaces the
chat's native scrollbar and runs to the bottom of the workspace.

Tab reaches the selected turn. Arrow keys move between turns, Home/End reach
the first/last, and Enter or Space jumps. The scroll handle supports arrows,
Page Up/Down, Space and Home/End. The Details separator retains its own keyboard
width controls. Pulse animation is disabled with reduced motion. On phones,
Details overlays the chat and has no resize gesture.

The rail color draws from the current palette and saturates as the context
window fills. Its percentage uses the latest native response's reported token
usage and that response model's context limit. Cached input occupies context;
whole-chat token totals do not describe window fullness. Unsent drafts and new
streamed text are not estimated. A dash indicates missing usage or capacity.
After compaction, a new reported call updates the percentage.

Automatic compaction is in **Project settings → Session defaults → Context
window**. This controls OpenCode's native automatic compactor for all chats in
the selected project. Save when the project's chats and decisions are idle.
The old manual compact action has been removed from the chat's More actions
menu. The underlying native action API is retained for compatibility.

## Technical guide

`src/echoflex/ConversationRail.tsx` is the shared React object. It takes target
IDs, read-only turn metadata, scroll/content refs and a selected key.
`Chat.tsx` owns turn/tool selection; `PanelResize.tsx` retains
width persistence and rollback. This avoids introducing a second scroll store,
turn store, or execution model. Hidden native scrollbar chrome leaves native
wheel, touch and programmatic scrolling intact.

Turn dots use equal spacing so a short exchange remains reachable beside a
long response. The thumb interpolates actual transcript offsets between those
turns. Dense histories retain one dot and keyboard target per turn. Resize
observers measure the transcript and viewport, never the dock or tooltip;
measurements are batched in animation frames and unchanged metrics do not
render again. Normal scrolling reuses the measured anchors; only viewport or
transcript size changes trigger a new geometry pass. The top help icon is removed. Stream updates do not switch a historical dock selection. A new
turn resets it to current work.

`GET/PUT /api/context-settings` reads the effective native configuration and
saves `settings.contextSettings[projectID].autoCompact` in ignored local state.
The existing OpenCode config hook applies only `compaction.auto`, preserving
pruning, reserve and permissions. The server guards in-flight setup/sends,
checks native busy/retry and pending decisions, refreshes that project's
instance, and verifies the effective value. Failed confirmation restores the
prior preference. Nothing requests a summary or implements custom compaction.
The same hook reapplies the preference on process restart. The setting is
native [OpenCode compaction configuration](https://dev.opencode.ai/docs/config/#compaction).

## Validation

- `tests/conversation-rail.browser.mjs`: production bundle; turn jumps/tool
  selection, statistics, keyboard, scroll/resize separation, draft preservation,
  streaming, color intensity, persisted settings, 120-turn history, touch,
  reduced motion and phone overlay.
- `tests/chat-dock.browser.mjs`, `tests/composer.browser.mjs` and
  `tests/panels-theme.browser.mjs`: existing dock, composer and persistence paths.
- `tests/conversation-rail.test.mjs` and `tests/context-settings.test.mjs`: usage
  boundaries, interpolation, native configuration adapter, busy/decision guards
  and failed-confirmation rollback.
- `node scripts/smoke-context.mjs`: isolated real OpenCode process, configuration
  readback and engine restart. No provider authentication or inference claim.
