"""Isolated, stdlib-only fixtures; no ASR/synthesis/model or public-repo writes."""
import ast
import copy
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
REPO = Path(os.environ.get('TOEIC_TEST_REPO', Path(__file__).resolve().parents[1])).resolve()
spec = importlib.util.spec_from_file_location('strong_finalize', REPO / 'scripts/finalize-audio-reaudit.py')
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


class FinalizeTest(unittest.TestCase):
    def setUp(self):
        # Keep the full-tree immutability assertion about authored files: an
        # import cache is not a publication, and need not be created in fixtures.
        bytecode = patch.object(sys, 'dont_write_bytecode', True)
        bytecode.start()
        self.addCleanup(bytecode.stop)
        self.temp = tempfile.TemporaryDirectory()
        parent = Path(self.temp.name)
        self.root = parent / 'repo'
        self.work = parent / 'private-work'
        self.out = self.root / 'data/audio'
        self.out.mkdir(parents=True)
        (self.root / 'scripts').mkdir()
        (self.work / 'tmp/bank-asr').mkdir(parents=True)
        for name in ('audio-evidence.py', 'audio-compare.py', 'audio-voice-override.py', 'generate-bank-audio.py'):
            shutil.copyfile(REPO / 'scripts' / name, self.root / 'scripts' / name)
        self.code = {'ruleFileSha256': review.sha((self.root / 'scripts/audio-compare.py').read_bytes()),
                     'normalizerFileSha256': review.sha((self.root / 'scripts/generate-bank-audio.py').read_bytes())}
        self.identity = {'model': review.MODEL, 'modelSha256': review.MODEL_SHA,
                         'device': 'cpu', 'computeType': 'int8', 'packages': {'fixture': '1'},
                         'beamSize': 5, 'conditionOnPreviousText': False, 'prompt': None, 'vadFilter': False}
        self.generation = {'recipe': 'original-synthesis-fixture', 'modelSha256': '1' * 64,
                           'encoding': 'original-aac-settings', 'packages': {'fixture': 'unchanged'}}
        self.packs = {}
        self.audits = {}
        self.records = {}
        units = []
        specs = [('a', 'en', 'She signed it.', 'She sign it.', 'She signed it.', False, True, 'shared'),
                 ('b', 'en', 'The shop has closed.', 'The shop is closed.', 'The shop is closed.', False, False, 'b'),
                 ('alias', 'en', 'She signed it.', 'She sign it.', 'She signed it.', False, True, 'shared'),
                 ('c', 'ja', '予約を確認しました。', '予約を変更しました。', '予約を確認しました。', False, True, 'c'),
                 ('d', 'en', 'The gray table.', 'The grey table.', 'The grey table.', True, True, 'd')]
        for key, language, text, old_heard, heard, old_equal, equal, media in specs:
            voice = 'af_heart' if language == 'en' else 'jf_alpha'
            payload = ('isolated-hash-fixture:' + media).encode()
            digest = review.sha(payload)
            src = f'./audio/generated/{language}/{voice}/{digest[:32]}.m4a'
            target = self.root / src
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)
            clip = {'src': src, 'sha256': digest, 'bytes': len(payload), 'duration': 1.2,
                    'voiceId': voice, 'language': language, 'text': text, 'spoken': text,
                    'phonemeSha256': review.sha(text.encode()), 'inputSha256': review.sha(('input:' + text).encode()),
                    'required': True, 'asrStatus': 'review'}
            token = f'{language}:part2:{key}'
            unit = {'key': key, 'language': language, 'bank': 'part2', 'voiceId': voice, 'text': text, 'required': True}
            units.append(unit)
            self.packs.setdefault((language, 'part2'), {'version': 1, 'language': language, 'bank': 'part2', 'clips': {}})['clips'][key] = clip
            old = self.asr(clip, key, old_heard, False)
            old['recognitionGeneration'] = {**self.identity, 'model': 'whisper-small', 'modelSha256': '9' * 64}
            old.pop('comparison')
            old['fingerprint'] = '8' * 64
            historical_comparison = self.comparison(clip, old_heard, old_equal)
            self.records[token] = {'token': token, 'language': language, 'bank': 'part2', 'key': key,
                                   'baseline': {'clip': copy.deepcopy(clip), 'asr': old},
                                   'comparison': historical_comparison}
            current = self.asr(clip, key, heard, equal) if not old_equal else {**old, 'status': 'matched', 'comparison': historical_comparison}
            self.audits.setdefault((language, 'part2'), {'version': 1, 'records': {}})['records'][key] = current
            if not old_equal:
                self.save_cache(current)
        self.source = {'version': 1, 'model': 'fixture-kokoro', 'voices': [], 'units': units}
        self.write(self.out / 'source.json', self.source)
        self.source_sha = review.sha((self.out / 'source.json').read_bytes())
        meta = []
        for pair, pack in self.packs.items():
            pack.update(sourceSha256=self.source_sha, generation=self.generation)
            self.write(self.out / pair[0] / (pair[1] + '.json'), pack)
            self.write(self.out / 'audit' / pair[0] / (pair[1] + '.json'), self.audits[pair])
            meta.append({'language': pair[0], 'bank': pair[1], 'src': f'./data/audio/{pair[0]}/{pair[1]}.json'})
        self.write(self.out / 'manifest.json', {'version': 1, 'generation': self.generation,
                                               'sourceSha256': self.source_sha, 'packs': meta})
        self.ledger = {'version': 1, 'baselineSourceSha256': self.source_sha, 'baselineCounts': {'en': 4, 'ja': 1},
                       'records': self.records, 'focus': {'edTailCandidates': ['en:part2:a']},
                       'stages': {'comparison': {'baseline': {'en': 4, 'ja': 1}, 'equivalent': {'en': 1, 'ja': 0},
                                                'remaining': {'en': 3, 'ja': 1}, 'audioFilesChanged': 0}}}
        self.write(self.out / 'quality-review.json', self.ledger)
        self.write(self.out / 'overrides.json', {'version': 1, 'entries': {}})
        self.tokens = [t for t, row in self.records.items() if not row['comparison']['equivalent']]
        self.token_path = parent / 'tokens.json'
        self.write(self.token_path, self.tokens)
        self.flush_calls = 0

    def tearDown(self):
        self.temp.cleanup()

    def write(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

    def comparison(self, clip, heard, equal):
        return {'audioSha256': clip['sha256'], 'expectedSpoken': clip['spoken'], 'recognized': heard,
                'language': clip['language'], 'ruleVersion': review.RULE_VERSION, 'equivalent': equal,
                'reasons': ['fixture-exact' if equal else 'non-equivalent-segments-remain'],
                'proofExpected': 'fixture:equal' if equal else None, 'proofRecognized': 'fixture:equal' if equal else None,
                'provenance': {**self.code, 'sourceTextSha256': review.sha(clip['text'].encode()), 'phonemeOverride': False}}

    def asr(self, clip, key, heard, equal):
        return {'key': key, 'src': clip['src'], 'sha256': clip['sha256'], 'voiceId': clip['voiceId'],
                'expected': clip['text'], 'spoken': clip['spoken'], 'recognized': heard,
                'status': 'matched' if equal else 'review', 'recognitionMethod': 'individual-beam5',
                'recognitionGeneration': copy.deepcopy(self.identity), 'singleFileVerification': True,
                'fingerprint': review.sha(json.dumps([self.identity, clip['sha256'], clip['language']], sort_keys=True).encode()),
                'segments': [{'start': 0.0, 'end': 1.2, 'text': ' ' + heard, 'avgLogprob': -.1, 'noSpeechProb': .001}],
                'comparison': self.comparison(clip, heard, equal), 'recognitionAttempts': 1}

    def save_cache(self, record):
        self.write(self.work / 'tmp/bank-asr' / (record['fingerprint'] + '.json'),
                   {'recognized': record['recognized'], 'segments': record['segments'], 'sha256': record['sha256'],
                    'generation': record['recognitionGeneration'], 'method': 'individual-beam5',
                    'duration': 1.2, 'elapsedSeconds': .1})

    def load_bank_without_inference_imports(self, root):
        # Execute the actual generator's atomic/read/flush functions, not a fake
        # flush. Discard only module imports/top-level synthesis dependencies;
        # these functions have no inference calls. Works in stdlib Python.
        names = {'public_error', 'public_errors', 'atomic', 'read', 'audit_records',
                 'valid_published_asr', 'valid_system_fallback', 'validate_fallback_packs', 'flush'}
        tree = ast.parse((root / 'scripts/generate-bank-audio.py').read_text())
        body = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
        self.assertEqual({node.name for node in body}, names)
        import re
        namespace = dict(ROOT=root, OUT=root / 'data/audio', Path=Path, json=json, os=os, tempfile=tempfile,
                         time=time, re=re, sha=review.sha,
                         evidence=review.module(root, 'fixture_evidence', 'audio-evidence.py'),
                         voice_rules=review.module(root, 'fixture_voice_rules', 'audio-voice-override.py'))
        exec(compile(ast.Module(body=body, type_ignores=[]), str(root / 'scripts/generate-bank-audio.py'), 'exec'), namespace)
        original = namespace['flush']
        def flush(*args):
            self.flush_calls += 1
            self.assertEqual(args[2], self.generation)
            return original(*args)
        return types.SimpleNamespace(atomic=namespace['atomic'], flush=flush)

    def run_tool(self, apply=False, tokens_file=None):
        return review.finalize(self.root, self.work, apply=apply, tokens_file=tokens_file,
                               bank_loader=self.load_bank_without_inference_imports)

    def snapshot(self):
        return {p.relative_to(self.root).as_posix(): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}

    def corrupt_audit(self, change, key='c', language='ja'):
        path = self.out / 'audit' / language / 'part2.json'
        audit = review.read(path)
        change(audit['records'][key])
        self.write(path, audit)

    def reject_without_writes(self, pattern=None, **kwargs):
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, pattern or '.'):
            self.run_tool(True, **kwargs)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.flush_calls, 0)

    def test_preview_is_read_only_and_counts_actual_aliases_and_unique_media(self):
        before = self.snapshot()
        result = self.run_tool(tokens_file=self.token_path)
        self.assertFalse(result['applied'])
        self.assertEqual(result['tested'], {'en': 3, 'ja': 1})
        self.assertEqual(result['matched'], {'en': 2, 'ja': 1})
        self.assertEqual(result['review'], {'en': 1, 'ja': 0})
        self.assertEqual(result['uniqueAudioSha256'], {'total': 3, 'en': 2, 'ja': 1})
        self.assertEqual(result['audioFilesChanged'], 0)
        self.assertEqual(result['finalizerRecognitionCalls'], 0)
        self.assertNotIn('newRecognitionCalls', result)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.flush_calls, 0)

    def test_apply_preserves_baseline_comparison_actual_audits_and_media_then_flushes(self):
        original = self.snapshot()
        result = self.run_tool(True, self.token_path)
        ledger = review.read(self.out / 'quality-review.json')
        self.assertTrue(result['applied'])
        self.assertEqual(ledger['stages']['comparison'], self.ledger['stages']['comparison'])
        self.assertEqual(ledger['focus'], self.ledger['focus'])
        for token, old in self.records.items():
            self.assertEqual(ledger['records'][token]['baseline'], old['baseline'])
            self.assertEqual(ledger['records'][token]['comparison'], old['comparison'])
            if token in self.tokens:
                pair = (old['language'], old['bank'])
                self.assertEqual(ledger['records'][token]['strongerASR'], self.audits[pair]['records'][old['key']])
            else:
                self.assertEqual(ledger['records'][token], old)
        for path, data in original.items():
            if path.startswith('audio/') or path.startswith('data/audio/audit/') or path == 'data/audio/source.json':
                self.assertEqual((self.root / path).read_bytes(), data)
        manifest = review.read(self.out / 'manifest.json')
        self.assertEqual(manifest['generation'], self.generation)
        self.assertEqual(manifest['totals']['requiredAudited'], 5)
        for meta in manifest['packs']:
            data = (self.root / meta['src']).read_bytes()
            self.assertEqual(meta['sha256'], review.sha(data))
            self.assertEqual(meta['bytes'], len(data))
        self.assertEqual(review.read(self.out / 'en/part2.json')['clips']['a']['asrStatus'], 'matched')
        self.assertEqual(review.read(self.out / 'en/part2.json')['clips']['b']['asrStatus'], 'review')
        after = self.snapshot()
        self.run_tool(True)
        self.assertEqual(self.snapshot(), after, 'Repeated finalization is byte-stable')
        self.assertEqual(self.flush_calls, 2)
        self.assertNotIn(str(self.work), json.dumps(ledger))
        self.assertNotIn(str(self.root), json.dumps(ledger))

    def test_resume_repairs_index_when_previous_write_stopped_after_ledger(self):
        prepared = review.prepare(self.root, self.work)
        self.write(self.out / 'quality-review.json', prepared['ledger'])
        self.assertEqual(review.read(self.out / 'en/part2.json')['clips']['a']['asrStatus'], 'review')
        self.run_tool(True)
        self.assertEqual(review.read(self.out / 'quality-review.json'), prepared['ledger'])
        self.assertEqual(review.read(self.out / 'en/part2.json')['clips']['a']['asrStatus'], 'matched')

    def test_missing_final_selected_key_fails_before_any_write(self):
        path = self.out / 'audit/ja/part2.json'
        audit = review.read(path)
        del audit['records']['c']
        self.write(path, audit)
        self.reject_without_writes('Missing valid current actual ASR')

    def test_wrong_model_and_model_sha_fail_before_any_write(self):
        path = self.out / 'audit/ja/part2.json'
        original = path.read_bytes()
        for field, value in [('model', 'whisper-small'), ('modelSha256', '0' * 64)]:
            with self.subTest(field=field):
                path.write_bytes(original)
                self.corrupt_audit(lambda r: r['recognitionGeneration'].__setitem__(field, value))
                self.reject_without_writes('Wrong stronger ASR model')

    def test_empty_or_error_transcript_does_not_become_a_successful_attempt(self):
        path = self.out / 'audit/ja/part2.json'
        original = path.read_bytes()
        for change in [lambda r: r.update(recognized='  '), lambda r: r.update(status='error'),
                       lambda r: r.update(segments=[]), lambda r: r['segments'][0].update(text='Different actual sentence')]:
            path.write_bytes(original)
            self.corrupt_audit(change)
            self.reject_without_writes()

    def test_invalid_or_stale_comparison_proof_fails_before_any_write(self):
        path = self.out / 'audit/ja/part2.json'
        original = path.read_bytes()
        changes = [lambda r: r.pop('comparison'), lambda r: r['comparison'].update(proofRecognized='not-the-proof'),
                   lambda r: r['comparison'].update(reasons=[None]),
                   lambda r: r['comparison']['provenance'].update(ruleFileSha256='0' * 64),
                   lambda r: r['comparison']['provenance'].update(normalizerFileSha256='0' * 64),
                   lambda r: r['comparison']['provenance'].update(phonemeOverride=True),
                   lambda r: r['comparison'].update(audioSha256='0' * 64)]
        for i, change in enumerate(changes):
            with self.subTest(case=i):
                path.write_bytes(original)
                self.corrupt_audit(change)
                self.reject_without_writes()

    def test_prompt_hotwords_and_non_individual_inference_are_rejected(self):
        path = self.out / 'audit/ja/part2.json'
        original = path.read_bytes()
        for change in [lambda r: r['recognitionGeneration'].update(prompt='expected sentence'),
                       lambda r: r['recognitionGeneration'].update(hotwords='expected word'),
                       lambda r: r.update(hotwords=['expected']),
                       lambda r: r.update(recognitionMethod='batch-beam1'),
                       lambda r: r.update(singleFileVerification=False)]:
            path.write_bytes(original)
            self.corrupt_audit(change)
            self.reject_without_writes()

    def test_current_media_sha_and_input_changes_rejected_even_with_valid_audit(self):
        path = self.out / 'ja/part2.json'
        original = path.read_bytes()
        for field, value in [('sha256', '0' * 64), ('text', 'different source'), ('spoken', 'different spoken'),
                             ('voiceId', 'jf_beta'), ('phonemeSha256', '0' * 64)]:
            with self.subTest(field=field):
                path.write_bytes(original)
                pack = review.read(path)
                pack['clips']['c'][field] = value
                self.write(path, pack)
                self.reject_without_writes('Recording/input metadata changed')
        path.write_bytes(original)
        clip = review.read(path)['clips']['c']
        (self.root / clip['src']).write_bytes(b'tampered media')
        self.reject_without_writes('Current media integrity failed')

    def test_stale_asr_sha_or_external_cache_cannot_pass(self):
        self.corrupt_audit(lambda r: r.update(sha256='0' * 64))
        self.reject_without_writes('Missing valid current actual ASR')
        self.write(self.out / 'audit/ja/part2.json', self.audits[('ja', 'part2')])
        r = self.audits[('ja', 'part2')]['records']['c']
        cache_path = self.work / 'tmp/bank-asr' / (r['fingerprint'] + '.json')
        cache = review.read(cache_path)
        cache['recognized'] = 'Different cached transcript'
        self.write(cache_path, cache)
        self.reject_without_writes('Actual ASR cache evidence differs')
        cache_path.unlink()
        self.reject_without_writes()

    def test_exact_target_set_not_benchmark_subset_superset_or_duplicates(self):
        for supplied in [self.tokens[:1], self.tokens + [self.tokens[0]], self.tokens + ['en:part2:d']]:
            self.write(self.token_path, supplied)
            self.reject_without_writes('Tokens file must exactly equal', tokens_file=self.token_path)

    def test_later_stage_or_existing_snapshot_conflict_cannot_be_overwritten(self):
        path = self.out / 'quality-review.json'
        for mutate in [lambda x: x['stages'].update(repair={'complete': True}),
                       lambda x: x['records']['en:part2:a'].update(repair={'record': 'later'}),
                       lambda x: x['records']['en:part2:a'].update(strongerASR={'recognized': 'older snapshot'}),
                       lambda x: x['stages'].update(strongerASR={'complete': False})]:
            ledger = copy.deepcopy(self.ledger)
            mutate(ledger)
            self.write(path, ledger)
            self.reject_without_writes()

    def test_source_baseline_counts_and_untargeted_media_are_immutable(self):
        path = self.out / 'quality-review.json'
        ledger = copy.deepcopy(self.ledger)
        ledger['stages']['comparison']['remaining']['en'] = 99
        self.write(path, ledger)
        self.reject_without_writes('Immutable comparison counts differ')
        self.write(path, self.ledger)
        pack_path = self.out / 'en/part2.json'
        pack = review.read(pack_path)
        pack['clips']['d']['spoken'] = 'changed previously equivalent row'
        self.write(pack_path, pack)
        self.reject_without_writes('Recording/input metadata changed')

    def test_historical_proof_keeps_its_code_identity_when_current_proof_uses_new_code(self):
        path = self.out / 'quality-review.json'
        ledger = copy.deepcopy(self.ledger)
        for row in ledger['records'].values():
            row['comparison']['provenance']['ruleFileSha256'] = '7' * 64
            row['comparison']['provenance']['normalizerFileSha256'] = '6' * 64
        self.write(path, ledger)
        self.run_tool(True)
        after = review.read(path)
        for token in self.tokens:
            self.assertEqual(after['records'][token]['comparison'], ledger['records'][token]['comparison'])
            self.assertEqual(after['records'][token]['strongerASR']['comparison']['provenance']['ruleFileSha256'],
                             self.code['ruleFileSha256'])
        self.assertEqual(after['stages']['comparison'], ledger['stages']['comparison'])

    def test_source_checkpoint_change_is_rejected_before_any_public_write(self):
        source = copy.deepcopy(self.source)
        source['units'][0]['text'] = 'Another original sentence.'
        self.write(self.out / 'source.json', source)
        self.reject_without_writes('checkpoints differ')

    def test_both_locks_prevent_writes_and_release_first_lock_on_second_failure(self):
        for name in ('bank-generate.lock', 'bank-audit.lock'):
            with (self.work / name).open('a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                self.reject_without_writes('Audio author is live')
        self.assertEqual(self.run_tool()['targetCount'], 4, 'Previous lock failures must not leak held locks')


if __name__ == '__main__':
    unittest.main()
