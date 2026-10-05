# OpenCode Upstream Pin

This file records the upstream source intended for the Freelancer runtime-fusion staging branch.

- Repository: `https://github.com/anomalyco/opencode.git`
- Upstream default branch at selection: `dev`
- Pinned commit: `907b3bc518fa48e90e8ec24dd327d13eee71c36c`
- OpenCode package version at that commit: `1.18.34`
- Freelancer `@opencode-ai/plugin` version when the staging branch was created: `1.18.31`
- License at time of pin: MIT
- Intended vendored source location: `vendor/opencode/`

## Ownership boundary

`vendor/opencode/` is upstream source material. Keep it recognizable and minimally modified during staging.

`runtime/` is reserved for Freelancer-owned runtime adapters, contracts, services, and eventually any deliberately absorbed implementations.

Do not place the initial upstream subtree under `runtime/`; doing so blurs provenance and makes future upstream comparison harder.

## Version compatibility gate

The initial staging state contains a known version skew:

- Freelancer plugin dependency: 1.18.31
- pinned OpenCode runtime: 1.18.34

The importer refuses this skew by default. Resolve it by either:

1. deliberately upgrading Freelancer to the pinned OpenCode version and running the existing full verification suite; or
2. selecting a compatible OpenCode pin; or
3. explicitly documenting why the skew is safe and invoking the importer with its override.

The override is evidence of a reviewed exception, not proof of compatibility.

## Import policy

The initial import should preserve the upstream monorepo and its own Bun/package-manager boundary. Do not merge its workspace definition, lockfile, package catalog, patches, or postinstall assumptions into Freelancer's root npm project during the first stage.

Treat the vendored tree as a build island until the package dependency map demonstrates a smaller runtime closure.

## Updating upstream later

Upstream updates are deliberate:

1. inspect changes since the current pin;
2. identify runtime changes relevant to Freelancer;
3. review dependency and license changes;
4. update the pin;
5. reproduce the import/update;
6. run upstream-runtime checks plus Freelancer parity/regression checks;
7. record local patch conflicts and intentional behavioral differences.

Do not blindly follow upstream HEAD.
