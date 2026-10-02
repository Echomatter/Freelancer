# Settings UX index and page audit

[Design guide / UI contract](settings-style-guide.md) · [Color system](color-system.md) · [Testing](testing.md)

**Audit baseline:** `5976007035754bc5d879d0b7b812e6b44e88159b` (October 1, 2026). This is the single detailed inventory of the 7 project-menu and 11 application-menu destinations, including their panels and nested editors. The executable navigation/heading index is [`src/settings-catalog.mjs`](../src/settings-catalog.mjs). Source review and implemented changes are identified separately from browser verification; see the final section.

## Shared UX parts

| Part | Implementation | Responsibility / placement |
| --- | --- | --- |
| Settings drawers and grouped destinations | [`SettingsNavigation.tsx`](../src/SettingsNavigation.tsx), settings catalog, `NavigationMenus.tsx` | Two existing scopes; subgroup labels, named icons, current-page marker, disclosure/dismissal behavior. |
| Page shell, heading, close action | [`echoflex/Controls.tsx`](../src/echoflex/Controls.tsx), [`settings-ux.css`](../src/settings-ux.css) | Scope/purpose, h1, description, page actions; form vs collection maximum width. |
| Panel / nested panel | `Panel`, `HelpScope` | Themed surface, accessible h2/h3 hierarchy, one task or collection, shared footer help. |
| Field and fieldset | `Field`, native form controls, legends | Visible labels, input association, grouped choices, responsive columns. |
| Buttons / badges / empty states | `Button`, `Badge`, `Empty` | Action hierarchy, named icon controls, textual status, recoverable empty states. |
| Provider identity and model controls | `ProviderColors.tsx`, `ProviderColorPicker.tsx`, `ModelSetup.tsx` | Provider mark/color, model and reasoning selection; independent color persistence. |
| Modal shell / confirmation | `echoflex/Dialog.tsx` | Focus management, dismissal, busy state, footer, consequential-action confirmation. |
| Feedback and progress | local status/error regions, `ProgressStatus`, `IndexJobs`, model-rating progress | Keep loading, write success, refresh failure, and execution progress distinct. |
| Read-only collections | model cards, tool/skill rows, project/file/search/history lists | Filter before results; name/state/metadata/action ordering; source and scope visible. |
| Theme sources | `domain/theme.mjs`, provider color modules, `echoflex/tokens.css`, `colors.css` | Existing palette derivation and contrast; no page-owned theme. |

**Menus:** Project and Application settings each use one flat list. Agents is an application destination with no shared-catalog subtitle.

## Application settings

### application/appearance — Appearance

**Source:** [`ThemePicker.tsx`](../src/ThemePicker.tsx), [`Settings.tsx`](../src/Settings.tsx). **Type / scope:** immediately saved application presentation. **Width:** collection.

**Anatomy:** page heading and Close; theme panel with current theme and Create a theme; independent disclosure groups for Palette generator, Custom themes, Light themes, and Dark themes. The generator contains style selection, Generate/Regenerate, a local preview, optional theme name, Save & use, and Discard. Custom palette cards have selection and removal actions; built-in cards show their selected state. Saving and errors belong to the picker.

**Placement verdict:** correct. Provider colors stay with Providers because they identify a provider rather than change the whole workspace. **PR treatment:** common page context, spacing, panel surface and responsive geometry; existing theme generation, contrast checks, selection persistence and rollback remain intact. No palette defaults are changed.

### application/providers — Providers

**Source:** [`Settings.tsx`](../src/Settings.tsx), [`ProviderColorPicker.tsx`](../src/ProviderColorPicker.tsx), [`ProviderConnection.tsx`](../src/ProviderConnection.tsx). **Scope:** shared provider configuration. **Width:** collection.

**Anatomy:** four provider cards: OpenAI, GitHub Copilot, OpenCode Go, OpenCode Free. Each has identity and connection status; non-free-provider cards expose Connect/Reconnect, billing mode, and optional monthly subscription price. Each card's color fieldset has presets, custom color input, hex input, preview, Save color, Use default, validation and local status. The final Billing preferences panel owns currency and Save provider settings. The connection dialog contains native method selection, conditional provider fields, API-key or browser authorization, optional authorization code, error and busy states.

