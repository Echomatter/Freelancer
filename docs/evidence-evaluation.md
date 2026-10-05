# Evidence evaluation

Freelancer's `evidence_evaluation` tool applies optional typed judgments to
bounded, explicitly selected information. It is not limited to model
selection or software engineering. The same contract can classify research
notes, compare project alternatives, score requirements against a rubric, or
check whether supplied evidence supports a narrow condition.

The application contract is Freelancer-owned JSON. It is not TypeSafe's
`systemOne` request or wire format. For the current request fields, bounds,
expression operators, response shapes, and receipt behavior, call the tool's
`describe` operation; do not infer them from an older example.

## Evidence and judgment contract

A version 1 contract has these top-level components:

| Component | Purpose |
| --- | --- |
| `evidence` | Select bounded records from `catalog`, an exact retained record with `source: "memory"` and `domain: "memories"`, or a local `query` over files, conversations and memories. Exact memory selectors may specify a revision. Query selectors carry a query, explicit projected fields and domain-specific filters, including project scope, source attributes, model, origin/status and pin/archive state. Queries use cached local data; with no scope filter the existing helper searches globally across registered projects. |
| `supplied` | Attach caller-provided values with an explicit kind: `supplied`, `assumption`, or `preference`. These are inputs to this request, not retained source records. Include provenance/date metadata when known. |
| `derivations` | Compute deterministic values from declared references, such as arithmetic or normalized fields. The expression language is the documented contract, not arbitrary JavaScript. |
| `scenarios` | Apply request-local overlays to declared targets. An overlay is an assumption or preference and never changes the retained source record. |
| `questions` | Ask bounded typed questions using evidence IDs as inputs. `check` is yes/no, `classify` chooses from an unordered set, and `score` places an item on declared ordered levels. Questions may specify a stage and dependencies. |
| `composition` | Combine selected typed answer fields with explicit mappings, weights, and a declared output scale. This is deterministic application logic. |

The tool exposes four operations: `describe` returns its current contract;
`prepare` resolves bounded local evidence and deterministic derivations from a
`contractJson` without calling Jev; `evaluate` evaluates a prepared
`contractJson` or composes an existing `receiptID` using
`compositionJson`; and `inspect` reads a recent `receiptID`. Read the live
`describe` result for exact operation argument and response details. A minimal
contract illustrating Freelancer's JSON shape is below; the values are an
application example, not an official TypeSafe SDK example:

`describe` includes a machine-readable JSON Schema for version 1. Runtime
validation adds reference integrity, stage ordering, privacy, and byte/work
limits that a JSON Schema alone cannot express. The schema definition is
[maintained in the domain layer](../domain/evidence-evaluation-schema.mjs) and
the running tool returns its current copy.

For catalog evidence, `describe.modelCatalogSchema` is identical to `model_catalog schema`.
Catalog detail returns `records[].id` and `records[].observations`; evidence packets use
the same observation shape. Select a source record ID and canonical observation `key`
or original `attribute`. Attribute selection occurs before pagination. Limits,
capabilities, AA composite ratings, source benchmarks and provider-median performance
retain their source coverage and configurations. Absent or null selected values mark
the packet partial; they are never replaced with zero.

`questions[].inputs` is always an array of input IDs, including for one input.
Composing a `classify` answer's `choice` into numbers requires an explicit numeric
`mapping` for every declared option. These are Freelancer contract requirements;
the existing adapter translates typed questions to the official TypeSafe request.

```json
{
  "version": 1,
  "name": "compare-project-options",
  "supplied": [
    {
      "id": "requirements",
      "kind": "supplied",
      "value": {
        "must": ["offline access", "exportable data"],
        "preference": "simple setup"
      },
      "provenance": "Requirements supplied for this comparison"
    },
    {
      "id": "option-a",
      "kind": "supplied",
      "value": {"name": "Option A", "features": ["offline access"]}
    },
    {
      "id": "option-b",
      "kind": "supplied",
      "value": {"name": "Option B", "features": ["exportable data"]}
    }
  ],
  "questions": [
    {
      "id": "a-coverage",
      "primitive": "check",
      "instructions": "Does option-a satisfy every must-have in requirements?",
      "criteria": {"yes": "Every must-have is evidenced", "no": "At least one is missing or unclear"},
      "inputs": ["requirements", "option-a", "option-b"],
      "stage": 0
    },
    {
      "id": "b-coverage",
      "primitive": "check",
      "instructions": "Does option-b satisfy every must-have in requirements?",
      "criteria": {"yes": "Every must-have is evidenced", "no": "At least one is missing or unclear"},
      "inputs": ["requirements", "option-a", "option-b"],
      "stage": 0
    }
  ]
}
```

