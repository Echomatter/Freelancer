# Freelancer Runtime Fusion Plan

## Purpose

This branch is the integration workspace for evolving Freelancer from a user interface and orchestration layer that sits above OpenCode into a single product whose runtime is substantially derived from OpenCode but owned, shaped, and surfaced by Freelancer.

The goal is not to "replace OpenCode" for its own sake. The goal is to remove unnecessary translation layers, duplicate state, duplicated concepts, and vendor-shaped boundaries so that the user interacts with one coherent system: Freelancer.

OpenCode should progressively become runtime implementation material inside Freelancer rather than a separately conceptualized application. The same principle should later be applied to computer-use projects such as Browser Harness, Cua Driver, UFO, Browser Use, Open Interpreter, Playwright, and related tools: preserve valuable engines, protocols, drivers, algorithms, evaluation techniques, and implementation ideas, while removing competing orchestration layers and vendor-specific model-facing surfaces.

The intended end state is:

```text
Freelancer
├── Freelancer UI
├── Freelancer Runtime
│   ├── model/provider execution
│   ├── sessions and conversations
│   ├── context assembly and compaction
│   ├── tools and capability runtime
│   ├── permissions and authority
│   ├── parent/worker execution
│   ├── streaming/event lifecycle
│   └── MCP and external extension support
├── Freelancer Capability Runtime
│   ├── filesystem
│   ├── shell
│   ├── git
│   ├── search
│   ├── memory
│   ├── browser
│   ├── desktop/computer use
│   └── external MCP capabilities
└── Freelancer Data Platform
    └── coherent persistence with explicit domain ownership
```

The user should no longer need to think in terms of "Freelancer plus OpenCode plus Cua plus Browser Harness plus Playwright." Those are implementation sources. Freelancer is the product.

---

## Governing principles

### 1. Freelancer is the product boundary

Anything the user sees, configures, understands, monitors, approves, or resumes should be expressed in Freelancer concepts and Freelancer UX.

OpenCode's TUI and presentation concepts are not product requirements merely because they exist upstream. They are reference material. Useful capabilities should be re-expressed in Freelancer rather than copied as screens.

### 2. Absorb behavior before collapsing process boundaries

Do not begin by forcing OpenCode into the same process. First bring the runtime source under Freelancer's control, pin it, build it reproducibly, and define clean internal contracts around it.

The process boundary can remain temporarily if it still reduces risk. A process boundary is acceptable. A conceptual boundary that forces duplicate representations and translation logic is what should disappear.

### 3. Reduce translation code continuously

Every place where Freelancer and OpenCode both represent the same concept is a candidate for simplification.

Examples include:
- session identity;
- model identity;
- provider configuration;
- tool identity;
- permission state;
- child-session identity;
- worker state;
- todos;
- context/compaction state;
- message lifecycle;
- cancellation;
- retry state;
- streaming events;
- model capability metadata.

For every duplicate representation ask:
1. Which system should own the truth in the final product?
2. Can one representation be removed?
3. Can the remaining representation be surfaced directly to the UI?
4. Can an adapter become thinner or disappear entirely?

### 4. Keep guidance, capability, authority, scheduling, and routing separate

The architecture already benefits from this separation and the fusion work must preserve it.

**Guidance** tells models how to work.

**Capability** determines what tools and execution mechanisms exist.

**Authority** determines what actions are allowed.

**Scheduling** determines how work is sequenced, bounded, retried, and cancelled.

**Routing** determines which model/provider/capability implementation should serve a request.

Do not let imported runtime code collapse these concepts back into one opaque control layer.

### 5. Do not inherit unnecessary upstream UI architecture

OpenCode's UI exists to serve OpenCode as a standalone product.

Freelancer should inventory it, not adopt it wholesale.

Useful behavior should be mapped into Freelancer's existing interaction model:
- project navigation;
- chats;
- goals;
- agents;
- workers;
- request groups;
- Details;
- Files;
- permissions/questions;
- available usage;
- capability inventory;
- settings.

