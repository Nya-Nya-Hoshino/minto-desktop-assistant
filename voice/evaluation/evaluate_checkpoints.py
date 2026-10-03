"""Generate reproducible held-out/new-text samples; report signal validity, not voice similarity."""
from pathlib import Path
import hashlib
import json
import os
import statistics
import sys
import time

VOICE = Path(__file__).resolve().parents[1]
ROOT = VOICE / "Style-Bert-VITS2"
OUTPUT = Path(__file__).resolve().parent
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

import numpy as np
import torch
from scipy.io import wavfile
from style_bert_vits2.constants import Languages
from style_bert_vits2.tts_model import TTSModel
from tensorboard.backend.event_processing.event_file_loader import EventFileLoader


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def metrics(path):
    rate, pcm = wavfile.read(path)
    signal = pcm.astype(np.float64) / 32768.0
    return {"sampling_rate": int(rate), "channels": 1 if pcm.ndim == 1 else int(pcm.shape[1]),
            "sample_dtype": str(pcm.dtype), "duration_seconds": len(pcm) / rate,
            "peak_absolute": float(np.max(np.abs(signal))),
            "rms": float(np.sqrt(np.mean(signal ** 2))),
            "pcm_rail_samples": int(np.count_nonzero((pcm == -32768) | (pcm == 32767))),
            "near_full_scale_fraction": float(np.mean(np.abs(signal) >= 0.999)),
            "finite": bool(np.isfinite(signal).all()), "sha256": sha256(path)}


def main():
    rows = [line.split("|") for line in (ROOT / "Data/Minto/val.list").read_text(encoding="utf-8").splitlines()]
    train_paths = {line.split("|")[0] for line in (ROOT / "Data/Minto/train.list").read_text(encoding="utf-8").splitlines()}
    manifest = json.loads((VOICE / "MintoCorpus/selection_manifest.json").read_text(encoding="utf-8"))
    by_filename = {entry["sample_filename"]: entry for entry in manifest}
    requested = ["min0040.wav", "min0132.wav", "min0471.wav"]
    samples = []
    for filename in requested:
        matched = [row for row in rows if Path(row[0]).name == filename]
        if len(matched) != 1:
            raise ValueError(f"Expected one exact held-out record: {filename}")
        row = matched[0]
        source = by_filename[filename]
        if not source["holdout"] or row[0] in train_paths:
            raise ValueError(f"Holdout leaked into training: {filename}")
        samples.append({"id": Path(filename).stem, "text": row[3], "kind": "heldout",
                        "original_texts": source["original_texts"], "original_path": source["original_wav"],
                        "original_sha256": sha256(Path(source["original_wav"])), "original_seconds": source["seconds"]})
    samples.append({"id": "assistant_new", "kind": "new_text",
                    "text": "マスター、おかえりなのです！ボクと一緒に、今日の予定を確認するのですよ。"})
    weights = ["Minto_e2_s1000.safetensors", "Minto_e6_s5000.safetensors", "Minto_e10_s9960.safetensors"]
    device = "cuda" if torch.cuda.is_available() else "cpu"
    report = {"device": device, "torch_version": torch.__version__, "seed_per_sample": 42,
              "inference": {"language": "JP", "speaker_id": 0, "style": "Neutral", "style_weight": 1.0, "length": 1.0, "line_split": False},
              "samples": samples, "checkpoints": [], "results": [],
              "limitations": ["No human listening or transcription score was obtained. Signal validity does not establish pronunciation, naturalness, or speaker similarity.",
                              "The official infer API normalizes float audio before PCM conversion. PCM rail counts do not measure clipping inside the generator.",
                              "Three ordinary held-out lines and one new assistant sentence cannot establish performance over all dialogue."]}
    assets = ROOT / "model_assets/Minto"
    for weight in weights:
        path = assets / weight
        report["checkpoints"].append({"path": str(path), "sha256": sha256(path), "bytes": path.stat().st_size})
        model = TTSModel(path, assets / "config.json", assets / "style_vectors.npy", device=device)
        for sample in samples:
            torch.manual_seed(42)
            np.random.seed(42)
            start = time.perf_counter()
            rate, audio = model.infer(text=sample["text"], language=Languages.JP, speaker_id=0,
                                      style="Neutral", style_weight=1.0, length=1.0, line_split=False)
            target = OUTPUT / f"{path.stem}_{sample['id']}.wav"
            wavfile.write(target, rate, audio)
            elapsed = time.perf_counter() - start
            result = {"checkpoint": weight, "sample_id": sample["id"], "path": str(target),
                      "elapsed_seconds_including_first_load": elapsed, **metrics(target)}
            report["results"].append(result)
            print(json.dumps(result, ensure_ascii=False), flush=True)
        model.unload()
        if device == "cuda":
            torch.cuda.empty_cache()
    scalar_events = {}
    training_events = sorted((ROOT / "Data/Minto/models").glob("events.out.tfevents.*"))
    for event_path in training_events:
        for event in EventFileLoader(str(event_path)).Load():
            for value in event.summary.value:
                if value.HasField("simple_value"):
                    scalar_events.setdefault(value.tag, []).append({"step": event.step, "value": value.simple_value})
                elif value.HasField("tensor") and value.tensor.float_val:
                    scalar_events.setdefault(value.tag, []).append({"step": event.step, "value": value.tensor.float_val[0]})
    report["training_scalar_summaries"] = {
        tag: {str(step): {"count": len(selected), "median": statistics.median(item["value"] for item in selected),
                         "first_step": selected[0]["step"], "last_step": selected[-1]["step"]}
              for step in (1000, 5000, 9960)
              if (selected := [item for item in entries if step - 500 < item["step"] <= step])}
        for tag, entries in scalar_events.items()}
    report["evaluation_scalar_note"] = "Official evaluate() writes generated/reference audio only; mel computation is commented out. Training loss is not held-out validation loss."
    report["corpus_audit"] = json.loads((VOICE / "MintoCorpus/audit_report.json").read_text(encoding="utf-8"))
    (OUTPUT / "checkpoint_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("WROTE checkpoint_report.json", flush=True)


if __name__ == "__main__":
    main()
