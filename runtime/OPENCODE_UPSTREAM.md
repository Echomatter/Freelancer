# OpenCode Upstream Pin

Freelancer runtime fusion currently targets the following OpenCode upstream revision:

- Repository: `https://github.com/anomalyco/opencode.git`
- Upstream default branch: `dev`
- Pinned commit: `907b3bc518fa48e90e8ec24dd327d13eee71c36c`
- License at time of pin: MIT
- Intended import location: `runtime/opencode-upstream/`

This branch intentionally records a deterministic upstream revision before deeper integration work begins.

## Import policy

The imported tree should initially remain recognizable as upstream OpenCode. Avoid broad renames or interleaving Freelancer-specific code throughout the upstream source until the runtime/presentation boundary and sync strategy are understood.

Prefer Freelancer-owned integration code outside the imported subtree where practical.

## Updating upstream later

Upstream updates should be deliberate:

1. inspect OpenCode changes since the currently pinned commit;
2. identify runtime improvements relevant to Freelancer;
3. review licensing/dependency changes;
4. update the pin;
5. import/merge the selected upstream revision;
6. run runtime compatibility and Freelancer regression tests;
7. document any local patch conflicts or behavioral differences.

Do not blindly follow upstream HEAD in production builds.