### 6. Native Freelancer does not mean rewrite everything

A capability is "native Freelancer" when Freelancer owns:
- the stable contract;
- lifecycle;
- evidence model;
- authority path;
- error semantics;
- health state;
- UX;
- provider selection.

It does not require rewriting low-level protocols or libraries that are already good.

CDP can remain CDP.
Windows UI Automation can remain UI Automation.
MCP remains MCP.
Useful MIT/Apache components can remain dependencies or vendored code.

The goal is architectural ownership, not ideological code purity.

---

# Phase A — Establish the upstream runtime source

## A1. Vendor OpenCode under an explicit runtime boundary

Import the pinned upstream OpenCode revision into:

```text
vendor/opencode/
```

This branch carries a reproducible import script and an upstream manifest.

The initial import should preserve upstream code with minimal modification. Do not immediately rename packages, rewrite directories, or intermingle Freelancer code throughout the imported tree.

The first objective is to answer:

> Can Freelancer build and exercise a pinned OpenCode runtime from source under its own repository and release process?

That must be proven before deeper fusion.

## A2. Preserve upstream provenance

Record:
- upstream repository;
- imported commit;
- upstream default branch;
- license;
- import date;
- local patches;
- sync procedure.

Keep local runtime adaptations either:
- in clearly separated integration code outside the upstream tree; or
- in a small, auditable patch layer.

Do not scatter Freelancer-specific edits throughout upstream before the runtime surface has been mapped.

## A3. Maintain a future sync path

OpenCode will continue to evolve.

The fusion architecture must assume that Freelancer periodically compares against upstream and selectively absorbs useful changes.

The desired relationship is not "copy once and forget." It is closer to an internal downstream runtime distribution with a known upstream lineage.

---

## A4. Staging gates before source modification

Do not modify imported OpenCode source immediately after the subtree lands. The staging branch must first satisfy these gates:

1. **Version compatibility gate:** resolve the current Freelancer `@opencode-ai/plugin` version against the pinned OpenCode package version. At branch creation these were 1.18.31 and 1.18.34 respectively; treat that skew as an explicit compatibility decision, not an assumption.
2. **Build-island gate:** prove the vendored Bun workspace can install, typecheck, and run its own relevant tests without changing Freelancer's Node/npm toolchain.
3. **Package-map gate:** complete the runtime/presentation package classification in `docs/OPENCODE_RUNTIME_PACKAGE_MAP.md`.
4. **Parity-harness gate:** define bounded old-runtime versus candidate-runtime scenarios in `docs/OPENCODE_RUNTIME_PARITY_HARNESS.md`.
5. **Authority gate:** identify every current Freelancer permission, paid-model, project-scope, Git agreement, and child-session authority dependency before replacing the corresponding runtime boundary.
6. **Persistence gate:** inventory current OpenCode and Freelancer stores before any schema merge. Physical database consolidation is frozen until ownership and migration evidence justify it.

The source layout during staging is intentionally explicit:

```text
vendor/opencode/                 # recognizable upstream source; minimal local edits
runtime/                         # future Freelancer-owned runtime code and adapters
tests/runtime-parity/            # old-vs-new conformance scenarios when implementation begins
docs/                            # maps, decisions, migration evidence
```

This makes upstream provenance visually different from Freelancer-owned runtime code.

---

# Phase B — Separate OpenCode runtime from OpenCode presentation

Perform a source-level inventory of OpenCode and classify major areas into:

1. runtime kernel;
2. provider/model integration;
3. sessions/conversations;
4. context/compaction;
5. tools;
6. permissions;
7. MCP/extensions;
8. child sessions;
9. event/streaming system;
10. persistence;
11. CLI/TUI/presentation;
12. standalone-product glue.

The purpose is not just documentation. This classification should drive the extraction boundary.

## Runtime candidates to retain deeply

