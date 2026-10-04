"""Audit and prepare the isolated joint Vol.1/Vol.2 corpus; no training steps."""
import argparse
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
from difflib import SequenceMatcher
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tempfile
import wave

ROOT = Path(__file__).resolve().parents[1]
_previous_spec = importlib.util.spec_from_file_location('prepare_minto', ROOT / 'voice' / 'prepare_minto.py')
previous = importlib.util.module_from_spec(_previous_spec)
_previous_spec.loader.exec_module(previous)
SOURCE = Path('G:/Gal/家喵二三事Vol.1/Nekomimi Sweet Housemates_Data/StreamingAssets/MyPetProject2/Windows')
AUDIT = ROOT / 'analysis' / 'vol1'
OUTPUT = ROOT / 'voice' / 'MintoCorpusV020'
HEADERS = ['Command', 'Arg1', 'Arg2', 'Arg3', 'Arg4', 'Arg5', 'Arg6', 'WaitType', 'Text', 'PageCtrl', 'Voice', 'WindowType', 'English', 'ChineseSimplified']
RUBY_READINGS = {'たくみ', 'なか', 'まなこ', 'わざ', 'マスター'}
EXPRESSIONS = ('えへへ', 'ふふ', 'へへ', 'うん', 'はい', 'あっ', 'おお', 'はあ', 'なのです', 'のですよ', 'のですか')


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


def clean_text(text):
    text = previous.clean_transcript(text)
    def reading(match):
        if match[1] not in RUBY_READINGS:
            raise ValueError('Unverified ruby reading: ' + match[1])
        return match[1]
    text = re.sub(r'<ruby=([^<>]+)>([^<>]*)</ruby>', reading, text)
    if '<' in text or '>' in text:
        raise ValueError('Unverified transcript markup: ' + text)
    return text


def extract_rows(book, chapter, book_file, book_path_id):
    accepted, excluded = [], []
    for grid in book['importGridList']:
        headers = next(r['strings'] for r in grid['rows'] if r['rowIndex'] == grid['headerRow'])
        if headers != HEADERS:
            raise ValueError('Unverified script headers: ' + repr(headers))
        for row in grid['rows']:
            if row['rowIndex'] == grid['headerRow'] or row['isEmpty'] or row['isCommentOut']:
                continue
            if len(row['strings']) > len(headers):
                raise ValueError('Script row exceeds actual header length')
            # An omitted trailing cell stays absent, rather than an invented value.
            cells = dict(zip(headers, row['strings']))
            if 'Voice' not in cells or not cells['Voice']:
                continue
            source = dict(book=book_file, chapter=chapter, book_path_id=book_path_id,
                          grid=grid['name'], rowIndex=row['rowIndex'], cells=cells)
            if cells['Arg1'] not in previous.ROLES:
                source['reason'] = 'unresolved_role' if cells['Arg1'] == '？？？' else 'other_explicit_role'
                excluded.append(source)
            elif cells['Command'] not in ('', 'Voice'):
                raise ValueError('Unverified Mint voice command: ' + cells['Command'])
            else:
                accepted.append(source)
    return accepted, excluded


def scan_bundle(path):
    import UnityPy
    path = Path(path)
    env = UnityPy.load(str(path))
    rows = []
    for obj in env.objects:
        if obj.type.name != 'AudioClip':
            continue
        data = obj.read()
        rows.append(dict(bundle=str(path), bundle_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
            serialized_container_keys=[k for k, value in env.container.items() if value.path_id == obj.path_id],
            path_id=obj.path_id, clip_name=data.m_Name, frequency=data.m_Frequency,
            channels=data.m_Channels, seconds=data.m_Length,
            audio_resource=dict(m_Source=data.m_Resource.m_Source, m_Offset=data.m_Resource.m_Offset,
                                m_Size=data.m_Resource.m_Size)))
    return rows


def match_resources(rows_by_resource, clips):
    index = defaultdict(list)
    for clip in clips:
        for name in {PurePosixPath(k).name for k in clip['serialized_container_keys']}:
            index[name].append(clip)
    matches, issues = {}, {}
    for resource in rows_by_resource:
        found = index[resource]
        if len(found) == 1:
            matches[resource] = found[0]
        else:
            issues[resource] = 'no_exact_container_basename' if not found else 'multiple_exact_audio_clips'
    return matches, issues