**Placement verdict:** correct, but three different save boundaries were visually ambiguous. **PR treatment:** explicit connection/billing/color independence, named billing fieldsets, a billing footer panel, pending-save guard, retained billing draft after failure, and preservation of dirty billing inputs across unrelated color/auth refreshes. Billing success is not reversed by a failed workspace refresh. Authentication remains the existing native flow; no credentials enter this catalog or guide.

### application/models — Models

**Source:** [`App.tsx`](../src/App.tsx), [`ModelRatings.tsx`](../src/ModelRatings.tsx). **Type:** shared catalog with a current-chat selection action. **Width:** collection.

**Anatomy:** heading with Update Model Ratings and Close; search, provider filter, sort control, All/Free access filter; empty-filter state; model cards with identity, observation/status, provider, access class, native context/output/tool-use/variant facts, and Use model. The ratings dialog chooses selected-model research or parallel free-model research, model and reasoning variant, then starts a task. Rating progress has hide/reveal, stop, retry, completion, questions and native permission surfaces.

**Placement verdict:** acceptable as an AI utility adjacent to Providers, not as an editable model-availability policy. **PR treatment:** shared description, card spacing, wrapping filters/actions and page bounds. No model selection, rating or execution logic changes. A ratings task remains distinct from merely opening this page.

### application/usage — Available Usage

**Source:** [`App.tsx`](../src/App.tsx), [`AvailableUsage.tsx`](../src/AvailableUsage.tsx). **Type:** overview with one visibility preference. **Width:** collection.

**Anatomy:** one full-width availability hero with combined meter, estimate, next reset, Refresh, provider legend, stale/partial/error feedback, reconnect shortcut and Observation details. Model visibility is an advanced disclosure with the saved “Show exhausted models” choice. Supporting panels cover Your providers, Model contributions, optional Agent contributions, and Recent projects / Open project. Provider rows carry provider-specific remaining usage, reset and warning information.

**Placement verdict:** usage belongs beside provider/model utilities. Model visibility is related and remains discoverable here; Recent projects is convenience navigation, not a usage setting. **PR treatment:** common hierarchy, descriptive scope and panel gaps, preserving the single hero and provider-colored meter. This PR does not add dollar figures to normal usage UI or reinterpret estimates as verified quotas. Moving Recent projects into a general home view is a follow-up IA decision, not silently done here.

### application/capabilities — Capabilities

**Source:** [`Capabilities.tsx`](../src/Capabilities.tsx), [`capability-presentation.mjs`](../src/capability-presentation.mjs), [`capabilities.css`](../src/capabilities.css); inventory contract in [`server/capabilities.mjs`](../server/capabilities.mjs).

**Anatomy:** title, refresh and close; Tools and Skills lists without filters; one MCP connection card. Short statuses remain visible. Explanations, origins, inspection errors and captured instruction sources are in the card help bubbles.

**Placement:** application-wide tools, skills and MCP connections. Project context is an inspection input, not an access setting. Connection setup retains native permissions and explicit approval.

### application/schedules — Scheduled prompts

**Source:** [`ScheduledPrompts.tsx`](../src/ScheduledPrompts.tsx). **Scope:** cross-project schedule management. **Width:** collection.

**Anatomy:** heading/Close, New schedule toolbar, local success/load/scheduler/error feedback, optional inline editor, empty state, schedule cards. Editor fields: Name, Prompt, Project, Agent, Model, Repeat (once / every 24 hours / every 7 days), First run in local time, displayed timezone, enabled checkbox, Save and Cancel. Cards show prompt, execution identity, next run, last delivery outcome, Open run, Edit, Pause/Resume, and a two-step Delete/Keep confirmation.

**Placement verdict:** application-level is correct because the collection spans projects; the project field is essential. **PR treatment:** standard page description, fields/cards/action wrapping and spacing. Native schedule timing and delivery semantics remain unchanged; “Sent to chat” is not relabeled “Completed.”

