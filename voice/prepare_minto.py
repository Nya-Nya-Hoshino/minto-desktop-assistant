"""Export exact audited Mint resources and build a bounded, traceable speech corpus."""
import argparse
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
from difflib import SequenceMatcher
import hashlib
import io
import json
import math
from pathlib import Path
import re
import shutil
import unicodedata
import wave


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "voice" / "MintoCorpus"
ROLES = ("ミント", "ミントパジャマ")
BOOKS = ((1, "chapter1.chapter.asset.book.json"), (2, "chapter2.chapter.asset.book.json"))


def clean_transcript(text):
    # These are the only markup tags observed in the audited dialogue Text cells.
    text = text.replace("<size=1.5em>", "").replace("</size>", "").strip()
    if text.startswith("「") and text.endswith("」"):
        text = text[1:-1]
    return text.strip()


def repetition_key(text):
    # This operates on transcript content; identifiers are never normalized.
    return "".join(c for c in unicodedata.normalize("NFKC", text)
                   if unicodedata.category(c)[0] in "LN")


def trigrams(text):
    return {text[i:i + 3] for i in range(max(1, len(text) - 2))}


def select_records(records, maximum_seconds=4800):
    validate_maximum_seconds(maximum_seconds)
    result = []
    seen_audio = set()
    seen_text = {}
    representatives = []
    eligible = []
    for original in records:
        row = dict(original, selected=False, holdout=False, cleaned_text="", reason="")
        result.append(row)
        texts = list(dict.fromkeys(original["original_texts"]))
        if len(texts) > 1:
            row["reason"] = "transcript_conflict"
            continue
        if not texts:
            row["reason"] = "no_exact_transcript"
            continue
        row["cleaned_text"] = clean_transcript(texts[0])
        if not row["cleaned_text"] or any(c in row["cleaned_text"] for c in "|\n\r"):
            row["reason"] = "invalid_training_text"
            continue
        if original["audio_sha256"] in seen_audio:
            row["reason"] = "duplicate_audio"
            continue
        seen_audio.add(original["audio_sha256"])
        key = repetition_key(row["cleaned_text"])
        if not key:
            row["reason"] = "no_language_characters"
            continue
        row["repetition_key_sha256"] = hashlib.sha256(key.encode()).hexdigest()
        if key in seen_text:
            row["reason"] = "repeated_text"
            row["repetition_representative"] = seen_text[key]
            continue
        grams = trigrams(key)
        similar = None
        for other_key, other_grams, other_resource in representatives:
            if min(len(key), len(other_key)) / max(len(key), len(other_key)) < 0.8:
                continue
            overlap = len(grams & other_grams) / len(grams | other_grams)
            if overlap >= 0.72 and SequenceMatcher(None, key, other_key).ratio() >= 0.88:
                similar = other_resource
                break
        if similar:
            row["reason"] = "near_repeated_text"
            row["repetition_representative"] = similar
            continue
        seen_text[key] = row["resource"]
        representatives.append((key, grams, row["resource"]))
        row["_grams"] = grams
        eligible.append(row)

    # Allocate the duration cap across actual chapter membership. Every chapter
    # remains represented; no scene or content category is blanket excluded.
    total_eligible = sum(r["seconds"] for r in eligible)
    totals = Counter()
    for row in eligible:
        totals[row["chapter"]] += row["seconds"]
    quotas = {chapter: maximum_seconds * seconds / total_eligible
              for chapter, seconds in totals.items()} if total_eligible else {}
    consumed = Counter()
    seen_grams = set()
    remaining = list(eligible)
    while remaining:
        allowed = [r for r in remaining if consumed[r["chapter"]] + r["seconds"] <= quotas[r["chapter"]]]
        if not allowed:
            break
        best = max(allowed, key=lambda r: (len(r["_grams"] - seen_grams) / max(r["seconds"], 0.1),
                                          len(r["_grams"] - seen_grams), r["resource"]))
        best["selected"] = True
        best["reason"] = "selected_lexical_diversity"
        consumed[best["chapter"]] += best["seconds"]
        seen_grams.update(best["_grams"])
        remaining.remove(best)
    used = sum(consumed.values())
    for row in sorted(remaining, key=lambda r: (-len(r["_grams"] - seen_grams) / max(r["seconds"], .1), r["resource"])):
        if used + row["seconds"] <= maximum_seconds:
            row["selected"] = True
            row["reason"] = "selected_remaining_budget"
            used += row["seconds"]
            seen_grams.update(row["_grams"])
        else:
            row["reason"] = "duration_budget"
    for chapter in sorted(totals):
        selected = sorted((r for r in eligible if r["selected"] and r["chapter"] == chapter),
                          key=lambda r: hashlib.sha256(r["resource"].encode()).hexdigest())
        for row in selected[:max(1, round(len(selected) * .05))]:
            row["holdout"] = True
    for row in result:
        row.pop("_grams", None)
    assert sum(r["seconds"] for r in result if r["selected"]) <= maximum_seconds
    return result


