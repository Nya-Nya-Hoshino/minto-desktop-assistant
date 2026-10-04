"""Compare unchanged old/new voices on exact holdouts and authored assistant sentences."""
import hashlib
import json
import os
from pathlib import Path
import sys
import time

VOICE = Path(__file__).resolve().parents[1]
ROOT = VOICE/'Style-Bert-VITS2'
OUTPUT = VOICE/'evaluation/v020'
os.chdir(ROOT)
sys.path.insert(0,str(ROOT))
os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1')

import numpy as np
import torch
from scipy.io import wavfile
from safetensors import safe_open
from pyannote.audio import Inference,Model
from style_bert_vits2.constants import Languages
from style_bert_vits2.tts_model import TTSModel

def digest(path):
    with Path(path).open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def metrics(path):
    rate,pcm = wavfile.read(path)
    signal = pcm.astype(np.float64)/32768
    return {'sampling_rate':int(rate),'channels':1 if pcm.ndim==1 else pcm.shape[1],'dtype':str(pcm.dtype),
            'seconds':len(pcm)/rate,'rms':float(np.sqrt(np.mean(signal**2))),'finite':bool(np.isfinite(signal).all()),
            'near_full_scale_fraction':float(np.mean(np.abs(signal)>=.999)),'sha256':digest(path)}

def cosine(one,two):
    return float(np.dot(one,two)/(np.linalg.norm(one)*np.linalg.norm(two)))

def samples():
    manifest = json.loads((VOICE/'MintoCorpusV020/selection_manifest.json').read_text(encoding='utf-8'))
    exact = ['Vol2/min0040.ogg','Vol2/min0132.ogg','Vol2/min0471.ogg','Vol1/min0373.ogg','Vol1/$3$min1152.ogg','Vol1/min0117.ogg']
    result = []
    for record_id in exact:
        rows = [r for r in manifest if r['record_id']==record_id and r['selected'] and r['holdout']]
        if len(rows)!=1:raise ValueError('Expected one exact holdout: '+record_id)
        r = rows[0]
        result.append({'id':record_id,'kind':'holdout','text':r['cleaned_text'],'original_texts':r['original_texts'],
                       'original_wav':r['original_wav'],'original_sha256':digest(r['original_wav']),'original_seconds':r['seconds']})
    result += [
        {'id':'assistant_new','kind':'new_text','text':'マスター、おかえりなのです！ボクと一緒に、今日の予定を確認するのですよ。'},
        {'id':'laughter_new','kind':'new_text','text':'えへへ、マスターに褒められて、うれしいのです。'},
        {'id':'response_new','kind':'new_text','text':'うん、はい！ボクも一緒に考えるのですよ。'},
        {'id':'kana_names','kind':'new_text','display_text':'OpenAIとGitHubの設定を確認するのです。','text':'オープンエーアイとギットハブの設定を確認するのです。'},
    ]
    return result

def main():
    OUTPUT.mkdir(parents=True,exist_ok=True)
    encoder = Model.from_pretrained(str(ROOT/'style_encoder/pytorch_model.bin'))
    embedding = Inference(encoder,window='whole').to(torch.device('cuda'))
    inputs = samples()
    original_vectors = {s['id']:embedding(s['original_wav']) for s in inputs if s['kind']=='holdout'}
    old_assets = ROOT/'model_assets/Minto'
    new_assets = ROOT/'model_assets/MintoV020'
    models = [(old_assets/'Minto_e10_s9960.safetensors',old_assets)]+[(p,new_assets) for p in new_assets.glob('*.safetensors')]
    if len(models)<2:raise ValueError('New checkpoints are required')
    report = {'samples':inputs,'seed_per_sentence':42,'inference':{'language':'JP','speaker_id':0,'style':'Neutral','style_weight':1,'length':1,'line_split':False},'models':[],'results':[],
              'limitations':['Signal validity and speaker-embedding cosine do not establish pronunciation or intonation quality.','No human listening score is available.','Kana names test Japanese readings, not native English pronunciation.','The official PCM output is normalized; rail measurements do not detect internal generator clipping.']}
    for weight,assets in models:
        with safe_open(str(weight),framework='pt',device='cpu') as tensors:epoch=int(tensors.get_tensor('iteration').item())
        report['models'].append({'path':str(weight),'sha256':digest(weight),'bytes':weight.stat().st_size,'epoch':epoch})
        model = TTSModel(weight,assets/'config.json',assets/'style_vectors.npy',device='cuda')
        for index,s in enumerate(inputs):
            torch.manual_seed(42);np.random.seed(42)
            started = time.perf_counter()
            rate,pcm = model.infer(s['text'],language=Languages.JP,speaker_id=0,style='Neutral',style_weight=1,length=1,line_split=False)
            target = OUTPUT/f'{weight.stem}_{index:02d}.wav'
            wavfile.write(target,rate,pcm)
            result = {'model':weight.name,'sample_id':s['id'],'path':str(target),'elapsed_seconds':time.perf_counter()-started,**metrics(target)}
            if not result['finite'] or result['dtype']!='int16' or result['sampling_rate']!=44100 or result['channels']!=1 or not .1<result['seconds']<35 or result['rms']<.005 or result['near_full_scale_fraction']>.001:
                raise ValueError('Generated signal failed validity: '+str(target))
            if s['kind']=='holdout':result['speaker_embedding_cosine']=cosine(embedding(str(target)),original_vectors[s['id']])
            report['results'].append(result)
            print(json.dumps(result,ensure_ascii=False),flush=True)
        model.unload();torch.cuda.empty_cache()
    (OUTPUT/'comparison.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print('WROTE comparison.json',flush=True)

if __name__=='__main__':main()