Prioritize anything that makes model execution actually work:
- provider adapters;
- authentication integration;
- model invocation;
- streaming;
- cancellation;
- retries;
- message state;
- tool calling;
- MCP;
- permissions;
- session lifecycle;
- context construction;
- compaction;
- child sessions;
- usage telemetry where useful;
- runtime events;
- native error handling.

## Presentation candidates to discard or use only as reference

Do not automatically carry forward:
- TUI layouts;
- navigation;
- standalone settings presentation;
- visual information architecture;
- command UX that duplicates Freelancer;
- OpenCode-specific app identity.

If a presentation feature reveals a runtime capability Freelancer lacks, capture that in the UI-gap inventory and redesign it in Freelancer.

---

# Phase C — Run two gap analyses

## C1. Runtime gap analysis

Compare OpenCode runtime capabilities to what Freelancer currently exposes or consumes.

For every OpenCode runtime feature classify it as:

- fully exposed;
- partially exposed;
- duplicated in Freelancer;
- translated awkwardly;
- unused but valuable;
- intentionally unsupported;
- obsolete for Freelancer;
- unknown and requiring investigation.

Questions to answer include:

- Are there provider features Freelancer cannot currently reach?
- Are model capabilities lost in translation?
- Is compaction surfaced completely?
- Are permission states faithfully represented?
- Are child sessions being wrapped unnecessarily?
- Are todos duplicated?
- Are runtime errors being converted into weaker generic errors?
- Are streaming events losing identity or provenance?
- Are retries/cancellations represented twice?
- Are tool schemas rewritten unnecessarily?
- Does Freelancer maintain state that could come directly from runtime truth?
- Does OpenCode already solve a problem Freelancer currently solves separately?

The output should be a concrete deletion/adoption map, not just a feature list.

## C2. UI gap analysis

Inventory useful controls and observability available through OpenCode but missing from Freelancer.

Do not copy screens.

For each valuable capability decide where it belongs in Freelancer:
- Application settings;
- Project settings;
- chat;
- Details;
- worker view;
- goal view;
- capability inventory;
- provider/model UI;
- diagnostics.

A capability is only complete when the user can understand and control it through Freelancer.

---

# Phase D — Define Freelancer Runtime

Create a deliberate internal runtime boundary.

Conceptually:

```text
Freelancer UI
    ↓
Freelancer application services
    ↓
Freelancer Runtime
    ↓
providers / tools / capabilities / persistence
```

Initially, much of Freelancer Runtime will be OpenCode-derived code.

Over time, the distinction "this came from OpenCode" should matter mainly for maintenance and provenance, not for product behavior.

The runtime should own or expose canonical services for:
- model execution;
- sessions;
- context;
- tools;
- permissions;
- workers/child execution;
- streaming events;
- cancellation;
- retries;
- compaction;
- MCP;
- provider access.

Freelancer's higher-level concepts—Goals, named Agents, project UX, evidence presentation, managed Git agreements, usage UX, memories, and workspace organization—remain Freelancer-owned product concepts.

---

# Phase E — Collapse duplicate models one domain at a time

Do not rewrite everything simultaneously.

Choose one duplicated domain, make one canonical model, migrate consumers, remove the old representation, and test.

A likely order:

1. runtime identity and health;
2. model/provider inventory;
3. session identity;
4. tool inventory;
5. event streaming;
6. permissions/questions;
7. child-session/worker mapping;
8. todos;
9. context/compaction;
10. retries/cancellation;
11. usage observations.

The purpose is to make the integration thinner after every step.

A successful fusion should cause adapter code to shrink.

If adapter code keeps growing, the architecture is moving in the wrong direction.

---

# Phase F — Unify persistence deliberately

The long-term product should have one coherent Freelancer data architecture, but physical consolidation into a single SQLite file is not a success criterion. Keep separate physical stores while ownership, migrations, locking, rollback, or upstream compatibility benefit from separation. Merge stores only when the same runtime and migration system genuinely own both sides and the operational benefit is demonstrated.

