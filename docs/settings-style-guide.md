# Settings design guide and UI contract

[Settings UX index](settings-ux-index.md) · [Color system](color-system.md) · [Architecture](ARCHITECTURE.md) · [Testing](testing.md)

This is the presentation contract for application settings, project settings, and the utility pages reached through those menus. It describes how to build the UI, not how an agent is allowed to execute a task. Do not turn it into agent instructions, tool allowlists, or another permission layer.

## Design intent

A person should be able to answer three questions before changing anything: **What is this page for? Who or what does this change affect? When is the change saved?** Keep purpose, scope and usage explanations in the existing help bubble. Browsing, diagnostics, editing, and executing work are different activities even when they share a navigation drawer.

Reuse EchoFlex. The existing palette and provider identity systems are authoritative. Keep a stable reading order, restrained surfaces, visible labels, and local feedback. Preserve every existing capability; improved presentation must not narrow runtime access.

## Ownership and information architecture

Application settings owns shared presentation, providers, file access, server access, cross-project schedules, and local data maintenance. Project settings owns new-chat defaults, project/chat delegation preferences, goals, and the repository agreement. Files, search, models, usage, and conversation history are utility destinations, not a claim that every control on them is configuration.

Agents belongs in Application settings because its catalog is shared across projects. GitHub edits the selected project’s agreement; there are no application-wide Git defaults. Scheduled prompts is application-wide but each schedule identifies its project. Remote access changes the running server on this computer. Settings menus are flat lists without section headings, separators or agent subtitles.

`src/settings-catalog.mjs` is the single navigation/heading metadata source. Route IDs remain stable and `App.tsx` continues to own routing. The catalog contains presentation metadata only. Preserve the two different search scopes; do not collapse them into a search that silently changes scope.

## Page anatomy

Use this reading order:

1. **Page heading:** icon and one `h1`; page-level actions and Close on the right when space allows. On narrow screens, Close remains beside the title and actions occupy the next row in reading and keyboard order. Use the primary button treatment for the main page action and quiet treatment for Close, with a 44px close target. Do not add a subtitle, scope/purpose line, description paragraph or a second title such as "Your models".
2. **Context and feedback:** scope selector where needed, loading/error information, or a compact observation timestamp. Put a filter before the collection it filters.
3. **Task panels:** ordinary choices first, supporting information next, advanced or maintenance actions last. Each independently saved task has its own panel or clearly labeled fieldset.
4. **Local action row:** save/cancel and result near the fields they affect. A long page must not imply that one Save button commits unrelated operations.

Use `PageHeading`; it resolves the registered title to page metadata and adds `data-settings-page` and `data-settings-layout`. A registered title is therefore an intentional integration point: update the registry and navigation/browser tests together when renaming it. An unrelated heading receives no settings metadata or settings-specific page shell. Catalog descriptions and any description override appear in the lower-right page help popup, never as page prose.

A form page is constrained to 960px including page padding; a collection/inspection page to 1280px. These are maximums, not minimum widths. Avoid adding nested `.page` scroll containers. The parent page scrolls; code previews or genuine wide tables may scroll within themselves.

## Panel and collection anatomy

`Panel` supplies the shared surface, border, radius, help scope, and accessible heading relationship. Its generated top-level title is `h2`; titled nested panels increment the heading level. An explicit `aria-label` or `aria-labelledby` remains authoritative. Untitled panels do not invent headings.

Use a panel to group one user task, not to box every line. A tool or skill inventory should be a list of rows inside a panel, not dozens of nested cards. A row contains a recognizable name, a textual state and supporting metadata. Tool and skill summaries remain in their explicit item disclosures. Other explanatory copy belongs in the card's help popup. Long paths wrap. Small secondary text still uses the palette's readable `--muted` value; do not fade it with opacity.

For manually composed card headings, keep the correct document level and use the common heading style. Fieldsets use legends, not decorative headings. Help belongs to the card's existing `HelpScope` footer; do not scatter competing help icons beside every heading.

Repeated entity cards, such as providers, schedules, or goals, use the same internal ordering: identity, state, relevant facts, primary action, secondary actions. Destructive or consequential actions are visually distinguishable and retain their existing confirmation path. A diagnostic's state badge must not look like a launch button.

## Visual vocabulary

| Role | Use |
| --- | --- |
| Page / card / sidebar surface | `--bg`, `--paper`, `--sidebar` |
| Primary / supporting text | `--text`, `--muted` |
| Standard border | `--line` — not an invented `--border` alias |
| Accent and selected surface | `--accent`, `--tint` |
| Hover / focus | `--hover`, `--focus` |
| Destructive / error treatment | Existing `--danger` / `--danger-tint` and shared controls |
| Provider identity | `ProviderText`, `ProviderScope`, `providerAttributes`, `ProviderSelect` |

The palette derivation and contrast checks live in the existing color system, not in page CSS. Do not put fixed light/dark colors into settings, modify generated fallback palettes by hand, or color a whole page with a provider's brand color. Identity color is not status color. A custom theme receives the same structure and semantics as a built-in theme.

The shared settings geometry is in `src/settings-ux.css`: 20px desktop panel gaps/padding, 16px at narrow widths, 12px panel corners, a 24–30px page title, and a 16px panel title. Dense secondary metadata is 12px. Controls retain native focus styles and use at least a 40px height where practical; narrow-screen menu targets are 44px. Keep icon-only actions named and avoid using a tooltip as their only accessible label.