Both questions use the same selected state and do not depend on one another,
so they can share an independent batch. A dependent question in a later stage
receives declared prior answers as additional state. Its question text and
criteria remain part of the static contract; this version does not use an
answer to fetch evidence, rewrite criteria, or choose new options. Do not use a
later stage when the original selected state already supports the question.

The current local validator applies these bounds: contract UTF-8 size 120 KB;
20 evidence selectors; 100 supplied values; 50 derivations; 10 scenarios;
20 questions; five stage numbers (0–4); 100 question inputs; 500 rows per
expression operation; 2,000 expression-work units; 12 nested expression
levels; 120 KB per selected packet and combined evidence packet; and a 900 KB
receipt response. There are at most 32 in-process, session-owned receipts,
with a one-hour lifetime. The runtime `describe` operation is authoritative if
these values change.

Native tool output stays below OpenCode's 50 KB response limit. Scenario
`entryRefs` point to unchanged packet or derived entries in the same JSON
response; `entries` retains changed values. Repeated provider state is represented
by its hash and recorded run IDs. The service keeps the complete receipt.
Receipts that still exceed 48 KB use explicitly partial JSON string chunks.
Continue with `inspect`, the same `receiptID`, and `presentation.nextCursor` as
`outputCursor`; concatenate `data` in offset order and parse the completed JSON.
Reading chunks never calls the provider or repeats evaluation. A cursor for a
changed receipt is rejected; inspect the current receipt without a cursor.

Preparation reserves space for later outcomes. Evaluation checks the cumulative
receipt size before each provider batch and stops with explicit partial results
if the next batch would exceed that space. Questions left unsubmitted are
marked `not-evaluated`; inspecting or reusing that receipt does not replay them.
If repeated stage state is omitted to preserve the response bound, its hash and
recorded run identifiers remain visible alongside the selected packet and
scenario inputs. The existing judgment ledger retains the actual submitted
state for recorded calls.

Scenario overlays run in declared order. Conditions see recalculated
derivations after earlier overlays. An unknown condition leaves its target
unknown rather than choosing a branch. Derived entries carry transitive
assumption, preference, subjective-threshold and partial-coverage information.

## Evidence boundaries

- A catalog or warehouse selector describes retained application data. A query
  returns a bounded local result set. Neither operation silently refreshes an
  external source.
- An exact memory revision identifies what was retained at that revision.
  Current-source absence, archive, or a newer retained revision does not make
  an older record a live verification.
- A supplied value is only as authoritative as the caller's provenance. Label
  assumptions and preferences instead of presenting them as observations.
- Select only fields needed for the judgment. The packet guard rejects
  sensitive field names and several recognizable credential patterns, but it
  cannot identify every secret hidden in arbitrary prose. Do not deliberately
  include credentials or private configuration in supplied values or source
  text.
- A derived value is reproducible application computation over its declared
  inputs. Keep units and scales explicit; do not blend unlike measures without
  a declared mapping.
- A scenario overlay explores a counterfactual request view. It neither edits
  stored evidence nor asserts that the scenario is true. A `when` condition
  applies only when its deterministic expression returns true; unknown does
  not silently choose a branch.
- TypeSafe provides typed answers, not verified truth. Check consequential
  claims against independent evidence and report uncertainty and evidence
  coverage separately.

Choice and Score include distributions and a confidence value that reflects
distribution concentration; it is not an overall confidence in the whole
workflow. Check returns the probability of yes and has no separate confidence.

