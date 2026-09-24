# Available Usage

The bottom navigation meter and the dashboard show **Estimated available** and
**Next reset**. The navigation summary expands into provider rows without leaving
the chat; its **Open Available Usage** link opens the dashboard. In the icon-only
navigation layout, the provider disclosure opens beside the rail. Only its rows
scroll; Settings, the summary and disclosure actions remain reachable.

## What the estimate means

Each connected, enabled finite subscription contributes one equal share to the
compound bar. All remaining portions touch from the left; the subdued used or
currently unavailable portions touch from the right, in reverse provider order.
There are no gaps or separately rounded mini-bars: one remaining/used boundary
moves across the rail. Provider colors still identify the portions. Unknown
shares stay patterned between the known remaining and used portions; they are
never folded into either total. Each provider's own row retains its normal bar.
The headline is the mean only when every included plan has usable data. Model
counts and subscription prices do not change the weights. These are separate
allowances, not interchangeable units or a promise about work output.

A limiting window or active execution block can make current availability zero
while a longer-window balance remains. Unknown/stale portions keep their width
and pattern; they are not zero. Partial data suppresses the overall number. Free
models remain visible, with variable or known blocked availability, outside the
finite denominator. Model readiness and restrictions remain in the existing
model inventory; provider rows no longer include a model/limits dropdown.

Times refer to reported window resets. A reset is not a promise that every model
will be usable. About this estimate retains local absolute reset times, the observation time
and shared-window information. A fresh observation must confirm a new value; the UI never
invents a refill. Small positive/non-full edges cannot round to empty/full.

## Ownership

- `shared/usage.mjs` remains the quota projection. Two additive, credential-free
  fields expose provider restriction and execution-block deadlines. Existing
  accounting, routing and native permissions are unchanged.
- `domain/availability.mjs` filters the existing inventory/catalog and applies
  observation-time fences to the quota projection. No new network/ledger store.
- `src/useAvailability.ts` uses one `domain/usage-refresh.mjs` coordinator for
  all views. Requests join in-flight work; automatic retries are bounded from
  one minute to five minutes, with failure backoff. Visibility/focus and a
  minute/deadline timer recheck freshness even when no chat event arrives. A
  45-second request timeout prevents an indefinite checking state.
- `domain/usage-meter.mjs` packs existing percentages into contiguous portions;
  it does not change quotas, weights, refreshes or accounting.
- `src/AvailableUsage.tsx` composes EchoFlex `Panel`, `Button` and the existing
  provider identity helpers. The usage stylesheet adds geometry, not palettes.
  Appearance remains confirmed server settings and live context; expansion is
  transient React state. No new appearance store, theme authority or dependency.

Currency amounts and raw usage counters are absent from the normal summaries.
The optional provider subscription-price editor and internal accounting remain.
Contribution percentages are unchanged and are not quota consumption. Native
conversation content, code, exports, permissions and context controls are not
scrubbed. A monetary number authored in a chat remains authored content.

## Verification and startup

```sh
node scripts/palette-css.mjs --check
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

Usage tests exercise the real app, HTTP, settings and draft stores with synthetic
native transport and quota data. Browser artifacts under `artifacts/usage/`
cover all four palettes, compact/expanded/dashboard views, actual computed
contrast, custom colors, save races, narrow widths, touch/keyboard, 200% zoom,
forced colors, reduced motion, refresh failures and clock-driven expiry. The
fixture never authenticates or performs model inference. `USAGE_OFFLINE=1` is an
editing-sandbox bridge only; it is not normal-navigation/CSP or native evidence.

UI contract is **7**. After pulling, rebuild and restart the local Freelancer
server/window. Refreshing an old server's browser alone is not an upgrade.
A live Windows Chrome-shortcut startup and real account reset remain distinct manual checks;
fixture tests cannot establish the user's balances or provider transport behavior.
