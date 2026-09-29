# Composer and tool dock

The composer uses a slim, shadow-free bottom surface with matching 44px round controls: message options on the left and the
send action on the right. The text field grows with the draft to an adaptive
viewport cap, then scrolls. The options button stays visually quiet until hovered or opened. Its tooltip
names the current agent, model and intelligence; the menu holds the labeled
controls. There is no secondary label row below the input. The enclosing border
continues along the very bottom of the page. The options sheet mounts only while
open, keeping its model list out of the closed chat DOM.

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
The textarea has no instructional placeholder. Its accessible label remains
stable, and mobile text controls use a 16px font, a send return-key hint, dynamic
viewport resizing and safe-area padding so focusing it does not zoom or displace
the surrounding toolbars.

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
controls. Their children retain lighter icons. Projects, Chats, and both settings
groups start collapsed. Compact navigation opens one group at a time and closes
after selecting a project, chat, settings destination, or new/continued chat;
opening a submenu keeps its parent open. Escape dismisses the innermost menu
and returns focus to its control, and clicking outside dismisses compact flyouts.
Phone settings show labeled destinations beside the rail. Desktop users can
collapse the navigation to the same icon rail; that choice persists locally.
Full desktop navigation keeps the chat list open while browsing settings.
Changing between rail and full navigation closes open groups.
On phones, the rail can be hidden for reading space with its top-bar control or
a leftward swipe. A rightward swipe beginning at the left screen edge restores
it; the top-bar control remains available for touch, keyboard, and assistive
technology users.

## Browser evidence

`composer.browser.mjs` checks all menu controls, matching target sizes, focus,
attachment/task collapse, draft preservation, tool markers and phone overflow.
`chat-dock.browser.mjs` checks stable current-turn selection, historical review,
independent output scrolling, streamed tools, delegation handoffs and short
viewports. Existing send, queue, interrupt and uncertainty journeys retain their
transport assertions. These are simulated-provider checks, not live inference.
`navigation.browser.mjs` covers phone and collapsed desktop menus, destination
dismissal, nested management actions, focus return, usage navigation and back
controls through the production browser bundle.

Contextual help sits in one lower-right footer bubble per card. Related field topics share that bubble through a topic selector; headings and the conversation rail have no help icons. Page-level help stays in the lower-right corner.