def export_clip(job):
    import UnityPy
    resource, metadata, output = job
    env = UnityPy.load(metadata['bundle'])
    objects = [o for o in env.objects if o.type.name == 'AudioClip' and o.path_id == metadata['path_id']]
    if len(objects) != 1:
        raise ValueError('Audited AudioClip path ID does not identify exactly one object')
    data = objects[0].read()
    if data.m_Name != metadata['clip_name']:
        raise ValueError('AudioClip name differs from audit')
    samples = data.samples
    if len(samples) != 1:
        raise ValueError('Expected exactly one WAV sample')
    name, content = next(iter(samples.items()))
    if Path(name).name != name or Path(resource).name != resource:
        raise ValueError('Resource and sample must be exact basenames')
    with wave.open(io.BytesIO(content), 'rb') as wav:
        frames, frequency, channels, width = wav.getnframes(), wav.getframerate(), wav.getnchannels(), wav.getsampwidth()
        pcm = wav.readframes(frames)
    seconds = frames / frequency
    if frequency != metadata['frequency'] or channels != metadata['channels'] or abs(seconds - metadata['seconds']) > .002:
        raise ValueError('Exported WAV differs from serialized audio metadata')
    path = Path(output) / 'originals' / 'Vol1' / resource / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return dict(metadata, resource=resource, volume='Vol1', sample_filename=name, original_wav=str(path),
                wav_sha256=hashlib.sha256(content).hexdigest(), audio_sha256=hashlib.sha256(pcm).hexdigest(),
                seconds=seconds, frames=frames, sample_width=width)


def text_features(text):
    key = previous.repetition_key(text)
    return set(previous.trigrams(key)) | {'start:' + key[:5], 'end:' + key[-5:]} | {
        'expression:' + phrase for phrase in EXPRESSIONS if phrase in text}


def speech_kind(text):
    key = previous.repetition_key(text)
    if any(phrase in text for phrase in ('えへへ', 'ふふ', 'へへ')):
        return 'laughter_expression'
    if key in ('はい', 'うん', 'え', 'あ', 'あっ', 'おお', 'ほへ'):
        return 'short_response'
    # Auditable orthographic heuristic, not an acoustic or semantic label.
    if key and re.fullmatch('[あぁいぃうぅえぇおぉはふほへひゃやゅゆょよんっーれろくすぐちづ]+', key):
        return 'nonlexical_orthographic'
    return 'dialogue'


def coverage(rows):
    rows = list(rows)
    return dict(count=len(rows), seconds=sum(r['seconds'] for r in rows),
        kinds=dict(Counter(speech_kind(r['cleaned_text']) for r in rows)),
        expressions={phrase:sum(phrase in r['cleaned_text'] for r in rows) for phrase in EXPRESSIONS},
        distinct_starts=len({previous.repetition_key(r['cleaned_text'])[:5] for r in rows}),
        distinct_ends=len({previous.repetition_key(r['cleaned_text'])[-5:] for r in rows}))


