# Palettes and provider colors

Freelancer uses shared EchoFlex styling. The application owns a small semantic token catalog, theme startup handling and provider color derivation.

The palette catalog offers 300 distinctively named choices, with 150 light and 150 dark palettes. Each displayed name has exactly two words, neither reused by another palette. Saved IDs remain stable. The catalog varies surface hue, depth and saturation as well as accent color, including contrasting seafoam/copper, navy/rose, and nightshade/gold combinations. A weighted OKLab separation check guards against near-duplicate palettes; the independent contrast contracts remain the accessibility gate. Derived muted shades preserve the required text contrast while remaining distinct from primary copy where the available surface contrast permits; selected and hover surfaces are adjusted to remain perceptible against the page. In Application settings > Appearance, collapsible Light themes and Dark themes groups are each sorted by accent hue. The default light and dark palettes retain their familiar color families; each choice colors the shell, EchoFlex controls, custom dialogs, status badges, code/diff surfaces and focus states consistently. Theme changes preview immediately while saving and revert with an error if the save is not confirmed. Saved palettes apply before the first application paint and survive restarts without origin-specific browser storage.

Provider colors are appearance metadata, never routing, authentication or accounting policy. OpenCode Free defaults to green. Each provider offers preset colors, a custom hex color, a preview and a reset to its default on Application settings > Providers. Derive readable foreground, subtle tint and solid-marker variants from the selected color for each application palette. Preserve provider labels; never rely on color alone. Status/error colors and user-authored message content retain their own semantics.

Store validated provider color overrides in the existing private appearance settings. Partial writes must preserve other providers, billing plans and unrelated appearance preferences. Confirm successful persistence before applying a choice; failed writes keep the existing colors and show an error. Unknown/legacy palette values resolve safely.

Verification must cover token contrast, input validation, partial saves/reset, older settings, initial HTML, custom UI/primitive states, provider/model identity propagation, normal browser interactions, keyboard focus, narrow layouts and reduced motion. Record tested heads and distinguish automated browser evidence from live Windows/retired native shell validation.

## Use

**Create a theme** opens the third category, **Custom themes**. Generate or
Regenerate rolls fresh local randomness with a choice of Surprise me, Light or
Dark. The preview shows page, sidebar, card, text and action colors. Naming is
optional; **Save & use** stores the palette and applies it after confirmation.
Discard leaves the current theme intact. Saved custom themes can be selected or
removed; removing the active one returns to its built-in Light or Dark default.

All 300 built-in thumbnails use the same semantic tokens as the live layout:
page background behind the transcript, sidebar beside it, and a distinct paper
card/composer. Text strokes are opaque, so their colors match the rendered ink.
The previous thumbnail used paper for the entire main area, hiding the page hue.

Open **Application settings > Appearance**, expand Light themes or Dark themes, and choose a palette from its color-sorted preview grid. Either category can be collapsed independently. A checkmark and pressed state identify the selected palette independently of color. The grid adapts to two columns on medium screens and one column on narrow screens. Todo placement is retained from older preferences, but is no longer an Appearance setting; the current workspace behavior remains in effect.

Open **Application settings > Providers** to set each provider's color. Choose a named swatch, the system color picker, or a three/six-digit hex value. The sample previews the choice without changing the rest of the app. **Save color** persists it; **Use default** removes only that provider's override. Color changes do not save unsaved billing fields or require authentication.

OpenCode Free (`opencode`) defaults to green and OpenCode Go (`opencode-go`) has a separate amber identity. Provider/model names, markers, selected model controls, contribution meters and child-model labels use derived readable shades. Conversation bodies, code, diff meaning, permissions, warnings and errors do not inherit provider colors. Native select popup entries remain neutral because their styling varies by operating system; the closed selected value and its border carry provider identity.

## Ownership and extension

- `domain/theme.mjs`: immutable palette registry and complete semantic token derivation; each palette has a separate browser/native light-or-dark mode.
- `domain/color.mjs`: validated hex, contrast and bounded shade adjustment. Only known CSS variables and validated values enter styles.
- `domain/provider-colors.mjs`: provider defaults and bounded cached foreground/tint/solid/border variants. Text is checked against all supported content surfaces, including the derived tint, at 4.5:1; marker/control edges target 3:1.
- `src/echoflex/tokens.css`: generated fallback for dev/static rendering. Run `node scripts/palette-css.mjs` after registry changes; `--check` detects drift.
- `src/ProviderColors.tsx`: appearance context, identity primitives and native model-select wrapper. It never globally replaces semantic accent/status variables with provider colors.
- `src/colors.css`: shared primitive states and custom UI colors. Existing custom composer, question, panel-resize, code/diff and provider-connection surfaces consume the same semantic variables. Git pages use these same tokens.

