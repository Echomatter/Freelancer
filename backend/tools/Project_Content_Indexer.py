#!/usr/bin/env python3
"""Project Content Indexer.

A deterministic SQLite/FTS5 retrieval layer for mixed project corpora stored
inside the Freelancer application database. One script builds, refreshes,
queries, and inspects one project-scoped index.

The index is a locator and analysis aid, not source authority.

Supported source types:
  text/code:  .md .txt .rst .log .yaml .yml and common source/config files
  tabular:    .csv .tsv
  structured: .json .jsonl .ndjson .xml .backup .toml .ini .cfg
  office:     .docx .xlsx
  paged:      .pdf (requires pdftotext; optional OCR fallback)
  archives:   .zip (supported members are indexed as virtual sources)

Examples (normally invoked through the Freelancer content_index tool):
  python Project_Content_Indexer.py --db freelancer.sqlite --project-key PROJECT rebuild --root . --facts none
  python Project_Content_Indexer.py --db freelancer.sqlite --project-key PROJECT status --root .
  python Project_Content_Indexer.py --db freelancer.sqlite --project-key PROJECT search 'authentication token' --phrase
  python Project_Content_Indexer.py --db freelancer.sqlite --project-key PROJECT facts --stats

Python dependencies: standard library only.
Optional external tools for PDFs: pdftotext; pdftoppm+tesseract for --ocr.
"""
from __future__ import annotations

import argparse
import collections
import configparser
import csv
import datetime as dt
import hashlib
import io
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Any, Iterable, Iterator, Mapping, Sequence

SCHEMA_VERSION = "3.0"
DEFAULT_DB = "freelancer.sqlite"

TEXT_EXTS = {
    ".md", ".txt", ".rst", ".log", ".yaml", ".yml",
    ".py", ".pyi", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx",
    ".css", ".scss", ".less", ".html", ".htm", ".svg",
    ".sh", ".ps1", ".psm1", ".psd1", ".bat", ".cmd",
    ".rs", ".go", ".c", ".h", ".cc", ".cpp", ".hpp",
    ".java", ".kt", ".swift", ".rb", ".php", ".sql",
    ".vue", ".svelte", ".lua", ".r", ".jl", ".ipynb",
}
TABULAR_EXTS = {".csv", ".tsv"}
STRUCTURED_EXTS = {".json", ".jsonl", ".ndjson", ".xml", ".backup", ".toml", ".ini", ".cfg"}
OFFICE_EXTS = {".docx", ".xlsx"}
PAGED_EXTS = {".pdf"}
ARCHIVE_EXTS = {".zip"}
SUPPORTED_EXTS = TEXT_EXTS | TABULAR_EXTS | STRUCTURED_EXTS | OFFICE_EXTS | PAGED_EXTS | ARCHIVE_EXTS
ZIP_MEMBER_EXTS = SUPPORTED_EXTS - ARCHIVE_EXTS

IGNORED_DIRS = {
    ".git", ".state", ".content-index", ".venv", "venv", "env", "node_modules", ".qa",
    "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache",
    "dist", "build", "coverage", ".next", ".runtime",
}
SOURCE_NAMES = {"dockerfile", "makefile", "license", "procfile", ".gitignore", ".gitattributes", ".editorconfig"}
PRIVATE_NAMES = {".npmrc", ".netrc", "credentials.json", "auth.json", "id_rsa", "id_ed25519"}
TOOLING_NAMES = {
    "project_content_index.sqlite",
    "project_content_index.sqlite.building",
    "project_content_index_build.json",
    "index_build_summary.json",
    "index_rebuild_output.json",
}

# Safety / performance budgets. They are deliberately conservative so a malformed
# data file cannot turn a routine rebuild into an unbounded job.
MAX_IN_MEMORY_BYTES = 128 * 1024 * 1024
MAX_AUTO_TEXT_BYTES = 16 * 1024 * 1024
MAX_UNIT_INDEX_CHARS = 256 * 1024
MAX_SOURCE_INDEX_CHARS = 2 * 1024 * 1024
MAX_ZIP_MEMBERS = 5000
MAX_ZIP_MEMBER_BYTES = 64 * 1024 * 1024
MAX_ZIP_TOTAL_BYTES = 512 * 1024 * 1024
MAX_ZIP_COMPRESSION_RATIO = 250.0
MAX_UNITS_PER_SOURCE = 50_000
MAX_STRUCTURED_LEAVES = 500_000
MAX_FACT_FIELDS_RETAINED = 75_000
MAX_FACTS_PER_UNIT = 500
MAX_FACTS_PER_SOURCE = 25_000
MAX_FACTS_TOTAL = 250_000
MAX_SCALAR_INDEX_CHARS = 20_000
MAX_SCALAR_FACT_CHARS = 2_000
MAX_SPECIAL_MATCHES_PER_UNIT = 50
MAX_JSONL_LINES = 500_000
MAX_CSV_ROWS = 500_000
MAX_TABLE_COLUMNS = 128
MAX_OCR_PAGES = 200

COMMON_FAMILY_ALIASES = {
    "name": "identity", "title": "identity", "model": "identity", "id": "identity",
    "identifier": "identity", "type": "identity", "category": "identity", "kind": "identity",
    "version": "version", "revision": "version", "schema version": "version",
    "status": "status", "state": "status", "role": "role", "source": "source",
    "date": "date", "created": "date", "updated": "date", "modified": "date", "year": "date",
    "level": "level", "character level": "level", "cr": "challenge_rating", "challenge rating": "challenge_rating",
    "ac": "armor_class", "armor class": "armor_class", "hp": "hit_points", "hit points": "hit_points",
    "health": "hit_points", "speed": "speed", "range": "range", "damage": "damage",
    "payload": "payload", "rate of fire": "rate_of_fire", "cost": "cost", "price": "cost",
    "weight": "weight", "capacity": "capacity", "population": "population",
    "duration": "duration", "power system": "power_system", "crew": "crew", "size": "size",
}


@dataclass(frozen=True)
class SpecialRule:
    family: str
    pattern_text: str
    pattern: re.Pattern[str]


@dataclass
class FactPolicy:
    mode: str = "none"
    special_rules: list[SpecialRule] = field(default_factory=list)
    retained_structured_fields: int = 0
    structured_fields_dropped: int = 0

    @property
    def general(self) -> bool:
        return self.mode in {"general", "both"}

    @property
    def special(self) -> bool:
        return self.mode in {"special", "both"} and bool(self.special_rules)

    def matching_special_families(self, label: str, path: str = "") -> list[str]:
        if not self.special:
            return []
        target = f"{path}\n{label}"
        return [r.family for r in self.special_rules if r.pattern.search(target)]

    def keep_structured_field(self, label: str, path: str) -> bool:
        special_match = bool(self.matching_special_families(label, path))
        # Positional array indexes are useful search text but poor generic facts.
        # Keep them only when a request-specific special rule explicitly targets the path.
        if label.isdigit() and not special_match:
            return False
        wanted = self.general or special_match
        if not wanted:
            return False
        if self.retained_structured_fields >= MAX_FACT_FIELDS_RETAINED:
            self.structured_fields_dropped += 1
            return False
        self.retained_structured_fields += 1
        return True


@dataclass
class BuildBudget:
    facts_total: int = 0
    facts_dropped_total: int = 0
    facts_dropped_by_source: collections.Counter[str] = field(default_factory=collections.Counter)


@dataclass
class TraversalBudget:
    leaves_seen: int = 0
    units_emitted: int = 0
    truncated: bool = False


def eprint(*args: Any) -> None:
    print(*args, file=sys.stderr)


def now_utc() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()


def count_words(text: str) -> int:
    return len(re.findall(r"\b[\w'’.-]+\b", text, flags=re.UNICODE))


def normalize_text(text: str) -> str:
    text = text.replace("\x00", "").replace("\u00ad", "").replace("\ufffd", "")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"[ \t]+$", "", line) for line in text.splitlines()]
    out: list[str] = []
    blank = 0
    for line in lines:
        if line.strip():
            blank = 0
            out.append(line)
        else:
            blank += 1
            if blank <= 2:
                out.append("")
    return "\n".join(out).strip()


