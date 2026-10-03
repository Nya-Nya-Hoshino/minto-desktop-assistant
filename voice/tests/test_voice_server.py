import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import numpy as np
from fastapi.testclient import TestClient


SERVER = Path(__file__).resolve().parents[2] / "runtime" / "voice_server.py"


class VoiceServerTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("minto_voice_server", SERVER)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bundled = self.root / "bundled"
        model = self.bundled / "Minto"
        model.mkdir(parents=True)
        (model / "Minto.safetensors").write_bytes(b"fixture")
        (model / "config.json").write_text(json.dumps({"data": {"spk2id": {"ミント": 0}, "style2id": {"Neutral": 0}}}), encoding="utf-8")
        np.save(model / "style_vectors.npy", np.zeros((1, 256), dtype=np.float32))
        self.registry = self.module.ModelRegistry(self.bundled, self.root / "custom")
        self.client = TestClient(self.module.create_app(self.registry, "test-token"))
        self.headers = {"X-Minto-Token": "test-token"}

    def test_local_api_requires_secret_and_blocks_browser_origin(self):
        self.assertEqual(self.client.get("/models/info").status_code, 401)
        self.assertEqual(self.client.get("/models/info", headers={**self.headers, "Origin": "https://example.com"}).status_code, 403)
        response = self.client.get("/models/info", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["0"]["spk2id"], {"ミント": 0})

    def test_unknown_model_or_style_fails_before_inference(self):
        for fields in [{"model_id": "missing"}, {"model_id": "0", "style": "missing"}]:
            response = self.client.post("/voice", params={"text": "こんにちは。", **fields}, headers=self.headers)
            self.assertEqual(response.status_code, 400)

    def test_refresh_keeps_exact_custom_folder_id(self):
        import shutil
        shutil.copytree(self.bundled / "Minto", self.root / "custom" / "test-model-id")
        response = self.client.post("/models/refresh", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(self.client.get("/models/info", headers=self.headers).json()), {"0", "test-model-id"})

    def test_invalid_style_vectors_are_rejected(self):
        np.save(self.bundled / "Minto" / "style_vectors.npy", np.full((1, 256), np.nan))
        with self.assertRaises(ValueError):
            self.registry.refresh()

    def test_malformed_model_mapping_fails_refresh_without_replacing_valid_models(self):
        import shutil
        bad = self.root / "custom" / "invalid-model"
        shutil.copytree(self.bundled / "Minto", bad)
        previous = self.registry.models
        for mapping in [{"spk2id": {"ミント": "0"}, "style2id": {"Neutral": 0}}, {"spk2id": {"ミント": 0}, "style2id": {"Neutral": 99}}]:
            (bad / "config.json").write_text(json.dumps({"data": mapping}), encoding="utf-8")
            response = self.client.post("/models/refresh", headers=self.headers)
            self.assertEqual(response.status_code, 400)
            self.assertIs(self.registry.models, previous)


if __name__ == "__main__":
    unittest.main()
