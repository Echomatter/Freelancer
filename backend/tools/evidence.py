"""Freelancer evidence maintenance. Deterministic, bounded, no model ranking changes."""
import argparse
import copy
import hashlib
import json
import math
import os
import uuid
from contextlib import contextmanager
from pathlib import Path
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from urllib.parse import urlparse


def pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"), object_pairs_hook=pairs)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + f".{uuid.uuid4().hex}.tmp")
    try:
        temp.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def validate(evidence, roster):
    errors = []
    models, sources = evidence.get("models", {}), evidence.get("sources", {})
    if evidence.get("schema_version") != 2 or not models:
        errors.append("Expected populated schema_version 2")
    aliases = evidence.get("alias_index", {})
    for alias, key in aliases.items():
        if key not in models:
            errors.append(f"Alias {alias} references missing model {key}")
    for route in roster.get("eligible_models", []):
        if route["id"] not in aliases:
            errors.append(f"Inventory route missing alias: {route['id']}")
    for key, model in models.items():
        refs = list(model.get("source_keys", [])) + list(model.get("context", {}).get("evidence", []))
        for name, cap in model.get("capabilities", {}).items():
            if cap.get("rating") not in ("unknown", "weak", "adequate", "good", "strong"):
                errors.append(f"{key}.{name}: invalid capability rating")
            if cap.get("confidence") not in ("low", "medium", "high"):
                errors.append(f"{key}.{name}: invalid confidence")
            refs.extend(cap.get("evidence", []))
            if cap.get("rating") not in ("unknown", "weak") and not cap.get("evidence"):
                errors.append(f"{key}.{name}: positive rating has no source")
        for benchmark in model.get("benchmarks", []):
            refs.append(benchmark.get("source"))
            for field in ("score", "value"):
                value = benchmark.get(field)
                if value is not None and (not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0):
                    errors.append(f"{key}: invalid benchmark {field}")
        for field, value in model.get("context", {}).items():
            if "tokens" in field and value is not None and (not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0):
                errors.append(f"{key}: invalid context {field}")
        for ref in refs:
            if ref not in sources:
                errors.append(f"{key}: unregistered source {ref}")
    for key, source in sources.items():
        date = source.get("retrieved_at")
        if date:
            try:
                if datetime.fromisoformat(date.replace("Z", "+00:00")).date() > datetime.now(timezone.utc).date():
                    errors.append(f"{key}: future retrieval date")
            except (ValueError, AttributeError):
                errors.append(f"{key}: invalid retrieval date")
    return errors


def coverage(evidence, roster):
    """Profile completion is distinct from universal benchmark verification."""
    models, aliases, sources = evidence.get("models", {}), evidence.get("alias_index", {}), evidence.get("sources", {})
    incomplete = []
    for route in roster.get("eligible_models", []):
        model = models.get(aliases.get(route["id"]), {})
        missing = [key for key in ("positioning", "source_keys", "last_researched_at", "capabilities") if not model.get(key)]
        if any(key not in sources for key in model.get("source_keys", [])):
            missing.append("registered_sources")
        if missing:
            incomplete.append({"route": route["id"], "missing": missing})
    total = len(roster.get("eligible_models", []))
    return {"status": "complete" if total and not incomplete else "needs_research",
            "routes": total, "completed_routes": total - len(incomplete), "incomplete": incomplete,
            "meaning": "A sourced, dated decision profile exists for every route. Unmeasured benchmarks and disclosed limitations do not reopen completed research or imply inability. This is not independent verification of every claim."}


def complete(root):
    target = root / "routing/model-evidence.json"
    with exclusive(target.with_suffix(".json.lock")):
        evidence, roster = read(target), read(root / "routing/model-roster.json")
        errors = validate(evidence, roster)
        result = coverage(evidence, roster)
        if errors or result["status"] != "complete":
            raise ValueError("Cannot complete unsourced or invalid profiles: " + json.dumps(errors or result["incomplete"]))
        evidence["advisor_readiness"] = "READY"
        evidence["readiness_reason"] = result["meaning"]
        evidence["routing_coverage"] = result
        # Record this audit separately; never freshen model/source research dates.
        evidence["routing_coverage"]["checked_at"] = datetime.now(timezone.utc).isoformat()
        write(target, evidence)
        return result


