# Bounded evidence refresh

Only run this when evidence maintenance is requested. Ordinary delegation uses the
cache. Work from the installed Freelancer backend root, not the project being edited.

1. Use the app's native provider inventory if inventory needs refreshing. Discovery,
   source research, inference success and account entitlement are separate facts.
2. Run `python tools/evidence.py status`. Choose at most three canonical IDs (or the
   user's requested IDs). Gaps are a backlog, not a demand to research every model.
   Run `python tools/evidence.py show --models ID [ID ID]` for just those records and
   the current base_sha256; do not load the whole catalog into a child.
3. Delegate a read-only Researcher assignment: IDs, relevant source keys, two or
   three questions, up to five source reads, and a compact claim table. Request URL,
   publisher, exact figure, benchmark/harness/settings, limitations and remaining gaps.
   Prefer provider model cards; accept attributed provider and reputable aggregator
   evaluations. Different harnesses can coexist without being directly comparable.
4. Build captures each accepted public source with
   `python tools/evidence.py capture --url https://...`. This saves retrieved bytes,
   URL, timestamp and hash locally and returns a capture_id. Researcher must not run capture/apply or other mutating shell commands;
   the parent owns capture/integration. Review source content
   before accepting claims. A download proves retrieval, not interpretation.
5. Build prepares a small JSON batch under .state/evidence/: base_sha256, models
   (one to three existing canonical keys with partial patches), and sources (new or
   refreshed records with the capture's URL, retrieved_at and capture_id). Object
   fields merge; supplied arrays replace arrays, so retain relevant existing entries.
   Unchanged sources may be omitted. Record last_researched_at on checked models,
   including unsuccessful bounded searches. Preserve uncertainty. No policy,
   scoring, alias or unrelated-model changes belong in a batch.
6. Run `python tools/evidence.py apply --batch .state/evidence/batch.json`. Stale
   bases, missing retrieval proof, duplicate keys and dangling references are rejected
   without replacing the cache. Re-read only affected IDs if the base changed.
   Accepted batches checkpoint immediately; global freshness/readiness is unchanged.
7. Ask a free independent Review to check this batch's claims against its sources,
   not to certify the entire catalog. Build runs `python tools/evidence.py validate`
   and relevant regressions, records validated outcomes using actual receipts, and
   summarizes accepted IDs, review coverage and remaining gaps. No second writer.

For broad refreshes, finish each batch before starting the next. Stop at the assigned
batch budget and return a resume list rather than retrying a whole-catalog Worker.
Provider failures belong to availability; timeouts are not model-quality judgments.
Keep usage estimates, subscription allocation and cash charges distinct. No model
reweighting or parent-model switch is part of this flow.
