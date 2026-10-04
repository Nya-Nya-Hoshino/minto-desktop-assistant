"""Prepare the fixed joint split using local official SBV2 tools in an isolated cwd."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import wave

VOICE = Path(__file__).resolve().parent
UPSTREAM = VOICE/'Style-Bert-VITS2'
CORPUS = VOICE/'MintoCorpusV020'
DATA = UPSTREAM/'Data/MintoV020'
ASSETS = UPSTREAM/'model_assets/MintoV020'
RUN = VOICE/'training-run-020'
SNAPSHOTS = ('G_9960.pth','D_9960.pth','WD_9960.pth')

def digest(path):
    with Path(path).open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def save(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')

def training_config(old):
    result = copy.deepcopy(old)
    result['model_name'] = 'MintoV020'
    result['train']['epochs'] = 14
    result['data']['training_files'] = str(DATA/'train.list')
    result['data']['validation_files'] = str(DATA/'val.list')
    result['model']['slm']['model'] = str(UPSTREAM/'slm/wavlm-base-plus')
    return result

def verify_split(train,val,train_audio,val_audio):
    text = lambda rows:{line.split('|')[3] for line in rows}
    if text(train)&text(val):raise ValueError('Normalized text crosses the fixed split')
    if set(train_audio)&set(val_audio):raise ValueError('Audio crosses the fixed split')

def selected_records():
    records = json.loads((CORPUS/'selection_manifest.json').read_text(encoding='utf-8'))
    selected = [r for r in records if r['selected']]
    if len(selected)!=1053 or sum(r['seconds'] for r in selected)>4800:raise ValueError('Audited corpus membership or duration changed')
    for r in selected:
        raw = Path(r['raw_wav'])
        if raw!=CORPUS/'raw'/r['raw_relative_wav'] or digest(raw)!=r['wav_sha256']:raise ValueError('Audited raw path/hash changed')
    return selected

def bootstrap():
    import yaml
    if DATA.exists() or RUN.exists() or ASSETS.exists():raise ValueError('Existing new training outputs are preserved; use an explicit stage')
    selected_records()
    old_files = [UPSTREAM/'config.yml',UPSTREAM/'configs/paths.yml',UPSTREAM/'Data/Minto/config.json']
    old_files += [UPSTREAM/'Data/Minto/models'/name for name in SNAPSHOTS]
    old_files += list((UPSTREAM/'model_assets/Minto').glob('*'))
    old_hashes = {str(p):digest(p) for p in old_files if p.is_file()}
    RUN.mkdir(parents=True)
    (RUN/'configs').mkdir()
    DATA.mkdir(parents=True)
    config = yaml.safe_load((UPSTREAM/'config.yml').read_text(encoding='utf-8'))
    config['model_name'] = 'MintoV020'
    (RUN/'config.yml').write_text(yaml.safe_dump(config,allow_unicode=True),encoding='utf-8')
    (RUN/'configs/paths.yml').write_text(yaml.safe_dump({'dataset_root':str(UPSTREAM/'Data'),'assets_root':str(UPSTREAM/'model_assets')}),encoding='utf-8')
    save(DATA/'config.json',training_config(json.loads((UPSTREAM/'Data/Minto/config.json').read_text(encoding='utf-8'))))
    save(RUN/'preserved-files.json',old_hashes)
    print('Isolated configuration created; previous configuration and weights preserved',flush=True)

def setup(worker=False):
    os.chdir(RUN)
    sys.path.insert(0,str(UPSTREAM))
    os.environ.update(USE_LIBUV='0',PYTHONIOENCODING='utf-8',HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1')
    from config import get_config
    config = get_config()
    if config.train_ms_config.config_path.resolve()!=(DATA/'config.json').resolve() or config.out_dir!=ASSETS:
        raise ValueError('Upstream default configuration escaped isolated training paths')
    if worker:
        # The upstream worker constructs its module name relative to cwd.
        # Start it from the upstream package, then restore the isolated config cwd.
        try:
            os.chdir(UPSTREAM)
            from style_bert_vits2.nlp.japanese import pyopenjtalk_worker
            pyopenjtalk_worker.initialize_worker()
        finally:os.chdir(RUN)

def resample():
    setup()
    selected_records()
    subprocess.run([sys.executable,str(UPSTREAM/'resample.py'),'--sr','44100','--input_dir',str(CORPUS/'raw'),'--output_dir',str(DATA/'wavs'),'--num_processes','4'],check=True)

def text():
    setup(worker=True)
    from preprocess_text import process_line
    records = selected_records()
    outputs = {'train.list':[],'val.list':[]}
    for index,r in enumerate(records,1):
        wav = DATA/'wavs'/r['raw_relative_wav']
        with wave.open(str(wav),'rb') as audio:
            if audio.getframerate()!=44100 or audio.getnchannels()!=1 or audio.getsampwidth()!=2 or abs(audio.getnframes()/44100-r['seconds'])>1/44100:
                raise ValueError(f'Resample metadata mismatch: {wav}')
        line = f"{wav}|ミント|JP|{r['cleaned_text']}\n"
        outputs['val.list' if r['holdout'] else 'train.list'].append(process_line(line,CORPUS/'esd_all.list',False,True,'raise'))
        if index%100==0:print(f'TEXT {index}/{len(records)}',flush=True)
    verify_split(outputs['train.list'],outputs['val.list'],[r['audio_sha256'] for r in records if not r['holdout']],[r['audio_sha256'] for r in records if r['holdout']])
    for name,lines in outputs.items():(DATA/name).write_text(''.join(lines),encoding='utf-8')
    print('Fixed split written: 967 training / 86 validation',flush=True)

def bert():
    setup(worker=True)
    subprocess.run([sys.executable,str(UPSTREAM/'bert_gen.py'),'--config',str(DATA/'config.json')],check=True)

def styles():
    setup()
    import numpy as np
    import torch
    from pyannote.audio import Inference,Model
    encoder = Model.from_pretrained(str(UPSTREAM/'style_encoder/pytorch_model.bin'))
    inference = Inference(encoder,window='whole').to(torch.device('cuda'))
    train = (DATA/'train.list').read_text(encoding='utf-8').splitlines()
    val = (DATA/'val.list').read_text(encoding='utf-8').splitlines()
    vectors = []
    for index,line in enumerate(train+val):
        wav = Path(line.split('|')[0]);target = Path(str(wav)+'.npy')
        vector = np.load(target) if target.exists() else inference(str(wav))
        if vector.shape!=(256,) or not np.isfinite(vector).all():raise ValueError(f'Invalid style embedding: {wav}')
        np.save(target,vector)
        if index<len(train):vectors.append(vector)
        if (index+1)%100==0:print(f'STYLE {index+1}/{len(train)+len(val)}',flush=True)
    ASSETS.mkdir(parents=True,exist_ok=True)
    np.save(ASSETS/'style_vectors.npy',np.mean(np.stack(vectors),axis=0)[None,:])
    config = json.loads((DATA/'config.json').read_text(encoding='utf-8'))
    config['data'].update(num_styles=1,style2id={'Neutral':0})
    save(ASSETS/'config.json',config)

def checkpoints():
    setup()
    models = DATA/'models'
    models.mkdir(exist_ok=True)
    for name in SNAPSHOTS:
        source = UPSTREAM/'Data/Minto/models'/name
        target = models/name
        if target.exists():raise ValueError('Existing optimizer snapshots are preserved')
        shutil.copyfile(source,target)
        if digest(source)!=digest(target):raise ValueError('Optimizer copy mismatch')
    print('Three optimizer snapshots copied and verified',flush=True)

def validate():
    setup()
    import numpy as np
    import torch
    records = selected_records()
    train = (DATA/'train.list').read_text(encoding='utf-8').splitlines()
    val = (DATA/'val.list').read_text(encoding='utf-8').splitlines()
    for rows,holdout in [(train,False),(val,True)]:
        expected = [r for r in records if r['holdout']==holdout]
        if len(rows)!=len(expected):raise ValueError('Fixed split count changed')
        for line,r in zip(rows,expected):
            fields = line.split('|')
            wav = DATA/'wavs'/r['raw_relative_wav']
            if len(fields)!=7 or fields[:3]!=[str(wav),'ミント','JP']:raise ValueError('Training membership or speaker changed')
            with wave.open(str(wav),'rb') as audio:
                if (audio.getframerate(),audio.getnchannels(),audio.getsampwidth())!=(44100,1,2):raise ValueError('Training WAV format changed')
                if abs(audio.getnframes()/44100-r['seconds'])>1/44100:raise ValueError('Training audio was trimmed')
            features = torch.load(wav.with_suffix('.bert.pt'),map_location='cpu')
            if features.shape!=(1024,2*len(fields[4].split())+1) or not torch.isfinite(features).all():raise ValueError('Invalid BERT cache')
            vector = np.load(str(wav)+'.npy')
            if vector.shape!=(256,) or not np.isfinite(vector).all():raise ValueError('Invalid style cache')
    verify_split(train,val,[r['audio_sha256'] for r in records if not r['holdout']],[r['audio_sha256'] for r in records if r['holdout']])
    from data_utils import TextAudioSpeakerLoader
    from style_bert_vits2.models.hyper_parameters import HyperParameters
    from transformers.trainer_pt_utils import DistributedLengthGroupedSampler
    parameters = HyperParameters.load_from_json(DATA/'config.json')
    dataset = TextAudioSpeakerLoader(str(DATA/'train.list'),parameters.data)
    sampler = DistributedLengthGroupedSampler(dataset=dataset,batch_size=parameters.train.batch_size,num_replicas=1,rank=0,lengths=dataset.lengths,drop_last=True)
    sampled = list(sampler)
    if len(sampled)!=len(train) or set(sampled)!=set(range(len(train))):raise ValueError('The sampler does not cover every training clip')
    from data_utils import TextAudioSpeakerCollate
    from training_collate_020 import pad_training_batch
    from style_bert_vits2.models import commons
    padded_short = 0
    for index,length in enumerate(dataset.lengths):
        if length>parameters.train.segment_size//parameters.data.hop_length:continue
        original = TextAudioSpeakerCollate(use_jp_extra=True)([dataset[index]])
        padded = pad_training_batch(original,parameters.train.segment_size,parameters.data.hop_length)
        commons.slice_segments(padded[2],torch.tensor([0]),parameters.train.segment_size//parameters.data.hop_length)
        commons.slice_segments(padded[4],torch.tensor([0]),parameters.train.segment_size)
        if not torch.equal(padded[3],original[3]) or not torch.equal(padded[5],original[5]):raise ValueError('True short audio lengths changed')
        padded_short += 1
    mean = np.mean(np.stack([np.load(line.split('|')[0]+'.npy') for line in train]),axis=0)[None,:]
    if not np.array_equal(mean,np.load(ASSETS/'style_vectors.npy')):raise ValueError('Neutral mean differs from training-only mean')
    for name,expected in json.loads((RUN/'preserved-files.json').read_text(encoding='utf-8')).items():
        if digest(name)!=expected:raise ValueError('Previous configuration or model changed')
    save(RUN/'inputs-verified.json',{'training':len(train),'validation':len(val),'sampled_training':len(sampled),'short_batches_padded_only_in_memory':padded_short,'seconds':sum(r['seconds'] for r in records),'untrimmed':True,'isolated_default_config':str(DATA/'config.json')})
    print('INPUTS VERIFIED: 967 training / 86 validation, old model/config hashes unchanged',flush=True)

if __name__=='__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage',choices=['bootstrap','resample','text','bert','styles','checkpoints','validate','all'])
    args = parser.parse_args()
    for stage in (['bootstrap','resample','text','bert','styles','checkpoints','validate'] if args.stage=='all' else [args.stage]):
        globals()[stage]()
