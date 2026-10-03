import importlib.util
import hashlib
import json
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path
import wave


SCRIPT = Path(__file__).resolve().parents[1] / "prepare_minto.py"


class CorpusSelectionTests(unittest.TestCase):
    def api(self):
        self.assertTrue(SCRIPT.is_file(), "Corpus selection implementation is missing")
        spec = importlib.util.spec_from_file_location("prepare_minto", SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    @staticmethod
    def record(resource, text, seconds=10, audio_sha256=None, chapter=2):
        return {"resource": resource, "original_texts": [text] if text else [],
                "seconds": seconds, "audio_sha256": audio_sha256 or resource,
                "chapter": chapter, "source_rows": []}

    def test_training_and_holdout_together_stay_within_budget(self):
        api = self.api()
        records = [self.record(str(i), "独自の文章" + str(i), 1000) for i in range(20)]
        result = api.select_records(records, maximum_seconds=4800)
        self.assertLessEqual(sum(r["seconds"] for r in result if r["selected"]), 4800)
        self.assertGreater(sum(r["selected"] for r in result), 0)

    def test_same_audio_bytes_are_not_selected_twice(self):
        api = self.api()
        records = [self.record("one", "今日は晴れです", audio_sha256="same"),
                   self.record("two", "明日は雨です", audio_sha256="same")]
        result = api.select_records(records)
        self.assertEqual(sum(r["selected"] for r in result), 1)
        self.assertIn("duplicate_audio", [r["reason"] for r in result])

    def test_conflicting_resource_transcripts_are_quarantined(self):
        api = self.api()
        record = self.record("conflict", "今日は晴れです")
        record["original_texts"].append("明日は雨です")
        result = api.select_records([record])
        self.assertFalse(result[0]["selected"])
        self.assertEqual(result[0]["reason"], "transcript_conflict")

    def test_untranscribed_audio_is_preserved_but_not_labeled(self):
        api = self.api()
        result = api.select_records([self.record("sound", "")])
        self.assertFalse(result[0]["selected"])
        self.assertEqual(result[0]["cleaned_text"], "")
        self.assertEqual(result[0]["reason"], "no_exact_transcript")

    def test_repeated_text_is_reduced_and_chapter_one_remains_eligible(self):
        api = self.api()
        records = [self.record("one", "「今日は晴れです。」", chapter=1),
                   self.record("two", "「今日は晴れです！」"),
                   self.record("three", "「明日は雨です。」", chapter=1)]
        result = api.select_records(records)
        self.assertEqual(sum(r["selected"] for r in result), 2)
        self.assertTrue(any(r["selected"] and r["chapter"] == 1 for r in result))

    def test_markup_cleaning_preserves_spoken_words(self):
        api = self.api()
        self.assertEqual(api.clean_transcript("「<size=1.5em>こんにちは</size>」"), "こんにちは")

    def test_selection_rejects_invalid_caps(self):
        api = self.api()
        for cap in [float("nan"), float("inf"), -float("inf"), 0, -1, 4800.01]:
            with self.subTest(cap=cap):
                rejected = False
                try:
                    api.select_records([], maximum_seconds=cap)
                except ValueError:
                    rejected = True
                except Exception:
                    pass
                self.assertTrue(rejected, "Invalid cap must raise ValueError")

    def test_cli_rejects_invalid_caps_before_output_creation_or_export(self):
        api = self.api()
        for value in ["nan", "inf", "-inf", "0", "-1", "4800.01"]:
            with self.subTest(value=value), tempfile.TemporaryDirectory() as temporary:
                output = Path(temporary) / "untouched"
                with mock.patch.object(api, "OUTPUT", output), mock.patch.object(
                    sys, "argv", [str(SCRIPT), "--maximum-seconds=" + value]
                ), mock.patch.object(api, "ProcessPoolExecutor", side_effect=ValueError("export reached")) as executor:
                    try:
                        api.main()
                    except ValueError:
                        pass
                    self.assertFalse(output.exists(), "Invalid cap must be rejected before filesystem writes")
                    executor.assert_not_called()

    def test_lower_cap_rerun_replaces_raw_set_and_preserves_originals(self):
        api = self.api()
        self.assertTrue(hasattr(api, "write_selected_raw"), "Exact selected-raw replacement is missing")
        with tempfile.TemporaryDirectory() as temporary:
            workspace = Path(temporary)
            output = workspace / "corpus"
            records = [self.record("one", "今日は晴れです", seconds=10),
                       self.record("two", "海で魚が泳ぐ", seconds=10),
                       self.record("three", "電車に乗ります", seconds=10)]
            original_hashes = {}
            for index, row in enumerate(records):
                original = output / "originals" / row["resource"] / "source.wav"
                original.parent.mkdir(parents=True, exist_ok=True)
                with wave.open(str(original), "wb") as wav:
                    wav.setnchannels(1)
                    wav.setsampwidth(2)
                    wav.setframerate(44100)
                    wav.writeframes(bytes([index, 0]) * 32)
                row.update(original_wav=str(original), sample_filename="source.wav")
                original_hashes[original] = hashlib.sha256(original.read_bytes()).hexdigest()
            first = api.select_records(records, maximum_seconds=30)
            api.write_selected_raw(first, output, workspace)
            self.assertEqual(len(list((output / "raw").rglob("*.wav"))), 3)
            second = api.select_records(records, maximum_seconds=10)
            api.write_selected_raw(second, output, workspace)
            actual = {p.relative_to(output / "raw").as_posix() for p in (output / "raw").rglob("*") if p.is_file()}
            self.assertEqual(actual, {r["raw_relative_wav"] for r in second if r["selected"]})
            self.assertEqual(len(actual), 1)
            for original, digest in original_hashes.items():
                self.assertEqual(hashlib.sha256(original.read_bytes()).hexdigest(), digest)

    def test_raw_replacement_rejects_output_outside_workspace(self):
        api = self.api()
        self.assertTrue(hasattr(api, "write_selected_raw"), "Guarded selected-raw replacement is missing")
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            workspace = parent / "workspace"
            workspace.mkdir()
            outside = parent / "outside"
            sentinel = outside / "raw" / "keep.txt"
            sentinel.parent.mkdir(parents=True)
            sentinel.write_text("preserve", encoding="utf-8")
            with self.assertRaises(ValueError):
                api.write_selected_raw([], outside, workspace)
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "preserve")


