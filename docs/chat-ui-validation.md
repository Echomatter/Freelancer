# Chat validation

The production journeys use the real React bundle, loopback HTTP handlers and
application stores with disposable data. Native model transport is simulated.
Run `npm run build` followed by `npm run test:browser`.

`polish.browser.mjs` checks the scrollbar and composer reach the window bottom,
right-aligned content-sized user bubbles, retained reading position after
navigation, shared task/delivery cards, dismissal/restoration, explicit queue
cancellation, settings close controls, and narrow layouts. `chat-tweaks.browser.mjs`
checks that assistant prose, including reasoning parts, stays in the chat while
tool calls stay in the collapsed work card. `chat-loading-cache.browser.mjs`
holds chat responses to verify one loading stage fills the chat and Details
area, then switches projects and verifies a recent transcript appears before
the network read completes. The composer stays disabled until native state is
rechecked. `colors.browser.mjs` covers provider identities and themes.

Recent chat content is kept only in the current browser tab, for up to 15
minutes, 12 chats, and 16 MB total. Cached copies omit native status,
permissions, and questions. Each revisit rechecks the native chat before
allowing a new message.

For interactive debugging, run `npm run dev -- --port 5199` and open
`http://127.0.0.1:5199/tests/fixtures/chat-ui.html`, or run
`node tests/fixtures/browser-workspace.mjs` for full-app permission controls.

See [consolidation verification](consolidation-verification.md) for executed
checks. Provider inference, paid dispatch and remote publishing require separate
evidence; a browser fixture does not establish them.
