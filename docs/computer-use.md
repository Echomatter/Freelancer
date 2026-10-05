# Computer use

Freelancer's `computer` OpenCode tool is the shared interface for browser and
desktop interaction. It selects only from local native MCP services whose
currently advertised tools establish support for the requested operation.
Named agents and workers use the same capability. Native OpenCode permissions
remain authoritative; the tool asks for native `computer` permission and the
selected provider operation's native permission before observation or action.

## Setup

Use **Application settings → Capabilities → Connected services → Add
connection**. Choose the **Cua Driver** template for the local command
`["cua-driver", "mcp"]`; the same generic native OpenCode connection editor
handles setup and explicit command consent. The interactive Windows desktop is
required. If CUA requests approval when the provider is used, pause and ask the
user to accept the prompt.

Browser Harness and Playwright remain available in the same generic editor.
Give the local service a recognizable name (`browser-harness`, `playwright`, or
`cua-driver`) so Freelancer can identify its adapter. The computer adapter
starts a local MCP process for its own session; the ordinary native MCP
connection remains independently managed by OpenCode.

Browser Harness (requires `uvx`, Python 3.11+, and a Chrome DevTools endpoint):

```json
{
  "type": "local",
  "command": ["uvx", "--from", "browser-harness[mcp]", "browser-harness-mcp"],
  "enabled": true
}
```

The existing Playwright template is also recognized. On Windows, its `npx`
command is resolved through the installed Node.js npm CLI when available.

Cua Driver (requires the separately installed local driver and a logged-in
interactive Windows session):

```json
{
  "type": "local",
  "command": ["cua-driver", "mcp"],
  "enabled": true
}
```

Computer-use connections must be local stdio MCP servers. Remote providers and
other native services are not selected by this adapter. OpenCode's own service
connection state and the `computer` adapter's ability to start and inspect its
separate process are distinct observations.

## Operations and evidence

Call `computer({operation:"status"})` to inspect configured adapters. Start a
conversation-scoped computer session with `observe`, then pass the returned
`sessionID` to `execute`, `capture`, `wait`, and `end_session`. For desktop work,
use the observed process and window identity when the provider requires it.
Targets cannot be switched mid-session without a fresh observation. Stale or
expired session IDs fail; they are not rebound to another target.

`execute` accepts a normalized action plus optional JSON fields such as
`selector`, `text`, `key`, `elementToken`, or `filePath`. Browser `javascript`
runs in the current page only. Screenshots are stored under ignored
`backend/.state/computer-use/captures/` and returned as native tool attachments.
Each response distinguishes a completed action from an observed or verified
postcondition. Observe again after state-changing actions; a returned action
receipt alone does not establish task success.

Provider support is inferred from the connected process's current advertised
tool names and schemas. Unknown support remains unknown. Browser Harness,
Playwright, and Cua Driver methods are adapted internally; the provider tool
schemas are not copied into a second model-facing surface. OpenCode's MCP tool
inventory still does not enumerate provider resources or all connected-service
tool definitions.

## Component inventory

| Component | Version / license | Use in Freelancer | Redistribution |
| --- | --- | --- | --- |
| `@modelcontextprotocol/sdk` | 1.32.1, MIT | Direct dependency; stdio MCP client transport and protocol calls | Package dependency; no source vendored |
| Browser Harness | User-configured runtime; upstream 0.1.13, MIT at review | Separate local MCP process; no source adapted | Not bundled or redistributed |
| Playwright MCP | User-configured runtime; version follows native service config | Existing local MCP process | Not bundled or redistributed |
| Cua Driver | User-configured runtime; upstream repository MIT | Separate local MCP process | Not bundled or redistributed |
| Cua optional perception extension | AGPL-3.0-only | Not used or installed by Freelancer | Excluded |
| BrowserCode | MIT upstream | Coding-primitive architecture reference only; no fork code used | Not bundled or redistributed |
| UFO² | MIT upstream | Windows UIA/hybrid-action reference only; no UFO orchestration used | Not bundled or redistributed |

The provider license/version rows describe upstream projects, not a validated
license audit of every transitive dependency in a user's separately installed
provider environment. The Freelancer dependency lockfile records the MCP SDK
dependency actually shipped with this application.

## Phase 0 proof record (2026-10-05)

| Evidence category | Browser Harness | Cua Driver |
| --- | --- | --- |
| Setup | `uvx` MCP process, disposable Chrome profile, local test page | Existing user installation, Cua Driver 0.33.4; no installer was run |
| Connection | Connected; 23 tools advertised over stdio | Installed Cua Driver 0.33.4; stdio MCP connected; health report passed; UI Automation and Windows Graphics Capture were reachable |
| Native calls / actions | Page info, local navigation, page JavaScript, click, state re-observation, screenshot | `health_report`, `list_apps`, `list_windows`; Calculator launched by Cua, then targeted for UIA observation and screenshot |
| Observed result | Local page reached its expected visible state; screenshot returned as a tool attachment | Calculator window identified, UIA state contained Calculator, screenshot attachment returned; launch did not activate the window |
| Context evidence | Smoke returned 2,174 JSON evidence characters; no model inference was run, so token overhead is unknown | Bounded UIA plus screenshot smoke returned 9,466 JSON evidence characters. The earlier unbounded/duplicate-tree shape was 28,808 characters; no model inference was run, so token overhead is unknown |
| Limits / outcome | Disposable-profile browser proof passed; no authenticated profile, download/upload, remote site, or model-driven task was tested | Direct provider/adapter and Calculator task passed. Native OpenCode permission UI/model tool use and broader action coverage are not established by this smoke |

