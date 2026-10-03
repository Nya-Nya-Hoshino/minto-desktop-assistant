"""Generate official SBV2 speaker embeddings and a training-only Neutral mean."""
from pathlib import Path
import json
import os
import sys

ROOT = Path(__file__).resolve().parent / "Style-Bert-VITS2"
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))

import numpy as np
import torch
from pyannote.audio import Inference, Model
from style_bert_vits2.constants import DEFAULT_STYLE


def main():
    data = ROOT / "Data" / "Minto"
    training = (data / "train.list").read_text(encoding="utf-8").splitlines()
    holdout = (data / "val.list").read_text(encoding="utf-8").splitlines()
    encoder = Model.from_pretrained(str(ROOT / "style_encoder" / "pytorch_model.bin"))
    inference = Inference(encoder, window="whole").to(torch.device("cuda"))
    vectors = []
    for index, line in enumerate(training + holdout):
        wav = Path(line.split("|")[0])
        target = Path(str(wav) + ".npy")
        if target.exists():
            vector = np.load(target)
        else:
            vector = inference(str(wav))
            np.save(target, vector)
        if vector.shape != (256,) or not np.isfinite(vector).all():
            raise ValueError(f"Invalid embedding: {wav}")
        if index < len(training):
            vectors.append(vector)
        if (index + 1) % 50 == 0:
            print(f"STYLE {index + 1}/{len(training) + len(holdout)}", flush=True)
    output = ROOT / "model_assets" / "Minto"
    output.mkdir(parents=True, exist_ok=True)
    np.save(output / "style_vectors.npy", np.mean(np.stack(vectors), axis=0)[None, :])
    config = json.loads((data / "config.json").read_text(encoding="utf-8"))
    config["data"]["num_styles"] = 1
    config["data"]["style2id"] = {DEFAULT_STYLE: 0}
    (output / "config.json").write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"COMPLETE: {len(training)} training, {len(holdout)} holdout; mean excludes holdout", flush=True)


if __name__ == "__main__":
    main()