### application/history — Conversation history

**Source:** [`History.tsx`](../src/History.tsx). **Scope:** one selected project at a time, reachable across the application. **Width:** collection.

**Anatomy:** heading and pending-aware Close; project selector and help; Active/Archived/All filter; feedback and Undo; loading/empty/result region with row selection, conversation title, activity/goal marker, archive/import/cache/date metadata, and Pin/Unpin; Load more; project/goal archive scope notes. Footer owns selected-count Archive/Restore and export format (Markdown/JSON), Include workers, Export selected. Archive/restore confirmation explains native vs Freelancer-only behavior and preserves related worker history.

**Placement verdict:** correct as cross-project organization, but scope must remain visible. **PR treatment:** standard description and responsive action controls; all archive, export, pinning and undo behavior retained. Sticky selection actions for very long lists are not introduced without a separate overlap/focus review.

### application/search — Search all content

**Source:** [`IndexedSearch.tsx`](../src/IndexedSearch.tsx). **Type:** global utility; no configuration write. **Width:** collection.

**Anatomy:** heading/Close/Content & Storage action; search field and explicit All registered projects scope; independent file/conversation errors and Retry; progress/result count; Conversation results and File results groups with project identity, excerpts, source/archive/import information and Open actions; complete-no-results panel linking to index maintenance.

**Placement verdict:** useful alongside history and indexed data; not a reason to put search inputs inside maintenance. **PR treatment:** standardized heading/context and responsive page geometry. The two result sources retain independent failure handling and provenance.

### application/content-storage — Content & Storage

**Source:** [`ContentStorage.tsx`](../src/ContentStorage.tsx). **Scope:** content indexes and application-local storage. **Width:** collection.

**Anatomy after this PR:** heading with Search all content and Close; section-jump links; independent index/storage error-retry notices; index metrics; Projects; Local data; SQLite maintenance. File access has its own Application settings destination. Projects rows show name/path/archive state, file and chat coverage, archive/restore, and file/conversation index refresh actions. Local data shows ownership flow and nested location cards (owner, path, size/note, Open folder), native warning and Export conversations. Maintenance exposes database/WAL/free-page stats, refresh, Start clean, Optimize, Check and Compact, with reset/compaction confirmations. Project archiving has its own index-before-archive confirmation.

**Placement verdict:** shared file access was wrongly buried after database maintenance. **PR treatment:** a real React slot moves the single existing control panel ahead of maintenance, with an anchor; DOM, reading and keyboard order agree. Storage/index APIs, ownership, archive revisions, confirmations and data-retention behavior remain unchanged. No filesystem access policy is broadened or narrowed.

### application/git-defaults — Git defaults

**Source:** [`GitDefaults.tsx`](../src/GitDefaults.tsx). **Scope:** future projects only. **Width:** form.

**Anatomy:** heading/Close; New project working style panel with explanation, working-style radio cards, pending fieldset, unchanged-value save disablement, error, saved confirmation and Save default.

**Placement verdict:** correct. The distinction from an existing project's agreement was too easy to miss in navigation. **PR treatment:** explicit “New projects” page context, consistent form width, radio-panel geometry and spacing. Existing-project agreements are not rewritten.

### application/remote-access — Remote access

**Source:** [`RemoteAccess.tsx`](../src/RemoteAccess.tsx). **Scope:** this running server/computer. **Width:** form.

**Anatomy:** heading/Close and page feedback; Private network panel with enable checkbox, network address, port, new-device trust duration, Save connection, runtime state, URL/copy action and unencrypted-HTTP warning. Internet access panel contains Tailscale availability/install guidance, enable checkbox, HTTPS port, Save web access, connection state, errors and URL/copy. Pair a device contains transport choice, QR generation, one-time expiry/paired/expired states, Copy pairing link and Cancel pairing. Remembered devices lists device identity, expiry and Remove.