Live Jev Score responses can report a score and probability bins at hundredth
resolution whose displayed weighted mean differs slightly from the reported
score. Freelancer applies a local compatibility rule only when both the score
and every bin have that resolution: it checks the possible weighted-mean
interval for bin rounding of half a hundredth, a unit-sum underlying distribution,
and score rounding of half a hundredth. The original values remain unchanged;
accepted differences carry `derived.scoreValidation` with the displayed mean,
difference, compatible bounds and local policy. Higher-precision responses keep
the strict arithmetic check. This policy follows observed live responses; it is
not a TypeSafe precision guarantee. Probability keys, bounds, total, rubric
legend and larger inconsistencies remain independently validated.

For reusable weighted views, retain the receipt and provide a composition
array through `compositionJson` that changes weights or mapping without
changing the questions or evidence. A term selects `score`, `probabilityYes`,
or `choice`, declares its numeric range and nonnegative weight, and can map
choice labels to numbers. Choice needs a complete numeric mapping. Each output
declares `min`, `max`, and `units`; score ranges must match the rubric and yes
probability uses `[0,1]`.
This recomputes the application-side combination without another model
judgment. Before reusing evaluated answers, `evaluate` rechecks the selected
evidence; if it changed, the answers remain historical and are not reusable.
If evidence, question meaning, or criteria change, prepare and evaluate a new
contract instead. Receipts are bounded and can expire. `inspect` returns the
prepared/evaluated snapshot; inspection alone does not recheck whether stored
selectors still resolve to the same evidence. A fresh `evaluate` checks selected
evidence before and during provider calls and marks the receipt changed if it no
longer matches. Receipts are scoped to the calling project/session and
held in an in-process cache (up to 32 receipts, with a one-hour lifetime); a
receipt unavailable after restart must be treated as unavailable, not
reconstructed as if it were the original result. Separate durable judgment
records contain only question/result and provenance material actually written
through that existing path.

Deterministic arithmetic, filtering, exact matching, and threshold checks
should stay in code. Use Jev only where semantic interpretation is needed.
Neither a typed result nor a composed score can authorize an action, grant
permission, trigger delegation, create or edit a memory, or
approve paid use. Actual judgment calls are recorded in the existing judgment
ledger; they do not become authored memories. The tool does not provide
arbitrary SQL or code execution. Native permissions and explicit user consent
remain authoritative; the native permission prompt applies when a contract
contains questions, not for deterministic evidence preparation or composition.

## Selector compatibility

Older `source: "knowledge"` selectors and the `facts` domain are accepted as
hidden compatibility inputs and normalized to memory records. New contracts
use `source: "memory"`, domain `memories` and an exact retained ID/revision.
This does not turn model-catalog observations into memories or change their
source values, identities or schema.

## TypeSafe semantics and references

The TypeSafe primitives give useful design guidance: [Choice](https://docs.typesafe.ai/primitives/choice)
selects among unordered alternatives, [Score](https://docs.typesafe.ai/primitives/score)
uses an ordered rubric, and [Noul](https://docs.typesafe.ai/primitives/noul)
answers a yes/no question with a probability. Its [primitives overview](https://docs.typesafe.ai/primitives)
describes these answer shapes. TypeSafe documents that questions over one
state are independent; use another request when a later judgment truly needs
an earlier answer to construct its state or choices. See its [parallel-question
cookbook](https://docs.typesafe.ai/cookbooks/parallel_questions) and [System
One workflow guidance](https://docs.typesafe.ai/concepts/how-to-build-with-system-one).

These are vendor semantics, not Freelancer's JSON schema. Freelancer's local
`evidence_evaluation` contract wraps retrieval, supplied values, deterministic
derivations, scenarios, stages, receipts, and composition around those typed
judgments. The TypeSafe [JavaScript SDK reference](https://docs.typesafe.ai/sdk/javascript)
is relevant to application integrations; the vendor's [official skill](https://github.com/typesafe-ai/skills/blob/65a39f393687675ce170e6094757de20370365b9/skills/typesafe-ai/SKILL.md)
is optional guidance. No separate external Memory service is required for
Freelancer's internal memories and retained relationships.
