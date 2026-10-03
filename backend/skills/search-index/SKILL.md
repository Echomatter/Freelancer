---
name: search-index
description: Search indexed project documents and data; check index freshness, refresh when needed, and return useful source locations and coverage limitations. Verify decisive claims against originals. Procedure for the current model, not a compulsory Researcher launch.
---

# Search Index

This skill teaches procedure and fallbacks only. It grants no write, paid-model, publication, or integration authority. Native permissions and assignment constraints remain authoritative. Delegation is never required by this skill.

Use the `content_index` tool for mixed project corpora (docs and data: Markdown/text, YAML, CSV/TSV, JSON/JSONL, XML, TOML/INI, DOCX, XLSX, PDF, safe ZIP members). The index is a locator, not source authority.

Call `content_index` with `operation=status`, `search`, `chats`, or the relevant source/fact operation. Use `operation=chats` to locate indexed OpenCode conversation text in the current project, optionally filtered by exact provider/model ID. Opening a current chat starts a background refresh; use Application settings → Content & Storage to refresh older chats. The chat index contains titles and user/assistant text, including workers and archived chats. It excludes tool output, reasoning, files, and drafts. Verify decisive results in the native conversation.

This skill does not spawn Researcher. Loading it from Researcher must not spawn another Researcher.

## When to use

- find-all / every-reference / inventory
- cross-document comparison or repeated values
- structured facts across heterogeneous files
- large mixed corpora where grep will miss formats

The index includes common source files for full-text location, but it is not a code-symbol or call-path analyzer. For code symbols and call paths, use native code search/grep/read, then read the decisive source. A missing or stale index hit must never block code search.

## Procedure

1. Use `operation=status` when freshness matters.
2. Rebuild only if missing/stale or a requested fact mode helps and native permissions and the assignment allow index maintenance. An explicit restriction on all writes means continue with native source search and report the missing coverage. Assignment labels do not grant maintenance authority.
3. Search exact names/phrases first; expand aliases deliberately.
4. Deduplicate source/locator hits.
5. Read the governing source before claims, edits, schemas, or numbers.

Rebuild modes: `none` (default), `general`, `special`, `both`. Do not rebuild every turn.

Search and chat results may return `nextCursor`. Continue only by repeating the
same query, filters, project scope and limit with that cursor. These pages read a
moving index, not a stable snapshot; recheck important results against originals.

INDEX != SOURCE. Rank != authority. Fact row != verified fact.

Keep the evidence order: local index/search → authoritative local source →
external technical documentation/web evidence when needed. Consider Context7 for
current library/API contracts and Fetch for original primary sources, missing
Context7 coverage or other web content. Neither is necessary for facts already
established locally; an unavailable service leaves native search/read usable.

The `knowledge` tool searches shared memories, claims and relations across
projects when prior decisions or source provenance help. Keep that search
separate from this project's file/chat index; combine results only by retaining
their source IDs and revision/boundary details. Check decisive claims against
the current original source. A missing source, disputed claim or metadata-only
pin is an explicit coverage gap, not a reason to infer missing content.
