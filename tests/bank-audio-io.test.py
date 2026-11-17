"""Checkpoint recovery and real short-clip encoding; no acoustic model calls."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('io_bank',ROOT/'scripts/generate-bank-audio.py')
bank=importlib.util.module_from_spec(spec);spec.loader.exec_module(bank)


class IOTest(unittest.TestCase):
    def test_transient_empty_checkpoint_recovers(self):
        with patch.object(Path,'read_text',side_effect=['','{"records":{"x":1}}']),patch.object(bank.time,'sleep'):
            self.assertEqual(bank.read(Path('audit.json'),{}),{'records':{'x':1}})

    def test_persistent_bad_checkpoint_never_means_empty_success(self):
        with patch.object(Path,'read_text',return_value='{broken'),patch.object(bank.time,'sleep') as sleep:
            with self.assertRaises(json.JSONDecodeError):bank.read(Path('audit.json'),{})
            self.assertEqual(sleep.call_count,4)

    def test_failed_write_preserves_previous_checkpoint(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'audit.json';bank.atomic(path,{'records':{'x':1}})
            with self.assertRaises(TypeError):bank.atomic(path,{'broken':object()})
            self.assertEqual(bank.read(path,{}),{'records':{'x':1}})
            self.assertEqual(list(Path(tmp).glob('*.tmp')),[])

    def test_public_error_paths_are_redacted_but_source_text_is_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'errors.json'
            text='Invoice is the source sentence.'
            value={'text':text,'nested':[{'error':f'Failed {ROOT}/audio/a.m4a and {Path.home()}/cache/model'}]}
            with patch.object(bank,'OUT',Path(tmp)):bank.atomic(path,value)
            result=bank.read(path,{})
            self.assertEqual(result['text'],text)
            self.assertNotIn(str(ROOT),result['nested'][0]['error'])
            self.assertNotIn(str(Path.home()),result['nested'][0]['error'])
            self.assertIn('audio/a.m4a',result['nested'][0]['error'])
            self.assertNotIn('/external/authoring',bank.public_error('at /external/authoring/x',Path('/external/authoring')))
            old=bank.public_errors({'error':'Failed /private/tmp/old-audio/segment.wav','containerError':'Failed /var/folders/local-user/cache.wav'})
            self.assertEqual(old,{'error':'Failed <local path>','containerError':'Failed <local path>'})
            self.assertIn('https://example.com/error',bank.public_error('See https://example.com/error'))

    def test_short_letter_keeps_every_original_sample(self):
        wave=np.linspace(-.1,.1,round(.37*bank.RATE),dtype=np.float32)
        captured=[]
        with patch.object(bank.codec,'encode',side_effect=lambda audio,*_: captured.append(audio.copy()) or {}):
            metadata=bank.encode_bank(wave,Path('test.m4a'),Path('/tmp'))
        np.testing.assert_array_equal(captured[0][:len(wave)],wave)
        self.assertTrue(np.all(captured[0][len(wave):]==0))
        self.assertEqual(len(captured[0]),round(.5*bank.RATE))
        self.assertAlmostEqual(metadata['trailingSilenceAddedSeconds'],.13)

    def test_real_ffmpeg_can_measure_and_encode_sub_400ms_audio(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);output=root/'audio/generated/en/af_bella/test.m4a'
            t=np.arange(round(.37*bank.RATE))/bank.RATE
            wave=(.1*np.sin(2*np.pi*440*t)).astype(np.float32)
            with patch.object(bank.codec,'ROOT',root):metadata=bank.encode_bank(wave,output,root)
            self.assertEqual(metadata['duration'],.5)
            self.assertGreater(metadata['decodedPeak'],.005)
            self.assertLessEqual(metadata['decodedPeak'],.95)
            self.assertEqual(metadata['bytes'],output.stat().st_size)


if __name__=='__main__':unittest.main()
