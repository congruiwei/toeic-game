"""No inference: preserve original evidence while updating only comparison status."""
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('recompare', ROOT / 'scripts/recompare-bank-audio.py')
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


class RecompareTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.parent = Path(self.temp.name)
        self.root = self.parent / 'repo'
        self.out = self.root / 'data/audio'
        self.work = self.parent / 'authoring'
        self.out.mkdir(parents=True)
        self.work.mkdir()
        self.digest = lambda data: hashlib.sha256(data).hexdigest()
        self.write = lambda path, value: (path.parent.mkdir(parents=True, exist_ok=True), path.write_text(json.dumps(value)))
        source = {'units': []}
        self.write(self.out / 'source.json', source)
        self.manifest = {'sourceSha256': self.digest((self.out / 'source.json').read_bytes()), 'generation': {'recipe': 'fixture'},
                         'packs': [{'language': 'en', 'bank': 'part2', 'src': './data/audio/en/part2.json'}]}
        self.write(self.out / 'manifest.json', self.manifest)
        self.clips = {key: {'text': text, 'spoken': text, 'sha256': key * 64, 'required': True}
                      for key, text in [('a', 'The gray worktable.'), ('b', 'She signed it.'), ('c', 'Already matched.')]}
        self.asr = {key: {'status': 'review' if key != 'c' else 'matched', 'recognized': recognized, 'sha256': key * 64,
                         'recognitionGeneration': {'model': 'original-model'}, 'segments': [{'text': recognized}]}
                    for key, recognized in [('a', 'The grey work table.'), ('b', 'She sign it.'), ('c', 'Already matched.')]}
        self.write(self.out / 'en/part2.json', {'clips': self.clips})
        self.write(self.out / 'audit/en/part2.json', {'records': self.asr})
        self.original = copy.deepcopy(self.asr)
        self.valid = True
        def read(path, default):
            return json.loads(path.read_text()) if path.exists() else copy.deepcopy(default)
        def compare(expected, recognized, language, **kwargs):
            self.assertEqual(kwargs['source_text'], expected)
            return {'equivalent': expected.startswith('The gray'), 'reasons': ['fixture-exact-rule'], 'ruleVersion': 'fixture'}
        def flush(source, sha, generation, packs):
            self.assertEqual(generation, self.manifest['generation'])
            for (language, bank), pack in packs.items():
                self.write(self.out / language / (bank + '.json'), pack)
        self.bank = types.SimpleNamespace(read=read, atomic=self.write, sha=self.digest, normalize=lambda t, l: t, flush=flush)
        self.evidence = types.SimpleNamespace(valid_asr=lambda c, r: self.valid,
                                             media_integrity=lambda r, c: {'ok': True})
        self.modules = {'generate-bank-audio.py': self.bank, 'audio-compare.py': types.SimpleNamespace(compare=compare),
                        'audio-evidence.py': self.evidence}

    def tearDown(self):
        self.temp.cleanup()

    def run_tool(self, apply=False):
        argv = ['recompare-bank-audio.py', '--workdir', str(self.work)] + (['--apply'] if apply else [])
        output = io.StringIO()
        with patch.object(review, 'ROOT', self.root), patch.object(review, 'OUT', self.out), \
                patch.object(review, 'module', side_effect=lambda name, filename: self.modules[filename]), \
                patch.object(sys, 'argv', argv), contextlib.redirect_stdout(output):
            review.main()
        return json.loads(output.getvalue())

    def test_preview_preserves_audits_and_does_not_create_a_ledger(self):
        result = self.run_tool()
        self.assertEqual(result['equivalent'], {'en': 1, 'ja': 0})
        self.assertEqual(result['remaining'], {'en': 1, 'ja': 0})
        self.assertFalse((self.out / 'quality-review.json').exists())
        self.assertEqual(json.loads((self.out / 'audit/en/part2.json').read_text())['records'], self.original)

    def test_apply_keeps_original_evidence_and_never_promotes_tense_difference(self):
        result = self.run_tool(True)
        self.assertEqual(result['audioFilesChanged'], 0)
        self.assertEqual(result['newRecognitionCalls'], 0)
        ledger = json.loads((self.out / 'quality-review.json').read_text())
        self.assertEqual(ledger['baselineCounts'], {'en': 2, 'ja': 0})
        self.assertEqual(ledger['records']['en:part2:a']['baseline']['asr'], self.original['a'])
        actual = json.loads((self.out / 'audit/en/part2.json').read_text())['records']
        self.assertEqual(actual['a']['status'], 'matched')
        self.assertEqual(actual['b']['status'], 'review')
        self.assertEqual(actual['c'], self.original['c'])
        self.assertEqual(actual['a']['recognized'], self.original['a']['recognized'])
        self.assertEqual(actual['a']['segments'], self.original['a']['segments'])
        self.assertEqual(actual['a']['recognitionGeneration'], self.original['a']['recognitionGeneration'])
        self.run_tool(True)
        again = json.loads((self.out / 'quality-review.json').read_text())
        self.assertEqual(again, ledger, 'resuming must not replace the pre-comparison baseline')

    def test_missing_actual_evidence_fails_before_any_public_write(self):
        self.valid = False
        with self.assertRaisesRegex(ValueError, 'Missing current actual ASR'):
            self.run_tool(True)
        self.assertFalse((self.out / 'quality-review.json').exists())
        self.assertEqual(json.loads((self.out / 'audit/en/part2.json').read_text())['records'], self.original)

    def test_source_checkpoint_mismatch_fails_without_writes(self):
        self.write(self.out / 'source.json', {'units': ['changed']})
        with self.assertRaisesRegex(ValueError, 'checkpoints differ'):
            self.run_tool(True)
        self.assertFalse((self.out / 'quality-review.json').exists())

    def test_later_stage_results_cannot_rewrite_step_one_counts(self):
        self.run_tool(True)
        ledger = json.loads((self.out / 'quality-review.json').read_text())
        ledger['stages']['strongerASR'] = {'completed': True}
        self.write(self.out / 'quality-review.json', ledger)
        with self.assertRaisesRegex(ValueError, 'Later review stages exist'):
            self.run_tool(True)
        self.assertEqual(json.loads((self.out / 'quality-review.json').read_text()), ledger)


