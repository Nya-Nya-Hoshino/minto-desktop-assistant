"""Validate the existing prepared Mint corpus without modifying training inputs."""
from pathlib import Path
import json
import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[1] / "Style-Bert-VITS2"
data = ROOT / "Data/Minto"
config = json.loads((data / "config.json").read_text(encoding="utf-8"))
train = (ROOT / config["data"]["training_files"]).read_text(encoding="utf-8").splitlines()
holdout = (ROOT / config["data"]["validation_files"]).read_text(encoding="utf-8").splitlines()
manifest = json.loads((data / "selection_manifest.json").read_text(encoding="utf-8"))
expected_train = {item["sample_filename"] for item in manifest if item["selected"] and not item["holdout"]}
expected_holdout = {item["sample_filename"] for item in manifest if item["selected"] and item["holdout"]}
actual_train = {Path(line.split("|")[0]).name for line in train}
actual_holdout = {Path(line.split("|")[0]).name for line in holdout}
if len(train) != 997 or len(holdout) != 52 or actual_train != expected_train or actual_holdout != expected_holdout:
    raise ValueError("Prepared lists do not match the selected 997/52 corpus partition")
if actual_train & actual_holdout:
    raise ValueError("Training and holdout paths overlap")
for line in train + holdout:
    parts = line.split("|")
    if len(parts) != 7 or parts[1] != "ミント" or parts[2] != "JP":
        raise ValueError("Unexpected official cleaned-list record")
    wav = ROOT / parts[0]
    for path in (wav, wav.with_suffix(".bert.pt"), Path(str(wav) + ".npy")):
        if not path.is_file():
            raise FileNotFoundError(path)
    vector = np.load(Path(str(wav) + ".npy"))
    if vector.shape != (256,) or not np.isfinite(vector).all():
        raise ValueError(f"Invalid style embedding: {wav}")
assets = ROOT / "model_assets/Minto"
neutral = np.load(assets / "style_vectors.npy")
if neutral.shape != (1, 256) or not np.isfinite(neutral).all():
    raise ValueError("Invalid Neutral style vector")
print(json.dumps({"training_count": len(train), "holdout_count": len(holdout),
                  "epochs": config["train"]["epochs"], "batch_size": config["train"]["batch_size"],
                  "fp16_run": config["train"]["fp16_run"], "cuda_available": torch.cuda.is_available(),
                  "torch_version": torch.__version__}, ensure_ascii=False))