Inventory all persistent state and assign canonical ownership.

Example domains:

```text
freelancer.sqlite
├── projects
├── chats / runtime session references
├── goals
├── agents
├── workers
├── runtime events
├── permissions / durable decisions where appropriate
├── todos
├── drafts
├── memories
├── content index
├── model metadata
├── usage observations
├── capability state
├── computer-use sessions/evidence
└── git project state
```

Logical ownership must remain explicit regardless of physical layout. A single SQLite file may become desirable later, but the staging plan should assume multiple stores are acceptable until migration behavior, WAL/locking, rollback, and upstream-sync consequences are measured.

Do not merge:
- provider secrets;
- OAuth material;
- OS credential-store data;
- opaque external authentication state

into SQLite merely to claim there is "one database."

The target is coherent persistence, not unsafe persistence.

Migration should be staged:
1. inventory stores;
2. identify source of truth;
3. design target schema;
4. add read compatibility;
5. migrate writes;
6. verify;
7. remove obsolete storage.

---

# Phase G — Create the Capability Runtime

This is where the larger fusion becomes more powerful than merely embedding OpenCode.

Freelancer should own a first-class capability layer above individual tools and MCP services.

The model should primarily see durable product capabilities such as:

- filesystem;
- shell;
- Git;
- search;
- memory;
- web;
- browser;
- desktop/computer;
- documents;
- external connected services.

MCP remains an extension protocol, not the identity of the capability.

A useful maturity path is:

```text
new capability
    ↓
MCP proof of concept
    ↓
proven useful
    ↓
Freelancer adapter
    ↓
native implementation or embedded library when justified
```

This lets Freelancer experiment cheaply without permanently exposing every dependency to the model.

---

# Phase H — Absorb computer-use projects into native capabilities

The unified computer-use effort should be folded into this runtime architecture.

## Browser

Primary sources:
- Browser Harness;
- BrowserCode;
- Browser Use;
- Playwright;
- open-browser-use.

Preferred model-facing concept:

```text
browser.observe
browser.execute
browser.capture
browser.wait
```

or an equally small surface.

Borrow BrowserCode's strongest idea: browser automation can often be more powerful and context-efficient when exposed as expressive code execution over CDP rather than dozens of narrow UI tools.

Do not adopt BrowserCode's entire OpenCode fork as a competing runtime.

## Desktop / Windows

Primary sources:
- Cua Driver;
- UFO²;
- Open Interpreter;
- Windows-native APIs.

Prefer:
1. native API;
2. structured UI Automation/accessibility;
3. application-specific interfaces;
4. visual recognition;
5. coordinate fallback.

Do not adopt UFO³ orchestration or another agent hierarchy.

Freelancer already owns orchestration.

## Provider abstraction

Internally support multiple implementations behind one capability contract.

A model should ask Freelancer to operate the browser or computer, not choose "Cua versus UFO versus Playwright."

Provider selection should use capability evidence:
- browser or desktop;
- structured controls;
- DOM/CDP;
- native Windows support;
- screenshots;
- background interaction;
- profile/session access;
- isolation;
- file transfer;
- clipboard;
- trace support.

Unknown remains unknown.

---

# Phase I — Preserve authority above capability

Absorbing drivers must never allow drivers to define product authority.

The flow remains:

```text
model intent
    ↓
Freelancer/OpenCode-derived authority layer
    ↓
permission decision
    ↓
capability runtime
    ↓
driver
```

A browser or desktop driver being technically capable of an action does not authorize that action.

Sensitive external side effects should remain subject to the appropriate native permission/consent model.

Do not create one permission system per imported project.

---

# Phase J — Normalize evidence

All execution layers should feed one evidence model.

Freelancer should distinguish:
- requested action;
- attempted action;
- provider/runtime result;
- observed resulting state;
- verified outcome.

This applies to:
- shell;
- Git;
- browser;
- desktop;
- workers;
- tests;
- external services.

