# Chat tools, files and startup palette

The top row combines navigation, Commands, Agents, Models, optional Goals,
connection status and refresh. Each tool tab opens an overlay below it. Working
icons animate only for current activity; selecting another turn shows its history.

Commands contains actual tool calls and their receipts. Conversation recaps stay
in the transcript, and task lists stay in the composer Tasks card. **Project settings → Files** contains the
selected chat's recorded diffs and current working tree previews. Each change is
labeled **Chat record** or **Working tree**; the latter can include other chats'
work. The file browser and indexed-search links remain on this page.

Agents uses graphical status cards linked to native agent chats for handoffs and
reports. Models starts with **Work by models**, showing the chat and its agents'
measured token-activity shares for the displayed month, including partial-data
labels. These shares are activity volume, not quality or completion. Selected-turn
model identities and handoff statuses appear below the chart.

Navigation width still previews while dragging and saves on release. Keyboard
resizing and narrow-screen clamping preserve the saved preference.

The saved light/dark palette is now included in the initial HTML, with a critical
background and color-scheme before scripts execute. It does not depend on the
browser's per-origin localStorage or a later provider/bootstrap response. This
also covers a restart that selects a different loopback port. Browser and Chrome startup use the same initial HTML and saved palette.

Restart the local application server after installing this branch. Refreshing
an older running server is insufficient. Unsupported width/theme saves must
produce a restart error, not a false saved acknowledgement.

## Verification

`npm test` includes `tests/panels-theme.test.mjs`. `npm run build` includes the
project TypeScript check. The optional browser pass uses the exact production
bundle, real local HTTP adapter and temporary on-disk store, with native model
and session data stubbed so no provider credentials or inference are required:

```sh
npm run build
npx playwright install chromium
npm run test:browser -- panels-theme
```

The browser pass checks initial dark HTML without JavaScript, both drag edges,
keyboard/reset/cancel behavior, reload persistence, failed saves, cramped window
sizes, and switching/relaunching the palette. In restricted editing environments,
`PANEL_OFFLINE=1` loads the built assets locally and bridges API calls to the real
loopback handler; that mode is not evidence of normal navigation or CSP behavior.

For current executed checks, see [consolidation verification](consolidation-verification.md).

Still perform one real Windows Chrome-shortcut launch: select Nightfall, close/reopen
the window and confirm saved panel sizes, palette, keyboard controls and exports.
Closing the window does not stop the Node server. No native compilation is needed.
