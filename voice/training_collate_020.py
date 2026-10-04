"""Pad fixed training segments in memory while keeping real audio/text lengths."""
from torch.nn import functional as F

def pad_training_batch(batch,segment_size,hop_length):
    if len(batch)!=11 or segment_size%hop_length:raise ValueError('Expected the inspected JP-Extra training batch')
    result=list(batch)
    result[2]=F.pad(batch[2],(0,max(0,segment_size//hop_length-batch[2].shape[-1])))
    result[4]=F.pad(batch[4],(0,max(0,segment_size-batch[4].shape[-1])))
    return tuple(result)
