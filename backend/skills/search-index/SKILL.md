---
name: search-index
description: Search indexed project documents and data; check index freshness, refresh when needed, and return useful source locations and coverage limitations. Verify decisive claims against originals. Procedure for the current model, not a compulsory Researcher launch.
---

# Search Index

This skill teaches procedure and fallbacks only. It grants no write, paid-model, publication, or integration authority. Native permissions and assignment constraints remain authoritative. Delegation is never required by this skill.

Use the `content_index` tool for mixed project corpora (docs and data: Markdown/text, YAML, CSV/TSV, JSON/JSONL, XML, TOML/INI, DOCX, XLSX, PDF, safe ZIP members). The index is a locator, not source authority.

Use `content_index` with `operation=chats` to locate indexed OpenCode conversation text in the current project, optionally filtered by exact provider/model ID. Current chats refresh when opened in Freelancer; use Application settings → Content & Storage to refresh older chats. The chat index contains titles and user/assistant text, including workers and archived chats. It excludes tool output, reasoning, files, and drafts. Verify decisive results in the native conversation.

This skill does not spawn Researcher. Loading it from Researcher must not spawn another Researcher.

## When to use

- find-all / every-reference / inventory
- cross-document comparison or repeated values
- structured facts across heterogeneous files
- large mixed corpora where grep will miss formats

For code symbols and call paths, use native code search/grep/read. A missing index hit must never block code search. Source extensions such as `.ts`, `.ps1`, and `.py` are not indexed.

## Procedure

1. `content_index status` when freshness matters.
2. Rebuild only if missing/stale or a requested fact mode helps and native permissions and the assignment allow index maintenance. An explicit restriction on all writes means continue with native source search and report the missing coverage. Assignment labels do not grant maintenance authority.
3. Search exact names/phrases first; expand aliases deliberately.
4. Deduplicate source/locator hits.
5. Read the governing source before claims, edits, schemas, or numbers.

Rebuild modes: `none` (default), `general`, `special`, `both`. Do not rebuild every turn.

An explicit index rebuild may trigger a lightweight model-inventory/quota freshness check through existing routing scripts. That is not a full model-research pass and must not recurse.

INDEX != SOURCE. Rank != authority. Fact row != verified fact.


The `knowledge` tool searches shared memories, claims and relations across
projects when prior decisions or source provenance help. Keep that search
separate from this project's file/chat index; combine results only by retaining
their source IDs and revision/boundary details. Check decisive claims against
the current original source. A missing source, disputed claim or metadata-only
pin is an explicit coverage gap, not a reason to infer missing content.
