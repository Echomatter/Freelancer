# Shared tools, skills and MCP

Open **Application settings → Capabilities**. Every named/custom agent, model and
project uses the same platform toolkit. There is no Freelancer capability
allowlist, service assignment matrix, required discovery ceremony or separate
MCP client. Actual native model support is not a platform entitlement.

Delegation uses its existing budget, concurrency, ownership and consent rules.
Git/GitHub uses its saved project agreement and existing permission-backed
exception flow. Explicit user/native restrictions still apply. Merely changing
a persona or opening another project never removes a platform connection.

## Connected Services (MCP)

The connection list is available even with no project open. Choose **Add
connection**, enter a unique name and either a remote HTTP(S) MCP URL or a local
executable/arguments JSON array, then approve the connection or command. Local
commands run on the computer hosting Freelancer, not on a paired phone.

Five generic templates are available: Playwright, Fetch and Sequential
Thinking run locally; Context7 connects to its hosted MCP, and JEV uses the
hosted TypeSafe API through a local MCP adapter. Context7 has free use and an
optional API key for higher limits; JEV requires a personal key and is usage
priced. TypeSafe does not publish an MCP server; the template uses the pinned
community `jev-mcp@0.5.1` adapter in native OpenCode. The
same editor also supports custom local or remote MCP services. Optional
environment/header fields accept native string values and
`{env:VARIABLE_NAME}` references. Prefer references for secrets. OpenCode owns
persistence, OAuth credentials and resolution. Freelancer does not copy these
values into its settings, agent prompts or diagnostic responses.

Freelancer's built-in memory and Pinned Memory use the shared application
database and native `knowledge` tool. No Memory MCP setup is required. An existing
external Memory connection remains visible as a custom OpenCode service; its
independent graph is not synchronized with Freelancer memory or pins.

**Authenticate** uses OpenCode's native OAuth browser flow on the host computer.
**Sign out** uses native logout. **Test / retry** attempts native connection;
**Disable/Enable** changes shared configuration. These actions do not themselves
prove that a model successfully used a service's tools. Saving an explicitly
approved local template lets OpenCode resolve and start its command; Freelancer
does not run a second MCP client.

Configuration is written through the pinned native `PATCH /global/config`,
read back, and applied through native instance refresh. It lives in the
user's native OpenCode configuration and is inherited by all projects. Existing
explicit native project overrides are not erased.
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
Tools and Skills remain available as collapsible lists even before opening a
project. Their saved collapse preferences affect presentation only. The page
lists the shared tools and skills without filters or agent/model selectors.
Short statuses such as Loaded, Unavailable, Unknown and Needs permission
describe the current inspection. Loaded means the tool is present, not that it
has successfully run. Details and native permission explanations are in the
Tools help bubble.

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

## Shared MCP skills

The shared `playwright`, `web-research`, `remember`, `reason-through`,
`docs-research`, and `bounded-judgment` skills guide capability use. `remember`
uses Freelancer's internal memory; the other hints can describe connected MCP
services. `browser-verify` covers UI verification and evidence boundaries.
OpenCode supplies connected tools to eligible models. Skills are optional
guidance: they never grant access, gate direct tool calls, or restrict a
capability by agent, model, project or workflow. Memory MCP does not mirror or
replace Freelancer persistence.

The captured execution contract supplies shared capability-use hints, with short
contextual advice in existing skills. Hints help select methods and suitable
evidence; they are optional, not required tool calls, routing rules or workflow
stages. Playwright observations, source/tests, documented expectations, retrieved
web content, historical Memory and JEV advice establish different things. Models
can combine them when useful and use other valid methods when a service fails.
Structured Freelancer model outcomes retain authority over performance evidence;
Memory may supplement qualitative history and JEV may advise an ambiguous
comparison within existing eligibility and consent boundaries.

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