class ComparisonEvidenceTest(unittest.TestCase):
    def test_proof_is_bound_to_current_media_source_and_code(self):
        spec = importlib.util.spec_from_file_location('proof_evidence', ROOT / 'scripts/audio-evidence.py')
        evidence = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(evidence)
        clip = {'sha256': 'a' * 64, 'text': 'gray', 'spoken': 'gray', 'language': 'en'}
        c = {'audioSha256': clip['sha256'], 'expectedSpoken': 'gray', 'recognized': 'grey', 'language': 'en',
             'ruleVersion': 'strict-audio-equivalence-1', 'equivalent': True, 'reasons': ['us-uk-spelling'],
             'proofExpected': 'gray', 'proofRecognized': 'gray', 'provenance': {
                 'sourceTextSha256': hashlib.sha256(b'gray').hexdigest(),
                 'ruleFileSha256': 'b' * 64, 'normalizerFileSha256': 'c' * 64}}
        record = {'recognized': 'grey', 'status': 'matched', 'comparison': c}
        self.assertTrue(evidence.valid_comparison(clip, record))
        for change in [{'audioSha256': 'd' * 64}, {'recognized': 'wrong'}, {'expectedSpoken': 'wrong'},
                       {'language': 'ja'}, {'equivalent': False}, {'proofRecognized': 'wrong'},
                       {'proofExpected': '', 'proofRecognized': ''}, {'reasons': [None]},
                       {'provenance': {**c['provenance'], 'ruleFileSha256': 42}}]:
            self.assertFalse(evidence.valid_comparison(clip, {**record, 'comparison': {**c, **change}}))
        self.assertTrue(evidence.valid_comparison(clip, {'status': 'review'}), 'legacy actual evidence stays valid')


if __name__ == '__main__':
    unittest.main()
