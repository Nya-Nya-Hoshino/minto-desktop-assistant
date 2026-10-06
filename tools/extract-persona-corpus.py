"""Export exact local scenario rows for persona review; no audio or game modification."""
import hashlib
import json
from pathlib import Path
import sys

import UnityPy

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'private/persona-corpus-030'
HEADERS = ['Command', 'Arg1', 'Arg2', 'Arg3', 'Arg4', 'Arg5', 'Arg6', 'WaitType', 'Text', 'PageCtrl', 'Voice', 'WindowType', 'English', 'ChineseSimplified']
SOURCES = [
    (1, Path('G:/Gal/家喵二三事Vol.1/Nekomimi Sweet Housemates_Data/StreamingAssets/MyPetProject2/Windows'), ['chapter1.chapter.asset', 'chapter2.chapter.asset', 'chapter3.chapter.asset', 'chapter4.chapter.asset']),
    (2, Path('G:/Gal/家喵二三事Vol.2/Nekomimi Sweet Housemates2_Data/StreamingAssets/MyPetProject2nd/Windows'), ['chapter0.chapter.asset', 'chapter1.chapter.asset', 'chapter2.chapter.asset'])
]

def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    rows, report = [], []
    for volume, directory, names in SOURCES:
        for name in names:
            file = directory / name
            env = UnityPy.load(str(file))
            count = text_count = 0
            grids = []
            for obj in env.objects:
                if obj.type.name != 'MonoBehaviour':
                    continue
                data = obj.read_typetree()
                if 'importGridList' not in data:
                    continue
                for grid in data['importGridList']:
                    grids.append(grid['name'])
                    header = next(row['strings'] for row in grid['rows'] if row['rowIndex'] == grid['headerRow'])
                    assert header == HEADERS, (file, header)
                    for row in grid['rows']:
                        if row['rowIndex'] == grid['headerRow'] or row['isEmpty'] or row['isCommentOut']:
                            continue
                        # Vol.2 Chapter1 has an unnamed trailing empty column. Preserve it verbatim.
                        assert not any(row['strings'][len(header):]), (file, row['rowIndex'])
                        cells = dict(zip(header, row['strings']))
                        rows.append({'volume': volume, 'bundle': str(file), 'path_id': obj.path_id, 'grid': grid['name'], 'rowIndex': row['rowIndex'], 'cells': cells, 'strings': row['strings']})
                        count += 1
                        if cells.get('Text'):
                            text_count += 1
            report.append({'volume': volume, 'bundle': str(file), 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'grids': grids, 'rows': count, 'text_rows': text_count})
    with (OUTPUT / 'all-scenario-rows.jsonl').open('w', encoding='utf-8') as stream:
        for row in rows:
            stream.write(json.dumps(row, ensure_ascii=False) + '\n')
    focused = [row for row in rows if row['cells'].get('Text') and row['cells'].get('Arg1') in ['', 'ミント', 'ミントパジャマ', '主人公']]
    # Empty Arg1 in Vol.1 is retained verbatim. Do not invent a speaker for unlabelled dialogue/narration.
    with (OUTPUT / 'minto-and-protagonist-context.jsonl').open('w', encoding='utf-8') as stream:
        for row in focused:
            stream.write(json.dumps(row, ensure_ascii=False) + '\n')
    result = {'sources': report, 'all_rows': len(rows), 'focused_text_rows': len(focused), 'scope': 'All non-comment scenario rows; exact Mint, protagonist and unlabelled narrative context. Original strings are retained.'}
    (OUTPUT / 'manifest.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))

if __name__ == '__main__':
    main()
