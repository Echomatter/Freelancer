# Chat validation

The production journeys use the real React bundle, loopback HTTP handlers and
application stores with disposable data. `chat-dock.browser.mjs` uses the
dedicated React presentation fixture through Vite. Native model transport is simulated.
Run `npm run build` followed by `npm run test:browser`.
For interactive selection, actions and failure traces, run `npm run test:ui`.
See [testing](testing.md) for focused commands and the coverage migration map.

`polish.browser.mjs` checks the scrollbar and composer reach the window bottom,
right-aligned content-sized user bubbles, retained reading position after
navigation, shared task/delivery cards, dismissal/restoration, explicit queue
cancellation, settings close controls, and narrow layouts. `chat-tweaks.browser.mjs`
checks that assistant prose, including reasoning parts, stays in the chat while
tool calls stay in the collapsed work card. `chat-dock.browser.mjs` checks the
current-turn dock, its independent scroll area, explicit review of an earlier
turn from a slim marker, return to current work, and narrow layout. Scrolling
the transcript does not change the selected tools or duplicate their bodies.

The dock sits above the transcript even when a short conversation cannot scroll.
Expanded output has its own bounded scroll area and cannot cover the composer.
The dock journey checks oversized first-tool output on a narrow, short viewport.
`composer.browser.mjs` checks matching input controls, the complete one-level
options panel, keyboard focus, collapsible tasks/files, and phone layouts.
See [composer design](composer-design.md) for the six alternatives compared.

`action-feedback.browser.mjs` delays Queue and Stop acknowledgements to check
immediate pending feedback, duplicate-click guards, preservation of newer draft
typing, and retrying the same delivery ID after a lost acknowledgement.
Interrupt captures a steering message, stops the response, cancels waiting
messages, then delivers the steer once native state permits it. Stop without a
message only stops. Render failures offer recovery without resending. The dock
journey checks delegation handoffs while a docked card is visible. One card
renders the selected tools; no scroll-position measurement can feed back into
its selection or cause the application to go blank.
`network-access.browser.mjs` opens the production app over a private NIC address
in a phone viewport and checks pairing/reload/unauthenticated rejection;
`browser-capabilities.browser.mjs` checks the HTTP-compatible ID/copy fallbacks.

`chat-loading-cache.browser.mjs`
holds chat responses to verify one loading stage fills the chat and Details
area, then switches projects and verifies a recent transcript appears before
the network read completes. It also opens a worker from a tool card, returns to
its parent, and verifies cached worker navigation while revalidation is held.
Late responses from another project must not replace the selected transcript.
The composer stays disabled until native state is rechecked.
`colors.browser.mjs` covers provider identities and themes.

Recent chat content is kept only in the current browser tab, for up to 15
minutes, 12 chats, and an estimated 16 MB total, including worker chats. Size
accounting walks retained values without creating a serialized transcript copy;
expired entries are removed before evicting useful chats. Cached copies omit native status,
permissions, and questions. Each revisit rechecks the native chat before
allowing a new message.

Concurrent refreshes for the current selection share an in-flight read. Navigation
invalidates UI delivery from older reads, while completed transcripts can still
populate their project-scoped cache. Worker identity comes from the verified
chat response rather than depending on the bounded sidebar session list.
Native SSE heartbeats and transport chunk boundaries no longer refresh the whole
workspace; complete change events and reconnect notifications still do.

`sidebar-layout.browser.mjs` checks that expanded Chats fills the space down to
the settings divider, the list scrolls independently, and usage expansion keeps
the navigation width fixed. It also checks lower settings in short windows and
chat selection from the compact flyout. Screenshots are written to
`artifacts/sidebar-layout/`.

For interactive debugging, run `npm run dev -- --port 5199` and open
`http://127.0.0.1:5199/tests/fixtures/chat-ui.html`, or run
`node tests/fixtures/browser-workspace.mjs` for full-app permission controls.

See [consolidation verification](consolidation-verification.md) for executed
checks. Provider inference, paid dispatch and remote publishing require separate
evidence; a browser fixture does not establish them.
