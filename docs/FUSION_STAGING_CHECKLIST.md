# Freelancer / OpenCode Fusion Staging Checklist

This branch is a **staging and architecture branch** until the OpenCode subtree is deliberately imported. It should make the dangerous decisions explicit before large source changes begin.

## Stage 0 — Branch safety

- [ ] Work only on `fusion/opencode-runtime`.
- [ ] Keep `main` independently buildable and releasable.
- [ ] Keep the working tree clean before any upstream import/update.
- [ ] Treat `vendor/opencode/` as upstream source, not Freelancer-owned runtime code.
- [ ] Treat `runtime/` as Freelancer-owned code only.
- [ ] Do not import other computer-use repositories into this branch during OpenCode runtime staging.

**Stop if:** the branch cannot be cleanly abandoned without affecting `main`.

## Stage 1 — Compatibility decision

Known initial skew:

- Freelancer `@opencode-ai/plugin`: **1.18.31**
- pinned OpenCode: **1.18.34**

Choose and record exactly one:

- [ ] upgrade Freelancer to 1.18.34 and run the existing full suite;
- [ ] select a matching/compatible OpenCode pin;
- [ ] approve a documented temporary skew after focused compatibility evidence.

Do not use `-AllowVersionSkew` merely to get past the importer.

**Stop if:** plugin/runtime compatibility is unknown.

## Stage 2 — Source import

- [ ] Run `scripts/check-opencode-fusion-preflight.ps1`.
- [ ] Run `scripts/import-opencode-upstream.ps1` only after preflight passes.
- [ ] Confirm source is under `vendor/opencode/`.
- [ ] Confirm vendored source matches the pinned commit.
- [ ] Confirm upstream license/provenance record is retained.
- [ ] Do not modify vendored source in the import commit.

**Stop if:** import changes Freelancer root dependency ownership, lockfile semantics or existing application behavior.

## Stage 3 — Build island

OpenCode remains its own Bun workspace initially.

- [ ] Confirm required Bun version is available.
- [ ] Install vendored dependencies inside the vendored workspace.
- [ ] Run relevant upstream typechecks/tests.
- [ ] Prove a disposable runtime can start from vendored source.
- [ ] Keep Freelancer's Node/npm toolchain unchanged during this proof.

Record exact commands and outputs in the implementation PR.

**Stop if:** proving the upstream build requires broad changes to Freelancer root tooling.

## Stage 4 — Package/runtime map

Use `docs/OPENCODE_RUNTIME_PACKAGE_MAP.md`.

- [ ] Map `schema`.
- [ ] Map `llm`.
- [ ] Map `core`.
- [ ] Map `server`.
- [ ] Map `protocol`.
- [ ] Map `sdk`.
- [ ] Map `plugin`.
- [ ] Classify `packages/opencode` composition logic.
- [ ] Confirm `tui` and `app` dependencies are avoidable for the desired runtime closure, or document why not.
- [ ] Record Node/Bun-specific implementation choices.

**Deliverable:** retain / wrap-compose / replace-ignore dependency diagram.

## Stage 5 — Runtime and UI gap analyses

For every significant OpenCode runtime feature classify:

- fully exposed;
- partially exposed;
- duplicated;
- translated awkwardly;
- unused but valuable;
- intentionally unsupported;
- presentation-only;
- unknown.

For every useful OpenCode user-visible control, identify the proper Freelancer-native location rather than porting the screen.

**Stop if:** implementation begins before ownership is decided for the domain being changed.

## Stage 6 — Baseline parity harness

Use `docs/OPENCODE_RUNTIME_PARITY_HARNESS.md`.

- [ ] Capture baseline scenarios against the current external runtime.
- [ ] Use disposable runtime/config/data where possible.
- [ ] Mark what requires real provider inference separately.
- [ ] Record authority invariants.
- [ ] Create a difference ledger format.

No runtime domain is replaced without applicable baseline evidence.

## Stage 7 — First migration slice

Choose **one** narrow duplicated domain.

Recommended early candidates:

1. runtime identity/health;
2. model/provider inventory;
3. tool inventory;
4. session identity.

For the selected domain:

- [ ] define canonical Freelancer contract;
- [ ] implement candidate path;
- [ ] run parity;
- [ ] switch one consumer;
- [ ] preserve rollback;
- [ ] delete/reduce old translation code;
- [ ] measure whether integration complexity went down.

**Stop if:** the new adapter is larger or more ambiguous than the old path without a clear compensating capability.

## Stage 8 — Persistence freeze

Until runtime ownership is stable:

- [ ] inventory OpenCode stores;
- [ ] inventory Freelancer stores;
- [ ] assign logical ownership;
- [ ] do not merge physical SQLite files;
- [ ] do not move provider/OAuth secrets into Freelancer storage;
- [ ] keep migration/rollback independently testable.

Physical consolidation is optional and later.

## Stage 9 — Capability runtime and computer use

Only after the runtime boundary is functioning:

- [ ] introduce/solidify the Freelancer Capability Runtime;
- [ ] place browser/desktop behind Freelancer contracts;
- [ ] reuse Browser Harness/Cua/UFO/Open Interpreter/Playwright components selectively;
- [ ] keep MCP as extension/prototyping path;
- [ ] do not import whole competing agent products unless a concrete low-level component requires vendoring.

## Branch exit criteria

This staging branch is ready to become a real implementation branch when:

- [ ] compatibility decision is recorded;
- [ ] source import is reproducible;
- [ ] vendored build island works;
- [ ] runtime package map is complete enough to choose a closure;
- [ ] baseline parity suite exists;
- [ ] first migration slice is named;
- [ ] persistence remains reversible;
- [ ] upstream sync strategy is documented;
- [ ] no architectural step requires copying OpenCode UI into Freelancer.

At that point implementation should proceed domain by domain, not through a wholesale rewrite.
