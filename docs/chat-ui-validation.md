# Chat validation

The production journeys use the real React bundle, loopback HTTP handlers and
application stores with disposable data. Native model transport is simulated.
Run `npm run build` followed by `npm run test:browser`.

`polish.browser.mjs` checks the scrollbar and composer reach the window bottom,
right-aligned content-sized user bubbles, retained reading position after
navigation, shared task/delivery cards, dismissal/restoration, explicit queue
cancellation, settings close controls, and narrow layouts. `chat-tweaks.browser.mjs`
checks that assistant prose, including reasoning parts, stays in the chat while
tool calls stay in the collapsed work card. `colors.browser.mjs` covers provider
identities and themes.

For interactive debugging, run `npm run dev -- --port 5199` and open
`http://127.0.0.1:5199/tests/fixtures/chat-ui.html`, or run
`node tests/fixtures/browser-workspace.mjs` for full-app permission controls.

See [consolidation verification](consolidation-verification.md) for executed
checks. Provider inference, paid dispatch and remote publishing require separate
evidence; a browser fixture does not establish them.