def select_joint(new_records, old_records, maximum_seconds=4800):
    previous.validate_maximum_seconds(maximum_seconds)
    old_training = [r for r in old_records if r['selected'] and not r['holdout']]
    protected = [r for r in old_records if r['selected'] and r['holdout']]
    fixed_seconds = sum(r['seconds'] for r in protected)
    if fixed_seconds > maximum_seconds:
        raise ValueError('Budget cannot contain all protected old holdout')
    old_train_audio = {r['audio_sha256'] for r in old_training}
    old_train_text = {previous.repetition_key(clean_text(r['original_texts'][0])) for r in old_training}
    result = []
    for original in list(old_records) + list(new_records):
        r = dict(original, selected=False, holdout=False, cleaned_text='', reason='')
        for field in ('raw_wav','raw_relative_wav'):
            if field in r:r['previous_'+field] = r.pop(field)
        r['previous_selected'] = original.get('selected', False) if r['volume']=='Vol2' else False
        r['previous_holdout'] = original.get('holdout', False) if r['volume']=='Vol2' else False
        r['record_id'] = r['volume'] + '/' + r['resource']
        texts = list(dict.fromkeys(r['original_texts']))
        if len(texts) != 1:
            r['reason'] = 'transcript_conflict' if texts else 'no_exact_transcript'
        else:
            try:r['cleaned_text'] = clean_text(texts[0])
            except ValueError as exc:r['reason'] = 'unverified_markup'; r['markup_error'] = str(exc)
        if not r['reason'] and (not r['cleaned_text'] or any(c in r['cleaned_text'] for c in '|\n\r')):
            r['reason'] = 'invalid_training_text'
        key = previous.repetition_key(r['cleaned_text'])
        if not r['reason'] and not key:r['reason'] = 'no_language_characters'
        r['_key'] = key
        r['_features'] = text_features(r['cleaned_text'])
        r['speech_kind'] = speech_kind(r['cleaned_text'])
        r['validation_eligible'] = (r['volume']=='Vol1' and r['audio_sha256'] not in old_train_audio and key not in old_train_text)
        if r['volume']=='Vol2' and r['previous_holdout']:
            if r['reason']:raise ValueError('Protected holdout has unusable exact transcript')
            r.update(selected=True, holdout=True, reason='protected_old_holdout')
        elif r['volume']=='Vol2' and not r['previous_selected']:
            r['reason'] = 'not_previous_training_selection'
        result.append(r)
    selected = [r for r in result if r['selected']]
    audio = {r['audio_sha256'] for r in selected}
    text = {r['_key'] for r in selected}
    features = set().union(*(r['_features'] for r in selected)) if selected else set()
    used = fixed_seconds
    nonlexical_seconds = sum(r['seconds'] for r in selected if r['speech_kind']=='nonlexical_orthographic')

    def choose(pool, limit, reason):
        nonlocal used, nonlexical_seconds
        spent = 0
        while pool:
            for r in list(pool):
                if r['audio_sha256'] in audio:r['reason'] = 'duplicate_audio'
                elif r['_key'] in text:r['reason'] = 'repeated_text'
                elif r['speech_kind']=='nonlexical_orthographic' and nonlexical_seconds + r['seconds'] > 60:
                    r['reason'] = 'nonlexical_diversity_budget'
                if r['reason']:pool.remove(r)
            allowed = [r for r in pool if spent+r['seconds']<=limit and used+r['seconds']<=maximum_seconds]
            if not allowed:break
            best = max(allowed, key=lambda r: sum(3 if f.startswith(('start:', 'end:', 'expression:')) else 1 for f in r['_features']-features)/max(r['seconds'], .1))
            pool.remove(best)
            # Close wording is reduced only for dialogue; useful short forms are
            # not discarded based on character length or vowel similarity.
            near = next((s for s in selected if min(len(s['_key']),len(best['_key']))>=12
                         and s['speech_kind']=='dialogue' and best['speech_kind']=='dialogue'
                         and SequenceMatcher(None,s['_key'],best['_key']).ratio()>=.94), None)
            if near:
                best.update(reason='near_repeated_dialogue', repetition_representative=near['record_id'])
                continue
            best.update(selected=True, reason=reason)
            selected.append(best);audio.add(best['audio_sha256']);text.add(best['_key']);features.update(best['_features'])
            used+=best['seconds'];spent+=best['seconds']
            if best['speech_kind']=='nonlexical_orthographic':nonlexical_seconds+=best['seconds']
        return pool

    old_pool = [r for r in result if r['volume']=='Vol2' and not r['selected'] and not r['reason']]
    old_remaining = choose(old_pool, (maximum_seconds-fixed_seconds)*.25, 'selected_old_voice_coverage')
    vol1_budget = maximum_seconds-used
    laughter_pool = [r for r in result if r['volume']=='Vol1' and not r['reason'] and r['speech_kind']=='laughter_expression']
    choose(laughter_pool,min(420,vol1_budget*.15),'selected_vol1_laughter_coverage')
    vocal_pool = [r for r in result if r['volume']=='Vol1' and not r['reason'] and not r['selected'] and r['speech_kind'] in ('short_response','nonlexical_orthographic')]
    choose(vocal_pool,min(40,vol1_budget*.02),'selected_vol1_short_vocal_coverage')
    new_pool = [r for r in result if r['volume']=='Vol1' and not r['reason'] and not r['selected']]
    new_remaining = choose(new_pool, maximum_seconds-used, 'selected_vol1_expression_coverage')
    # Fill only with exact, diverse records still eligible after the first pass.
    remaining = choose(new_remaining+old_remaining, maximum_seconds-used, 'selected_remaining_diversity')
    for r in remaining:r['reason'] = 'duration_budget'
    for chapter in sorted({r['chapter'] for r in selected if r['volume']=='Vol1'}):
        eligible = sorted((r for r in selected if r['volume']=='Vol1' and r['chapter']==chapter and r['validation_eligible']),
                          key=lambda r: hashlib.sha256(r['record_id'].encode()).hexdigest())
        for r in eligible[:max(1,round(len(eligible)*.05))]:r['holdout'] = True
    for r in result:
        r['normalized_text_sha256'] = hashlib.sha256(r.pop('_key').encode()).hexdigest()
        r.pop('_features')
    validate_partition(result, old_records, maximum_seconds)
    return result


