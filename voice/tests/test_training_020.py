import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1]/'prepare_training_020.py'

class TrainingIsolationTests(unittest.TestCase):
    def api(self):
        spec = importlib.util.spec_from_file_location('training020',SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_normalized_text_or_audio_cannot_cross_validation(self):
        api = self.api()
        row = 'exact.wav|ミント|JP|えへへ|a|0|1'
        with self.assertRaises(ValueError):api.verify_split([row],[row],['one'],['two'])
        with self.assertRaises(ValueError):api.verify_split([row],[row.replace('えへへ','別の文')],['one'],['one'])

    def test_new_configuration_keeps_previous_training_options_and_uses_absolute_inputs(self):
        api = self.api()
        old = {'model_name':'Minto','train':{'epochs':10,'batch_size':1,'skip_optimizer':False},
               'data':{'training_files':'old','validation_files':'old','spk2id':{'ミント':0}},
               'model':{'slm':{'model':'./slm/wavlm-base-plus'}}}
        cfg = api.training_config(old)
        self.assertEqual(old['train']['epochs'],10)
        self.assertEqual(cfg['train']['epochs'],14)
        self.assertEqual(cfg['train']['batch_size'],1)
        self.assertFalse(cfg['train']['skip_optimizer'])
        self.assertEqual(cfg['data']['spk2id'],{'ミント':0})
        self.assertTrue(Path(cfg['data']['training_files']).is_absolute())
        self.assertEqual(Path(cfg['model']['slm']['model']),api.UPSTREAM/'slm/wavlm-base-plus')

if __name__=='__main__':unittest.main()