## Fields, saving, and feedback

Use `Field` for visible labels and correct control association. A placeholder is an example, not a label. Related fields may share a two-column grid when each remains readable; they collapse to one column on narrow screens. Checkbox/radio labels form one clickable row. Put longer explanations in the existing help popup. Keep actual status, errors, permission warnings and consequential-action confirmation text visible near their controls.

Choose one save model for each task and state it clearly. A theme choice may save immediately; a multi-field billing edit uses an explicit Save action. Do not silently mix the two. Saving provider colors must not discard unsaved billing values. API authentication and quota refresh are also independent operations.

During a mutation, prevent duplicate submission and disable the fields whose values are being submitted. Retain the draft after a failure. Report success only after the write is acknowledged. A failed follow-up refresh must not turn a successful write into a false “save failed” message. Clear stale success on the next edit. Do not add a fake global Save/Reset affordance where the API has independent save boundaries.

Use `role="status"` or an existing polite live region for saving/success and `role="alert"` for an actionable error. Keep the failed task identifiable. Routine inventory rows are not individual live regions. Preserve a usable retry path, and keep unavailable data distinct from a confirmed empty result.

## Honest state language

| Observed condition | Appropriate wording | Do not imply |
| --- | --- | --- |
| Native tool registration found | Registered | Tool invocation succeeded |
| Registration absent | Not registered | The model is forbidden from using it |
| Probe unavailable | Unknown / inventory unavailable | There are zero tools or skills |
| Skill file missing | Missing file | Merely not selected |
| MCP connection observed | Connected | Its tools and dependencies were tested |
| MCP requests authentication | Sign-in needed | The integration is ready |
| MCP configuration saved | Saved; report observed activation | Every model successfully used the service |
| Quota data incomplete or old | Partial / not current | Complete current availability |
| Schedule delivered to a chat | Sent to chat | The work finished |

Capabilities combines platform inventory with shared native MCP connection controls. Do not add agent/model selectors, per-agent access switches, or a second prompt editor. Preserve explicit approval for new connections and native authentication. Its text filter changes presentation only. Report observed project context without claiming the entire environment is project-local or universally verified.

Place model data source setup under **Application settings → Capabilities → Model data sources**. Providers and Models show the user's connected OpenCode setup, including keyless OpenCode Free. Models uses compact informative cards in one filtered grid, with native limits, capabilities and access, published deployment prices, and separate Artificial Analysis tested configurations. Keep source units, links and capture dates with the values; show **—** for unavailable values. Explain source scales and missingness in the help icon. Choose models in the chat composer or Session defaults. Explicit source updates stay on Models. Keep source-key management on this computer and let paired remote devices update configured sources using safe status metadata. Reuse the existing write-only credential form and protected storage; Artificial Analysis is a data source, with no MCP template or duplicate setup form.

Connected services and model data sources use the same palette surfaces, identity/status rows, shared fields and compact local actions as other capabilities. Keep explanatory metadata in panel help. **Show exhausted models** is a plain saved checkbox at the end of Available Usage. Conversation browsing, archive/restore, Undo and export live in Search all content. Search coverage belongs in page help. Search and Content & Storage do not add cross-navigation buttons to their headings.

## Responsive and keyboard behavior

Maintain DOM order when moving a setting; do not use CSS `order` to make keyboard traversal disagree with visual placement. At 360px, the page must not scroll horizontally. Long IDs/paths wrap, action rows wrap, and multi-column forms collapse. Do not hide error messages, destructive-action warnings, or the save result to achieve a compact layout.

Navigation drawers remain disclosure buttons with `aria-expanded`/`aria-controls`; destinations use `aria-current="page"`. Subgroups are ordinary labeled groups. They are not ARIA tabs or menu widgets. Preserve the existing Escape/outside-click/focus handling in `useNavigationDismiss`.

Use the existing EchoFlex `Dialog` or `ConfirmDialog` for modal editors and confirmations. Let its stack own focus, backdrop, dismissal, and lifecycle. Do not introduce native browser prompts or page-owned modal shells. Respect reduced motion and retain a visible selected/focus indication in forced-colors mode.

## Implementation and review workflow

For a new or changed destination, update the registry, its entry in the [single UX index](settings-ux-index.md), and tests. Reuse the shared heading and panel controls before adding page CSS. Page-local CSS is for content-specific structure, not a second shell or palette. Explain any genuinely different layout in the index.

Review the actual page and nested editors, not just source markup. The checklist is: correct scope, correct save boundary, clear title/labels, one reading order, keyboard access, long content, loading, empty/filter-empty, partial/unavailable, save failure/retry, and consistent light/dark/custom themes. Validate provider color separately from semantic status. Check that a style change does not change requests, tool access, paid consent, Git authority, or saved keys.

The new browser sweep covers all 19 current destinations at 360px and 1440px in representative light, dark, and generated custom themes. Existing feature journeys remain necessary for authentication, Git confirmations, goals, theme persistence, schedules, and data maintenance. A layout sweep is not evidence that external integrations work.

## Ownership / contact

Repository maintainers own this guide and the route index. Propose a change in a GitHub issue or PR on `Echomatter/Freelancer`, linking the affected `scope/id`, source component, screenshot, theme, viewport, and reproduction steps. No separate design owner or contact address is assumed. Code and documentation should change together; unresolved issues belong in the index's remaining-work section rather than disappearing behind a “complete” label.