Both exercises used the Freelancer adapter and local native MCP stdio protocol,
not another agent framework. The combined smoke additionally used one
conversation-scoped Freelancer session across Browser Harness and CUA, revisited
the browser after Calculator observation, and returned 13,252 JSON evidence
characters. They prove those specific provider operations and visible
postconditions only; they do not prove model use or general task success. CUA
used the installed user's runtime and its app inventory was not retained in
logs. Native OpenCode permission UI remains untested.

## Gap analysis and revised roadmap

| Proposal | Current Freelancer implementation | Remaining gap / next work |
| --- | --- | --- |
| One model-facing Freelancer API | `computer` presents status, observe, execute, capture, wait, and end-session operations | The response proposal also showed `surface:auto` and `target`; these are deferred because an implicit surface/target can bind the wrong live UI. Add only after target selection can remain explicit and stale-safe. Add bounded action batches only for a measured workflow. |
| Provider contract and health | Internal stdio MCP manager discovers tools and schemas, tracks connection health, and derives tri-state capabilities | Status now reports provider name/kind, health, and unknown capability states. Add health recheck/refresh policy and provider lifecycle cleanup evidence. |
| Capability-evidence routing | Provider selection checks observed operations, then scores DOM, structured controls, screenshots, and file transfer | Routing is deterministic and operation-scoped. No transparent action retry is allowed after uncertain delivery. Add fallback only for an explicit unsupported/refusal response before effect, with the attempted route recorded. |
| Browser and desktop in one logical workflow | A conversation session now holds independent browser and desktop target bindings | Contract covers cross-surface session continuity; verify a real browser-to-Calculator task in the next live journey |
| Structured Windows before visual actions | CUA 0.33.4 structured output is preserved; summary defaults bound UIA and omit screenshots, while `capture` returns visual evidence | Add stale-element-token/ref behavior coverage and test a real UIA action followed by visual verification |
| Browser session identity | CUA browser target/tab IDs and public session labels map separately from native window identity | Adapter mappings are covered by contracts; live CUA browser preparation is still open; do not attach to the user's existing Chrome profile without deliberate setup |
| Normalized evidence | Responses carry distinct `evidence.action`, `evidence.state`, and `evidence.outcome`; native tool metadata preserves it alongside provider effect/route. The existing Commands tool card renders those fields for root and worker conversations. | Outcome remains `not_verified` until a separately observed postcondition exists. Broader outcome verification should remain a separate evidence step, never inferred from action completion. |
| Bounded recovery | Calls have timeouts, stale-handle errors, and output limits | Add narrowly scoped retry/fallback only for explicit transient/refusal categories; never replay an action with uncertain delivery |
| Optional UFO² techniques | UFO² remains a reference only | Compare only against measured CUA gaps; no additional hierarchy or runtime until an actual gap is recorded |
| Later isolated/cloud providers | Not implemented | Defer until local browser and Windows acceptance, licensing, and isolation requirements are demonstrated |

### Next gates

1. **Passed 2026-10-05:** one live Freelancer session crossed disposable Chrome
   and Calculator, used exact target observation, captured both surfaces, and
   reverified browser state after desktop work. Native OpenCode permission is
   still explicitly outside this adapter smoke.
2. **Current gate:** run a native-host OpenCode permission journey and confirm Freelancer's native
   permission decisions remain in force alongside CUA's own policy. The SDK's
   experimental tool endpoint lists tools but does not directly invoke them, so
   testing the actual native `context.ask` flow requires a real tool call. If an
   authorization prompt appears, stop and ask the user to accept it; no prompt
   is synthesized or auto-approved by the adapter smoke.
3. Complete CUA 0.33.4 wire coverage for `session`, UIA, screenshot, browser
   target/tab/ref shapes, unsupported actions, and stale refs. Stale target
   rejection and bounded UIA output already have contract and live coverage.
4. Connect normalized computer evidence to existing request/worker reporting.
   Do not infer verified success from a provider receipt; preserve separate
   action, observation, and outcome states.
5. Evaluate downloads/uploads, localhost journeys, foreground refusal and
   visual fallback. Only consider UFO-derived techniques when a measured CUA
   gap identifies the needed low-level operation. Defer isolated/cloud drivers
   until local acceptance and licensing requirements are demonstrated.

## Verification boundaries

Contract and fixture checks cover adapter mapping, session ownership, stale
targets, normalized evidence, and stdio protocol behavior. They do not establish
provider authentication, a real Chrome session, Windows UIA coverage, model
inference, or successful completion of a user's task. Evaluate these separately
with the desired installed provider, browser profile, Windows application, and
model before relying on them.
