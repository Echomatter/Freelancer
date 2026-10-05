# OpenCode Runtime Package Map

Status: **staging source map** for pinned OpenCode commit `907b3bc518fa48e90e8ec24dd327d13eee71c36c`.

This document exists to prevent the fusion work from treating `packages/opencode` as one indivisible runtime. OpenCode already exposes useful internal package seams. The first implementation task after vendoring is to verify this map against the imported source and refine the dependency closure before modifying upstream code.

## Classification

| Package / area | Observed role | Initial Freelancer treatment |
| --- | --- | --- |
| `@opencode-ai/schema` | Shared schemas/types built on Effect | **Retain deeply.** Candidate low-level contract dependency. Avoid duplicating equivalent schemas in Freelancer without reason. |
| `@opencode-ai/llm` | Provider routing/protocol implementations for Anthropic, OpenAI, Google, Bedrock, Copilot, OpenRouter, OpenAI-compatible and others | **High-value runtime component.** Preserve provider/protocol work rather than reimplementing transports. |
| `@opencode-ai/core` | Core runtime services including session runner, system context, database, filesystem/PTY/platform abstractions and model/provider dependencies | **Primary runtime-kernel candidate.** Largest dependency/risk surface; map its internal services before embedding. |
| `@opencode-ai/server` | HTTP/API composition, protocol/server helpers, Effect/Drizzle dependencies | **Primary transition seam.** Existing external HTTP behavior can act as the parity oracle while the runtime is absorbed. |
| `@opencode-ai/protocol` | Protocol/schema layer | **Retain.** Strong candidate for stable internal contracts during migration. |
| `@opencode-ai/sdk` | Generated/programmatic client and server helpers | **Use heavily during migration.** Useful for baseline behavior and possibly temporary internal boundaries. |
| `@opencode-ai/plugin` | Tool/plugin extension APIs, including promise/effect integrations | **Retain initially.** Freelancer already depends on this package; resolve version skew before import. |
| `packages/opencode` | Standalone executable/composition package; CLI commands plus server/runtime assembly and TUI dependency | **Mine selectively.** Do not assume this package is the runtime kernel. Separate composition logic from standalone product commands. |
| `@opencode-ai/tui` | Terminal UI, keymaps, clipboard/editor integrations, TUI runtime/context | **Presentation/reference by default.** Inventory useful behavior but do not adopt its UX architecture. |
| `@opencode-ai/app` | Web/desktop application UI and app-specific dependencies | **Presentation/reference by default.** Useful only for feature-gap discovery or isolated reusable logic. |

## Key source observations

At the pinned revision:

- the OpenCode root uses Bun workspaces and a shared catalog;
- `packages/opencode` is version `1.18.34`;
- Freelancer currently depends on `@opencode-ai/plugin` `1.18.31`;
- the server exposes a programmatic HTTP application surface and explicit listener lifecycle;
- core packages use Effect services/layers and platform-specific Node/Bun implementations;
- the provider stack is already separated into `@opencode-ai/llm` and AI SDK/provider packages;
- TUI and app packages are separately identifiable rather than inseparable runtime code.

These observations argue for **absorbing a package/service closure**, not blindly rewriting the standalone application package.

## Required post-import analysis

For each package above, record:

1. direct dependencies;
2. transitive workspace dependencies;
3. Node-only, Bun-only, and dual implementations;
4. runtime global/process assumptions;
5. persistence ownership;
6. lifecycle/finalizer ownership;
7. public exports actually needed by Freelancer;
8. code currently reached through Freelancer's HTTP integration;
9. code not used by Freelancer today but potentially valuable;
10. code that is presentation-only or standalone-product glue.

## Runtime closure questions

Do not modify vendored source until these are answered:

- Can the required provider/model/session/tool stack be composed without `@opencode-ai/tui`?
- Can it be composed without `@opencode-ai/app`?
- Which pieces genuinely require Bun rather than merely living in a Bun monorepo?
- Which `#db`, `#sqlite`, `#pty`, and filesystem imports select Node implementations successfully?
- Does Freelancer need the full `packages/opencode` package, or can it build from `core + server + protocol + sdk + plugin + llm + schema` plus a small amount of composition code?
- Which current HTTP endpoints map directly to internal services?
- Which current Freelancer translations can disappear once those services are called more directly?

## Default decision rule

Prefer, in order:

1. consume an existing OpenCode package/service without modification;
2. wrap it behind a Freelancer-owned runtime contract;
3. patch a narrow upstream seam with an auditable delta;
4. fork/rewrite only when the existing contract fundamentally conflicts with Freelancer.

The burden of proof is on **divergence**, not reuse.

## Deliverable from the first source-analysis pass

Produce a dependency diagram with three colors/classes:

- **retain unchanged**
- **wrap/compose**
- **replace or ignore**

That map becomes the basis for the first implementation PR. No large-scale source edits should precede it.
