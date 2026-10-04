# Playwright MCP mechanics

Guidance is adapted from Microsoft's [Playwright MCP documentation](https://github.com/microsoft/playwright-mcp),
checked through Context7 on 2026-10-04. The [official CLI skill](https://github.com/microsoft/playwright-cli/tree/b85c7a736bb473bf55b584e54a09ffa698d6d871/skills/playwright-cli)
uses a separate CLI and sessions. Use the configured native MCP here.

Inspect live definitions: native prefixes and parameters vary by version.
Current Microsoft schemas use `target` for snapshot references or selectors;
older servers may use `ref`. Derive unique selectors from observed page state.

| Need | Discovered operation |
| --- | --- |
| Identify/select a tab | `browser_tabs` |
| Navigate | `browser_navigate` |
| Inspect accessible state and references | `browser_snapshot` |
| Interact | `browser_click`, `browser_type`, `browser_fill_form`, `browser_select_option` |
| Wait for an expected visible state | `browser_wait_for` |
| Inspect visual layout | `browser_take_screenshot` with observed `target`, `fullPage`, `filename` and image options |

Refresh snapshots after meaningful changes. Prefer concrete expected-state waits
over repeated fixed delays. Element and full-page screenshots are different requests.
Use other discovered operations for console/network diagnostics, dialogs, uploads,
downloads, viewport/media changes and page inspection. Optional vision, PDF,
storage and tracing depend on what the connected server actually exposes.

If tools are absent, inspect Application settings → Capabilities for connection
health. Loading a skill neither installs a service nor enables features. Keep
setup within the user-authorized native connection flow.

On Windows, pass URLs and paths as tool arguments rather than shell strings.
Preserve user profiles and unrelated browser sessions. Repository browser journeys
must use that project's documented commands; Freelancer's runner is not universal.
Simulated services do not prove live authentication, and an accepted request does
not prove its resulting visible state.
