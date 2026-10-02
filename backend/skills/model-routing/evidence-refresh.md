# Bounded evidence refresh

This skill teaches procedure and fallbacks only. It grants no write, paid-model,
publication, or integration authority. Native permissions, paid consent, user
constraints, and worker limits remain authoritative. Delegation is optional;
work directly unless a separate named agent materially helps.

Only run this when evidence maintenance is requested. Ordinary delegation uses
the cache. Work from the installed Freelancer backend root, not the project
being edited.

1. Use the app's native provider inventory if inventory needs refreshing.
   Discovery, source research, inference success and account entitlement are
   separate facts.
2. Run `python tools/evidence.py status`. Choose at most three canonical IDs
   (or the user's requested IDs). Gaps are a backlog, not a demand to research
   every model. Run `python tools/evidence.py show --models ID [ID ID]` for
   just those records and the current base_sha256; do not load the whole
   catalog into a child.
3. Work directly by default. When a separate reader materially helps, you may
   optionally delegate one bounded read-only investigation to a named agent
   from the current catalog (Researcher is a useful starting point) with
   `delegate({agent, task, inspectionOnly: true})`: IDs, relevant source keys,
   two or three questions, up to five source reads, and a compact claim table.
   Request URL, publisher, exact figure, benchmark/harness/settings,
   limitations and remaining gaps. Prefer provider model cards; accept
   attributed provider and reputable aggregator evaluations. Different
   harnesses can coexist without being directly comparable. Never delegate
   ceremonially and never require a second agent.
4. The parent (or the engineer doing this task) captures each accepted public
   source with `python tools/evidence.py capture --url https://...`. This
   saves retrieved bytes, URL, timestamp and hash locally and returns a
   capture_id. An optional read-only delegate must not run capture/apply or
   other mutating shell commands. Review source content before accepting
   claims. A download proves retrieval, not interpretation.
5. Prepare a small JSON batch under .state/evidence/: base_sha256, models
   (one to three existing canonical keys with partial patches), and sources
   (new or refreshed records with the capture's URL, retrieved_at and
   capture_id). Object fields merge; supplied arrays replace arrays, so retain
   relevant existing entries. Unchanged sources may be omitted. Record
   last_researched_at on checked models, including unsuccessful bounded
   searches. Preserve uncertainty. No policy, scoring, alias or
   unrelated-model changes belong in a batch.
6. Run `python tools/evidence.py apply --batch .state/evidence/batch.json`.
   Stale bases, missing retrieval proof, duplicate keys and dangling
   references are rejected without replacing the cache. Re-read only affected
   IDs if the base changed. Accepted batches checkpoint immediately; global
   freshness/readiness is unchanged.
7. When independent checking is useful, optionally ask for a report-only
   review with `delegate({agent, task, independentReview: true})` covering
   only this batch's claims against its sources, not the entire catalog. Then
   run `python tools/evidence.py validate` and relevant regressions, record
   validated outcomes using actual receipts, and summarize accepted IDs,
   review coverage and remaining gaps. No second writer and no mandatory
   review stage.

For broad refreshes, finish each batch before starting the next. Stop at the
assigned batch budget and return a resume list rather than retrying a
whole-catalog worker. Provider failures belong to availability; timeouts are
not model-quality judgments. Keep usage estimates, subscription allocation
and cash charges distinct. No model reweighting or parent-model switch is
part of this flow.

Consider Fetch for primary model cards or evaluation sources and Context7 when
current SDK/API documentation matters. These retrieval options complement the
existing evidence capture; they do not replace it or establish measured model
performance. If unavailable, use native web retrieval or cached sources and
preserve uncertainty. No extra capability call is required for an evidence batch.

Required capabilities: shell/python evidence tooling where enabled. Fallback:
if the tooling or a source is unavailable, record the gap with its reason and
continue with cached evidence; do not invent capability or bypass limits.