def safe_decode(data: bytes) -> str:
    if data.startswith(b"\xef\xbb\xbf"):
        return data.decode("utf-8-sig", errors="replace")
    if data.startswith((b"\xff\xfe\x00\x00", b"\x00\x00\xfe\xff")):
        return data.decode("utf-32", errors="replace")
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16", errors="replace")
    for enc in ("utf-8", "cp1252", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def slug(text: str, fallback: str = "field") -> str:
    s = re.sub(r"[^a-z0-9]+", "_", text.casefold()).strip("_")
    return (s[:64] or fallback)


def canonical_family(label: str) -> str:
    key = re.sub(r"\s+", " ", label.casefold().strip(" .:_-"))
    return COMMON_FAMILY_ALIASES.get(key, slug(key))


def looks_binary_like_string(value: str) -> bool:
    s = value.strip()
    if not s:
        return False
    if s.casefold().startswith("data:") and ";base64," in s[:200].casefold():
        return True
    if len(s) >= 1024 and not re.search(r"\s", s):
        base64ish = sum(ch.isalnum() or ch in "+/=_-" for ch in s) / max(1, len(s))
        if base64ish > 0.96:
            return True
    return False


def scalar_to_text(value: Any) -> tuple[str, bool]:
    if value is None:
        return "null", True
    if isinstance(value, bool):
        return "true" if value else "false", True
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
            return str(value), False
        return str(value), True
    s = normalize_text(str(value))
    if looks_binary_like_string(s):
        return f"[binary-like data omitted: {len(s)} chars]", False
    fact_ok = len(s) <= MAX_SCALAR_FACT_CHARS
    if len(s) > MAX_SCALAR_INDEX_CHARS:
        s = s[:MAX_SCALAR_INDEX_CHARS] + f" … [truncated {len(s) - MAX_SCALAR_INDEX_CHARS} chars]"
    return s, fact_ok


def parse_numeric_scalar(value: str) -> tuple[float | None, str]:
    s = value.strip()
    if not s or len(s) > 100:
        return None, ""
    m = re.fullmatch(
        r"\s*([\$€£])?\s*(-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?)\s*(%|[A-Za-z][A-Za-z0-9 ./_-]{0,24})?\s*",
        s,
    )
    if not m:
        return None, ""
    try:
        number = float(m.group(2).replace(",", ""))
    except ValueError:
        return None, ""
    unit = (m.group(1) or m.group(3) or "").strip().casefold()
    # Dice expressions such as 4D6 are not scalar measurements and must not
    # contaminate numeric aggregates.
    if re.fullmatch(r"d\d+", unit):
        return None, ""
    return number, unit


def relpath(path: Path, root: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def is_tooling(path: Path, root: Path) -> bool:
    try:
        rp = path.resolve().relative_to(root.resolve())
    except ValueError:
        return True
    if any(part.casefold() in IGNORED_DIRS for part in rp.parts[:-1]):
        return True
    name = path.name.casefold()
    if name in TOOLING_NAMES:
        return True
    if name.endswith(".sqlite") or name.endswith(".sqlite.building"):
        return True
    if name.startswith(".env") or name in PRIVATE_NAMES or path.as_posix().casefold().endswith("/.opencode/freelancer.json"):
        return True
    return False


def looks_like_text(path: Path) -> bool:
    try:
        if path.stat().st_size > MAX_AUTO_TEXT_BYTES:
            return False
        with path.open("rb") as source:
            sample = source.read(8192)
    except OSError:
        return False
    if b"\x00" in sample or any(byte < 32 and byte not in (9, 10, 13) for byte in sample):
        return False
    try:
        sample.decode("utf-8")
        return True
    except UnicodeDecodeError:
        return False


def discover_files(root: Path) -> list[Path]:
    found: list[Path] = []
    for directory, dirs, names in os.walk(root, followlinks=False):
        dirs[:] = [name for name in dirs if name.casefold() not in IGNORED_DIRS and not (Path(directory) / name).is_symlink()]
        for name in names:
            p = Path(directory) / name
            if p.is_symlink() or not p.is_file() or is_tooling(p, root):
                continue
            if p.suffix.casefold() in SUPPORTED_EXTS or name.casefold() in SOURCE_NAMES or looks_like_text(p):
                found.append(p)
    return sorted(found, key=lambda p: relpath(p, root).casefold())


def infer_routing(path_or_virtual: str) -> tuple[str, str, int]:
    """Return role, status, routing rank. These are hints, never authority."""
    low = path_or_virtual.casefold().replace("\\", "/")
    parts = set(PurePosixPath(low.split("!", 1)[0]).parts)
    if parts & {"archive", "archives", "backup", "backups", "legacy", "old", "history"} or any(
        x in low for x in ("superseded", "deprecated", ".backup")
    ):
        return "project_archive", "archive", 10
    if parts & {"governance", "current", "canonical"} or any(x in low for x in ("/final", "_final", "_current")):
        return "current_project_source", "current", 80
    if parts & {"reference", "references", "rules", "sources"}:
        return "reference_source", "reference", 50
    return "project_source", "source", 35


def extract_heading_hint(text: str) -> str:
    for raw in text.splitlines()[:30]:
        s = raw.strip()
        if not s:
            continue
        s = re.sub(r"^#{1,6}\s+", "", s)
        if 2 <= len(s) <= 140:
            return s
    return ""


def split_logical_units(text: str, *, prefix: str = "logical", target_words: int = 750, max_words: int = 1100) -> list[dict[str, Any]]:
    text = normalize_text(text)
    if not text:
        return [{"locator": f"{prefix}:1", "heading": "", "text": "", "fields": []}]
    blocks = re.split(r"\n\s*\n", text)
    units: list[dict[str, Any]] = []
    buf: list[str] = []
    words = 0
    heading = ""

    def flush() -> None:
        nonlocal buf, words, heading
        if not buf:
            return
        body = "\n\n".join(buf).strip()
        if body:
            units.append({"locator": f"{prefix}:{len(units)+1}", "heading": heading, "text": body, "fields": []})
        buf, words, heading = [], 0, ""

    for block in blocks:
        b = block.strip()
        if not b:
            continue
        first = b.splitlines()[0].strip()
        is_heading = bool(re.match(r"^#{1,6}\s+", first)) or (
            len(first) <= 120 and len(first.split()) <= 14 and not first.endswith((".", ",", ";")) and
            (first.isupper() or bool(re.match(r"^(chapter|appendix|part|section)\b", first, re.I)))
        )
        bw = count_words(b)
        if buf and (words >= target_words or (is_heading and words >= 250) or words + bw > max_words):
            flush()
        if is_heading and not heading:
            heading = re.sub(r"^#{1,6}\s+", "", first)[:300]
        buf.append(b)
        words += bw
        if words >= max_words:
            flush()
    flush()
    return units or [{"locator": f"{prefix}:1", "heading": "", "text": text, "fields": []}]


def json_path(parent: str, key: Any) -> str:
    if isinstance(key, int):
        return f"{parent}[{key}]"
    s = str(key)
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]*", s):
        return f"{parent}.{s}"
    return f"{parent}[{json.dumps(s, ensure_ascii=False)}]"


def structured_leaf_iter(obj: Any, base_path: str, budget: TraversalBudget, depth: int = 0) -> Iterator[tuple[str, str, str, bool]]:
    if budget.leaves_seen >= MAX_STRUCTURED_LEAVES:
        budget.truncated = True
        return
    if depth > 50:
        budget.truncated = True
        yield base_path, "depth_limit", "[maximum nesting depth reached]", False
        return
    if isinstance(obj, Mapping):
        if not obj:
            budget.leaves_seen += 1
            yield base_path, "object", "{}", False
            return
        for key, value in obj.items():
            yield from structured_leaf_iter(value, json_path(base_path, key), budget, depth + 1)
            if budget.leaves_seen >= MAX_STRUCTURED_LEAVES:
                budget.truncated = True
                return
        return
    if isinstance(obj, (list, tuple)):
        if not obj:
            budget.leaves_seen += 1
            yield base_path, "list", "[]", False
            return
        for i, value in enumerate(obj):
            yield from structured_leaf_iter(value, json_path(base_path, i), budget, depth + 1)
            if budget.leaves_seen >= MAX_STRUCTURED_LEAVES:
                budget.truncated = True
                return
        return
    budget.leaves_seen += 1
    label_match = re.search(r"(?:\.([^.[\]]+)|\[\"([^\"]+)\"\]|\[(\d+)\])$", base_path)
    label = next((g for g in (label_match.groups() if label_match else ()) if g is not None), "value")
    text, fact_ok = scalar_to_text(obj)
    yield base_path, str(label), text, fact_ok


def heading_from_record(obj: Any, fallback: str) -> str:
    if isinstance(obj, Mapping):
        for key in ("name", "title", "model", "id", "identifier", "slug", "key"):
            for actual, value in obj.items():
                if str(actual).casefold() == key and not isinstance(value, (dict, list, tuple)):
                    txt, _ = scalar_to_text(value)
                    if txt and len(txt) <= 180:
                        return txt
    return fallback[:180]


def record_roots(obj: Any, prefix: str) -> Iterator[tuple[str, Any]]:
    """Choose useful record boundaries without duplicating top-level compound content."""
    if isinstance(obj, Mapping):
        compound = [(k, v) for k, v in obj.items() if isinstance(v, (Mapping, list, tuple))]
        scalars = {k: v for k, v in obj.items() if not isinstance(v, (Mapping, list, tuple))}
        if not compound:
            yield prefix, obj
            return
        if scalars:
            yield prefix, scalars
        for key, value in compound:
            p = json_path(prefix, key)
            if isinstance(value, (list, tuple)):
                if value and all(not isinstance(x, (Mapping, list, tuple)) for x in value):
                    for start in range(0, len(value), 200):
                        end = min(len(value), start + 200)
                        yield f"{p}[{start}:{end-1}]", list(value[start:end])
                else:
                    for i, item in enumerate(value):
                        yield json_path(p, i), item
            else:
                yield p, value
        return
    if isinstance(obj, (list, tuple)):
        if obj and all(not isinstance(x, (Mapping, list, tuple)) for x in obj):
            for start in range(0, len(obj), 200):
                end = min(len(obj), start + 200)
                yield f"{prefix}[{start}:{end-1}]", list(obj[start:end])
        else:
            for i, item in enumerate(obj):
                yield json_path(prefix, i), item
        return
    yield prefix, obj


def record_to_units(record_path: str, obj: Any, locator_prefix: str, policy: FactPolicy, budget: TraversalBudget) -> list[dict[str, Any]]:
    if budget.units_emitted >= MAX_UNITS_PER_SOURCE:
        budget.truncated = True
        return []
    heading = heading_from_record(obj, record_path)
    units: list[dict[str, Any]] = []
    lines: list[str] = []
    fields: list[dict[str, Any]] = []
    words = 0
    part = 1

    def flush() -> None:
        nonlocal lines, fields, words, part
        if not lines:
            return
        if budget.units_emitted >= MAX_UNITS_PER_SOURCE:
            budget.truncated = True
            lines, fields, words = [], [], 0
            return
        locator = f"{locator_prefix}:{record_path}"
        if part > 1:
            locator += f"#part={part}"
        units.append({"locator": locator[:500], "heading": heading, "text": normalize_text("\n".join(lines)), "fields": fields})
        budget.units_emitted += 1
        part += 1
        lines, fields, words = [], [], 0

    for path, label, value, fact_ok in structured_leaf_iter(obj, record_path, budget):
        line = f"{path}: {value}"
        lw = count_words(line)
        if lines and (words + lw > 950 or len(lines) >= 250):
            flush()
            if budget.truncated and budget.units_emitted >= MAX_UNITS_PER_SOURCE:
                break
        lines.append(line)
        words += lw
        if fact_ok and policy.keep_structured_field(label, path):
            fields.append({"label": label, "value": value, "path": path, "confidence": 0.98})
    flush()
    return units


def structured_object_to_units(obj: Any, *, locator_prefix: str, root_path: str, policy: FactPolicy) -> tuple[list[dict[str, Any]], list[str]]:
    budget = TraversalBudget()
    units: list[dict[str, Any]] = []
    for record_path, record in record_roots(obj, root_path):
        units.extend(record_to_units(record_path, record, locator_prefix, policy, budget))
        if budget.units_emitted >= MAX_UNITS_PER_SOURCE or budget.leaves_seen >= MAX_STRUCTURED_LEAVES:
            budget.truncated = True
            break
    warnings: list[str] = []
    if budget.truncated:
        warnings.append(
            f"structured extraction truncated at {budget.units_emitted:,} units / {budget.leaves_seen:,} scalar leaves"
        )
    if policy.structured_fields_dropped:
        warnings.append(f"structured fact-field retention capped; dropped {policy.structured_fields_dropped:,} candidate fields")
    return units or [{"locator": f"{locator_prefix}:{root_path}", "heading": "", "text": "", "fields": []}], warnings


def extract_json_bytes(data: bytes, policy: FactPolicy) -> tuple[list[dict[str, Any]], str, list[str]]:
    text = safe_decode(data)
    try:
        obj = json.loads(text)
    except Exception as exc:
        units = split_logical_units(text, prefix="json-fallback")
        return units, "json-invalid-text-fallback", [f"JSON parse failed; indexed as text: {exc}"]
    units, warnings = structured_object_to_units(obj, locator_prefix="json", root_path="$", policy=policy)
    return units, "json-structured", warnings


def extract_jsonl_bytes(data: bytes, policy: FactPolicy) -> tuple[list[dict[str, Any]], str, list[str]]:
    text = safe_decode(data)
    units: list[dict[str, Any]] = []
    warnings: list[str] = []
    invalid = 0
    line_count = 0
    for line_no, raw in enumerate(text.splitlines(), start=1):
        if line_no > MAX_JSONL_LINES:
            warnings.append(f"JSONL truncated after {MAX_JSONL_LINES:,} lines")
            break
        line = raw.strip()
        if not line:
            continue
        line_count += 1
        try:
            obj = json.loads(line)
        except Exception:
            invalid += 1
            if len(units) < MAX_UNITS_PER_SOURCE:
                units.append({
                    "locator": f"jsonl:line:{line_no}", "heading": "invalid JSON line",
                    "text": normalize_text(line[:MAX_SCALAR_INDEX_CHARS]), "fields": [],
                })
            continue
        if len(units) >= MAX_UNITS_PER_SOURCE:
            warnings.append(f"JSONL unit cap reached at {MAX_UNITS_PER_SOURCE:,} units")
            break
        ub, uw = structured_object_to_units(obj, locator_prefix="jsonl", root_path=f"$line[{line_no}]", policy=policy)
        units.extend(ub[: max(0, MAX_UNITS_PER_SOURCE - len(units))])
        warnings.extend(uw)
    if invalid:
        warnings.append(f"{invalid:,} invalid JSONL/NDJSON lines were isolated instead of aborting the source")
    if line_count == 0:
        units = [{"locator": "jsonl:empty", "heading": "", "text": "", "fields": []}]
    return units, "jsonl-structured", warnings


def local_tag(tag: str) -> str:
    return tag.split("}")[-1]


def xml_subtree_to_obj(elem: ET.Element, node_budget: list[int], depth: int = 0) -> Any:
    if node_budget[0] >= MAX_STRUCTURED_LEAVES or depth > 50:
        return "[xml traversal limit reached]"
    node_budget[0] += 1
    children = list(elem)
    attrs = {f"@{local_tag(k)}": v for k, v in elem.attrib.items()}
    text = (elem.text or "").strip()
    if not children:
        if attrs:
            if text:
                attrs["#text"] = text
            return attrs
        return text
    out: dict[str, Any] = dict(attrs)
    if text:
        out["#text"] = text
    grouped: dict[str, list[Any]] = collections.defaultdict(list)
    for child in children:
        grouped[local_tag(child.tag)].append(xml_subtree_to_obj(child, node_budget, depth + 1))
    for tag, values in grouped.items():
        out[tag] = values[0] if len(values) == 1 else values
    return out


def extract_xml_bytes(data: bytes, policy: FactPolicy) -> tuple[list[dict[str, Any]], str, list[str]]:
    try:
        root = ET.fromstring(data)
    except Exception as exc:
        text = safe_decode(data)
        return split_logical_units(text, prefix="xml-fallback"), "xml-invalid-text-fallback", [f"XML parse failed; indexed as text: {exc}"]
    root_tag = local_tag(root.tag)
    children = list(root)
    units: list[dict[str, Any]] = []
    warnings: list[str] = []
    node_budget = [0]
    if len(children) > 1:
        counts: collections.Counter[str] = collections.Counter()
        for child in children:
            tag = local_tag(child.tag)
            counts[tag] += 1
            path = f"/{root_tag}/{tag}[{counts[tag]}]"
            obj = xml_subtree_to_obj(child, node_budget)
            sub, uw = structured_object_to_units(obj, locator_prefix="xml", root_path=path, policy=policy)
            units.extend(sub[: max(0, MAX_UNITS_PER_SOURCE - len(units))])
            warnings.extend(uw)
            if len(units) >= MAX_UNITS_PER_SOURCE or node_budget[0] >= MAX_STRUCTURED_LEAVES:
                warnings.append("XML extraction hit configured traversal/unit cap")
                break
    else:
        obj = xml_subtree_to_obj(root, node_budget)
        units, uw = structured_object_to_units(obj, locator_prefix="xml", root_path=f"/{root_tag}", policy=policy)
        warnings.extend(uw)
    return units, "xml-structured", warnings


def extract_toml_bytes(data: bytes, policy: FactPolicy) -> tuple[list[dict[str, Any]], str, list[str]]:
    text = safe_decode(data)
    try:
        import tomllib  # Python 3.11+
        obj = tomllib.loads(text)
    except Exception as exc:
        return split_logical_units(text, prefix="toml-fallback"), "toml-text-fallback", [f"TOML structured parse unavailable/failed: {exc}"]
    units, warnings = structured_object_to_units(obj, locator_prefix="toml", root_path="$", policy=policy)
    return units, "toml-structured", warnings


def extract_ini_bytes(data: bytes, policy: FactPolicy) -> tuple[list[dict[str, Any]], str, list[str]]:
    text = safe_decode(data)
    parser = configparser.ConfigParser(interpolation=None, strict=False)
    parser.optionxform = str
    try:
        parser.read_string(text)
    except Exception as exc:
        return split_logical_units(text, prefix="ini-fallback"), "ini-text-fallback", [f"INI/CFG parse failed; indexed as text: {exc}"]
    obj: dict[str, Any] = {}
    if parser.defaults():
        obj["DEFAULT"] = dict(parser.defaults())
    for section in parser.sections():
        obj[section] = dict(parser.items(section, raw=True))
    units, warnings = structured_object_to_units(obj, locator_prefix="ini", root_path="$", policy=policy)
    return units, "ini-structured", warnings


def unique_headers(row: Sequence[str]) -> list[str]:
    seen: collections.Counter[str] = collections.Counter()
    out: list[str] = []
    for i, raw in enumerate(row[:MAX_TABLE_COLUMNS], start=1):
        base = normalize_text(str(raw)).strip() or f"column_{i}"
        base = base[:120]
        seen[base.casefold()] += 1
        out.append(base if seen[base.casefold()] == 1 else f"{base}_{seen[base.casefold()]}")
    return out


def extract_delimited_bytes(data: bytes, ext: str, policy: FactPolicy) -> tuple[list[dict[str, Any]], str, list[str]]:
    text = safe_decode(data)
    warnings: list[str] = []
    delimiter = "\t" if ext == ".tsv" else ","
    if ext == ".csv":
        try:
            delimiter = csv.Sniffer().sniff(text[:64_000], delimiters=",\t;|").delimiter
        except Exception:
            delimiter = ","
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    try:
        first = next(reader)
    except StopIteration:
        return [{"locator": "rows:empty", "heading": "", "text": "", "fields": []}], "delimited-rows", warnings
    headers = unique_headers(first)
    units: list[dict[str, Any]] = []
    window_lines: list[str] = []
    window_fields: list[dict[str, Any]] = []
    start_row = end_row = 2
    words = 0

    def flush() -> None:
        nonlocal window_lines, window_fields, start_row, end_row, words
        if not window_lines:
            return
        units.append({
            "locator": f"rows:{start_row}-{end_row}", "heading": " | ".join(headers[:6]),
            "text": normalize_text("\n".join(window_lines)), "fields": window_fields,
        })
        window_lines, window_fields, words = [], [], 0

    for row_no, row in enumerate(reader, start=2):
        if row_no > MAX_CSV_ROWS + 1:
            warnings.append(f"delimited source truncated after {MAX_CSV_ROWS:,} data rows")
            break
        if len(units) >= MAX_UNITS_PER_SOURCE:
            warnings.append(f"unit cap reached at {MAX_UNITS_PER_SOURCE:,}")
            break
        vals = list(row[:MAX_TABLE_COLUMNS])
        pairs: list[str] = []
        row_fields: list[dict[str, Any]] = []
        for i, raw in enumerate(vals):
            value, fact_ok = scalar_to_text(raw)
            if not value:
                continue
            label = headers[i] if i < len(headers) else f"column_{i+1}"
            path = f"row[{row_no}].{label}"
            pairs.append(f"{label}={value}")
            if fact_ok and policy.keep_structured_field(label, path):
                row_fields.append({"label": label, "value": value, "path": path, "confidence": 0.96})
        line = f"R{row_no}\t" + "\t".join(pairs)
        lw = count_words(line)
        if window_lines and (len(window_lines) >= 80 or words + lw > 950):
            flush()
            start_row = row_no
        if not window_lines:
            start_row = row_no
        end_row = row_no
        window_lines.append(line)
        window_fields.extend(row_fields)
        words += lw
    flush()
    if len(first) > MAX_TABLE_COLUMNS:
        warnings.append(f"columns capped at {MAX_TABLE_COLUMNS}")
    return units or [{"locator": "rows:header-only", "heading": " | ".join(headers[:6]), "text": "\t".join(headers), "fields": []}], "delimited-rows", warnings


def extract_docx_bytes(data: bytes, policy: FactPolicy) -> tuple[list[dict[str, Any]], str, list[str]]:
    del policy
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        xml = zf.read("word/document.xml")
    root = ET.fromstring(xml)
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    body = root.find(".//w:body", ns)
    blocks: list[str] = []
    if body is not None:
        for child in list(body):
            tag = local_tag(child.tag)
            if tag == "p":
                texts = [t.text or "" for t in child.findall(".//w:t", ns)]
                para = "".join(texts).strip()
                if not para:
                    continue
                style_el = child.find("./w:pPr/w:pStyle", ns)
                style = style_el.attrib.get(f"{{{ns['w']}}}val", "") if style_el is not None else ""
                blocks.append(f"## {para}" if style.casefold().startswith("heading") else para)
            elif tag == "tbl":
                for tr in child.findall(".//w:tr", ns):
                    cells: list[str] = []
                    for tc in tr.findall("./w:tc", ns):
                        txt = " ".join((t.text or "") for t in tc.findall(".//w:t", ns)).strip()
                        cells.append(txt)
                    if any(cells):
                        blocks.append(" | ".join(cells))
    text = "\n\n".join(blocks)
    return split_logical_units(text, prefix="docx"), "docx-xml-logical", []


def excel_col_num(ref: str) -> int:
    m = re.match(r"([A-Za-z]+)", ref)
    if not m:
        return 1
    n = 0
    for ch in m.group(1).upper():
        n = n * 26 + (ord(ch) - 64)
    return max(1, n)


def extract_xlsx_bytes(data: bytes, policy: FactPolicy) -> tuple[list[dict[str, Any]], str, list[str]]:
    warnings: list[str] = []
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        names = set(zf.namelist())
        if "xl/workbook.xml" not in names:
            raise RuntimeError("invalid XLSX: xl/workbook.xml missing")
        shared: list[str] = []
        if "xl/sharedStrings.xml" in names:
            ssroot = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in ssroot:
                shared.append("".join(t.text or "" for t in si.iter() if local_tag(t.tag) == "t"))
        wb = ET.fromstring(zf.read("xl/workbook.xml"))
        rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels")) if "xl/_rels/workbook.xml.rels" in names else ET.Element("rels")
        relmap = {r.attrib.get("Id"): r.attrib.get("Target") for r in rels}
        sheets: list[tuple[str, str]] = []
        for s in wb.iter():
            if local_tag(s.tag) != "sheet":
                continue
            sheet_name = s.attrib.get("name", "Sheet")
            rid = next((v for k, v in s.attrib.items() if local_tag(k) == "id"), None)
            target = relmap.get(rid or "")
            if not target:
                continue
            if target.startswith("/"):
                sheet_path = target.lstrip("/")
            elif target.startswith("xl/"):
                sheet_path = target
            else:
                sheet_path = "xl/" + target.lstrip("/")
            sheets.append((sheet_name, sheet_path))

        units: list[dict[str, Any]] = []
        for sheet_name, sheet_path in sheets:
            if sheet_path not in names:
                warnings.append(f"missing worksheet XML: {sheet_path}")
                continue
            root = ET.fromstring(zf.read(sheet_path))
            parsed_rows: list[tuple[int, dict[int, str], dict[int, str]]] = []
            for row in root.iter():
                if local_tag(row.tag) != "row":
                    continue
                row_no = int(row.attrib.get("r", len(parsed_rows) + 1))
                vals: dict[int, str] = {}
                formulas: dict[int, str] = {}
                for c in row:
                    if local_tag(c.tag) != "c":
                        continue
                    col = excel_col_num(c.attrib.get("r", "A1"))
                    if col > MAX_TABLE_COLUMNS:
                        continue
                    typ = c.attrib.get("t", "")
                    formula = next((x.text or "" for x in c if local_tag(x.tag) == "f"), "")
                    v = next((x.text or "" for x in c if local_tag(x.tag) == "v"), "")
                    inline = "".join(x.text or "" for x in c.iter() if local_tag(x.tag) == "t")
                    if typ == "s" and v.isdigit() and int(v) < len(shared):
                        value = shared[int(v)]
                    elif typ == "inlineStr":
                        value = inline
                    elif typ == "b":
                        value = "TRUE" if v == "1" else "FALSE"
                    else:
                        value = v or inline
                    vals[col] = value.strip()
                    if formula:
                        formulas[col] = formula.strip()
                if vals or formulas:
                    parsed_rows.append((row_no, vals, formulas))
            if not parsed_rows:
                continue
            header_row_no, header_vals, _ = parsed_rows[0]
            max_col = max(header_vals.keys(), default=1)
            headers = unique_headers([header_vals.get(i, "") for i in range(1, max_col + 1)])
            data_rows = parsed_rows[1:] if len(parsed_rows) > 1 else []
            window_lines: list[str] = []
            window_fields: list[dict[str, Any]] = []
            start_row = end_row = header_row_no
            words = 0

            def flush_sheet() -> None:
                nonlocal window_lines, window_fields, words, start_row, end_row
                if not window_lines:
                    return
                units.append({
                    "locator": f"sheet:{sheet_name}!R{start_row}:R{end_row}", "heading": sheet_name,
                    "text": normalize_text("\n".join(window_lines)), "fields": window_fields,
                })
                window_lines, window_fields, words = [], [], 0

            for row_no, vals, formulas in data_rows:
                if len(units) >= MAX_UNITS_PER_SOURCE:
                    warnings.append(f"XLSX unit cap reached at {MAX_UNITS_PER_SOURCE:,}")
                    break
                pairs: list[str] = []
                row_fields: list[dict[str, Any]] = []
                max_seen = min(max(set(vals) | set(formulas), default=1), MAX_TABLE_COLUMNS)
                for col in range(1, max_seen + 1):
                    raw = vals.get(col, "")
                    formula = formulas.get(col, "")
                    if not raw and not formula:
                        continue
                    label = headers[col - 1] if col - 1 < len(headers) else f"column_{col}"
                    value, fact_ok = scalar_to_text(raw)
                    shown = value
                    if formula:
                        shown = f"{shown} [formula: {formula}]" if shown else f"[formula: {formula}]"
                    pairs.append(f"{label}={shown}")
                    path = f"sheet[{sheet_name}].row[{row_no}].{label}"
                    if value and fact_ok and policy.keep_structured_field(label, path):
                        row_fields.append({"label": label, "value": value, "path": path, "confidence": 0.96})
                line = f"R{row_no}\t" + "\t".join(pairs)
                lw = count_words(line)
                if window_lines and (len(window_lines) >= 80 or words + lw > 950):
                    flush_sheet()
                    start_row = row_no
                if not window_lines:
                    start_row = row_no
                end_row = row_no
                window_lines.append(line)
                window_fields.extend(row_fields)
                words += lw
            flush_sheet()
            if not data_rows:
                units.append({
                    "locator": f"sheet:{sheet_name}!R{header_row_no}", "heading": sheet_name,
                    "text": "\t".join(headers), "fields": [],
                })
        return units or [{"locator": "workbook:empty", "heading": "", "text": "", "fields": []}], "xlsx-xml-sheet-rows", warnings


def ocr_pdf_page(pdf: Path, page_no: int, temp_dir: Path) -> str:
    prefix = temp_dir / f"ocr-{page_no}"
    subprocess.run(
        ["pdftoppm", "-f", str(page_no), "-l", str(page_no), "-singlefile", "-png", "-r", "140", str(pdf), str(prefix)],
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True,
    )
    png = prefix.with_suffix(".png")
    cp = subprocess.run(
        ["tesseract", str(png), "stdout", "--psm", "3", "-l", "eng"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
    )
    try:
        png.unlink()
    except OSError:
        pass
    return normalize_text(cp.stdout.decode("utf-8", errors="replace"))


def extract_pdf_file(path: Path, *, ocr: bool = False, temp_dir: Path | None = None) -> tuple[list[dict[str, Any]], str, list[str]]:
    if not shutil.which("pdftotext"):
        raise RuntimeError("pdftotext not installed; PDF cannot be indexed")
    cp = subprocess.run(
        ["pdftotext", "-layout", "-enc", "UTF-8", str(path), "-"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
    )
    text = cp.stdout.decode("utf-8", errors="replace")
    pages = text.split("\f")
    if pages and not pages[-1].strip():
        pages.pop()
    pages = [normalize_text(p) for p in pages]
    warnings: list[str] = []
    method = "pdftotext-layout"
    blank = [i + 1 for i, p in enumerate(pages) if count_words(p) < 5]
    if ocr and blank:
        if not shutil.which("pdftoppm") or not shutil.which("tesseract"):
            warnings.append("OCR requested but pdftoppm/tesseract are unavailable")
        else:
            own_temp = False
            if temp_dir is None:
                temp_dir = Path(tempfile.mkdtemp(prefix="project-index-ocr-"))
                own_temp = True
            done = 0
            for pno in blank[:MAX_OCR_PAGES]:
                try:
                    recovered = ocr_pdf_page(path, pno, temp_dir)
                    if count_words(recovered) >= 5:
                        pages[pno - 1] = recovered
                        done += 1
                except Exception as exc:
                    warnings.append(f"OCR failed on page {pno}: {exc}")
            if len(blank) > MAX_OCR_PAGES:
                warnings.append(f"OCR capped at {MAX_OCR_PAGES} blank pages; {len(blank)-MAX_OCR_PAGES} left as text-layer output")
            if done:
                method += "+ocr-fallback"
            if own_temp:
                shutil.rmtree(temp_dir, ignore_errors=True)
    units = [
        {"locator": f"page:{i}", "heading": extract_heading_hint(p), "text": p, "fields": []}
        for i, p in enumerate(pages, start=1)
    ]
    return units or [{"locator": "page:1", "heading": "", "text": "", "fields": []}], method, warnings


def extract_bytes(data: bytes, ext: str, policy: FactPolicy) -> tuple[list[dict[str, Any]], str, list[str]]:
    ext = ext.casefold()
    if len(data) > MAX_IN_MEMORY_BYTES and ext not in PAGED_EXTS:
        raise RuntimeError(f"source exceeds in-memory extraction cap ({len(data):,} bytes > {MAX_IN_MEMORY_BYTES:,})")
    if ext in TEXT_EXTS:
        return split_logical_units(safe_decode(data), prefix=ext.lstrip(".") or "text"), "text-logical", []
    if ext in TABULAR_EXTS:
        return extract_delimited_bytes(data, ext, policy)
    if ext == ".json":
        return extract_json_bytes(data, policy)
    if ext in {".jsonl", ".ndjson"}:
        return extract_jsonl_bytes(data, policy)
    if ext in {".xml", ".backup"}:
        return extract_xml_bytes(data, policy)
    if ext == ".toml":
        return extract_toml_bytes(data, policy)
    if ext in {".ini", ".cfg"}:
        return extract_ini_bytes(data, policy)
    if ext == ".docx":
        return extract_docx_bytes(data, policy)
    if ext == ".xlsx":
        return extract_xlsx_bytes(data, policy)
    raise RuntimeError(f"unsupported byte extraction for {ext}")


def extract_physical(path: Path, policy: FactPolicy, *, ocr: bool, temp_dir: Path) -> tuple[list[dict[str, Any]], str, list[str]]:
    if path.suffix.casefold() == ".pdf":
        return extract_pdf_file(path, ocr=ocr, temp_dir=temp_dir)
    ext = path.suffix.casefold()
    return extract_bytes(path.read_bytes(), ext if ext in SUPPORTED_EXTS else ".txt", policy)


def cap_index_units(units: list[dict[str, Any]], warnings: list[str]) -> list[dict[str, Any]]:
    """Bound FTS payloads while retaining an explicit searchable prefix per source."""
    capped: list[dict[str, Any]] = []
    remaining = MAX_SOURCE_INDEX_CHARS
    for unit in units:
        if remaining <= 0:
            break
        text = normalize_text(str(unit.get("text", "")))
        limit = min(MAX_UNIT_INDEX_CHARS, remaining)
        if len(text) > limit:
            text = text[:limit] + f" … [truncated {len(text) - limit} chars for index safety]"
        capped.append({**unit, "text": text})
        remaining -= len(text)
    if len(capped) < len(units) or sum(len(str(unit.get("text", ""))) for unit in units) > MAX_SOURCE_INDEX_CHARS:
        warnings.append(f"index text capped at {MAX_SOURCE_INDEX_CHARS:,} chars per source")
    return capped


def safe_zip_member_name(name: str) -> bool:
    p = PurePosixPath(name.replace("\\", "/"))
    return not p.is_absolute() and ".." not in p.parts


def iter_zip_members(path: Path) -> tuple[list[tuple[zipfile.ZipInfo, bytes, str]], list[str]]:
    out: list[tuple[zipfile.ZipInfo, bytes, str]] = []
    warnings: list[str] = []
    total = 0
    with zipfile.ZipFile(path) as zf:
        infos = sorted(zf.infolist(), key=lambda x: x.filename.casefold())
        if len(infos) > MAX_ZIP_MEMBERS:
            warnings.append(f"ZIP member list capped at {MAX_ZIP_MEMBERS:,} entries")
            infos = infos[:MAX_ZIP_MEMBERS]
        for info in infos:
            if info.is_dir() or info.file_size <= 0:
                continue
            if info.flag_bits & 0x1:
                warnings.append(f"encrypted ZIP member skipped: {info.filename}")
                continue
            if not safe_zip_member_name(info.filename):
                warnings.append(f"unsafe ZIP member path skipped: {info.filename}")
                continue
            ext = Path(info.filename).suffix.casefold()
            if ext not in ZIP_MEMBER_EXTS:
                continue
            if info.file_size > MAX_ZIP_MEMBER_BYTES:
                warnings.append(f"oversize ZIP member skipped: {info.filename} ({info.file_size:,} bytes)")
                continue
            ratio = info.file_size / max(1, info.compress_size)
            if ratio > MAX_ZIP_COMPRESSION_RATIO:
                warnings.append(f"high-compression-ratio ZIP member skipped: {info.filename} ({ratio:.1f}x)")
                continue
            if total + info.file_size > MAX_ZIP_TOTAL_BYTES:
                warnings.append(f"ZIP uncompressed-byte budget reached at {MAX_ZIP_TOTAL_BYTES:,} bytes")
                break
            try:
                data = zf.read(info)
            except Exception as exc:
                warnings.append(f"ZIP member read failed: {info.filename}: {exc}")
                continue
            total += len(data)
            out.append((info, data, ext))
    return out, warnings


def parse_special_rules(specs: Sequence[str]) -> list[SpecialRule]:
    rules: list[SpecialRule] = []
    for raw in specs:
        if "=" not in raw:
            raise ValueError(f"special fact rule must be FAMILY=REGEX, got {raw!r}")
        family, pattern_text = raw.split("=", 1)
        family = slug(family.strip(), "special")
        pattern_text = pattern_text.strip()
        if not pattern_text:
            raise ValueError(f"special fact regex is empty for family {family!r}")
        if len(pattern_text) > 500:
            raise ValueError("special fact regex exceeds 500 characters")
        try:
            pat = re.compile(pattern_text, re.I)
        except re.error as exc:
            raise ValueError(f"invalid special fact regex {pattern_text!r}: {exc}") from exc
        rules.append(SpecialRule(family, pattern_text, pat))
    return rules


def line_label_value_facts(text: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    lines = text.splitlines()
    for i, raw in enumerate(lines):
        line = re.sub(r"\s+", " ", raw.strip())
        if not line or len(line) > 500 or "://" in line[:120]:
            continue
        m = re.match(r"^([A-Za-z][A-Za-z0-9 .&/()'’_+#%-]{1,80})\s*:\s*(.+)$", line)
        if not m:
            continue
        label, value = m.group(1).strip(), m.group(2).strip()
        if len(label.split()) > 14 or not value or looks_binary_like_string(value):
            continue
        context = " | ".join(
            re.sub(r"\s+", " ", x.strip())
            for x in lines[max(0, i - 1): min(len(lines), i + 2)] if x.strip()
        )
        out.append({
            "label": label, "value": value[:5000], "path": f"line:{i+1}",
            "evidence": context[:1200], "confidence": 0.82, "kind": "label_value",
        })
    return out


def split_markdown_row(line: str) -> list[str]:
    s = line.strip().strip("|")
    return [re.sub(r"\s+", " ", x.strip()) for x in s.split("|")]


def markdown_table_facts(text: str) -> list[dict[str, Any]]:
    lines = text.splitlines()
    out: list[dict[str, Any]] = []
    i = 0
    while i + 1 < len(lines):
        if "|" not in lines[i] or "|" not in lines[i + 1]:
            i += 1
            continue
        headers = split_markdown_row(lines[i])
        sep = split_markdown_row(lines[i + 1])
        if not headers or len(headers) != len(sep) or not all(re.fullmatch(r":?-{3,}:?", x.replace(" ", "")) for x in sep):
            i += 1
            continue
        i += 2
        row_no = 0
        while i < len(lines) and "|" in lines[i] and lines[i].strip():
            vals = split_markdown_row(lines[i])
            if len(vals) != len(headers):
                break
            row_no += 1
            for col, (label, value) in enumerate(zip(headers, vals), start=1):
                if not label or not value or looks_binary_like_string(value):
                    continue
                out.append({
                    "label": label[:120], "value": value[:5000],
                    "path": f"markdown-table:line:{i+1}:row:{row_no}:col:{col}",
                    "evidence": lines[i].strip()[:1200], "confidence": 0.78, "kind": "markdown_table",
                })
            i += 1
        continue
    return out


def make_fact_row(*, kind: str, family: str, label: str, value: str, path: str, evidence: str, confidence: float) -> dict[str, Any]:
    num, unit = parse_numeric_scalar(value)
    return {
        "kind": kind, "family": family, "label": label[:160], "label_norm": slug(label, "field"),
        "value_text": value[:5000], "value_num": num, "value_unit": unit[:40], "path": path[:500],
        "evidence": evidence[:1500], "confidence": confidence,
    }


def collect_unit_facts(unit: Mapping[str, Any], policy: FactPolicy) -> list[dict[str, Any]]:
    if policy.mode == "none":
        return []
    out: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str, str, str]] = set()

    def add(row: dict[str, Any]) -> None:
        key = (row["kind"], row["family"], row["label_norm"], row["value_text"], row["path"])
        if key not in seen:
            seen.add(key)
            out.append(row)

    for f in unit.get("fields", []) or []:
        label = str(f.get("label", "field"))
        value = str(f.get("value", ""))
        path = str(f.get("path", ""))
        confidence = float(f.get("confidence", 0.95))
        if policy.general:
            add(make_fact_row(
                kind="structured", family=canonical_family(label), label=label, value=value,
                path=path, evidence=f"{path}: {value}", confidence=confidence,
            ))
        general_family = canonical_family(label)
        for family in policy.matching_special_families(label, path):
            if policy.general and family == general_family:
                continue
            add(make_fact_row(
                kind="special_field", family=family, label=label, value=value,
                path=path, evidence=f"{path}: {value}", confidence=min(0.99, confidence),
            ))

    text = str(unit.get("text", ""))
    label_rows = line_label_value_facts(text)
    if policy.general:
        for f in label_rows:
            add(make_fact_row(
                kind=f["kind"], family=canonical_family(f["label"]), label=f["label"], value=f["value"],
                path=f["path"], evidence=f["evidence"], confidence=f["confidence"],
            ))
        for f in markdown_table_facts(text):
            add(make_fact_row(
                kind=f["kind"], family=canonical_family(f["label"]), label=f["label"], value=f["value"],
                path=f["path"], evidence=f["evidence"], confidence=f["confidence"],
            ))

    if policy.special:
        special_count = 0
        label_line_indexes = {f["path"] for f in label_rows}
        for f in label_rows:
            general_family = canonical_family(f["label"])
            for family in policy.matching_special_families(f["label"], f["path"]):
                if policy.general and family == general_family:
                    continue
                add(make_fact_row(
                    kind="special_label_value", family=family, label=f["label"], value=f["value"],
                    path=f["path"], evidence=f["evidence"], confidence=0.86,
                ))
        # Structured sources already expose exact matched fields. Free-text matches
        # are only useful for prose units and would otherwise duplicate those rows.
        if unit.get("fields"):
            return out
        for line_no, raw in enumerate(text.splitlines(), start=1):
            if special_count >= MAX_SPECIAL_MATCHES_PER_UNIT:
                break
            line = re.sub(r"\s+", " ", raw.strip())
            if not line or len(line) > 500 or f"line:{line_no}" in label_line_indexes:
                continue
            for rule in policy.special_rules:
                if rule.pattern.search(line):
                    add(make_fact_row(
                        kind="special_match", family=rule.family, label="text_match", value=line,
                        path=f"line:{line_no}", evidence=line, confidence=0.55,
                    ))
                    special_count += 1
                    break
    return out


def ensure_content_schema(con: sqlite3.Connection) -> None:
    required = {"content_meta", "content_sources", "content_units", "content_units_fts", "content_facts", "content_fact_stats"}
    present = {str(r[0]) for r in con.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view')")}
    missing = sorted(required - present)
    if missing:
        raise RuntimeError(
            "Freelancer content-index schema is missing: " + ", ".join(missing) +
            ". Start Freelancer once after updating so its database migration can run."
        )


def previous_physical_manifest(db: Path, project_key: str) -> dict[str, str]:
    if not db.exists():
        return {}
    try:
        con = sqlite3.connect(db.resolve().as_uri() + '?mode=ro', uri=True)
        ensure_content_schema(con)
        row = con.execute(
            "SELECT value FROM content_meta WHERE project_key=? AND key='physical_manifest_json'",
            (project_key,),
        ).fetchone()
        con.close()
        if not row:
            return {}
        raw = json.loads(row[0])
        return {str(x["path"]): str(x["sha256"]) for x in raw if "path" in x and "sha256" in x}
    except Exception:
        return {}


def previous_build_settings(db: Path, project_key: str) -> tuple[str, str] | None:
    """Return the settings that affect stored source/fact rows, if readable."""
    if not db.exists():
        return None
    try:
        con = sqlite3.connect(db.resolve().as_uri() + '?mode=ro', uri=True)
        ensure_content_schema(con)
        rows = dict(con.execute(
            "SELECT key,value FROM content_meta WHERE project_key=? AND key IN ('facts_mode','special_fact_rules_json')",
            (project_key,),
        ).fetchall())
        con.close()
        if 'facts_mode' not in rows:
            return None
        return str(rows['facts_mode']), str(rows.get('special_fact_rules_json', '[]'))
    except Exception:
        return None

def compare_manifests(old: Mapping[str, str], new: Mapping[str, str]) -> dict[str, list[str]]:
    old_keys, new_keys = set(old), set(new)
    return {
        "added": sorted(new_keys - old_keys, key=str.casefold),
        "removed": sorted(old_keys - new_keys, key=str.casefold),
        "changed": sorted((k for k in old_keys & new_keys if old[k] != new[k]), key=str.casefold),
        "unchanged": sorted((k for k in old_keys & new_keys if old[k] == new[k]), key=str.casefold),
    }


def insert_metadata_only(con: sqlite3.Connection, *, project_key: str, root: Path, path: Path, rp: str, sha: str, error: str) -> None:
    role, status, rank = infer_routing(rp)
    st = path.stat()
    con.execute("""
        INSERT INTO content_sources(project_key,filename,virtual_path,container_path,member_path,extension,source_role,status,routing_rank,
            file_size_bytes,modified_utc,sha256,unit_count,locator_kind,extraction_method,extraction_status,text_chars,word_count,notes)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        project_key, path.name, rp, rp, "", path.suffix.casefold(), role, status, rank,
        st.st_size, dt.datetime.fromtimestamp(st.st_mtime, dt.timezone.utc).replace(microsecond=0).isoformat(),
        sha, 0, "metadata_only", "failed", "metadata_only", 0, 0, f"Extraction failed: {error}",
    ))


def locator_kind_for(ext: str, member_path: str) -> str:
    if member_path:
        return "archive_member"
    if ext == ".pdf":
        return "physical_page"
    if ext == ".xlsx":
        return "sheet_rows"
    if ext in {".json", ".jsonl", ".ndjson", ".xml", ".backup", ".toml", ".ini", ".cfg"}:
        return "structured_record"
    if ext in TABULAR_EXTS:
        return "row_range"
    return "logical_unit"


def add_source(
    con: sqlite3.Connection,
    *,
    project_key: str,
    root: Path,
    physical_path: Path,
    virtual_path: str,
    extension: str,
    data_sha: str,
    data_size: int,
    units: list[dict[str, Any]],
    extraction_method: str,
    extraction_status: str,
    member_path: str,
    notes: str,
    policy: FactPolicy,
    build_budget: BuildBudget,
) -> tuple[int, int, int, int]:
    role, status, rank = infer_routing(virtual_path)
    text_chars = sum(len(str(u.get("text", ""))) for u in units)
    word_count = sum(count_words(str(u.get("text", ""))) for u in units)
    st = physical_path.stat()
    container = relpath(physical_path, root)
    cur = con.execute("""
        INSERT INTO content_sources(project_key,filename,virtual_path,container_path,member_path,extension,source_role,status,routing_rank,
            file_size_bytes,modified_utc,sha256,unit_count,locator_kind,extraction_method,extraction_status,text_chars,word_count,notes)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        project_key, Path(member_path).name if member_path else physical_path.name,
        virtual_path, container, member_path, extension, role, status, rank, data_size,
        dt.datetime.fromtimestamp(st.st_mtime, dt.timezone.utc).replace(microsecond=0).isoformat(),
        data_sha, len(units), locator_kind_for(extension, member_path), extraction_method, extraction_status,
        text_chars, word_count, notes,
    ))
    source_id = int(cur.lastrowid)
    inserted_facts = dropped_facts = 0
    source_fact_count = 0

    for unit_no, unit in enumerate(units, start=1):
        body = normalize_text(str(unit.get("text", "")))
        heading = str(unit.get("heading", "") or extract_heading_hint(body))[:300]
        locator = str(unit.get("locator", f"logical:{unit_no}"))[:500]
        cur = con.execute("""
            INSERT INTO content_units(source_id,unit_no,locator,heading,text,word_count,char_count,sha256)
            VALUES(?,?,?,?,?,?,?,?)
        """, (source_id, unit_no, locator, heading, body, count_words(body), len(body), sha256_text(body)))
        unit_id = int(cur.lastrowid)
        con.execute("""
            INSERT INTO content_units_fts(rowid,project_key,filename,virtual_path,source_role,status,heading,locator,text)
            VALUES(?,?,?,?,?,?,?,?,?)
        """, (
            unit_id, project_key, Path(member_path).name if member_path else physical_path.name,
            virtual_path, role, status, heading, locator, body,
        ))

        facts = collect_unit_facts(unit, policy)
        if len(facts) > MAX_FACTS_PER_UNIT:
            dropped_facts += len(facts) - MAX_FACTS_PER_UNIT
            facts = facts[:MAX_FACTS_PER_UNIT]
        allowed_source = max(0, MAX_FACTS_PER_SOURCE - source_fact_count)
        allowed_total = max(0, MAX_FACTS_TOTAL - build_budget.facts_total)
        allowed = min(len(facts), allowed_source, allowed_total)
        if allowed < len(facts):
            dropped_facts += len(facts) - allowed
        facts = facts[:allowed]
        if facts:
            con.executemany("""
                INSERT INTO content_facts(source_id,unit_no,locator,fact_kind,family,label,label_norm,value_text,value_num,value_unit,field_path,evidence,confidence)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, [(
                source_id, unit_no, locator, f["kind"], f["family"], f["label"], f["label_norm"],
                f["value_text"], f["value_num"], f["value_unit"], f["path"], f["evidence"], f["confidence"],
            ) for f in facts])
            inserted_facts += len(facts)
            source_fact_count += len(facts)
            build_budget.facts_total += len(facts)
        if build_budget.facts_total >= MAX_FACTS_TOTAL:
            # Search indexing continues; only fact extraction is budget-limited.
            pass

    if dropped_facts:
        build_budget.facts_dropped_total += dropped_facts
        build_budget.facts_dropped_by_source[virtual_path] += dropped_facts
    return source_id, word_count, inserted_facts, dropped_facts


def rebuild_fact_stats(con: sqlite3.Connection, project_key: str) -> None:
    con.execute("DELETE FROM content_fact_stats WHERE project_key=?", (project_key,))
    con.execute("""
        INSERT INTO content_fact_stats(project_key,family,label_norm,label,value_unit,fact_count,distinct_value_count,source_count,
                                       numeric_count,min_numeric,max_numeric,avg_numeric)
        SELECT ?, f.family,
               f.label_norm,
               MIN(f.label) AS label,
               f.value_unit,
               COUNT(*) AS fact_count,
               COUNT(DISTINCT f.value_text) AS distinct_value_count,
               COUNT(DISTINCT f.source_id) AS source_count,
               SUM(CASE WHEN f.value_num IS NOT NULL THEN 1 ELSE 0 END) AS numeric_count,
               MIN(f.value_num), MAX(f.value_num), AVG(f.value_num)
        FROM content_facts f
        JOIN content_sources s ON s.source_id=f.source_id
        WHERE s.project_key=?
        GROUP BY f.family,f.label_norm,f.value_unit
    """, (project_key, project_key))

def publish_project_index(db: Path, staged: Path, project_key: str) -> None:
    """Only Node's SQLite writes the shared application database and its WAL."""
    node = os.environ.get("FREELANCER_NODE") or shutil.which("node")
    if not node:
        raise RuntimeError("Node.js 22.13 or newer is required to publish the file index.")
    publisher = Path(__file__).resolve().parent / "runtime" / "publish-index.mjs"
    result = subprocess.run([node, str(publisher), str(db), str(staged), project_key],
                            capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("Index publication failed: " + result.stderr.strip()[-2000:])


def build_index(root: Path, db: Path, project_key: str, *, fact_mode: str, special_specs: Sequence[str], ocr: bool, staging_dir: Path | None = None) -> dict[str, Any]:
    special_rules = parse_special_rules(special_specs)
    if fact_mode == "special" and not special_rules:
        raise ValueError("--facts special requires at least one --special-fact FAMILY=REGEX rule")
    if fact_mode == "both" and not special_rules:
        # "both" without special rules is still valid, but it is equivalent to general.
        eprint("warning: --facts both has no --special-fact rules; only general facts will be built")
    policy = FactPolicy(fact_mode, special_rules)
    discovered = discover_files(root)
    files: list[Path] = []
    scan_failures: list[dict[str, str]] = []
    old_manifest = previous_physical_manifest(db, project_key)
    physical_manifest: dict[str, str] = {}
    for path in discovered:
        rp = relpath(path, root)
        try:
            physical_manifest[rp] = sha256_file(path)
            files.append(path)
        except OSError as exc:
            # Files can disappear or be locked while a project is being edited.
            # Keep refreshing the rest of the corpus and report this one gap.
            scan_failures.append({"source": rp, "error": f"file could not be read: {exc}"})
    changes = compare_manifests(old_manifest, physical_manifest)
    requested_settings = (
        fact_mode,
        json.dumps([{"family": r.family, "regex": r.pattern_text} for r in special_rules], ensure_ascii=False),
    )
    incremental = bool(old_manifest) and previous_build_settings(db, project_key) == requested_settings
    changed_paths = set(changes['added']) | set(changes['changed'])
    replaced_paths = set(changes['changed']) | set(changes['removed'])
    files_to_extract = [path for path in files if relpath(path, root) in changed_paths] if incremental else files

    if not db.exists():
        raise RuntimeError("Freelancer database not found. Start Freelancer once before rebuilding the content index.")
    temp_dir = staging_dir or Path(tempfile.mkdtemp(prefix="project-content-index-"))
    staged = temp_dir / "staged-freelancer.sqlite"
    source_con = sqlite3.connect(db.resolve().as_uri() + '?mode=ro', uri=True)
    try:
        ensure_content_schema(source_con)
        stage_con = sqlite3.connect(staged)
        try:
            source_con.backup(stage_con)
        finally:
            stage_con.close()
    finally:
        source_con.close()

    con = sqlite3.connect(staged)
    con.row_factory = sqlite3.Row
    ensure_content_schema(con)
    con.execute("PRAGMA foreign_keys=ON")
    built_at = now_utc()
    con.execute("BEGIN IMMEDIATE")
    if incremental:
        # Units/Facts cascade with their source rows; FTS is independent and
        # must be removed explicitly for a physical source and its ZIP members.
        for rp in sorted(replaced_paths, key=str.casefold):
            con.execute("DELETE FROM content_units_fts WHERE project_key=? AND (virtual_path=? OR virtual_path LIKE ?)",
                        (project_key, rp, f"{rp}!%"))
        if replaced_paths:
            marks = ','.join('?' for _ in replaced_paths)
            con.execute(f"DELETE FROM content_sources WHERE project_key=? AND container_path IN ({marks})",
                        [project_key, *sorted(replaced_paths, key=str.casefold)])
    else:
        con.execute("DELETE FROM content_units_fts WHERE project_key=?", (project_key,))
        con.execute("DELETE FROM content_sources WHERE project_key=?", (project_key,))
    con.execute("DELETE FROM content_fact_stats WHERE project_key=?", (project_key,))
    con.execute("DELETE FROM content_meta WHERE project_key=?", (project_key,))
    con.executemany("INSERT INTO content_meta(project_key,key,value) VALUES(?,?,?)", [
        (project_key, "schema_version", SCHEMA_VERSION),
        (project_key, "built_at_utc", built_at),
        (project_key, "root", str(root.resolve())),
        (project_key, "facts_mode", fact_mode),
        (project_key, "special_fact_rules_json", json.dumps([{"family": r.family, "regex": r.pattern_text} for r in special_rules], ensure_ascii=False)),
        (project_key, "authority_warning", "The index and calculated facts are locators/analysis aids. Verify governing source content before authoritative claims or edits."),
    ])

    failures: list[dict[str, str]] = list(scan_failures)
    extraction_warnings: list[dict[str, Any]] = []
    method_counts: collections.Counter[str] = collections.Counter()
    build_budget = BuildBudget()
    total_words = total_units = total_facts = physical_sources = archive_members = 0

    try:
        for idx, path in enumerate(files_to_extract, start=1):
            rp = relpath(path, root)
            ext = path.suffix.casefold() if path.suffix.casefold() in SUPPORTED_EXTS else ".txt"
            eprint(f"[{idx:03d}/{len(files_to_extract):03d}] {rp}")
            if ext == ".zip":
                container_sha = physical_manifest[rp]
                members, zip_warnings = iter_zip_members(path)
                if zip_warnings:
                    extraction_warnings.append({"source": rp, "warnings": zip_warnings})
                if not members:
                    failures.append({"source": rp, "error": "no safe supported members found in ZIP"})
                    insert_metadata_only(con, project_key=project_key, root=root, path=path, rp=rp, sha=container_sha,
                                         error="no safe supported members found in ZIP")
                    continue
                for info, data, member_ext in members:
                    virtual = f"{rp}!{info.filename}"
                    con.execute("SAVEPOINT one_source")
                    try:
                        member_policy = FactPolicy(policy.mode, policy.special_rules)
                        if member_ext == ".pdf":
                            member_tmp = temp_dir / f"member-{sha256_bytes(data)[:16]}.pdf"
                            member_tmp.write_bytes(data)
                            units, method, warnings = extract_pdf_file(member_tmp, ocr=ocr, temp_dir=temp_dir)
                            try:
                                member_tmp.unlink()
                            except OSError:
                                pass
                        else:
                            units, method, warnings = extract_bytes(data, member_ext, member_policy)
                        units = cap_index_units(units, warnings)
                        if len(units) > MAX_UNITS_PER_SOURCE:
                            warnings.append(f"unit list capped at {MAX_UNITS_PER_SOURCE:,}")
                            units = units[:MAX_UNITS_PER_SOURCE]
                        _, words, facts, _ = add_source(
                            con, project_key=project_key, root=root, physical_path=path, virtual_path=virtual, extension=member_ext,
                            data_sha=sha256_bytes(data), data_size=len(data), units=units,
                            extraction_method=f"zip-member+{method}", extraction_status="ok",
                            member_path=info.filename, notes=f"archive member; container sha256={container_sha}",
                            policy=member_policy, build_budget=build_budget,
                        )
                        total_words += words
                        total_units += len(units)
                        total_facts += facts
                        archive_members += 1
                        method_counts[f"zip-member+{method}"] += 1
                        if warnings:
                            extraction_warnings.append({"source": virtual, "warnings": warnings})
                        con.execute("RELEASE one_source")
                    except Exception as exc:
                        con.execute("ROLLBACK TO one_source")
                        con.execute("RELEASE one_source")
                        failures.append({"source": virtual, "error": str(exc)})
                continue

            sha = physical_manifest[rp]
            con.execute("SAVEPOINT one_source")
            try:
                source_policy = FactPolicy(policy.mode, policy.special_rules)
                units, method, warnings = extract_physical(path, source_policy, ocr=ocr, temp_dir=temp_dir)
                units = cap_index_units(units, warnings)
                if len(units) > MAX_UNITS_PER_SOURCE:
                    warnings.append(f"unit list capped at {MAX_UNITS_PER_SOURCE:,}")
                    units = units[:MAX_UNITS_PER_SOURCE]
                _, words, facts, _ = add_source(
                    con, project_key=project_key, root=root, physical_path=path, virtual_path=rp, extension=ext,
                    data_sha=sha, data_size=path.stat().st_size, units=units,
                    extraction_method=method, extraction_status="ok", member_path="", notes="",
                    policy=source_policy, build_budget=build_budget,
                )
                total_words += words
                total_units += len(units)
                total_facts += facts
                physical_sources += 1
                method_counts[method] += 1
                if warnings:
                    extraction_warnings.append({"source": rp, "warnings": warnings})
                con.execute("RELEASE one_source")
            except Exception as exc:
                con.execute("ROLLBACK TO one_source")
                con.execute("RELEASE one_source")
                failures.append({"source": rp, "error": str(exc)})
                insert_metadata_only(con, project_key=project_key, root=root, path=path, rp=rp, sha=sha, error=str(exc))

        rebuild_fact_stats(con, project_key)
        con.execute("INSERT INTO content_units_fts(content_units_fts) VALUES('optimize')")

        physical_manifest_rows = [{"path": k, "sha256": v} for k, v in sorted(physical_manifest.items(), key=lambda kv: kv[0].casefold())]
        con.execute(
            "INSERT OR REPLACE INTO content_meta(project_key,key,value) VALUES(?,?,?)",
            (project_key, "physical_manifest_json", json.dumps(physical_manifest_rows, ensure_ascii=False)),
        )

        summary = {
            "schema_version": SCHEMA_VERSION,
            "built_at_utc": built_at,
            "facts_mode": fact_mode,
            "special_fact_rules": [{"family": r.family, "regex": r.pattern_text} for r in special_rules],
            "refresh_mode": "incremental" if incremental else "full",
            "files_reindexed": len(files_to_extract),
            "files_reused": len(changes['unchanged']) if incremental else 0,
            "files_removed": len(changes['removed']),
            "physical_sources_indexed": con.execute(
                "SELECT COUNT(DISTINCT container_path) FROM content_sources WHERE project_key=?", (project_key,)
            ).fetchone()[0],
            "archive_members_indexed": archive_members,
            "indexed_sources": con.execute(
                "SELECT COUNT(*) FROM content_sources WHERE project_key=?", (project_key,)
            ).fetchone()[0],
            "units": total_units,
            "words": total_words,
            "facts": total_facts,
            "fact_stat_groups": con.execute(
                "SELECT COUNT(*) FROM content_fact_stats WHERE project_key=?", (project_key,)
            ).fetchone()[0],
            "facts_dropped_by_budget": build_budget.facts_dropped_total,
            "fact_budget_sources": dict(build_budget.facts_dropped_by_source),
            "extraction_methods": dict(method_counts),
            "extraction_failures": failures,
            "extraction_warnings": extraction_warnings,
            "changes": changes,
        }
        con.execute(
            "INSERT OR REPLACE INTO content_meta(project_key,key,value) VALUES(?,?,?)",
            (project_key, "summary_json", json.dumps(summary, ensure_ascii=False)),
        )

        integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
        fk = con.execute("PRAGMA foreign_key_check").fetchall()
        units_count = int(con.execute(
            "SELECT COUNT(*) FROM content_units u JOIN content_sources s ON s.source_id=u.source_id WHERE s.project_key=?",
            (project_key,),
        ).fetchone()[0])
        fts_count = int(con.execute(
            "SELECT COUNT(*) FROM content_units_fts WHERE project_key=?", (project_key,)
        ).fetchone()[0])
        facts_count = int(con.execute(
            "SELECT COUNT(*) FROM content_facts f JOIN content_sources s ON s.source_id=f.source_id WHERE s.project_key=?",
            (project_key,),
        ).fetchone()[0])
        if integrity != "ok" or fk or units_count != fts_count:
            raise RuntimeError(
                f"index validation failed: integrity={integrity!r}, foreign_keys={len(fk)}, units={units_count}, fts_rows={fts_count}"
            )
        validation = {
            "integrity": "ok", "foreign_keys": "ok", "units_equal_fts_rows": True,
            "units": units_count, "facts": facts_count,
        }
        con.execute(
            "INSERT OR REPLACE INTO content_meta(project_key,key,value) VALUES(?,?,?)",
            (project_key, "validation_json", json.dumps(validation)),
        )
        con.commit()
        con.close()
        con = None  # type: ignore[assignment]
        if staging_dir is None:
            eprint("Publishing project index…")
            publish_project_index(db, staged, project_key)
        summary["validation"] = validation
        return summary
    except Exception:
        try:
            con.rollback()
        except Exception:
            pass
        raise
    finally:
        try:
            if con is not None:
                con.close()
        except Exception:
            pass
        if staging_dir is None:
            shutil.rmtree(temp_dir, ignore_errors=True)


def connect(db: Path) -> sqlite3.Connection:
    if not db.exists():
        raise RuntimeError(f"index not found: {db}. Run the rebuild command first")
    con = sqlite3.connect(db.resolve().as_uri() + '?mode=ro', uri=True)
    con.row_factory = sqlite3.Row
    return con


def make_fts_query(query: str, phrase: bool) -> str:
    if phrase:
        return '"' + query.replace('"', '""') + '"'
    return query


def cmd_search(con: sqlite3.Connection, args: argparse.Namespace, project_key: str) -> list[dict[str, Any]]:
    where = ["content_units_fts MATCH ?", "content_units_fts.project_key = ?"]
    params: list[Any] = [make_fts_query(args.query, args.phrase), project_key]
    if args.source:
        where.append("s.virtual_path LIKE ?")
        params.append(f"%{args.source}%")
    if args.role:
        where.append("s.source_role = ?")
        params.append(args.role)
    if args.status:
        where.append("s.status = ?")
        params.append(args.status)
    params.append(args.limit)
    sql = f"""
        SELECT s.virtual_path, s.source_role, s.status, u.unit_no, u.locator, u.heading,
               bm25(content_units_fts) AS score,
               snippet(content_units_fts, 7, '[', ']', ' … ', 28) AS snippet
        FROM content_units_fts
        JOIN content_units u ON u.unit_id = content_units_fts.rowid
        JOIN content_sources s ON s.source_id = u.source_id
        WHERE {' AND '.join(where)}
        ORDER BY bm25(content_units_fts), s.routing_rank DESC
        LIMIT ?
    """
    try:
        return [dict(r) for r in con.execute(sql, params).fetchall()]
    except sqlite3.OperationalError as exc:
        if args.phrase:
            raise
        tokens = re.findall(r"[\w'’.-]+", args.query, flags=re.UNICODE)
        if not tokens:
            raise RuntimeError(f"invalid/empty FTS query: {exc}") from exc
        args2 = argparse.Namespace(**vars(args))
        args2.query = " ".join(tokens)
        args2.phrase = True
        return cmd_search(con, args2, project_key)


def cmd_sources(con: sqlite3.Connection, args: argparse.Namespace, project_key: str) -> list[dict[str, Any]]:
    where: list[str] = ["project_key = ?"]
    params: list[Any] = [project_key]
    if args.source:
        where.append("virtual_path LIKE ?")
        params.append(f"%{args.source}%")
    if args.role:
        where.append("source_role = ?")
        params.append(args.role)
    if args.status:
        where.append("status = ?")
        params.append(args.status)
    sql = "SELECT virtual_path,extension,source_role,status,routing_rank,unit_count,word_count,extraction_method,extraction_status,sha256,notes FROM content_sources"
    sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY routing_rank DESC, virtual_path"
    return [dict(r) for r in con.execute(sql, params).fetchall()]


def cmd_unit(con: sqlite3.Connection, args: argparse.Namespace, project_key: str) -> list[dict[str, Any]]:
    return [dict(r) for r in con.execute("""
        SELECT s.virtual_path,u.unit_no,u.locator,u.heading,u.text
        FROM content_units u JOIN content_sources s ON s.source_id=u.source_id
        WHERE s.project_key=? AND s.virtual_path LIKE ? AND u.unit_no=?
        ORDER BY s.virtual_path
    """, (project_key, f"%{args.source}%", args.unit)).fetchall()]


def cmd_facts(con: sqlite3.Connection, args: argparse.Namespace, project_key: str) -> list[dict[str, Any]]:
    if args.stats:
        where: list[str] = ["project_key = ?"]
        params: list[Any] = [project_key]
        if args.family:
            where.append("family = ?")
            params.append(args.family)
        sql = "SELECT family,label_norm,label,value_unit,fact_count,distinct_value_count,source_count,numeric_count,min_numeric,max_numeric,avg_numeric FROM content_fact_stats"
        sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY fact_count DESC, family, label_norm LIMIT ?"
        params.append(args.limit)
        return [dict(r) for r in con.execute(sql, params).fetchall()]
    where = ["s.project_key = ?"]
    params: list[Any] = [project_key]
    if args.family:
        where.append("f.family = ?")
        params.append(args.family)
    if args.source:
        where.append("s.virtual_path LIKE ?")
        params.append(f"%{args.source}%")
    if args.kind:
        where.append("f.fact_kind = ?")
        params.append(args.kind)
    if args.label:
        where.append("f.label_norm LIKE ?")
        params.append(f"%{slug(args.label)}%")
    sql = """SELECT s.virtual_path,s.source_role,s.status,f.unit_no,f.locator,
                    f.fact_kind,f.family,f.label,f.value_text,f.value_num,
                    f.value_unit,f.field_path,f.confidence,f.evidence
             FROM content_facts f JOIN content_sources s ON s.source_id=f.source_id"""
    sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY s.virtual_path, f.unit_no, f.family, f.label LIMIT ?"
    params.append(args.limit)
    return [dict(r) for r in con.execute(sql, params).fetchall()]


def cmd_meta(con: sqlite3.Connection, project_key: str) -> list[dict[str, Any]]:
    return [dict(r) for r in con.execute(
        "SELECT key,value FROM content_meta WHERE project_key=? ORDER BY key", (project_key,)
    ).fetchall()]

def cmd_status(root: Path, db: Path, project_key: str) -> dict[str, Any]:
    files = discover_files(root)
    current = {relpath(p, root): sha256_file(p) for p in files}
    previous = previous_physical_manifest(db, project_key)
    changes = compare_manifests(previous, current)
    index_exists = bool(previous)
    stale = not index_exists or bool(changes["added"] or changes["removed"] or changes["changed"])
    result: dict[str, Any] = {
        "index_exists": index_exists,
        "stale": stale,
        "source_count_now": len(current),
        "changes": changes,
    }
    if index_exists:
        try:
            con = connect(db)
            ensure_content_schema(con)
            for key in ("built_at_utc", "facts_mode", "special_fact_rules_json", "validation_json"):
                row = con.execute("SELECT value FROM content_meta WHERE project_key=? AND key=?", (project_key, key)).fetchone()
                if row:
                    result[key] = row[0]
            con.close()
        except Exception as exc:
            result["index_read_error"] = str(exc)
            result["stale"] = True
    return result


def print_json(obj: Any) -> None:
    print(json.dumps(obj, indent=2, ensure_ascii=False))


def add_source_filters(p: argparse.ArgumentParser) -> None:
    p.add_argument("--source", help="substring filter on source/virtual path")
    p.add_argument("--role", help="exact source_role filter")
    p.add_argument("--status", help="exact source status filter")


def main() -> None:
    ap = argparse.ArgumentParser(description="Build and query a project-scoped SQLite/FTS5 index inside the Freelancer database.")
    ap.add_argument("--db", default=DEFAULT_DB, help=f"Freelancer SQLite database path (default: {DEFAULT_DB})")
    ap.add_argument("--project-key", required=True, help="Stable project scope key supplied by Freelancer")
    sub = ap.add_subparsers(dest="command", required=True)

    p = sub.add_parser("build", aliases=["rebuild"], help="atomically rebuild the index from the current project corpus")
    p.add_argument("--root", default=".", help="project root")
    p.add_argument("--facts", choices=["none", "general", "special", "both"], default="none",
                   help="fact layer to calculate during rebuild")
    p.add_argument("--special-fact", action="append", default=[], metavar="FAMILY=REGEX",
                   help="request-specific fact rule; repeat as needed")
    p.add_argument("--ocr", action="store_true", help="OCR nearly blank PDF pages when pdftoppm+tesseract are available")
    p.add_argument("--staging-dir", type=Path, help=argparse.SUPPRESS)

    p = sub.add_parser("status", help="compare current source hashes with the stable index manifest")
    p.add_argument("--root", default=".", help="project root")

    p = sub.add_parser("search", help="FTS5/BM25 ranked full-text search")
    p.add_argument("query")
    p.add_argument("--phrase", action="store_true", help="quote the entire query as a literal phrase")
    add_source_filters(p)
    p.add_argument("--limit", type=int, default=20)

    p = sub.add_parser("chats", help="search OpenCode conversations cached by Freelancer for this project")
    p.add_argument("query")
    p.add_argument("--model", help="exact provider/model ID")
    p.add_argument("--limit", type=int, default=20)

    p = sub.add_parser("sources", help="list indexed physical and virtual sources")
    add_source_filters(p)

    p = sub.add_parser("unit", help="read one indexed retrieval unit")
    p.add_argument("--source", required=True)
    p.add_argument("--unit", required=True, type=int)

    p = sub.add_parser("facts", help="query calculated/extracted facts or aggregate fact statistics")
    p.add_argument("--family")
    p.add_argument("--source")
    p.add_argument("--kind", choices=["structured", "label_value", "markdown_table", "special_field", "special_label_value", "special_match"])
    p.add_argument("--label")
    p.add_argument("--stats", action="store_true", help="show aggregated counts/distinct/numeric min-max-average")
    p.add_argument("--limit", type=int, default=100)

    sub.add_parser("meta", help="show build metadata")

    args = ap.parse_args()
    db = Path(args.db)
    if not db.is_absolute():
        db = Path.cwd() / db
    db = db.resolve()

    try:
        if args.command == "chats":
            terms = re.findall(r"\w+", str(args.query), flags=re.UNICODE)[:12]
            if not terms or len(args.query) > 200:
                raise ValueError("Chat search requires 1 to 200 characters")
            match = " AND ".join('"' + term + '"' for term in terms)
            con = sqlite3.connect(db.resolve().as_uri() + '?mode=ro', uri=True)
            con.row_factory = sqlite3.Row
            try:
                rows = con.execute("""SELECT chat_search.session_id AS session, message_id AS message,
                    role, model_id AS model, chat_search.updated_at AS updatedAt,
                    COALESCE(h.title, chat_search.title) AS title,
                    snippet(chat_search, 7, '', '', ' … ', 24) AS excerpt
                    FROM chat_search LEFT JOIN session_headers h
                    ON h.project_id=chat_search.project_id AND h.session_id=chat_search.session_id
                    WHERE chat_search MATCH ? AND chat_search.project_id = ?
                    AND (? = '' OR model_id = ?)
                    ORDER BY bm25(chat_search) LIMIT ?""",
                    (match, args.project_key, args.model or "", args.model or "", max(1, min(100, args.limit)))).fetchall()
                print_json({"results": [dict(row) for row in rows],
                    "coverage": "Derived from OpenCode messages. Refresh conversation index in Freelancer History for older chats; current chats refresh when opened."})
            finally:
                con.close()
            return
        if args.command in {"build", "rebuild"}:
            root = Path(args.root).resolve()
            if not Path(args.db).is_absolute():
                db = (root / args.db).resolve()
            print_json(build_index(root, db, args.project_key, fact_mode=args.facts, special_specs=args.special_fact, ocr=args.ocr, staging_dir=args.staging_dir))
            return
        if args.command == "status":
            root = Path(args.root).resolve()
            if not Path(args.db).is_absolute():
                db = (root / args.db).resolve()
            print_json(cmd_status(root, db, args.project_key))
            return

        con = connect(db)
        try:
            if args.command == "search":
                result = cmd_search(con, args, args.project_key)
            elif args.command == "sources":
                result = cmd_sources(con, args, args.project_key)
            elif args.command == "unit":
                result = cmd_unit(con, args, args.project_key)
            elif args.command == "facts":
                result = cmd_facts(con, args, args.project_key)
            elif args.command == "meta":
                result = cmd_meta(con, args.project_key)
            else:
                raise RuntimeError(f"unknown command: {args.command}")
            print_json(result)
        finally:
            con.close()
    except Exception as exc:
        print(json.dumps({"error": str(exc), "type": type(exc).__name__}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