**Placement verdict:** correct, but “this computer” matters when viewing remotely. **PR treatment:** visible server scope, consistent form width, wrapping addresses and action rows. No transport/security setting is changed. Initial-load failure currently lacks its own Retry button; see remaining behavior work below.

## Project settings

### project/sessions — Session defaults

**Source:** [`SessionDefaults.tsx`](../src/SessionDefaults.tsx), [`ContextSettings.tsx`](../src/ContextSettings.tsx), `ModelSetup.tsx`. **Scope:** new chats in the selected project; independent context configuration. **Width:** form.

**Anatomy:** heading/Close; Start a new chat form with Agent, fixed-model summary or editable parent model, reasoning/intelligence selection, validation/error and Save defaults / confirmed status. Context window is a second independently saved panel with Automatic compaction, loading, Retry, Save context settings and project-scoped status. A Manage agents shortcut opens the shared catalog.

**Placement verdict:** correct, provided new-chat defaults and runtime context settings are not presented as one save operation. **PR treatment:** scope/save-boundary description, common panel hierarchy and form spacing. No change to model inheritance, stored defaults, current chat choices, or compaction behavior.

### project/delegation — Delegation

**Source:** [`DelegationSettings.tsx`](../src/DelegationSettings.tsx). **Scope:** project or current chat, explicitly chosen before editing. **Width:** form.

**Anatomy:** heading/Close; Delegation budget panel; Apply to selector (project/current chat); loading/error/retry; fieldset for delegation strategy, worker-model preference, simultaneous agents and maximum depth; Existing advanced limits disclosure for legacy model/provider allow/exclusion information and clear actions, context policy and timeout; save row, help and conflict/discard/reload feedback.

**Placement verdict:** correct. Scope selection is a prerequisite to interpreting the fields, not a hidden footer option. **PR treatment:** common field spacing, context text and responsive layout. Legacy controls remain available; this styling pass adds no routing ceremonies, visibility gates or model restrictions.

### project/goals — Goals

**Source:** [`Goals.tsx`](../src/Goals.tsx). **Scope:** selected project and each goal's linked chat. **Width:** collection.

**Anatomy:** heading/New goal/Close; introductory save-vs-start text; Show archived toggle; goal rows with identity/status/reason, free-model event, Open chat, Start/Resume/Stop, remaining-work stop, Edit, Archive/Restore and latest checkpoint/evidence disclosure. Goal editor dialog contains title, objective, execution lock/steering explanation, execution identity fields, delegation preferences/worker count, free-rotation and ordinary-tool-approval choices, shared-folder caveat, objective-revision history, error and Save/Cancel.

**Placement verdict:** deliberately correct in Project settings per the product's goal-management design. **PR treatment:** consistent page context and card/actions geometry, preserving existing dialog shell. Goal chat headers, runtime transitions, durable checkpoints and approval boundaries are not changed.

### project/files — Files

**Source:** [`WorkspacePanels.tsx`](../src/WorkspacePanels.tsx), `FileChanges.tsx`, `FilePreview.tsx`. **Type:** project browse/inspection. **Width:** collection.

**Anatomy:** heading with Back where relevant, Search project content and Close; root-only current-chat changes surface; current path; error/Retry; folder rows; file preview panel with text/diff or binary explanation; loading and empty-folder states.

**Placement verdict:** appropriate as a project utility, but it is not the place to edit shared file-access scope. **PR treatment:** explicit browse-vs-permissions description, common panels and contained code scrolling. No file editing, diff, path authorization or selected-chat behavior changes. The existing changes/diff subview retains its feature-owned presentation.

### project/search — Search project content

**Source:** [`IndexedSearch.tsx`](../src/IndexedSearch.tsx). **Type:** scoped utility. **Width:** collection.

**Anatomy:** the same search controls, independently loaded result groups, provenance, retry and empty states as application search, but the selected project is passed explicitly and named beside the query. Open file results return to that project's Files; conversation results open their corresponding chat. Index maintenance remains a separate destination.

**Placement verdict:** correct; preserving a separate scope avoids accidentally broadening a user's search. **PR treatment:** distinct registry entry/title/description and shared layout; endpoints and scope parameters are unchanged.

