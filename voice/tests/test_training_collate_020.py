import importlib.util
from pathlib import Path
import unittest
import torch

class ShortAudioTests(unittest.TestCase):
    def test_short_audio_is_padded_only_in_batch_tensors_and_true_lengths_are_preserved(self):
        path=Path(__file__).resolve().parents[1]/'training_collate_020.py'
        spec=importlib.util.spec_from_file_location('collate020',path)
        api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
        batch=[torch.zeros(1) for _ in range(11)]
        batch[2]=torch.ones(1,1025,23);batch[3]=torch.tensor([23]);batch[4]=torch.ones(1,1,11907);batch[5]=torch.tensor([11907])
        before_spec=batch[2].clone();before_wav=batch[4].clone()
        result=api.pad_training_batch(tuple(batch),16384,512)
        self.assertEqual(result[2].shape,(1,1025,32));self.assertEqual(result[4].shape,(1,1,16384))
        self.assertTrue(torch.equal(result[2][:,:,:23],before_spec));self.assertTrue(torch.equal(result[4][:,:,:11907],before_wav))
        self.assertEqual(torch.count_nonzero(result[2][:,:,23:]),0);self.assertEqual(torch.count_nonzero(result[4][:,:,11907:]),0)
        self.assertIs(result[3],batch[3]);self.assertIs(result[5],batch[5]);self.assertEqual(batch[2].shape[-1],23)
        for index in [0,1,6,7,8,9,10]:self.assertIs(result[index],batch[index])

if __name__=='__main__':unittest.main()
