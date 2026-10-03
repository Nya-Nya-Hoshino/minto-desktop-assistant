"""Local authenticated adapter for the bundled Style-Bert-VITS2 runtime."""
import argparse
import hmac
import io
import json
import os
from pathlib import Path
import re
import socket
import threading
import wave

import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response


class ModelRegistry:
    def __init__(self, bundled, custom):
        self.bundled, self.custom = Path(bundled), Path(custom)
        self.custom.mkdir(parents=True, exist_ok=True)
        self.models = {}
        self.loaded = None
        self.loaded_id = None
        self.lock = threading.Lock()
        self.refresh()

    def refresh(self):
        models = {}
        folders = [("0", self.bundled / "Minto")]
        folders += [(folder.name, folder) for folder in sorted(self.custom.iterdir()) if folder.is_dir()]
        for model_id, folder in folders:
            if not folder.exists():
                continue
            weights = list(folder.glob("*.safetensors"))
            if len(weights) != 1:
                raise ValueError("Each model folder must contain exactly one .safetensors file")
            config = json.loads((folder / "config.json").read_text(encoding="utf-8"))
            speaker, styles = config["data"]["spk2id"], config["data"]["style2id"]
            n_speakers = config["data"].get("n_speakers", 1)
            if type(n_speakers) is not int or n_speakers < 1 or not isinstance(speaker, dict) or not isinstance(styles, dict) or not speaker or not styles:
                raise ValueError("Invalid speaker/style mapping")
            for mapping, limit in [(speaker, n_speakers), (styles, len(styles))]:
                if any(not isinstance(name, str) or not name or type(identifier) is not int or not 0 <= identifier < limit for name, identifier in mapping.items()) or len(set(mapping.values())) != len(mapping):
                    raise ValueError("Invalid speaker/style identifiers")
            vector_path = folder / "style_vectors.npy"
            vectors = np.load(vector_path, allow_pickle=False)
            if not speaker or not styles or vectors.shape != (len(styles), 256) or not np.isfinite(vectors).all():
                raise ValueError("Invalid model speaker/style metadata or vectors")
            models[model_id] = {"model_path": str(weights[0]), "config_path": str(folder / "config.json"), "style_vec_path": str(vector_path), "spk2id": speaker, "style2id": styles}
        self.models = models
        return models

    def synthesize(self, text, model_id, speaker_name, style, length, style_weight):
        with self.lock:
            info = self.models.get(model_id)
            if info is None:
                raise ValueError("Unknown voice model")
            speaker_name = speaker_name or next(iter(info["spk2id"]))
            style = style or next(iter(info["style2id"]))
            if speaker_name not in info["spk2id"] or style not in info["style2id"]:
                raise ValueError("Unknown speaker or style")
            from style_bert_vits2.constants import Languages
            from style_bert_vits2.tts_model import TTSModel
            if self.loaded_id != model_id:
                if self.loaded is not None:
                    self.loaded.unload()
                self.loaded = TTSModel(Path(info["model_path"]), Path(info["config_path"]), Path(info["style_vec_path"]), device="cpu")
                self.loaded_id = model_id
            clips = []
            rate = 44100
            for sentence in re.split(r"(?<=[。！？\n])", text):
                for offset in range(0, len(sentence), 100):
                    chunk = sentence[offset:offset + 100].strip()
                    if not chunk:
                        continue
                    rate, audio = self.loaded.infer(chunk, language=Languages.JP, speaker_id=info["spk2id"][speaker_name], style=style, style_weight=style_weight, length=length, line_split=False)
                    clips.extend([audio, np.zeros(int(rate * 0.12), dtype=np.int16)])
            if not clips:
                raise ValueError("Empty voice text")
            buffer = io.BytesIO()
            with wave.open(buffer, "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(rate)
                wav.writeframes(np.concatenate(clips).astype("<i2").tobytes())
            return buffer.getvalue()


def create_app(registry, token):
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def authorize(request: Request, call_next):
        if request.headers.get("origin"):
            return Response(status_code=403)
        if not hmac.compare_digest(request.headers.get("x-minto-token", ""), token):
            return Response(status_code=401)
        return await call_next(request)

    @app.get("/models/info")
    def models_info():
        return registry.models

    @app.post("/models/refresh")
    def models_refresh():
        try:
            with registry.lock:
                return registry.refresh()
        except (ValueError, KeyError, TypeError, OSError) as error:
            raise HTTPException(400, str(error)) from error

    @app.post("/voice")
    def voice(text: str, model_id: str = "0", speaker_name: str = "", style: str = "", language: str = "JP", length: float = 1, style_weight: float = 1, auto_split: bool = False):
        if not text.strip() or len(text) > 12000 or language != "JP" or not 0.1 <= length <= 5 or not 0.1 <= style_weight <= 5:
            raise HTTPException(400, "Invalid Japanese voice request")
        info = registry.models.get(model_id)
        if info is None or (speaker_name and speaker_name not in info["spk2id"]) or (style and style not in info["style2id"]):
            raise HTTPException(400, "Unknown model, speaker, or style")
        try:
            return Response(registry.synthesize(text, model_id, speaker_name, style, length, style_weight), media_type="audio/wav")
        except ValueError as error:
            raise HTTPException(400, str(error)) from error

    return app


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", required=True)
    parser.add_argument("--port", type=int, default=0)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    os.chdir(root)
    token = os.environ.pop("MINTO_VOICE_TOKEN")
    registry = ModelRegistry(root / "model_assets", Path(args.data_root))
    import uvicorn
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", args.port))
    listener.listen(128)
    print(json.dumps({"event": "ready", "port": listener.getsockname()[1]}), flush=True)
    server = uvicorn.Server(uvicorn.Config(create_app(registry, token), log_level="warning", access_log=False))
    server.run(sockets=[listener])
