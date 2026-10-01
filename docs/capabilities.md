# Capabilities

[Overview](../README.md) · [Architecture](ARCHITECTURE.md) · [Named agents](named-agents.md)

**Capabilities** is a platform-wide, simple read-only list of native tools, skills and MCP status. It does not invoke a model or change settings. OpenCode still owns tools, permissions and execution; this view only reports inventory/status.

Open **Application settings → Capabilities** to inspect the available list. The page is read-only apart from the advanced native LSP tool opt-in, which requires a Freelancer restart to take effect. There are no project, agent or model selectors.

## What the inspection reads

The server probes native endpoints over the loopback host and combines them with the saved settings and the Freelancer catalog:

- **Registration** — `/experimental/tool/ids` lists the tools the native runtime registered.
- **Model exposure** — `/experimental/tool?provider=…&model=…` lists the tools a specific model is actually exposed to. Skipped when no model is selected.
- **Agent profile** — `/agent` returns the current native named-agent permission profile and per-tool enable/disable flags. Captured Freelancer request context is resolved separately when a session is selected.
- **Effective config** — `/config` is inspected for permissions, tool flags, MCP, LSP, and references when returned by the installed native version. Missing fields do not prove that the runtime supports the corresponding capability.
- **Skills, MCP, LSP, commands** — `/skill`, `/mcp`, `/lsp`, `/command` return discovered skills, MCP connections, language servers, and optional commands.

Each probe reports a state of `observed`, `unavailable`, or `not-run`. An unavailable probe is shown per row; it never fails the whole view.

## Column and state semantics

Every tool row carries the same fields. The values are observations, not guarantees.

- **Discovered** — `Yes` when the tool id is present in native registration, `No` when it is absent, `Unknown` when the registration probe did not run. Registration means the runtime loaded the tool; it does not mean a call has succeeded.
- **Model exposure** — `Yes` when the selected model is exposed to the tool and it is not disabled, `No` when it is not exposed or is disabled, `Unknown` when no model is selected or the exposure probe did not run. This is the only field that depends on a model choice.
- **Native permission** — the effective action for the tool: `allow`, `ask`, or `deny`. The agent profile is checked first; when it does not decide, the effective config is consulted. The value is `unknown` when neither source yields a decision and `conditional` when the permission is an object rather than a simple action. A permission is a gate, not a capability: `allow` does not prove the tool works.
- **Application access** — how the application treats the tool regardless of native permission: `shared` (available to all agents), `operation-dependent` (delegate, git_project, lsp, content_index, bash — subject to their own runtime checks), or `blocked` (native `task`, and source-write tools when the captured assignment or saved agreement is inspection-only).
- **Dependency** — always `unverified`. Registration and permission are not proof of successful use; a tool that passes every check here still needs execution evidence.
- **Unavailable reason** — a short explanation when a tool is not usable (not registered, not exposed, denied, disabled, or a dependency such as MCP auth is missing), otherwise a note that successful use was not verified.

**Origin** records where a tool comes from: `OpenCode native` (built-in), `Freelancer plugin` (this application's delegation, git, goals, and index tools), or `OpenCode custom/plugin/MCP` (everything else the runtime registered).

## Skills, MCP, LSP, and references

- **Skills** list native-discovered skills with their file origin, plus catalog skills that native discovery did not return. A catalog skill missing its `SKILL.md` is reported as `missing`; one not returned by native discovery is reported as not discovered. Native discovery alone does not validate a skill's dependencies; dependency health remains `unverified` until a separate check establishes it.
- **MCP connections** show configured and observed servers with status (`connected`, `disabled`, `failed`, `needs_auth`, `needs_client_registration`, or `unverified`). Tool association is by native tool-name prefix and is explicitly unverified.
- **Language servers** show whether a connected server was observed; none is not an error, just an observation.
- **References and optional commands** are advertised native items; their dependency is `unverified`.

## Unknown and unverified are honest states

`unknown` means the inspection could not determine a value (no model selected, probe unavailable, no permission decision). `unverified` means the value is a configuration or registration fact, not a successful-use fact. Neither is a failure and neither is a pass. A green row still requires execution evidence before you claim a tool works.

## Scope boundaries

Capabilities is a diagnostic, not a control. It does not create a second editable prompt, change agent definitions, enable or install tools or MCP servers, or act as an integration gateway to external services. It reads native state and the saved catalog, then stops. Use the testing journeys and runtime smoke checks for evidence that a path actually works; see [testing](testing.md) and [available usage](available-usage.md).

The shared file-target boundary is user-configurable in Application settings;
see [File access scope](file-access.md). Native permission remains authoritative.

## Advanced native tool opt-in

The **Capabilities** page also provides the advanced shared **Enable native LSP tool** opt-in. For the pinned **OpenCode 1.18.31**, saving it sets the native
`OPENCODE_EXPERIMENTAL_LSP_TOOL=true` startup flag for all agents on the next
Freelancer restart. If no saved choice exists, the process's native environment
flags apply; an explicit saved true/false is passed as the per-tool flag and takes
precedence over the broad `OPENCODE_EXPERIMENTAL` switch.
Language-server configuration and executable/project dependencies are separate:
registering the tool does not install a server. Native `lsp:true` or server-object
configuration plus `/lsp` status and required executables/dependencies determine
whether a usable server actually connects.

Websearch is eligible for the `opencode` and `opencode-go` providers. Other providers
require native `OPENCODE_ENABLE_EXA=true` or `OPENCODE_ENABLE_PARALLEL=true` opt-in.
An explicit native permission denial still applies. Permission `allow` alone does
not register either tool. Use the specific flag rather than enabling every native
experiment; experimental code mode remains deferred.

These switches were checked against the pinned native
[tool registry](https://github.com/anomalyco/opencode/blob/v1.18.31/packages/opencode/src/tool/registry.ts)
and [runtime flags](https://github.com/anomalyco/opencode/blob/v1.18.31/packages/opencode/src/effect/runtime-flags.ts).
Changing startup configuration requires a runtime restart. Freelancer diagnostics
do not install, enable or authenticate an external service.