def status(evidence, roster, size=3):
    models, aliases = evidence["models"], evidence["alias_index"]
    routes = {r["id"] for r in roster["eligible_models"]}
    queue, limitations = [], []
    profile_coverage = coverage(evidence, roster)
    incomplete_routes = {r["route"] for r in profile_coverage["incomplete"]}
    for key, model in models.items():
        live = [a for a, target in aliases.items() if target == key and a in routes]
        if not live:
            continue
        gaps = model.get("research_gaps", [])
        missing = [k for k in sorted({"coding", "tool_use"} | set(model.get("capabilities", {})))
                   if model.get("capabilities", {}).get(k, {}).get("rating", "unknown") == "unknown"]
        if gaps or missing or any(r in incomplete_routes for r in live):
            bucket = queue if any(r in incomplete_routes for r in live) else limitations
            bucket.append({"model": key, "routes": live, "unmeasured_capabilities": missing,
                          "research_gaps": gaps, "sources": model.get("source_keys", []),
                          "last_researched_at": model.get("last_researched_at")})
    queue.sort(key=lambda row: (row["last_researched_at"] or "", row["model"]))
    unresolved_routes = [row for row in profile_coverage["incomplete"]
                         if aliases.get(row["route"]) not in models]
    return {"routing_coverage": profile_coverage,
            "routes_needing_registration": unresolved_routes,
            "counts": {"routes": len(routes), "models": len(models), "sources": len(evidence["sources"]), "models_needing_research": len(queue), "routes_needing_registration": len(unresolved_routes), "models_with_disclosed_limitations": len(limitations)},
            "disclosed_limitations": limitations,
            "next_batch": queue[:size], "remaining_models": [r["model"] for r in queue[size:]],
            "instruction": "Completed profiles are ready for host reasoning. Disclosed limitations are not unfinished research or a routing block. Refresh a completed profile only for a changed fact, task-critical question or explicit request. Resolve routes_needing_registration through inventory/alias maintenance before model research. Research at most next_batch or requested IDs; retain original source dates and benchmark caveats."}


def merge(old, patch):
    result = copy.deepcopy(old)
    for key, value in patch.items():
        result[key] = merge(result.get(key, {}), value) if isinstance(value, dict) else copy.deepcopy(value)
    return result


@contextmanager
def exclusive(lock):
    # OS releases the byte/advisory lock on process exit, including crashes.
    # Keep the lock inode: deleting it creates races with waiting writers.
    with open(lock, "a+b") as handle:
        if os.name == "nt":
            import msvcrt
            if handle.tell() == 0:
                handle.write(b"0")
                handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            if os.name == "nt":
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle, fcntl.LOCK_UN)


