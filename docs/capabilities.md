# Shared tools, skills and MCP

Open **Application settings → Capabilities**. Every named/custom agent, model and
project uses the same platform toolkit. There is no Freelancer capability
allowlist, service assignment matrix, required discovery ceremony or separate
MCP client. Actual native model support is not a platform entitlement.

Delegation uses its existing budget, concurrency, ownership and consent rules.
Git/GitHub uses its saved project agreement and existing permission-backed
exception flow. Explicit user/native restrictions still apply. Merely changing
a persona or opening another project never removes a platform connection.

## Connected services

The connection list is available even with no project open. Choose **Add
connection**, enter a unique name and either a remote HTTP(S) MCP URL or a local
executable/arguments JSON array, then approve the connection or command. Local
commands run on the computer hosting Freelancer, not on a paired phone.

Optional environment/header fields accept native string values and
`{env:VARIABLE_NAME}` references. Prefer references for secrets. OpenCode owns
persistence, OAuth credentials and resolution. Freelancer does not copy these
values into its settings, agent prompts or diagnostic responses.

**Authenticate** uses OpenCode's native OAuth browser flow on the host computer.
**Sign out** uses native logout. **Test / retry** attempts native connection;
**Disable/Enable** changes shared configuration. These actions do not themselves
prove that a model successfully used a service's tools. Setup does not install
an MCP package or silently connect a suggested service.

Configuration is written through the pinned native `PATCH /global/config`,
read back, and applied through native instance refresh. It lives in this
Freelancer installation's app-local OpenCode configuration and is inherited by
all projects. Existing explicit native project overrides are not erased.
There is no per-project copy or second credential database. Stale edits return a
conflict rather than replacing a newer connection. Running work and pending
native decisions prevent a disruptive global reload, not ordinary tool use.

Connection controls use the same authenticated application boundary as provider
setup, including trusted paired devices. Native commands and the OAuth browser
run on the host computer. A failed or unsupported
native endpoint remains **unavailable**, not an empty successful result. A saved
configuration whose refresh cannot be confirmed is labeled **unverified** with
a restart notice. The native API in OpenCode 1.18.31 has no config-key deletion
operation: **Disable is not Remove**. This UI does not fake deletion by dropping
a key from a merge patch or invent a competing config writer.

## Tool and skill observations

The inventory reads native registration, current-context model exposure,
permissions, skills, MCP state, references and commands. It does not change them.
The page lists the shared tools and skills without filters or agent/model selectors. Short statuses such as Loaded, Unavailable, Unknown and Needs permission describe the current inspection. Loaded means the tool is present, not that it has successfully run. Details and native permission explanations are in the Tools help bubble.

The current chat supplies the observed agent/model context; the page does not
hard-code Engineer or offer identity-based access selectors. Without a chat,
model exposure remains unobserved. Tools and skills stay in the shared catalog.
Missing skill dependencies remain explicitly unverified or missing.

Open **Tools help → Technical details** to see the captured request identity
and source composition. This is a provenance map, not a full effective provider
prompt or another editable instruction store. Native-internal layers remain
labeled as such. No provider prompt, secret or raw MCP server instructions are
copied into the page.

## LSP removal

Freelancer no longer supplies LSP setup, opt-in flags, dependency diagnostics,
installation guidance or a dedicated settings panel. Old app opt-in values are
ignored. This does not write a new native denial or erase an independently
configured OpenCode capability. An externally registered tool is still part of
the platform's ordinary native inventory, not an app-owned LSP feature.

## Browser verification and evidence

The shared `browser-verify` skill uses an appropriate already-connected browser
MCP, such as Playwright, for model-driven interaction. It has no vendor, persona,
model or project entitlement gate. It discovers the current project's own test
runner; Freelancer's `npm run test:browser` is only a project-specific example.
Fixture journeys, native MCP transport checks and actual model-driven browser
observations are distinct evidence. Missing connections are reported, not
silently installed or claimed successful.

`npm run smoke:mcp` checks the pinned native runtime using disposable config/data
and a harmless local stdio server. It checks persistence, inheritance by two
projects and connection lifecycle; it uses no user account and no model
inference. The ordinary browser journeys simulate native services. A real
model-driven browser acceptance run remains a separate, explicitly authorized
check; neither suite stands in for it.

See [testing](testing.md), [named agents](named-agents.md) and
[file access](file-access.md) for existing execution/data boundaries.
