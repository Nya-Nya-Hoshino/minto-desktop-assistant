"""Run the official trainer with the isolated short-utterance batch collator."""
import json
from pathlib import Path
import sys

VOICE=Path(__file__).resolve().parent
UPSTREAM=VOICE/'Style-Bert-VITS2'
sys.path.insert(0,str(UPSTREAM))
from data_utils import TextAudioSpeakerCollate
from training_collate_020 import pad_training_batch
config=json.loads((UPSTREAM/'Data/MintoV020/config.json').read_text(encoding='utf-8'))

class SegmentPaddedCollate(TextAudioSpeakerCollate):
    def __call__(self,batch):
        return pad_training_batch(super().__call__(batch),config['train']['segment_size'],config['data']['hop_length'])

if __name__=='__main__':
    import train_ms_jp_extra
    train_ms_jp_extra.TextAudioSpeakerCollate=SegmentPaddedCollate
    train_ms_jp_extra.run()