def validate_maximum_seconds(maximum_seconds):
    if not math.isfinite(maximum_seconds) or not 0 < maximum_seconds <= 4800:
        raise ValueError("maximum_seconds must be finite, positive, and at most 4800")


def write_selected_raw(manifest, output_path, workspace_root):
    workspace = Path(workspace_root).resolve()
    output = Path(output_path).resolve()
    if output == workspace or not output.is_relative_to(workspace):
        raise ValueError("Corpus output must be a directory within the workspace")
    raw = output / "raw"
    # Validate the final absolute recursive-deletion target before touching it.
    # Resolving a link/junction must not redirect deletion to another directory.
    if raw.resolve() != raw or not raw.is_relative_to(workspace):
        raise ValueError("Raw replacement target must be the corpus raw directory")
    originals = output / "originals"
    copies = []
    relative_paths = set()
    for row in manifest:
        if not row["selected"]:
            continue
        relative = Path(row["resource"]) / row["sample_filename"]
        destination = raw / relative
        source = Path(row["original_wav"]).resolve()
        if (relative.is_absolute() or not destination.resolve().is_relative_to(raw)
                or not source.is_relative_to(originals) or not source.is_file()):
            raise ValueError("Selected WAV paths must stay within corpus originals and raw")
        if relative in relative_paths:
            raise ValueError("Selected WAV paths must be unique")
        relative_paths.add(relative)
        copies.append((row, relative, source, destination))
    if raw.exists():
        shutil.rmtree(raw)
    raw.mkdir(parents=True)
    for row, relative, source, destination in copies:
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
        row["raw_wav"] = str(destination)
        row["raw_relative_wav"] = relative.as_posix()


