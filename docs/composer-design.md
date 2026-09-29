# Composer and tool dock

The composer uses matching 44px controls: message options on the left and the
send action on the right. The text field grows to 160px, then scrolls. A quiet
line shows the current agent, model and intelligence without adding
another toolbar.

## Alternatives tried

Six interactive prototypes were compared for reaching a model choice, changing
several settings, discovering attachments, and retaining a compact phone layout.
The comparison is saved locally at `artifacts/composer/design-comparison.html`.

| Design | Access and tradeoff |
| --- | --- |
| Permanent toolbar | Direct access, but every control occupies space even while typing |
| Nested menu | One extra disclosure per category; difficult to compare choices |
| Tabbed panel | A category switch before most selections; other values disappear |
| Icon launchpad | Easy to scan, but each tile opens another view and still needs a label |
| Searchable commands | Useful for keyboard experts; requires typing and knowing the option name |
| **Flat quick panel** | **One opening action reveals attachments and all four settings together** |

The selected design keeps native select controls and their keyboard behavior.
Escape returns focus to the options button; clicking outside closes the panel.
Tab after the last setting returns to the message. The panel floats above the
chat scroll area so an expanded tool dock cannot clip it on short screens.
Changes apply to the next message and do not change captured running assignments.

## Supporting context

Tasks, attachments and delivery cards share a compact outline and collapsible
header. A closed task card shows progress and the current task; unfinished work
is called out when the response ends. Files can be collapsed without being
removed. New delivery errors open their details. Closing or dismissing a card
never cancels native work. Cancelling a queued message remains an explicit action.
Expanded support cards share one bounded scroll area, keeping the message and
send action visible even with a long task list.

The upward arrow remains the send affordance. During a response, typed text
opens the existing Delegate / Queue / Interrupt choice; an empty message shows
Stop. Attached files remain in the composer during those text-only handoffs.
Native permissions, paid consent, draft capture and uncertain-delivery rules
are unchanged.

## Tool history

There is one tool card at the top of the chat. It defaults to the current turn
and does not switch turns when the transcript scrolls. Each turn has a slim,
outlined marker that opens its tools in the dock without jumping the transcript.
Earlier turns are labeled explicitly and provide **Back to current turn**.
A new turn returns the dock to current work. Expanded tools scroll independently
and never cover the composer. Tool bodies are not duplicated in the transcript.

The [conversation rail](conversation-rail.md) adds an explicit jump: selecting a
turn dot moves the transcript and opens that turn's tools together. Ordinary
scrolling and the existing inline tool markers retain their behavior. A turn
without tools shows an empty tool state instead of another turn's commands.

The same outlined icon treatment identifies the Projects and Chats parent
controls. Their children retain lighter icons. Compact navigation closes after
chat selection and when the window enters the phone layout.

## Browser evidence

`composer.browser.mjs` checks all menu controls, matching target sizes, focus,
attachment/task collapse, draft preservation, tool markers and phone overflow.
`chat-dock.browser.mjs` checks stable current-turn selection, historical review,
independent output scrolling, streamed tools, delegation handoffs and short
viewports. Existing send, queue, interrupt and uncertainty journeys retain their
transport assertions. These are simulated-provider checks, not live inference.