The UI should present normalized evidence in existing request groups, Details, worker cards, and goal status rather than creating separate activity products for each subsystem.

---

# Phase K — Decide process topology last

Only after runtime ownership and data contracts are stable should the project decide whether OpenCode-derived runtime code remains:
- a child process;
- a local internal service;
- an in-process package;
- a hybrid.

Do not confuse "one product" with "one OS process."

A separate runtime process may continue to provide isolation, restartability, or simpler failure handling.

The architectural goal is removing redundant concepts and translation layers, not maximizing process purity.

---

# Phase L — Testing strategy

Fusion work has a high risk of invisible regression because wrapper behavior can look correct while runtime semantics drift.

Maintain layered tests:

## Upstream compatibility
Can the pinned OpenCode-derived runtime execute core upstream behavior?

## Freelancer runtime contracts
Do canonical Freelancer services faithfully expose runtime truth?

## Product behavior
Can the Freelancer UI observe, control, resume, cancel, and explain work correctly?

## Capability behavior
Can browser/desktop/tools execute and verify real tasks?

## Migration behavior
Can existing Freelancer projects/chats/settings survive storage and runtime changes?

## Failure behavior
Test:
- lost acknowledgements;
- runtime restart;
- stale session handles;
- denied permissions;
- provider failure;
- tool failure;
- browser disconnect;
- child cancellation;
- partial evidence;
- database migration interruption.

Do not let fixture success stand in for real runtime success.

---

# Phase M — Practical sequence

The recommended implementation sequence is:

1. Pin OpenCode upstream and resolve the explicit version-compatibility gate.
2. Vendor the pinned source under `vendor/opencode/` without changing Freelancer's root package-manager ownership.
3. Prove the vendored OpenCode Bun workspace can bootstrap and execute independently as a build island.
4. Complete the package map and parity-harness definitions.
5. Build the relevant runtime closure from within the Freelancer repository.
6. Document runtime versus presentation boundaries.
7. Complete runtime and UI gap analyses.
8. Introduce a Freelancer Runtime facade.
9. Move one duplicated domain at a time behind the facade.
10. Delete redundant translation code continuously.
11. Consolidate persistence logically first; merge physical stores only when justified.
12. Introduce the Capability Runtime.
13. Fold unified browser/computer use into that capability layer.
14. Keep MCP as the extension escape hatch.
15. Periodically compare against upstream OpenCode and selectively absorb improvements.
16. Consider collapsing process boundaries only after architecture stabilizes.

---

# What not to do

Do not:
- rewrite OpenCode wholesale;
- copy OpenCode UI into Freelancer;
- sever upstream provenance;
- merge databases blindly;
- copy every external computer-use project into the tree;
- expose vendor-specific tool names to agents unnecessarily;
- create parallel orchestration systems;
- let imported agents compete with Freelancer workers;
- move authority into capability drivers;
- combine all state into one schema without ownership boundaries;
- refactor every subsystem simultaneously;
- optimize for architectural purity before proving behavior.

---

# Success criteria

The fusion is successful when:

1. A user can treat Freelancer as the complete product.
2. OpenCode is an implementation lineage/runtime source, not a visible product dependency.
3. Runtime truth is surfaced directly with minimal translation.
4. Important OpenCode runtime features are no longer accidentally hidden.
5. Valuable OpenCode UI capabilities have Freelancer-native equivalents.
6. Duplicate session/tool/permission/worker/context state is materially reduced.
7. Computer-use engines are hidden behind native Freelancer capabilities.
8. MCP remains available for extension without defining core product architecture.
9. Persistence is coherent and ownership is explicit.
10. Upstream OpenCode improvements can still be evaluated and absorbed.
11. The amount of integration glue trends downward as the work progresses.

The final architectural idea is simple:

> Freelancer becomes the harness, runtime, capability system, evidence system, and user experience. OpenCode and the other open-source projects become implementation lineage and reusable machinery beneath it.