class ExportedCorpusAuditTests(unittest.TestCase):
    def test_every_original_wav_matches_manifest_and_audited_metadata(self):
        root = SCRIPT.parents[1]
        output = SCRIPT.parent / "MintoCorpus"
        manifest_path = output / "selection_manifest.json"
        if not manifest_path.is_file():
            self.skipTest("Run complete export before integration audit")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        audit = json.loads((root / "analysis" / "minto_voice_resource_audit.json").read_text(encoding="utf-8"))
        metadata = json.loads((root / "analysis" / "minto_voice_metadata_audit.json").read_text(encoding="utf-8"))
        self.assertEqual({r["resource"] for r in manifest}, set(audit["resources"]))
        self.assertEqual(len(list((output / "originals").rglob("*.wav"))), len(manifest))
        seconds = 0
        for row in manifest:
            path = Path(row["original_wav"])
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), row["wav_sha256"])
            self.assertTrue(row["serialized_container_keys"])
            with wave.open(str(path), "rb") as wav:
                self.assertEqual(wav.getnchannels(), 1)
                self.assertEqual(wav.getframerate(), 44100)
                self.assertEqual(wav.getnframes(), row["frames"])
                pcm = wav.readframes(wav.getnframes())
                self.assertEqual(hashlib.sha256(pcm).hexdigest(), row["audio_sha256"])
                seconds += wav.getnframes() / wav.getframerate()
        self.assertAlmostEqual(seconds, metadata["total_seconds"], places=3)

    def test_training_holdout_partition_and_source_text_pairing(self):
        output = SCRIPT.parent / "MintoCorpus"
        manifest_path = output / "selection_manifest.json"
        if not manifest_path.is_file():
            self.skipTest("Run complete export before integration audit")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        selected = [r for r in manifest if r["selected"]]
        self.assertLessEqual(sum(r["seconds"] for r in selected), 4800)
        self.assertEqual(len({r["audio_sha256"] for r in selected}), len(selected))
        by_path = {r["raw_relative_wav"]: r for r in selected}
        train = (output / "esd.list").read_text(encoding="utf-8").splitlines()
        holdout = (output / "esd_holdout.list").read_text(encoding="utf-8").splitlines()
        seen = set()
        for is_holdout, lines in [(False, train), (True, holdout)]:
            for line in lines:
                fields = line.split("|")
                self.assertEqual(len(fields), 4)
                relative, role, language, text = fields
                row = by_path[relative]
                self.assertEqual((role, language), ("ミント", "JP"))
                self.assertEqual(row["cleaned_text"], text)
                self.assertEqual(row["holdout"], is_holdout)
                self.assertNotIn(relative, seen)
                seen.add(relative)
                self.assertEqual(hashlib.sha256((output / "raw" / relative).read_bytes()).hexdigest(), row["wav_sha256"])
                self.assertEqual(len(row["original_texts"]), 1)
                self.assertTrue(any(s["cells"]["Command"] == "" and s["cells"]["Text"] == row["original_texts"][0]
                                    for s in row["source_rows"]))
        self.assertEqual(seen, set(by_path))
        self.assertTrue(any(r["chapter"] == 1 for r in selected))


if __name__ == "__main__":
    unittest.main()
