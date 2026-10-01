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
tool calls stay in the Commands overlay. `chat-dock.browser.mjs` checks the
current-turn dock, its independent scroll area, explicit review of an earlier
turn from a slim marker, return to current work, and narrow layout. Scrolling
the transcript does not change the selected tools or duplicate their bodies.

The toolbar stays above the transcript even when a short conversation cannot scroll. Commands opens an overlay below that toolbar.
Expanded output has its own bounded scroll area and cannot cover the composer.
The toolbar journey checks equal sections, overlays, goal handoffs and preserved drafts at 1440px, 390px and 320px. The command history journey checks oversized first-tool output on a short viewport.
The selected tab uses the theme accent. Small activity markers for Commands,
Agents, Models and Goals open details for their owning turn; internal handoff
bodies and agent cards stay in the overlays. The journey checks that opening
an older turn does not show a later turn's model, and that labels, icons and
stats remain inside their buttons beside the collapsed navigation rail.
Tabs, navigation toggle, connection status and loading indicator share one top
row on phones too, with the panel toggle at the left edge. Narrow tabs show icons and stats with accessible names; the
selected tab keeps its accent. The mobile composer keeps a short draft on one
row and grows for multiline text.
The Agents overlay groups each worker card with that turn's assignments,
handoffs and reports, including distinct follow-ups to the same worker. Live
tool, subject, elapsed time and receipt details remain inspectable. Commands
excludes delegation, catalog and worker-inspection tools. Tab icons animate only
for their scoped activity; stale observations, approval waits and idle running
goals do not animate. Later assignments cannot replace earlier turn reports.
`composer.browser.mjs` checks matching input controls, the complete one-level
options panel, keyboard focus, collapsible tasks/files, and phone layouts.
See [composer design](composer-design.md) for the six alternatives compared.

`action-feedback.browser.mjs` delays Queue and Stop acknowledgements to check
immediate pending feedback, duplicate-click guards, preservation of newer draft
typing, and retrying the same delivery ID after a lost acknowledgement.
`send-feedback.browser.mjs` also checks that the composer clears and disables
while a submitted message is sending, then preserves the draft after failure.
Steer captures a correction without stopping the response or cancelling waiting
messages, then delivers the steer once native state permits it. Stop cancels
pending deliveries and stops the response; it also pauses an active goal.
Render failures offer recovery without resending. The dock
journey checks delegation handoffs while a docked card is visible. One card
renders the selected tools; no scroll-position measurement can feed back into
its selection or cause the application to go blank.
`network-access.browser.mjs` opens the production app over a private NIC address
in a phone viewport and checks pairing/reload/unauthenticated rejection;
`browser-capabilities.browser.mjs` checks the HTTP-compatible ID/copy fallbacks.

`chat-loading-cache.browser.mjs` switches between recently opened projects and
verifies a warmed transcript appears before the full native read completes. It
also verifies a parent transcript warms its linked worker, late reads from
another project cannot replace the selected transcript, and cached views stay
read-only until native state is rechecked.
`colors.browser.mjs` covers provider identities and themes.

Recent chat content is kept only in the current browser tab, for up to 20
minutes, 32 chats, and an estimated 24 MB total, including worker chats. In the
background, the app warms active/waiting chats and the three latest parent chats
for the current and two most recently used registered projects. Parent message
links warm their verified child sessions too. At most two transcript-only reads
run concurrently; the full native chat read still refreshes status, permissions,
questions, todos, diffs, and activity before enabling actions. Cached copies omit
native status, permissions, and questions. Size accounting avoids serializing
transcripts, and expired entries are removed before evicting useful chats.

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