def apply(root, batch):
    target = root / "routing/model-evidence.json"
    lock = target.with_suffix(".json.lock")
    with exclusive(lock):
        base = batch.get("base_sha256", "")
        if len(base) != 64 or any(c not in "0123456789abcdef" for c in base):
            raise ValueError("Invalid base_sha256; show the affected models again")
        journal_path = root / f".state/evidence/accepted/{base}.json"
        journal = read(journal_path) if journal_path.exists() else None
        if journal and journal.get("batch") == batch and journal.get("candidate_sha256") == digest(target):
            journal["status"] = "applied"
            write(journal_path, journal)
            return {"accepted_models": list(batch["models"]), "sha256": digest(target), "already_applied": True}
        if batch.get("base_sha256") != digest(target):
            raise ValueError("Evidence changed since this batch was prepared; show the affected models again")
        if set(batch) - {"base_sha256", "sources", "models"}:
            raise ValueError("Batches update sources/models only; no policy, aliases or scoring changes")
        if not 1 <= len(batch.get("models", {})) <= 3:
            raise ValueError("Use one to three models per accepted batch")
        old = read(target)
        if set(batch["models"]) - set(old["models"]):
            raise ValueError("Refresh inventory before researching a newly discovered model")
        for key, source in batch.get("sources", {}).items():
            capture_id = source.get("capture_id", "")
            if len(capture_id) != 64 or any(c not in "0123456789abcdef" for c in capture_id):
                raise ValueError(f"{key}: capture the source URL before adding/refreshing its retrieval claim")
            proof = read(root / f".state/evidence/captures/{capture_id}.json")
            if proof["url"] != source.get("url") or proof["retrieved_at"] != source.get("retrieved_at"):
                raise ValueError(f"{key}: source does not match its actual retrieval receipt")
            if hashlib.sha256(json.dumps(proof, sort_keys=True).encode()).hexdigest() != capture_id or digest(root / f".state/evidence/captures/{capture_id}.source") != proof["sha256"]:
                raise ValueError(f"{key}: capture content or receipt changed")
        candidate = merge(old, {"models": batch["models"], "sources": batch.get("sources", {})})
        errors = validate(candidate, read(root / "routing/model-roster.json"))
        if errors:
            raise ValueError("; ".join(errors))
        # No global evidence-age/readiness bump. Only supplied model/source fields change.
        candidate_bytes = (json.dumps(candidate, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
        journal = {"status": "prepared", "batch": batch, "candidate_sha256": hashlib.sha256(candidate_bytes).hexdigest()}
        write(journal_path, journal)
        write(target, candidate)
        journal["status"] = "applied"
        write(journal_path, journal)
        return {"accepted_models": list(batch["models"]), "sha256": digest(target), "validation": "schema and references verified; claims still require source review"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("status", "show", "validate", "capture", "apply", "complete"))
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--models", nargs="+")
    parser.add_argument("--batch", type=Path)
    parser.add_argument("--url")
    args = parser.parse_args()
    root = args.root.resolve()
    target = root / "routing/model-evidence.json"
    if args.operation == "complete":
        result = complete(root)
    elif args.operation == "capture":
        if not args.url or urlparse(args.url).scheme != "https" or urlparse(args.url).username:
            raise ValueError("Use a public HTTPS source URL without credentials")
        req = Request(args.url, headers={"User-Agent": "Freelancer-Evidence/1.0"})
        with urlopen(req, timeout=30) as response:
            content = response.read(16 * 1024 * 1024 + 1)
            if len(content) > 16 * 1024 * 1024:
                raise ValueError("Source exceeds bounded capture limit")
            result = {"url": args.url, "resolved_url": response.url, "retrieved_at": datetime.now(timezone.utc).isoformat(),
                      "sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content)}
        capture_id = hashlib.sha256(json.dumps(result, sort_keys=True).encode()).hexdigest()
        dest = root / ".state/evidence/captures"
        dest.mkdir(parents=True, exist_ok=True)
        (dest / f"{capture_id}.source").write_bytes(content)
        write(dest / f"{capture_id}.json", result)
        result["capture_id"] = capture_id
    elif args.operation == "apply":
        if not args.batch:
            raise ValueError("--batch is required")
        result = apply(root, read(args.batch))
    else:
        evidence, roster = read(target), read(root / "routing/model-roster.json")
        if args.operation == "validate":
            errors = validate(evidence, roster)
            if errors:
                raise ValueError("; ".join(errors))
            result = {"valid": True, **status(evidence, roster)["counts"]}
        elif args.operation == "show":
            if not args.models or len(args.models) > 3:
                raise ValueError("--models accepts one to three model IDs or aliases")
            keys = [evidence["alias_index"].get(key, key) for key in args.models]
            selected = {key: evidence["models"][key] for key in keys}
            source_keys = {key for model in selected.values() for key in model.get("source_keys", [])}
            result = {"base_sha256": digest(target), "models": selected,
                      "sources": {key: evidence["sources"][key] for key in source_keys}}
        else:
            result = {"base_sha256": digest(target), **status(evidence, roster)}
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError) as error:
        raise SystemExit(str(error))