### project/github — GitHub

**Source:** [`GitHubProject.tsx`](../src/GitHubProject.tsx). **Scope:** selected repository; native GitHub sign-in also identifies the connected account. **Width:** collection.

**Anatomy:** heading with Refresh and Close; no-project/loading/retry states; explicit last-known-data warning; action errors/notices and install/login progress. Top cards: Local history (install/adopt/initialize, main version, identity summary/editor, Save identity and Stop tracking automation) and Cloud sync (CLI availability, account, sign-in/reconnect, destination/visibility, link/create-private actions, refresh linked metadata and uploads toggle). Working agreement contains preset choices, main version, sync permission, Save agreement and saved summary. Current work contains branch/changed count, eligible-file selection and per-file reasons, checkpoint description, Save checkpoint, Get updates, Sync, optional first upload and Ask in chat. History & recent actions contains execution receipts, review links/previews and local-checkpoint disclosure. Every consequential action uses the existing exact-preview/setup confirmation dialog.

**Placement verdict:** project ownership is right; local setup, agreement, work and receipts form a sensible progression. Cloud sync and Working agreement currently both edit the saved `github` permission: this is a real duplication, not two independent permissions. **PR treatment:** page scope, shared cards/headings, responsive grid/action geometry; managed Git previews, revision checks, identity validation, last-known-state behavior and execution receipts are unchanged. Consolidating that duplicated editor is listed as remaining work rather than removing an authority check in a styling PR.

### application/agents — Agents

**Source:** [`WorkspaceCatalog.tsx`](../src/WorkspaceCatalog.tsx), [`App.tsx`](../src/App.tsx). **Scope:** application-shared definitions. **Width:** collection; editor uses form width.

**Anatomy:** heading with Add agent/Close; search; agent cards with icon, default/custom badge, name, prompt excerpt, response style, approach, model identity, Use agent and Edit. Inline editor contains Name, Prompt, parent-model/reasoning choice, response style (concise/balanced/detailed), approach (practical/thorough/creative), Save, Cancel and custom-agent Delete. There are no per-agent tool/skill access switches.

**Placement:** Application settings. Agent catalog/editor headings and active navigation use application scope. Session defaults retains its Manage agents shortcut.

### application/file-access — File access

Choose allowed file locations for agents in a separate application page. Three choices preserve the existing shared setting, native permission checks, save confirmation and failure recovery. It is separate from content indexing, data locations, model selection and agent definitions.

## Remaining behavior and IA work

The shared presentation standard reaches all 19 destinations, but this is not a claim that every pre-existing behavioral issue has been resolved. The source audit found these follow-ups: duplicate GitHub uploads/sync editing; Recent projects living inside Available Usage; a Remote access initial-load Retry action; consistent dirty-navigation handling across independent editors; and further manual review of long history selection bars and manually composed heading levels. These require targeted behavior changes and feature regression journeys, not cosmetic hiding.

## Verification and evidence boundaries

New code includes `tests/settings-ux.test.mjs` (route preservation, scope descriptions, state semantics and semantic tokens) and `tests/settings-ux.browser.mjs` (all 19 destinations, representative light/dark/generated themes, narrow/desktop widths, current-page metadata and overflow).

During preparation, the focused Node contracts and changed-file syntax/CSS checks were run locally. The full repository could be read and written through the GitHub connector, but could not be cloned into the local test container because network/DNS access was unavailable. Consequently the full app build, existing feature browser suites and new end-to-end sweep must be run in CI or a normal checkout before merge. Isolated layout inspection is not a substitute for those tests. No external provider authentication, Git publication from the application, or tool execution was tested by this UX audit.

Recommended verification: `npm run build`; `node --test tests/settings-ux.test.mjs`; `node scripts/test-browser.mjs settings-ux.browser capabilities.browser`; then the existing provider/color, navigation, storage, Git, goals and scheduling journeys and `npm run test:contracts`. Retain screenshots and failure artifacts. Do not relabel an unexecuted check as passed.
