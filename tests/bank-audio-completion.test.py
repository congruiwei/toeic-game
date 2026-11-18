"""Real flush/sync completion regressions; no synthesis, decode, or ASR calls."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('completion_bank', ROOT / 'scripts/generate-bank-audio.py')
bank = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bank)


class CompletionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.root, self.work = self.base / 'repo', self.base / 'work'
        self.out = self.root / 'data/audio'
        self.unit = {'language': 'en', 'bank': 'vocab', 'key': 'v-test/example/0',
                     'text': 'Please send the invoice.', 'voiceId': 'af_heart',
                     'required': True, 'kind': 'example'}
        self.source = {'version': 1, 'model': 'test-model', 'voices': {'en': ['af_heart']},
                       'units': [self.unit]}
        self.media = b'\x00\x00\x00\x18ftypM4A \x00\x00\x00\x00isommp42'
        digest = bank.sha(self.media)
        self.clip = {**self.unit, 'spoken': self.unit['text'], 'src':
                     f'./audio/generated/en/af_heart/{digest[:32]}.m4a',
                     'sha256': digest, 'bytes': len(self.media), 'duration': 1.0,
                     'decodedPeak': .4, 'asrStatus': 'pending'}
        self.path = self.root / self.clip['src']
        self.path.parent.mkdir(parents=True)
        self.path.write_bytes(self.media)
        self.generation = {'model': 'whisper-small', 'modelSha256': 'a' * 64,
                           'device': 'cpu', 'computeType': 'int8', 'beamSize': 5,
                           'conditionOnPreviousText': False, 'prompt': None,
                           'vadFilter': False}
        self.asr = {'sha256': digest, 'expected': self.clip['text'],
                    'spoken': self.clip['spoken'], 'recognized': self.clip['spoken'],
                    'status': 'matched', 'recognitionGeneration': self.generation,
                    'recognitionMethod': 'individual-beam5', 'singleFileVerification': True}

    def tearDown(self):
        self.tmp.cleanup()

    def flush(self, record):
        bank.atomic(self.out / 'audit/en/vocab.json', {'records': {self.unit['key']: record}})
        packs = {('en', 'vocab'): {'clips': {self.unit['key']: copy.deepcopy(self.clip)}}}
        with patch.multiple(bank, ROOT=self.root, OUT=self.out):
            bank.flush(self.source, 'b' * 64, {}, packs)
        return bank.read(self.out / 'manifest.json', {}), bank.read(self.out / 'en/vocab.json', {})

    def test_real_flush_rejects_empty_missing_or_stale_asr(self):
        variants = [('empty', {**self.asr, 'recognized': ''}),
                    ('whitespace', {**self.asr, 'recognized': ' \n '}),
                    ('missing provenance', {k: v for k, v in self.asr.items()
                                            if k != 'recognitionGeneration'}),
                    ('old expected', {**self.asr, 'expected': 'An old sentence.'}),
                    ('old spoken', {**self.asr, 'spoken': 'An old normalized sentence.'})]
        for name, record in variants:
            with self.subTest(name=name):
                index, pack = self.flush(record)
                self.assertFalse(index['requiredAuditComplete'])
                self.assertFalse(index['auditComplete'])
                self.assertEqual(index['totals']['requiredAudited'], 0)
                self.assertEqual(pack['clips'][self.unit['key']]['asrStatus'], 'pending')

    def test_real_flush_counts_current_executed_asr(self):
        for status in ['matched', 'review']:
            with self.subTest(status=status):
                index, pack = self.flush({**self.asr, 'status': status})
                self.assertTrue(index['requiredAuditComplete'])
                self.assertEqual(index['totals']['requiredAudited'], 1)
                self.assertEqual(pack['clips'][self.unit['key']]['asrStatus'], status)

    def test_accepted_without_its_independent_proof_is_not_complete(self):
        index, pack = self.flush({**self.asr, 'status': 'accepted'})
        self.assertFalse(index['requiredAuditComplete'])
        self.assertEqual(pack['clips'][self.unit['key']]['asrStatus'], 'pending')

    def prepare_sync(self):
        models = self.work / 'models'
        models.mkdir(parents=True)
        (models / 'kokoro-v1.0.onnx').write_bytes(b'dummy model, never loaded')
        (models / 'voices-v1.0.bin').write_bytes(b'dummy voices, never loaded')
        synthesis = {'recipe': bank.codec.RECIPE,
                     'modelSha256': bank.sha((models / 'kokoro-v1.0.onnx').read_bytes()),
                     'voicesSha256': bank.sha((models / 'voices-v1.0.bin').read_bytes()),
                     'packages': {name: 'test-version' for name in
                                  ['kokoro-onnx', 'misaki', 'onnxruntime', 'soundfile', 'numpy']}}
        payload = [synthesis, bank.codec.ENCODING, self.unit['voiceId'],
                   bank.normalize(self.unit['text'], 'en'), None]
        self.clip['inputSha256'] = bank.sha(json.dumps(payload, sort_keys=True).encode())
        bank.atomic(self.out / 'source.json', self.source)
        bank.atomic(self.out / 'en/vocab.json', {'clips': {self.unit['key']: self.clip}})

    def sync(self):
        argv = ['generate-bank-audio.py', '--workdir', str(self.work), '--sync-only']
        with patch.multiple(bank, ROOT=self.root, OUT=self.out), patch.object(sys, 'argv', argv), \
                patch.object(bank.importlib.metadata, 'version', return_value='test-version'), \
                patch.object(bank.ort, 'InferenceSession', side_effect=AssertionError('must not load a model')) as model:
            bank.main()
        model.assert_not_called()
        return bank.read(self.out / 'manifest.json', {}), bank.read(self.out / 'en/vocab.json', {})

    def test_real_sync_retains_correct_input_and_intact_media(self):
        self.prepare_sync()
        index, pack = self.sync()
        self.assertTrue(index['requiredComplete'])
        self.assertEqual(pack['clips'][self.unit['key']]['inputSha256'], self.clip['inputSha256'])

    def test_real_sync_removes_missing_media_even_with_correct_input(self):
        self.prepare_sync()
        self.path.unlink()
        index, pack = self.sync()
        self.assertFalse(index['requiredComplete'])
        self.assertNotIn(self.unit['key'], pack['clips'])

    def test_real_sync_removes_same_size_corruption_even_with_correct_input(self):
        self.prepare_sync()
        self.path.write_bytes(self.media[:-1] + bytes([self.media[-1] ^ 1]))
        index, pack = self.sync()
        self.assertFalse(index['requiredComplete'])
        self.assertNotIn(self.unit['key'], pack['clips'])

    def test_real_sync_removes_stale_input_even_with_intact_media(self):
        self.prepare_sync()
        self.clip['inputSha256'] = 'f' * 64
        bank.atomic(self.out / 'en/vocab.json', {'clips': {self.unit['key']: self.clip}})
        index, pack = self.sync()
        self.assertFalse(index['requiredComplete'])
        self.assertNotIn(self.unit['key'], pack['clips'])

    def test_explicit_label_phones_override_default_and_bind_reuse(self):
        unit={**self.unit,'kind':'label','text':'A.'}
        with patch.object(bank,'phonemize',side_effect=AssertionError('No G2P for a label')):
            self.assertEqual(bank.resolve_phonemes(unit,'A.',{},{}),'ˈA')
            self.assertEqual(bank.resolve_phonemes(unit,'A.',{'phonemes':'ˈA.'},{}),'ˈA.')
        override={'phonemes':'ˈA.'}
        clip={'inputSha256':'input','phonemeSha256':bank.sha('ˈA'.encode())}
        self.assertFalse(bank.planned_clip_matches(clip,'input',override))
        clip['phonemeSha256']=bank.sha('ˈA.'.encode())
        self.assertTrue(bank.planned_clip_matches(clip,'input',override))
        self.assertFalse(bank.planned_clip_matches(clip,'other',override))

    def test_real_sync_removes_target_phone_mismatch_despite_current_input_hash(self):
        self.prepare_sync()
        override={'phonemes':'reviewed phones'}
        generation={'recipe':bank.codec.RECIPE,'modelSha256':bank.sha(b'dummy model, never loaded'),
                    'voicesSha256':bank.sha(b'dummy voices, never loaded'),
                    'packages':{n:'test-version' for n in ['kokoro-onnx','misaki','onnxruntime','soundfile','numpy']}}
        self.clip['inputSha256']=bank.input_fingerprint(generation,self.unit,override)[1]
        self.clip['phonemeSha256']=bank.sha(b'wrong phones')
        bank.atomic(self.out/'overrides.json',{'entries':{'en:vocab:v-test/example/0':override}})
        bank.atomic(self.out/'en/vocab.json',{'clips':{self.unit['key']:self.clip}})
        index,pack=self.sync()
        self.assertFalse(index['requiredComplete'])
        self.assertNotIn(self.unit['key'],pack['clips'])


if __name__ == '__main__':
    unittest.main()
