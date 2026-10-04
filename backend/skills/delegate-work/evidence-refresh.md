# Delegation routing evidence maintenance

Read this only for requested routing-cache maintenance or selector diagnostics.
Ordinary `delegate` uses cached routing evidence. Published `model_catalog`
refresh is a separate free-source download; this guide edits the internal
routing evidence cache and never changes eligibility or grants paid use.

Resolve `FREELANCER_RUNTIME_ROOT` (Freelancer's `backend/` directory) and work
there, not in the user's project. For a requested routing investigation:

```powershell
$runtimeRoot = $env:FREELANCER_RUNTIME_ROOT
& "$runtimeRoot/scripts/select-model.ps1" -WorkMode build -HostAssessment true
```

This exposes candidate evidence and is not an ordinary delegation preflight.
Never alter evidence merely to obtain a desired route.

## Maintain a bounded cache batch

1. Inspect `python tools/evidence.py status`. Select the user's requested
   canonical IDs or a small batch. Gaps are a backlog, not an instruction to
   research the full catalog. Read only affected records with
   `python tools/evidence.py show --models ID [ID ...]` and retain the
   current `base_sha256`.
2. Investigate focused questions using primary model cards or attributed
   evaluation sources. Record publisher, URL, figure, benchmark/harness/settings
   and limitations. Different configurations can coexist without being comparable.
   If useful, delegate bounded source reading with `inspectionOnly:true`;
   keep capture and apply with the authorized writer.
3. Capture accepted public sources using
   `python tools/evidence.py capture --url https://...`. Retain its
   `capture_id`, timestamp and hash. Retrieval does not establish a claim.
4. Prepare a JSON batch under `.state/evidence/`: `base_sha256`,
   existing canonical `models` with partial patches, and `sources`
   with URL, `retrieved_at` and `capture_id`. Object fields merge;
   supplied arrays replace arrays, so preserve relevant existing values.
   Record `last_researched_at` for checked models, including unsuccessful
   searches. Exclude policy, scoring, aliases and unrelated model changes.
5. Apply with `python tools/evidence.py apply --batch .state/evidence/batch.json`.
   Stale bases, missing retrieval proof, duplicate keys and dangling references
   are rejected. Re-read affected IDs on a stale base; do not overwrite it.
6. Inspect accepted records and use the applicable `verify` / `review`
   guidance within the task's check constraints. Summarize changed IDs, evidence,
   review coverage and remaining gaps. Complete each batch before the next.

Use `web-research` / `fetch` for primary source retrieval and
`context7-mcp` when current API contracts matter. Source failures leave explicit
gaps; use current cached evidence rather than inventing capability. Discovery,
inference, account entitlement, measured performance and operational availability
are distinct. Preserve source/configuration uncertainty and the assigned budget;
no parent-model change or whole-catalog retry is part of this maintenance.