def export_resource(job):
    import UnityPy
    resource, source, metadata, output_path = job
    bundle = Path(source["bundle"])
    env = UnityPy.load(str(bundle))
    clips = []
    for obj in env.objects:
        if obj.type.name == "AudioClip":
            data = obj.read()
            if data.m_Name == metadata["clip_name"]:
                clips.append((obj, data))
    if len(clips) != 1:
        raise ValueError(f"Exact audited clip_name did not identify one AudioClip: {resource}")
    obj, data = clips[0]
    samples = data.samples
    if len(samples) != 1:
        raise ValueError(f"Expected one exported sample for audited resource: {resource}")
    sample_name, wav_bytes = next(iter(samples.items()))
    if Path(sample_name).name != sample_name:
        raise ValueError("AudioClip sample filename must be a basename")
    actual_path = Path(output_path) / "originals" / resource / sample_name
    actual_path.parent.mkdir(parents=True, exist_ok=True)
    actual_path.write_bytes(wav_bytes)
    with wave.open(io.BytesIO(wav_bytes), "rb") as wav:
        frame_count = wav.getnframes()
        frequency = wav.getframerate()
        channels = wav.getnchannels()
        sample_width = wav.getsampwidth()
        pcm = wav.readframes(frame_count)
    seconds = frame_count / frequency
    if frequency != metadata["frequency"] or channels != metadata["channels"]:
        raise ValueError(f"Exported WAV format differs from audit: {resource}")
    if abs(seconds - metadata["seconds"]) > .002:
        raise ValueError(f"Exported duration differs from audit: {resource}")
    return {"resource": resource, "bundle": str(bundle), "audit_asset": source["asset"],
            "serialized_container_keys": [key for key, reader in env.container.items() if reader.path_id == obj.path_id],
            "clip_name": data.m_Name, "path_id": obj.path_id,
            "sample_filename": sample_name, "original_wav": str(actual_path),
            "bundle_sha256": hashlib.sha256(bundle.read_bytes()).hexdigest(),
            "wav_sha256": hashlib.sha256(wav_bytes).hexdigest(),
            "audio_sha256": hashlib.sha256(pcm).hexdigest(),
            "seconds": seconds, "frames": frame_count, "frequency": frequency,
            "channels": channels, "sample_width": sample_width}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--maximum-seconds", type=float, default=4800)
    args = parser.parse_args()
    validate_maximum_seconds(args.maximum_seconds)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    audit = json.loads((ROOT / "analysis" / "minto_voice_resource_audit.json").read_text(encoding="utf-8"))
    metadata_audit = json.loads((ROOT / "analysis" / "minto_voice_metadata_audit.json").read_text(encoding="utf-8"))
    metadata = {row["resource"]: row for row in metadata_audit["metadata"]}
    rows_by_resource = defaultdict(list)
    book_hashes = {}
    for chapter, filename in BOOKS:
        book_path = ROOT / "analysis" / filename
        book_hashes[filename] = hashlib.sha256(book_path.read_bytes()).hexdigest()
        book = json.loads(book_path.read_text(encoding="utf-8"))
        for grid in book["importGridList"]:
            headers = next(row["strings"] for row in grid["rows"] if row["rowIndex"] == grid["headerRow"])
            for row in grid["rows"]:
                if row["rowIndex"] == grid["headerRow"] or row["isCommentOut"] or row["isEmpty"]:
                    continue
                cells = dict(zip(headers, row["strings"]))
                if cells["Arg1"] in ROLES and cells["Voice"]:
                    if cells["Command"] not in ("", "Voice"):
                        raise ValueError("Unverified voice command encountered")
                    rows_by_resource[cells["Voice"]].append({"book": filename, "chapter": chapter,
                        "grid": grid["name"], "rowIndex": row["rowIndex"], "cells": cells})
    if set(rows_by_resource) != set(audit["resources"]) or set(metadata) != set(audit["resources"]):
        raise ValueError("Exact transcript/audit resource sets differ")
    jobs = [(resource, source, metadata[resource], str(OUTPUT))
            for resource, source in audit["resources"].items()]
    exported = []
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        for index, result in enumerate(pool.map(export_resource, jobs), 1):
            exported.append(result)
            if index % 100 == 0:
                print(f"Exported and verified {index}/{len(jobs)} original WAVs", flush=True)
    for row in exported:
        row["source_rows"] = rows_by_resource[row["resource"]]
        row["chapter"] = min(source["chapter"] for source in row["source_rows"])
        row["original_texts"] = list(dict.fromkeys(source["cells"]["Text"] for source in row["source_rows"]
                                   if source["cells"]["Command"] == "" and source["cells"]["Text"]))
    manifest = select_records(exported, args.maximum_seconds)
    write_selected_raw(manifest, OUTPUT, ROOT)
    lists = {"esd.list": [], "esd_holdout.list": [], "esd_all.list": []}
    for row in manifest:
        if not row["selected"]:
            continue
        line = f"{row['raw_relative_wav']}|ミント|JP|{row['cleaned_text']}\n"
        assert len(line.strip().split("|")) == 4
        lists["esd_all.list"].append(line)
        lists["esd_holdout.list" if row["holdout"] else "esd.list"].append(line)
    for name, lines in lists.items():
        (OUTPUT / name).write_text("".join(lines), encoding="utf-8")
    (OUTPUT / "selection_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    selected = [row for row in manifest if row["selected"]]
    report = {"original_count": len(exported), "original_seconds": sum(r["seconds"] for r in exported),
        "source_row_count": sum(len(r["source_rows"]) for r in manifest),
        "selected_count": len(selected), "selected_seconds": sum(r["seconds"] for r in selected),
        "training_count": sum(not r["holdout"] for r in selected),
        "training_seconds": sum(r["seconds"] for r in selected if not r["holdout"]),
        "holdout_count": sum(r["holdout"] for r in selected),
        "holdout_seconds": sum(r["seconds"] for r in selected if r["holdout"]),
        "selected_by_chapter": dict(Counter(r["chapter"] for r in selected)),
        "reasons": dict(Counter(r["reason"] for r in manifest)),
        "book_sha256": book_hashes, "maximum_seconds": args.maximum_seconds,
        "frequency": sorted(set(r["frequency"] for r in exported)),
        "channels": sorted(set(r["channels"] for r in exported)),
        "selection_method": "Exact PCM-hash deduplication; original resource transcript conflict quarantine; punctuation-insensitive transcript deduplication; character-trigram Jaccard >= 0.72 plus SequenceMatcher >= 0.88 for near repetition. Duration quota proportional to actual chapter durations, followed by greedy novel trigram coverage per second. This lexical heuristic approximates repetition, not full semantic equivalence. No scene-based exclusion. Only exact Text from blank Command rows labels audio; Voice-only resources remain in originals with no invented transcript. Five percent deterministic resource-hash holdout per chapter; main esd.list excludes holdout.",
        "limitations": ["Source script pairing and duration/format verified; acoustic word-by-word alignment requires listening review.", "A lexical heuristic cannot establish all semantic equivalence."],
        "official_parser": "preprocess_text.py process_line expects utt|spk|language|text; constants.py Languages.JP = JP; resample.py preserves relative paths recursively."}
    (OUTPUT / "audit_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    main()
