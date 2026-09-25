# Panel sizing and startup palette

Drag the right edge of navigation or the left edge of Details. Widths preview
immediately and save on release. Double-click an edge to reset that panel.
The focused separator supports Arrow keys, Shift for larger steps, and Home/End.
Escape cancels a drag. Failed saves roll back with a visible error.

Widths live in the existing appearance store. The two fields are independent of
todo placement, theme, routing and native sessions. Navigation is bounded to
180–480px, Details to 260–640px, with 320px reserved for chat. Small windows
clamp the displayed sizes without erasing preferences. The existing compact
navigation and Details overlay remain; their resize handles are not shown.

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
node tests/panels-theme.browser.mjs
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