def validate_partition(records, old_records, maximum_seconds):
    selected = [r for r in records if r['selected']]
    if sum(r['seconds'] for r in selected)>maximum_seconds:raise ValueError('Joint duration exceeds budget')
    audio = [r['audio_sha256'] for r in selected]
    text = [previous.repetition_key(r['cleaned_text']) for r in selected]
    if len(set(audio))!=len(audio) or len(set(text))!=len(text):raise ValueError('Selected audio/text duplication or split leakage')
    old_holdout = {r['resource'] for r in old_records if r['selected'] and r['holdout']}
    actual = {r['resource'] for r in selected if r['volume']=='Vol2' and r['holdout']}
    if old_holdout!=actual:raise ValueError('Protected old holdout partition changed')
    old_train = [r for r in old_records if r['selected'] and not r['holdout']]
    old_audio = {r['audio_sha256'] for r in old_train}
    old_text = {previous.repetition_key(clean_text(r['original_texts'][0])) for r in old_train}
    for r in selected:
        if r['holdout'] and (r['audio_sha256'] in old_audio or previous.repetition_key(r['cleaned_text']) in old_text):
            raise ValueError('Prior training audio or normalized text entered validation')


def write_corpus(records):
    if OUTPUT.resolve()!=ROOT / 'voice' / 'MintoCorpusV020':raise ValueError('Output path must be isolated V020 corpus')
    raw = OUTPUT / 'raw'
    tracked = set()
    if raw.exists():
        if raw.resolve()!=raw or not raw.is_relative_to(ROOT.resolve()):raise ValueError('Existing raw path escaped isolated output')
        manifest_path = OUTPUT/'selection_manifest.json'
        if not manifest_path.is_file():raise ValueError('Existing raw output has no exact manifest')
        prior = json.loads(manifest_path.read_text(encoding='utf-8'))
        for r in prior:
            if not r['selected']:continue
            path = Path(r['raw_wav'])
            if not path.resolve().is_relative_to(raw) or not path.is_file():raise ValueError('Tracked raw WAV path is invalid')
            if hashlib.sha256(path.read_bytes()).hexdigest()!=r['wav_sha256']:raise ValueError('Tracked raw WAV checksum changed')
            tracked.add(path)
        actual = {p for p in raw.rglob('*') if p.is_file()}
        if actual!=tracked:raise ValueError('Untracked raw files are preserved; replacement refused')
    lists = {'esd.list':[], 'esd_holdout.list':[], 'esd_all.list':[]}
    written = set()
    planned = []
    for r in records:
        if not r['selected']:continue
        relative = Path(r['volume']) / r['resource'] / r['sample_filename']
        target = raw / relative
        if not target.resolve().is_relative_to(raw.resolve()):raise ValueError('WAV path escaped raw output')
        source = Path(r['original_wav'])
        if not source.is_file() or hashlib.sha256(source.read_bytes()).hexdigest()!=r['wav_sha256']:
            raise ValueError('Selected source WAV checksum mismatch')
        if target in written:raise ValueError('Duplicate raw output path')
        written.add(target)
        planned.append((r,source,target,relative))
        line = f"{relative.as_posix()}|ミント|JP|{r['cleaned_text']}\n"
        lists['esd_all.list'].append(line)
        lists['esd_holdout.list' if r['holdout'] else 'esd.list'].append(line)
    # Verify every staged copy before replacing any prior corpus output.
    with tempfile.TemporaryDirectory(prefix='.corpus-stage-',dir=OUTPUT) as temporary:
        staged = []
        for index,(r,source,target,relative) in enumerate(planned):
            copy = Path(temporary)/str(index)
            shutil.copyfile(source,copy)
            if hashlib.sha256(copy.read_bytes()).hexdigest()!=r['wav_sha256']:raise ValueError('Copied WAV checksum mismatch')
            staged.append((copy,target))
        for copy,target in staged:
            target.parent.mkdir(parents=True,exist_ok=True)
            os.replace(copy,target)
    for r,source,target,relative in planned:r.update(raw_wav=str(target),raw_relative_wav=relative.as_posix())
    for path in tracked-written:path.unlink()
    for name, lines in lists.items():(OUTPUT/name).write_text(''.join(lines),encoding='utf-8')
    save_json(OUTPUT/'selection_manifest.json',records)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workers',type=int,default=4)
    parser.add_argument('--maximum-seconds',type=float,default=4800)
    parser.add_argument('--selection-only',action='store_true',help='Verify archived WAV hashes and rebuild only the V020 selection')
    args = parser.parse_args()
    previous.validate_maximum_seconds(args.maximum_seconds)
    if (OUTPUT/'raw').exists() and not args.selection_only:raise ValueError('Existing V020 corpus is preserved; use --selection-only to select verified exports')
    import UnityPy
    OUTPUT.mkdir(parents=True, exist_ok=True)
    accepted, excluded, book_hashes = [], [], {}
    for chapter in ([] if args.selection_only else range(1,5)):
        path = SOURCE/f'chapter{chapter}.chapter.asset'
        book_hashes[str(path)] = hashlib.sha256(path.read_bytes()).hexdigest()
        env = UnityPy.load(str(path))
        books = []
        for obj in env.objects:
            if obj.type.name!='MonoBehaviour':continue
            data = obj.read_typetree()
            save_json(AUDIT/f'chapter{chapter}-{obj.path_id}.json',data)
            if 'importGridList' in data:books.append((obj.path_id,data))
        if len(books)!=1:raise ValueError('Expected exactly one serialized book per actual chapter bundle')
        path_id, book = books[0]
        good, bad = extract_rows(book,chapter,str(path),path_id)
        accepted.extend(good);excluded.extend(bad)
    if args.selection_only:
        accepted = json.loads((AUDIT/'source_rows.json').read_text(encoding='utf-8'))
        excluded = json.loads((AUDIT/'excluded_source_rows.json').read_text(encoding='utf-8'))
        book_hashes = json.loads((AUDIT/'audit_report.json').read_text(encoding='utf-8'))['book_sha256']
        for name,digest in book_hashes.items():
            if hashlib.sha256(Path(name).read_bytes()).hexdigest()!=digest:raise ValueError('Source chapter hash changed')
    else:
        save_json(AUDIT/'source_rows.json',accepted)
        save_json(AUDIT/'excluded_source_rows.json',excluded)
    rows_by_resource = defaultdict(list)
    for r in accepted:rows_by_resource[r['cells']['Voice']].append(r)
    bundle_paths = [] if args.selection_only else [p for p in (SOURCE/'sound').rglob('*') if p.is_file()]
    clips = []
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        for chunk in pool.map(scan_bundle,bundle_paths):clips.extend(chunk)
    if args.selection_only:clips = json.loads((AUDIT/'audio_metadata.json').read_text(encoding='utf-8'))
    else:save_json(AUDIT/'audio_metadata.json',clips)
    matches, issues = match_resources(rows_by_resource,clips)
    save_json(AUDIT/'mapping_issues.json',issues)
    print(f'Audited {len(clips)} AudioClips; {len(matches)} exact Mint mappings; {len(issues)} unresolved',flush=True)
    exported = []
    jobs = [] if args.selection_only else [(resource,meta,str(OUTPUT)) for resource,meta in sorted(matches.items())]
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        for index,r in enumerate(pool.map(export_clip,jobs),1):
            r['source_rows'] = rows_by_resource[r['resource']]
            r['chapter'] = min(s['chapter'] for s in r['source_rows'])
            r['original_texts'] = list(dict.fromkeys(s['cells']['Text'] for s in r['source_rows']
                if s['cells']['Command']=='' and 'Text' in s['cells'] and s['cells']['Text']))
            exported.append(r)
            if index%100==0:print(f'Exported and WAV-verified {index}/{len(jobs)}',flush=True)
    if args.selection_only:
        exported = json.loads((AUDIT/'export_manifest.json').read_text(encoding='utf-8'))
        for r in exported:
            if hashlib.sha256(Path(r['original_wav']).read_bytes()).hexdigest()!=r['wav_sha256']:
                raise ValueError('Archived original WAV checksum changed')
    else:save_json(AUDIT/'export_manifest.json',exported)
    old = json.loads((ROOT/'voice/MintoCorpus/selection_manifest.json').read_text(encoding='utf-8'))
    for r in old:r['volume']='Vol2'
    all_exact = []
    for r in exported:
        if len(r['original_texts'])==1:
            try:all_exact.append(dict(r,cleaned_text=clean_text(r['original_texts'][0])))
            except ValueError:pass
    save_json(AUDIT/'coverage_before_selection.json',dict(vol1=coverage(all_exact),
        old_training=coverage(r for r in old if r['selected'] and not r['holdout'])))
    manifest = select_joint(exported,old,args.maximum_seconds)
    write_corpus(manifest)
    selected = [r for r in manifest if r['selected']]
    report = dict(maximum_seconds=args.maximum_seconds,book_sha256=book_hashes,
        source_row_count=len(accepted),audio_metadata_count=len(clips),mapping_issues=issues,
        excluded_roles=dict(Counter(r['cells']['Arg1'] for r in excluded)),
        exported_count=len(exported),exported_seconds=sum(r['seconds'] for r in exported),
        selected=coverage(selected),training=coverage(r for r in selected if not r['holdout']),
        validation=coverage(r for r in selected if r['holdout']),
        selected_by_volume={v:coverage(r for r in selected if r['volume']==v) for v in ('Vol1','Vol2')},
        split_by_volume={f'{v}/{split}':coverage(r for r in selected if r['volume']==v and r['holdout']==(split=='validation'))
                         for v in ('Vol1','Vol2') for split in ('training','validation')},
        reasons=dict(Counter(r['reason'] for r in manifest)),
        selected_by_chapter=dict(Counter(f"{r['volume']}/{r['chapter']}" for r in selected)),
        frequencies=sorted({r['frequency'] for r in exported}),channels=sorted({r['channels'] for r in exported}),
        split_acceptance=dict(protected_old_holdout_count=sum(r['volume']=='Vol2' and r['holdout'] for r in selected),
            old_training_audio_in_validation=0,old_training_normalized_text_in_validation=0,
            selected_duplicate_pcm=0,selected_duplicate_normalized_text=0,joint_seconds=sum(r['seconds'] for r in selected)),
        selection_method='Protect all 52 old holdout rows first. Reserve 25% of the remaining joint duration for prior training voice coverage. Before general Vol.1 selection reserve up to 420 seconds / 15% of remaining Vol.1 budget for distinct laughter expressions, and up to 40 seconds / 2% for short-vocal forms; unconsumed reservations return to general selection. Prioritize exact Vol.1 rows using novel character trigrams plus observed expression tokens and first/last five normalized text characters, weighted 3:1 to trigrams per second. Exact PCM and normalized text are globally unique. Dialogue near repetition at SequenceMatcher >=0.94 only when both keys have >=12 characters; no length-based rejection. Pure-vocal orthographic forms collectively limited to 60 seconds, with no blanket scene/content exclusion. Five percent deterministic Vol.1 validation per chapter; every prior training PCM/text is ineligible for validation. All old originals and references preserved.',
        limitations=['Orthographic categories and coverage features are auditable heuristics, not acoustic labels.','Game Text/Voice pairing, ruby readings, and WAV metadata are verified; word-level alignment still requires listening review.','Unresolved speaker roles are excluded without inference. Voice-only audio remains archived without invented transcription.'])
    save_json(OUTPUT/'audit_report.json',report)
    save_json(AUDIT/'audit_report.json',report)
    print(json.dumps(report,ensure_ascii=True),flush=True)


if __name__=='__main__':main()