The existing `settings.json` keeps `appearance.theme`, optional `appearance.customThemes`, and an optional `appearance.providerColors` object keyed by supported provider IDs. Missing overrides use defaults. Known Light/Dark settings retain their background families; some old muted and semantic shades are adjusted for readability. Unknown theme values resolve to Light. No bulk migration, dependency upgrade, separate settings database, cloud sync or account change is introduced.

The appearance handler accepts partial provider maps and `null` resets. Invalid combined patches fail before mutation. Serialization in the existing store preserves unrelated settings. Successful UI responses merge only the changed keys and invalidate older bootstrap reads. Provider color metadata never influences billing, quotas, model eligibility, routing or credentials.

Custom definitions live in `appearance.customThemes` (up to 64), alongside the
selected ID in `appearance.theme`. Only UUID-based IDs, a short plain-text name,
light/dark mode and nine canonical hex colors are accepted. The server derives
every semantic token and validates the same contrast requirements as built-ins.
Generation uses browser crypto randomness and bounded rejection sampling. It
rejects exact decorative color reuse and weighted OKLab distance below 0.08 from
same-mode built-ins, saved themes and recent rolls (recent-roll checks are local).
Semantic status colors keep their established meaning. Saves recheck against
the current collection inside the serialized store update, avoiding concurrent
overwrites. Initial HTML and provider color derivation support custom palettes;
names and arbitrary CSS never enter the server-stamped style attribute.

## Startup and interactions

The server stamps the saved palette and every semantic token into initial HTML before JavaScript. Palette changes replace the complete token set without color crossfades that could temporarily mix unreadable foreground/background pairs. Browser origin or loopback port is not used as a persistence key.

The browser and Chrome app window use the same saved palette in initial HTML and subsequent DOM updates. There is no native frame-color adapter or native-window capability grant.

During the browser audit, the existing Chat component's sender hook was found not to render its dialog output. The bounded fix renders `sender.ui` outside the composer form, restoring Queue/Clarify so the actual custom dialog can participate in palette checks. No sender protocol, queue or worker behavior was redesigned here.

## Verification

Commands:

```sh
node scripts/palette-css.mjs --check
npm test
npm run build
npx playwright install chromium
npm run test:browser -- colors
```

The color contracts cover legacy/default resolution, token parity, text/control contrast, custom provider colors, provider identity, input validation, concurrent partial writes, resets, HTTP boundaries, initial HTML, and token replacement. Source/token comparisons normalize Windows CRLF to LF; the CLI regression test accepts both line endings while rejecting changed or missing tokens.

`tests/custom-themes.browser.mjs` compares the computed colors of all 300
thumbnails against their source tokens. It also covers random rerolls, mode
selection, unsaved preview isolation, naming, failed-save recovery, unnamed
saves, removal, a delayed-bootstrap first-paint check and narrow-screen layout.
`tests/custom-themes.test.mjs` exercises a full 64-theme collection, contrast,
perceptual separation, hostile color input and concurrent appearance writes.

The production browser journey passed six scenario groups: all palettes and live shell/primitive states; failed theme saves; provider preview and duplicate-save prevention; invalid/failed color writes and model cards; parent/worker identity with neutral messages and actual sender/question dialogs; connection dialog, narrow layout, shade adaptation, reload, reset and forced-color usability. It uses the real application/HTTP/store with disposable data and only native OpenCode transport stubbed; no inference or real credentials.

The browser journey uses normal loopback navigation on Windows. Optional COLOR_OFFLINE=1 is a bridge for restricted environments and is not CSP evidence. Browser fixtures do not establish real provider authentication or whole-application WCAG conformance.

## Windows settings-file locks

A Windows browser run exposed an intermittent `EPERM` while atomically replacing `settings.json`. The UI correctly reported the failed save and kept the previous palette. The existing store now retries only Windows `EPERM`, `EACCES`, and `EBUSY` rename failures, using the same fully written temporary file. There are at most six attempts with 620 ms total backoff. Other errors fail immediately. It never deletes the destination or re-executes the state mutation; queued saves remain serialized. A persistent error still leaves the saved settings intact and cleans up only the temporary file. Five fault-injection tests cover transient recovery, permanent failure, unrelated errors, state preservation, and serialization. This is a bounded save-reliability fix, not a storage migration.

## Available Usage consumer

The compound meter, provider disclosure and dashboard tile consume the same
EchoFlex tokens and live appearance context. Provider fill/text use derived
`--provider-solid`/`--provider-fg` on the tested provider tint; actions and status
copy remain semantic. Geometry changes animate, palette colors do not crossfade.
The usage browser journey extends existing color verification without adding a
second registry or changing saved provider color behavior.
