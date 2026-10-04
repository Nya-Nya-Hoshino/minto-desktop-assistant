import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import subprocess
import sys
import unittest
from unittest import mock

SCRIPT = Path(__file__).resolve().parents[1] / 'prepare_vol1.py'


class PreparationTests(unittest.TestCase):
    def api(self):
        self.assertTrue(SCRIPT.is_file(), 'Vol.1 preparation implementation is missing')
        spec = importlib.util.spec_from_file_location('prepare_vol1', SCRIPT)
        api = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(api)
        return api

    def record(self, resource, text, seconds=2, volume='Vol1', holdout=False, selected=False):
        return dict(resource=resource, original_texts=[text] if text else [], seconds=seconds,
                    audio_sha256=resource, volume=volume, chapter=1, source_rows=[],
                    holdout=holdout, selected=selected)

    def test_extract_handles_omitted_tail_and_excludes_unknown_role(self):
        api = self.api()
        book = json.loads((SCRIPT.parents[1] / 'analysis/vol1/chapter1-6963812381073233734.json').read_text(encoding='utf-8'))
        header = book['importGridList'][0]['rows'][0]
        def row(index, cells):
            return dict(rowIndex=index, strings=cells, isEmpty=0, isCommentOut=0)
        book['importGridList'] = [dict(name='exact', headerRow=0, rows=[header,
            row(1, ['', 'ミント']),
            row(2, ['', '？？？', '', '', '', '', '', '', '「えへへ」', '', 'min0019.ogg']),
            row(3, ['', 'ミント', '', '', '', '', '', '', '「えへへ」', '', 'min0019.ogg']),
            row(4, ['Voice', 'ミント', '', '', '', '', '', '', '', '', 'min0020.ogg'])])]
        accepted, excluded = api.extract_rows(book, 1, 'exact.json', 123)
        self.assertEqual([r['cells']['Voice'] for r in accepted], ['min0019.ogg', 'min0020.ogg'])
        self.assertEqual(excluded[0]['reason'], 'unresolved_role')
        self.assertEqual(excluded[0]['cells']['Arg1'], '？？？')
        self.assertEqual(accepted[0]['book_path_id'], 123)

    def test_exact_container_basename_matching_keeps_original_case(self):
        api = self.api()
        clips = [dict(serialized_container_keys=['assets/exact/min0019.ogg'], path_id=7),
                 dict(serialized_container_keys=['assets/exact/MIN0019.ogg'], path_id=8)]
        matches, issues = api.match_resources({'min0019.ogg': [], 'Min0019.ogg': []}, clips)
        self.assertEqual(matches['min0019.ogg']['path_id'], 7)
        self.assertEqual(issues['Min0019.ogg'], 'no_exact_container_basename')
        matches, issues = api.match_resources({'min0019.ogg': []}, clips + [clips[0]])
        self.assertFalse(matches)
        self.assertEqual(issues['min0019.ogg'], 'multiple_exact_audio_clips')

    def test_ruby_uses_observed_pronunciation_and_keeps_raw_text(self):
        api = self.api()
        self.assertEqual(api.clean_text('「<ruby=マスター>主人</ruby>、えへへ」'), 'マスター、えへへ')
        with self.assertRaises(ValueError):
            api.clean_text('<unverified>えへへ</unverified>')

    def test_preserves_old_holdout_and_blocks_both_old_training_hashes(self):
        api = self.api()
        old = [self.record('old-h', '旧検証', volume='Vol2', holdout=True, selected=True),
               self.record('old-t', '旧訓練', volume='Vol2', selected=True)]
        new = [self.record('new-a', '別の表現'), self.record('new-t', '旧訓練'),
               self.record('new-h', '旧検証'), self.record('new-l', 'えへへ')]
        new[0]['audio_sha256'] = 'old-t'
        result = api.select_joint(new, old, maximum_seconds=30)
        holdout = [r for r in result if r['selected'] and r['holdout']]
        self.assertIn('old-h', [r['resource'] for r in holdout])
        self.assertNotIn('new-h', [r['resource'] for r in result if r['selected']])
        self.assertTrue(all(r['resource'] not in ('new-a', 'new-t') for r in holdout))
        self.assertTrue(any(r['resource']=='new-l' and r['selected'] for r in result))
        api.validate_partition(result, old, 30)

    def test_short_laughter_and_nonlexical_forms_survive_and_repeats_reduce(self):
        api = self.api()
        rows = [self.record('one', 'えへへ'), self.record('two', 'えへへ！'),
                self.record('three', 'はあ、はあ……んっ'), self.record('four', 'え？'),
                self.record('five', ''), self.record('six', '……')]
        result = api.select_joint(rows, [], maximum_seconds=100)
        kept = [r['resource'] for r in result if r['selected']]
        self.assertIn('one', kept)
        self.assertNotIn('two', kept)
        self.assertIn('three', kept)
        self.assertIn('four', kept)
        self.assertEqual(next(r for r in result if r['resource']=='five')['reason'], 'no_exact_transcript')
        self.assertEqual(next(r for r in result if r['resource']=='six')['reason'], 'no_language_characters')

    def test_budget_is_joint_and_old_holdout_cannot_be_dropped(self):
        api = self.api()
        old = [self.record('h', '検証', seconds=20, volume='Vol2', holdout=True, selected=True)]
        new = [self.record(str(i), '独自文章' + str(i), seconds=10) for i in range(20)]
        result = api.select_joint(new, old, maximum_seconds=60)
        self.assertLessEqual(sum(r['seconds'] for r in result if r['selected']), 60)
        with self.assertRaises(ValueError):
            api.select_joint(new, old, maximum_seconds=10)
        for cap in [0, -1, 4800.1, float('nan'), float('inf')]:
            with self.assertRaises(ValueError):
                api.select_joint([], [], maximum_seconds=cap)

    def test_normalized_text_and_pcm_do_not_cross_splits(self):
        api = self.api()
        rows = [self.record('t', 'えへへ', selected=True),
                self.record('v', 'えへへ！', selected=True, holdout=True)]
        for r in rows:r['cleaned_text'] = api.clean_text(r['original_texts'][0])
        with self.assertRaises(ValueError):api.validate_partition(rows, [], 100)

    def test_laughter_coverage_has_a_duration_reservation_under_pressure(self):
        api = self.api()
        laughs = [self.record('laugh'+str(i), 'えへへ、今日は楽しかったのです'+str(i), seconds=6) for i in range(6)]
        dialogue = [self.record('d'+str(i), chr(0x4e00+i)*4 + chr(0x5000+i)*4, seconds=1) for i in range(90)]
        result = api.select_joint(dialogue+ laughs, [], maximum_seconds=60)
        self.assertGreaterEqual(sum(r['seconds'] for r in result if r['selected'] and r['speech_kind']=='laughter_expression'),6)

    def test_reselection_replaces_only_tracked_new_raw_and_preserves_originals(self):
        api = self.api()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = root/'voice/MintoCorpusV020'
            output.mkdir(parents=True)
            records = []
            for resource in ('one','two'):
                source = output/'originals/Vol1'/resource/'exact.wav'
                source.parent.mkdir(parents=True)
                source.write_bytes(resource.encode())
                record = self.record(resource,'文'+resource,selected=True)
                record.update(original_wav=str(source),sample_filename='exact.wav',
                              wav_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),cleaned_text='文'+resource)
                records.append(record)
            with mock.patch.object(api,'ROOT',root),mock.patch.object(api,'OUTPUT',output):
                api.write_corpus([records[0]])
                api.write_corpus([records[1]])
                self.assertFalse((output/'raw/Vol1/one/exact.wav').exists())
                self.assertEqual((output/'originals/Vol1/one/exact.wav').read_bytes(),b'one')
                sentinel = output/'raw/untracked.wav'
                sentinel.write_bytes(b'preserve')
                with self.assertRaises(ValueError):api.write_corpus([records[0]])
                self.assertEqual(sentinel.read_bytes(),b'preserve')

    def test_bad_selected_source_preserves_raw_lists_and_manifest_and_allows_retry(self):
        api = self.api()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = root/'voice/MintoCorpusV020'
            output.mkdir(parents=True)
            rows = []
            for volume, resource in [('Vol1','one'),('Vol2','two')]:
                source = output/'originals'/volume/resource/'exact.wav'
                source.parent.mkdir(parents=True)
                source.write_bytes(resource.encode())
                row = self.record(resource,'文'+resource,volume=volume,selected=True)
                row.update(original_wav=str(source),sample_filename='exact.wav',
                           wav_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),cleaned_text='文'+resource)
                rows.append(row)
            with mock.patch.object(api,'ROOT',root),mock.patch.object(api,'OUTPUT',output):
                api.write_corpus(rows)
                protected = [Path(r['raw_wav']) for r in rows]+[output/name for name in ['esd.list','esd_holdout.list','esd_all.list','selection_manifest.json']]
                before = {p:p.read_bytes() for p in protected}
                Path(rows[1]['original_wav']).write_bytes(b'corrupted')
                with self.assertRaises(ValueError):api.write_corpus(rows)
                self.assertEqual({p:p.read_bytes() for p in protected},before)
                Path(rows[1]['original_wav']).write_bytes(b'two')
                api.write_corpus(rows)
                self.assertEqual({p:p.read_bytes() for p in protected},before)

    def test_cli_supports_selection_only_from_verified_exports(self):
        self.api()
        process = subprocess.run([sys.executable,str(SCRIPT),'--help'],capture_output=True,text=True)
        self.assertEqual(process.returncode,0)
        self.assertIn('--selection-only',process.stdout)

    def test_unselected_old_rows_do_not_expose_old_raw_as_new_selected_audio(self):
        api = self.api()
        old = [self.record('h','検証',seconds=2,volume='Vol2',selected=True,holdout=True),
               self.record('t','以前の訓練',seconds=10,volume='Vol2',selected=True)]
        old[1].update(raw_wav='exact-old-raw.wav',raw_relative_wav='t/exact.wav')
        result = api.select_joint([],old,maximum_seconds=6)
        row = next(r for r in result if r['resource']=='t')
        self.assertFalse(row['selected'])
        self.assertNotIn('raw_wav',row)
        self.assertNotIn('raw_relative_wav',row)
        self.assertEqual(row['previous_raw_wav'],'exact-old-raw.wav')
        self.assertEqual(row['previous_raw_relative_wav'],'t/exact.wav')


class IntegrationTests(unittest.TestCase):
    def test_exported_corpus_has_preserved_holdout_and_no_leakage(self):
        path = SCRIPT.parent / 'MintoCorpusV020/selection_manifest.json'
        if not path.is_file():self.skipTest('Complete corpus export is not present')
        api = PreparationTests().api()
        old = json.loads((SCRIPT.parent / 'MintoCorpus/selection_manifest.json').read_text(encoding='utf-8'))
        rows = json.loads(path.read_text(encoding='utf-8'))
        api.validate_partition(rows, old, 4800)
        old_holdout = {r['resource'] for r in old if r['selected'] and r['holdout']}
        self.assertEqual({r['resource'] for r in rows if r['selected'] and r['holdout'] and r['volume']=='Vol2'}, old_holdout)
        selected = [r for r in rows if r['selected']]
        for r in selected:
            self.assertEqual(hashlib.sha256(Path(r['raw_wav']).read_bytes()).hexdigest(), r['wav_sha256'])
        lines = sum(len((path.parent / n).read_text(encoding='utf-8').splitlines()) for n in ['esd.list','esd_holdout.list'])
        self.assertEqual(lines,len(selected))


if __name__ == '__main__':unittest.main()
