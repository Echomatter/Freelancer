---
name: compare-builds
description: Build two alternative implementations of the same brief, compare their artifacts and observed behavior, then recommend or adapt the better result.
---

# Compare builds

Use when implementing alternatives will resolve a meaningful design or engineering
choice, or the user requests a development comparison. For a choice that can be
settled from existing evidence, reason through it without building extra versions.

## Set up a fair comparison

- Give both versions the same brief, baseline, constraints and acceptance criteria.
  Vary a useful choice, such as architecture, interaction or algorithm; keep scope
  and effort comparable.
- Preserve the current implementation and unrelated work. Put alternatives in
  separate, clearly named folders or other agreed isolated workspaces. Honor the
  project's structure and saved Git agreement; isolation grants no history authority.
- Work directly or delegate bounded implementations to named agents with disjoint
  paths and the same inputs. Keep initial designs independent when useful; no
  particular models, teams or paid routes are required. Record material differences
  in conditions, including actual agent/model identities when relevant.

## Build and compare

- Produce inspectable versions with equivalent finishing effort; distinguish an
  incomplete alternative from a failed approach.
- Compare source, artifacts and permitted observed behavior against the criteria
  under equivalent inputs, environment and configurations. Record differences
  that prevent a fair comparison. Tie conclusions to the evidence actually found.
- Run tests or benchmark suites only when requested or already authorized. Keep
  measurements tied to the version, command and conditions actually checked;
  otherwise state which outcomes remain unmeasured. `verify` guides checks and
  `playwright` can inspect rendered behavior when that is the relevant claim.
- `review` can supply independent findings; `bounded-judgment` can advise a
  qualitative comparison. Neither establishes correctness or an unmeasured advantage.

## Decide and deliver

Show where both versions can be inspected, the meaningful differences, observed
results and remaining uncertainty. Recommend the better fit, combine specific
strengths where justified, or report that the evidence does not separate them.
Do not invent a winner from a narrow score or silently change the criteria.

Apply the chosen version when implementation is within the user's request, after
checking integration with the existing project. Preserve rejected artifacts when
still useful; remove temporary alternatives only within the authorized scope.
Comparison never automatically merges, publishes, changes permissions or selects
a paid model.
