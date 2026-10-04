---
name: reason-through
description: Compare choices, assumptions and dependencies when a decision or plan is uncertain.
---

# Reason through

Use for design tradeoffs, conflicting evidence or a plan whose dependencies need
revision. For an observed failure, `debug` supplies cause-testing guidance; when
two implementations would resolve a choice, consider `compare-builds`.

- Identify the actual decision, constraints and success criteria. Separate observed
  facts, assumptions and unknowns.
- Compare plausible choices using criteria that could change the decision. Expose
  important dependencies and contradictory evidence; omit alternatives that add
  no useful distinction.
- Seek the smallest source read or permitted observation that resolves a consequential
  uncertainty. Revise the choice when its assumptions change.
- Give the conclusion, key reasons, remaining uncertainty and next action. Explain
  proportionally; an exhaustive trace is unnecessary.

Ordinary reasoning is sufficient. Sequential Thinking optionally tracks supplied
steps, branches and revisions; it adds no observations or independent verification.
Read [references/sequential-thinking.md](references/sequential-thinking.md) when
using its tool. `bounded-judgment` can advise a typed comparison over explicit
evidence, while the agent retains responsibility for the conclusion.
