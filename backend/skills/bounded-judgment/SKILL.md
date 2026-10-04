---
name: bounded-judgment
description: Classify, check or score explicit evidence with optional Jev judgments; report missing information and uncertainty separately.
---

# Bounded judgment

Use when a typed semantic judgment helps check a condition, classify records,
assess relevance or compare alternatives. Jev supplies structured answers; the
agent supplies explanations. Use code for exact lookups, arithmetic, filtering
and sorting. Continue ordinary analysis when a judgment adds little.

## Prepare a useful question

- Retrieve relevant evidence first. Separate observations, supplied values,
  assumptions and preferences. Preserve source identities, dates, units,
  configuration and unknowns; select only fields the question needs.
- Ask one coherent judgment per question. Split independently useful dimensions
  instead of burying quality, cost, speed and reliability in one vague score.
  Describe candidates neutrally; avoid unsupported conclusions in option labels.
- Use `check` for a yes/no condition, `classify` for one explicit option, or
  `score` for ordered described levels. Align instructions and criteria; include
  insufficient evidence when a closed choice may be unsupported.
- Keep criteria and evidence comparable. Different releases/deployments remain
  distinct unless a source establishes equivalence. Missing evidence is unknown,
  not zero or proof of inferiority.

## Evaluate and explain

`evidence_evaluation` selects stored or supplied evidence using Freelancer's local
contract. Discover its current schema with `describe` when needed. `prepare`
validates without inference; `evaluate` accepts a contract or prepared receipt;
`inspect` reads receipts without replay. Read [contract details](references/contracts.md)
for the minimal example, source projection, stages, composition and paginated receipts.

Independent questions with the same state can share a batch. Use a later stage
only when it needs previous answers. For larger requested sets, page the inventory
and compare in bounded batches with a common rubric; combine results in code.
Request limits do not limit the whole task. Report unassessed candidates and coverage.

Explain the answer from its evidence, distribution and important limits. Choice
confidence describes concentration among supplied options; it does not erase
uncertain input scores or prove success on an untested task. Reuse existing answers
for changed weights. When declared numeric criteria settle a comparison, code can
select the result without another model choice.

A connected Jev MCP is another valid route with its own schema. `typesafe-ai`
covers integration development; durable `knowledge` definitions support explicitly
reusable questions. No skill is a prerequisite. Keep credentials/private configuration
out of state and preserve native cost/disclosure consent.

[Jev 1.13's documented pitfalls](https://docs.typesafe.ai/model-jaggedness/jev-1.13)
include indirection, irrelevant state and numeric precision. Check the returned
version and distinguish preparation/service failures from questionable judgments.
