"""Reviewed-correction recovery with isolated data and temporary fake workers.

Run with the local audio Python environment. No synthesis, decoder, or ASR
model is called. Only the supervision tests launch real, tiny Python children.
"""
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/correct-bank-audio.py'
spec = importlib.util.spec_from_file_location('correction_test_module', SCRIPT)
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)

ASR_GENERATION = {
    'model': 'fixture-whisper', 'modelSha256': 'c' * 64,
    'device': 'cpu', 'computeType': 'int8', 'beamSize': 5,
    'conditionOnPreviousText': False, 'prompt': None, 'vadFilter': False,
}


def actual(clip, status='matched'):
    return {
        'sha256': clip['sha256'], 'expected': clip['text'], 'spoken': clip['spoken'],
        'recognized': clip['spoken'] if status == 'matched' else 'A different transcription.',
        'status': status, 'recognitionGeneration': copy.deepcopy(ASR_GENERATION),
        'recognitionMethod': 'individual-beam5', 'singleFileVerification': True,
        'recognitionAttempts': 1,
    }


class CorrectionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name).resolve()
        self.root, self.work = self.base / 'repo', self.base / 'work'
        self.out = self.root / 'data/audio'
        self.unit = {'bank': 'vocab', 'language': 'en', 'key': 'v-test/example/0',
                     'voiceId': 'af_heart', 'text': 'Please use the blue entrance.',
                     'required': True}
        self.token = c.token(self.unit)
        self.base_override = {'phonemes': 'jˈus', 'reason': 'Old fixture input'}
        self.proposal = {'token': self.token, 'sourceText': self.unit['text'],
                         'override': {'phonemes': 'jˈuz'}, 'reason': 'Use is a verb here.'}
        self.corrected = c.prepare_correction(self.unit, self.proposal, self.base_override)
        self.generation = {'recipe': 'fixture-recipe', 'modelSha256': '1' * 64,
                           'voicesSha256': '2' * 64, 'packages': {'fixture': '1'},
                           'encoding': copy.deepcopy(c.bank.codec.ENCODING)}
        self.initial = self.clip(self.base_override, 'a' * 64)
        self.proposal['beforePhonemeSha256'] = self.initial['phonemeSha256']
        self.new = self.clip(self.corrected, 'b' * 64)
        self.expected_initial = self.initial
        self.generated_digest = 'b' * 64
        self.pack_path = self.out / 'en/vocab.json'
        self.audit_path = self.out / 'audit/en/vocab.json'
        self.plan_path = self.base / 'plan.json'
        self.neighbor_key = 'v-untouched/example/0'
        self.neighbor = {'sha256': 'e' * 64, 'text': 'Do not change this fixture.'}
        self.audit_mode = 'matched'
        self.initial_bad = False
        self.upgrade_generation = False
        self.calls = []
        self.checkpoint_seen = False
        c.atomic(self.out / 'source.json', {'version': 1, 'units': [self.unit]})
        c.atomic(self.out / 'manifest.json', {'generation': self.generation})
        c.atomic(self.pack_path, {'clips': {self.unit['key']: self.initial,
                                          self.neighbor_key: self.neighbor}})
        c.atomic(self.audit_path, {'records': {self.neighbor_key: {'sentinel': True}}})
        c.atomic(self.out / 'overrides.json', {'version': 1, 'entries': {
            self.token: self.base_override, 'en:vocab:' + self.neighbor_key: {'spoken': 'Untouched.'}}})
        self.save_plan()

    def tearDown(self):
        self.tmp.cleanup()

    def clip(self, override, digest, generation=None):
        spoken, fingerprint = c.bank.input_fingerprint(generation or self.generation, self.unit, override)
        return {**self.unit, 'spoken': spoken, 'sha256': digest, 'inputSha256': fingerprint,
                'phonemeSha256': c.sha(override['phonemes'].encode()),
                'synthesisSpeed': float(override.get('speed', 1)),
                'src': f'./audio/generated/en/af_heart/{digest[:32]}.m4a',
                'duration': 1.0, 'bytes': 1000, 'asrStatus': 'pending'}

    def save_plan(self, proposals=None):
        c.atomic(self.plan_path, {'version': 1,
                 'sourceSha256': c.sha((self.out / 'source.json').read_bytes()),
                 'entries': proposals if proposals is not None else [self.proposal]})

    def entry(self):
        return {'token': self.token, 'language': self.unit['language'], 'bank': self.unit['bank'],
                'key': self.unit['key'], 'kind': 'confirmed-input-correction',
                'proposal': copy.deepcopy(self.proposal), 'baseOverride': copy.deepcopy(self.base_override),
                'retryOverride': copy.deepcopy(self.corrected),
                'sourceBinding': c.retry.binding_for(self.unit, self.base_override),
                'initial': {'clip': copy.deepcopy(self.initial), 'asr': actual(self.initial)},
                'complete': False}

    def read(self, relative):
        return c.read(self.out / relative, {})

    def fake_command(self, command, work):
        """Only these declared fake commands may mutate the temporary fixture."""
        self.assertEqual(Path(work), self.work)
        self.calls.append(command)
        if '--sync-only' in command:
            manifest = self.read('manifest.json')
            manifest['syncCount'] = manifest.get('syncCount', 0) + 1
            c.atomic(self.out / 'manifest.json', manifest)
            return
        self.assertIn('--tokens-file', command)
        tokens = c.read(Path(command[command.index('--tokens-file') + 1]), [])
        self.assertEqual(tokens, [self.token], 'Never expand the correction plan implicitly')
        if Path(command[1]).name == 'generate-bank-audio.py':
            checkpoint = self.read('retries.json')['records'][self.token]
            self.assertEqual(checkpoint['initial']['clip'], self.expected_initial)
            self.assertTrue(c.retry.has_actual_asr(self.expected_initial, checkpoint['initial']['asr']))
            self.assertFalse(checkpoint['complete'])
            self.checkpoint_seen = True
            override = self.read('overrides.json')['entries'][self.token]
            if self.upgrade_generation:
                self.generation = {**self.generation, 'recipe': 'fixture-recipe-updated'}
                manifest = self.read('manifest.json')
                manifest['generation'] = self.generation
                c.atomic(self.out / 'manifest.json', manifest)
            pack = self.read('en/vocab.json')
            pack['clips'][self.unit['key']] = self.clip(override, self.generated_digest)
            c.atomic(self.pack_path, pack)
        elif Path(command[1]).name == 'audit-bank-audio.py':
            pack = self.read('en/vocab.json')
            clip = pack['clips'][self.unit['key']]
            record = actual(clip, self.audit_mode if clip['sha256'] != self.expected_initial['sha256'] else 'review')
            if self.initial_bad and clip['sha256'] == self.expected_initial['sha256']:
                record.pop('recognitionGeneration')
            elif self.audit_mode == 'error' and clip['sha256'] != self.expected_initial['sha256']:
                record.update(recognized='', status='error')
            audit = self.read('audit/en/vocab.json')
            audit['records'][self.unit['key']] = record
            c.atomic(self.audit_path, audit)
        else:
            self.fail('Unexpected child command: ' + repr(command))

    def fake_stream(self, generate, audit, work, stream=False):
        self.assertTrue(stream)
        self.assertIn('--individual-only', audit)
        self.fake_command(generate, work)
        self.fake_command(audit, work)

    def flow(self, stream=False):
        argv = ['correct-bank-audio.py', '--plan', str(self.plan_path),
                '--workdir', str(self.work), '--apply', *(['--stream'] if stream else [])]
        with patch.multiple(c, ROOT=self.root, OUT=self.out), \
                patch.multiple(c.retry, ROOT=self.root, OUT=self.out), \
                patch.multiple(c.bank, ROOT=self.root, OUT=self.out), \
                patch.object(sys, 'argv', argv), \
                patch.object(c, 'run_command', side_effect=self.fake_command), \
                patch.object(c.retry, 'run_workers', side_effect=self.fake_stream), \
                patch.object(c.bank, 'Kokoro', side_effect=AssertionError('No acoustic model permitted')), \
                patch.object(c.bank, 'phonemize', side_effect=AssertionError('No G2P needed in these fixtures')), \
                contextlib.redirect_stdout(io.StringIO()) as output:
            c.main()
        return json.loads(output.getvalue().strip().splitlines()[-1])

    def test_prepare_binds_source_and_drops_stale_phonemes_for_spoken_change(self):
        with self.assertRaisesRegex(ValueError, 'source text changed'):
            c.prepare_correction(self.unit, {**self.proposal, 'sourceText': 'Other text'}, self.base_override)
        changed = c.prepare_correction(self.unit, {**self.proposal, 'override': {'spoken': 'Please use it.'}},
                                       self.base_override)
        self.assertNotIn('phonemes', changed)
        self.assertEqual(changed['spoken'], 'Please use it.')
        for override in [{'phonemes': 'jˈus'}, {'speed': 0.5}, {'spoken': ''}, {'text': 'changed'}]:
            with self.subTest(override=override), self.assertRaises(ValueError):
                c.prepare_correction(self.unit, {**self.proposal, 'override': override}, self.base_override)

    def test_changed_sha_and_real_asr_cannot_hide_wrong_target_input(self):
        cases = {'old phonemes': {'phonemeSha256': self.initial['phonemeSha256']},
                 'wrong voice': {'voiceId': 'am_puck'}, 'wrong language': {'language': 'ja'},
                 'wrong text': {'text': 'Different source.'}, 'old spoken': {'spoken': 'Old normalized text.'},
                 'wrong speed': {'synthesisSpeed': 0.9}, 'stale fingerprint': {'inputSha256': '0' * 64}}
        for name, change in cases.items():
            with self.subTest(name=name):
                clip = {**self.new, **change}
                self.assertTrue(c.retry.has_actual_asr(clip, actual(clip)))
                with self.assertRaises(ValueError):
                    c.finish_correction(self.entry(), clip, actual(clip), self.unit, self.corrected, self.generation)

    def test_missing_stale_or_unexecuted_asr_never_finishes(self):
        good = actual(self.new)
        cases = [None, {}, {**good, 'recognized': ''}, {**good, 'sha256': self.initial['sha256']},
                 {**good, 'expected': 'Old text.'}, {**good, 'spoken': 'Old spoken.'},
                 {k: v for k, v in good.items() if k != 'recognitionGeneration'},
                 {**good, 'status': 'pending'}, {**good, 'recognitionMethod': 'invented'}]
        for record in cases:
            with self.subTest(record=record), self.assertRaises(ValueError):
                c.finish_correction(self.entry(), self.new, record, self.unit, self.corrected, self.generation)
        with self.assertRaises(ValueError):
            same_sha = {**self.new, 'sha256': self.initial['sha256']}
            c.finish_correction(self.entry(), same_sha, actual(same_sha), self.unit, self.corrected, self.generation)

    def test_completed_case_stays_bound_to_source_override_generation_and_selected_audio(self):
        entry = c.finish_correction(self.entry(), self.new, actual(self.new), self.unit,
                                    self.corrected, self.generation)
        self.assertTrue(c.current_correction(entry, self.unit, self.corrected, self.new,
                                              actual(self.new), self.generation))
        variants = [({**self.unit, 'text': 'Changed source.'}, self.corrected, self.new, self.generation),
                    ({**self.unit, 'voiceId': 'am_puck'}, self.corrected, self.new, self.generation),
                    (self.unit, {**self.corrected, 'phonemes': 'changed'}, self.new, self.generation),
                    (self.unit, self.base_override, self.new, self.generation),
                    (self.unit, self.corrected, {**self.new, 'sha256': 'f' * 64}, self.generation),
                    (self.unit, self.corrected, self.new, {**self.generation, 'recipe': 'updated'})]
        for unit, override, clip, generation in variants:
            with self.subTest(unit=unit, override=override, generation=generation):
                self.assertFalse(c.current_correction(entry, unit, override, clip, actual(clip), generation))

    def test_resumed_case_cannot_count_missing_or_stale_initial_recognition(self):
        for initial_asr in [{}, {**actual(self.initial), 'recognized': ''},
                            {**actual(self.initial), 'sha256': '0' * 64}]:
            with self.subTest(initial_asr=initial_asr):
                entry = self.entry()
                entry['initial']['asr'] = initial_asr
                with self.assertRaises(ValueError):
                    c.finish_correction(entry, self.new, actual(self.new), self.unit,
                                        self.corrected, self.generation)
                good = c.finish_correction(self.entry(), self.new, actual(self.new), self.unit,
                                           self.corrected, self.generation)
                good['initial']['asr'] = initial_asr
                self.assertFalse(c.current_correction(good, self.unit, self.corrected, self.new,
                                                      actual(self.new), self.generation))

    def test_real_main_saves_initial_evidence_limits_keys_and_is_idempotent(self):
        result = self.flow()
        self.assertTrue(self.checkpoint_seen)
        self.assertEqual(result['regeneratedKeys'], 1)
        entry = self.read('retries.json')['records'][self.token]
        self.assertTrue(entry['complete'])
        self.assertEqual(entry['initial']['clip'], self.initial)
        self.assertEqual(entry['initial']['asr']['status'], 'review')
        self.assertEqual(entry['retry']['clip']['sha256'], self.new['sha256'])
        self.assertEqual((entry['synthesisAttemptCount'], entry['asrAttemptCount']), (2, 2))
        self.assertEqual(self.read('en/vocab.json')['clips'][self.neighbor_key], self.neighbor)
        self.assertEqual(self.read('audit/en/vocab.json')['records'][self.neighbor_key], {'sentinel': True})
        self.assertEqual(self.read('overrides.json')['entries']['en:vocab:' + self.neighbor_key],
                         {'spoken': 'Untouched.'})
        self.calls.clear()
        result = self.flow()
        self.assertEqual((result['regeneratedKeys'], result['alreadyCompleted']), (0, 1))
        self.assertTrue(all('--sync-only' in command for command in self.calls))
        self.assertEqual(self.read('retries.json')['records'][self.token], entry)

    def test_new_generation_fingerprint_is_loaded_after_worker_finishes(self):
        self.upgrade_generation = True
        self.flow()
        entry = self.read('retries.json')['records'][self.token]
        self.assertTrue(entry['complete'])
        self.assertTrue(c.correction_matches(self.unit, self.corrected,
                                            entry['retry']['clip'], self.generation))

    def test_stream_keeps_exact_plan_tokens_initial_asr_and_final_sync(self):
        result = self.flow(stream=True)
        self.assertEqual(result['regeneratedKeys'], 1)
        self.assertEqual([Path(command[1]).name for command in self.calls],
                         ['audit-bank-audio.py', 'generate-bank-audio.py',
                          'audit-bank-audio.py', 'generate-bank-audio.py'])
        self.assertIn('--sync-only', self.calls[-1])
        self.assertTrue(self.checkpoint_seen)

    def test_review_retains_corrected_audio_instead_of_restoring_known_wrong_input(self):
        self.audit_mode = 'review'
        self.flow()
        entry = self.read('retries.json')['records'][self.token]
        self.assertTrue(entry['complete'])
        self.assertTrue(entry['unresolved'])
        self.assertEqual(entry['outcome'], 'input-correction-applied-asr-review')
        self.assertEqual(self.read('en/vocab.json')['clips'][self.unit['key']]['sha256'], self.new['sha256'])
        self.assertEqual(self.read('overrides.json')['entries'][self.token]['phonemes'], 'jˈuz')
        self.assertEqual(entry['retry']['asr']['status'], 'review')

    def test_failed_asr_stays_pending_keeps_corrected_input_and_resumes(self):
        c.atomic(self.out / 'normalization-review.json', {'asrTextReviewNotes': [{
            'token': self.token, 'confirmedInputError': True,
            'disposition': 'pending-reviewed-input-correction'}]})
        self.audit_mode = 'error'
        with self.assertRaisesRegex(ValueError, 'awaits a changed audio file and real current ASR'):
            self.flow()
        entry = self.read('retries.json')['records'][self.token]
        self.assertFalse(entry['complete'])
        self.assertEqual(entry['phase'], 'awaiting-real-ASR')
        self.assertEqual(self.read('en/vocab.json')['clips'][self.unit['key']]['sha256'], self.new['sha256'])
        self.assertEqual(self.read('overrides.json')['entries'][self.token]['phonemes'], 'jˈuz')
        self.assertGreater(self.read('manifest.json')['syncCount'], 0)
        self.assertEqual(self.read('normalization-review.json')['asrTextReviewNotes'][0]['disposition'],
                         'pending-reviewed-input-correction')
        initial = copy.deepcopy(entry['initial'])
        self.audit_mode = 'matched'
        self.flow()
        resumed = self.read('retries.json')['records'][self.token]
        self.assertTrue(resumed['complete'])
        self.assertEqual(resumed['initial'], initial)
        note = self.read('normalization-review.json')['asrTextReviewNotes'][0]
        self.assertEqual(note['disposition'], 'corrected-input-retained-see-case')
        self.assertEqual(note['correctedAudioSha256'], self.new['sha256'])

    def test_initial_asr_failure_does_not_install_override_or_invent_evidence(self):
        self.initial_bad = True
        with self.assertRaisesRegex(ValueError, 'Missing real initial ASR'):
            self.flow()
        self.assertEqual(self.read('overrides.json')['entries'][self.token], self.base_override)
        self.assertFalse(self.read('retries.json').get('records'))
        self.assertFalse(any(Path(x[1]).name == 'generate-bank-audio.py' for x in self.calls))

    def test_stale_plan_and_interrupted_override_are_rejected_before_workers(self):
        plan = c.read(self.plan_path, {})
        c.atomic(self.plan_path, {**plan, 'sourceSha256': '0' * 64})
        with self.assertRaisesRegex(ValueError, 'source fingerprint is stale'):
            self.flow()
        self.assertEqual(self.calls, [])
        self.save_plan()
        c.atomic(self.out / 'retries.json', {'records': {self.token: self.entry()}})
        overrides = self.read('overrides.json')
        overrides['entries'][self.token] = {'phonemes': 'unreviewed third input'}
        c.atomic(self.out / 'overrides.json', overrides)
        with self.assertRaisesRegex(ValueError, 'override binding changed'):
            self.flow()
        self.assertEqual(self.calls, [])
        overrides['entries'][self.token] = self.base_override
        c.atomic(self.out / 'overrides.json', overrides)
        self.unit['voiceId'] = 'am_puck'
        c.atomic(self.out / 'source.json', {'units': [self.unit]})
        self.save_plan()
        with self.assertRaisesRegex(ValueError, 'source or override binding changed'):
            self.flow()
        self.assertEqual(self.calls, [])

    def test_automatic_pace_retry_refuses_unfinished_confirmed_correction(self):
        c.atomic(self.out / 'retries.json', {'records': {self.token: self.entry()}})
        with patch.multiple(c.retry, ROOT=self.root, OUT=self.out), \
                patch.object(sys, 'argv', ['retry-bank-audio.py', '--workdir', str(self.work)]), \
                patch.object(c.retry, 'run_workers', side_effect=AssertionError('No automatic retry permitted')):
            with self.assertRaisesRegex(RuntimeError, 'Resume correct-bank-audio.py'):
                c.retry.main()

    def test_completed_case_repairs_missing_normalization_checkpoint_without_regeneration(self):
        self.flow()
        saved = self.read('retries.json')['records'][self.token]
        c.atomic(self.out / 'normalization-review.json', {'version': 1, 'confirmedInputCorrections': []})
        self.calls.clear()
        result = self.flow()
        self.assertEqual(result['alreadyCompleted'], 1)
        correction = self.read('normalization-review.json')['confirmedInputCorrections'][0]
        self.assertEqual(correction['delivery'], 'regenerated-with-both-ASR-versions')
        self.assertEqual(correction['selectedSha256'], self.new['sha256'])
        self.assertEqual(self.read('retries.json')['records'][self.token], saved)
        self.assertTrue(all('--sync-only' in command for command in self.calls))

    def test_future_required_and_optional_do_not_fabricate_synthesis_or_asr(self):
        for required in [False, True]:
            with self.subTest(required=required):
                self.unit['required'] = required
                c.atomic(self.out / 'source.json', {'units': [self.unit]})
                c.atomic(self.pack_path, {'clips': {self.neighbor_key: self.neighbor}})
                c.atomic(self.out / 'retries.json', {'version': 1, 'records': {}})
                c.atomic(self.out / 'normalization-review.json', {'version': 1})
                c.atomic(self.out / 'overrides.json', {'entries': {self.token: self.base_override}})
                self.save_plan()
                for _ in range(2):
                    self.calls.clear()
                    result = self.flow()
                    self.assertEqual(result['futureGenerationOverrides'], 1)
                    self.assertEqual(result['regeneratedKeys'], 0)
                    self.assertEqual(self.read('retries.json')['records'], {})
                    counts = result['attempts']['confirmedInputCorrections']
                    self.assertEqual((counts['keys'], counts['perKeySynthesisVersions'],
                                      counts['perKeyRecognitionAttempts']), (0, 0, 0))
                    review = self.read('normalization-review.json')['confirmedInputCorrections'][0]
                    self.assertEqual(review['delivery'], 'future-required-generation' if required else 'future-optional-only')
                    self.assertTrue(all('--sync-only' in command for command in self.calls))

    def test_new_error_after_preventive_first_generation_gets_real_before_and_after_versions(self):
        earlier = {'token': self.token, 'sourceText': self.unit['text'],
                   'override': {'phonemes': self.base_override['phonemes']},
                   'reason': 'Earlier independent pronunciation prevention'}
        c.atomic(self.out / 'normalization-review.json', {
            'confirmedInputCorrections': [{'token': self.token, 'proposal': earlier,
                'baseOverride': None, 'sourceBinding': c.retry.binding_for(self.unit, None),
                'appliedOverride': self.base_override, 'delivery': 'future-required-generation'}],
            'asrTextReviewNotes': [{'token': self.token, 'confirmedInputError': True,
                'disposition': 'pending-reviewed-input-correction'}]})
        result = self.flow()
        self.assertEqual((result['regeneratedKeys'], result['futureGenerationOverrides']), (1, 0))
        entry = self.read('retries.json')['records'][self.token]
        self.assertEqual(entry['baseOverride'], self.base_override)
        self.assertEqual(entry['initial']['clip'], self.initial)
        self.assertTrue(c.retry.has_actual_asr(entry['initial']['clip'], entry['initial']['asr']))
        self.assertTrue(c.retry.has_actual_asr(entry['retry']['clip'], entry['retry']['asr']))
        self.assertEqual(self.read('normalization-review.json')['confirmedInputCorrections'][0]['delivery'],
                         'regenerated-with-both-ASR-versions')
        self.assertEqual(self.read('normalization-review.json')['asrTextReviewNotes'][0]['disposition'],
                         'corrected-input-retained-see-case')

    def prepare_second_correction(self):
        """Run a real first correction, then propose another input change on b."""
        self.flow()
        first = copy.deepcopy(self.read('retries.json')['records'][self.token])
        self.assertTrue(first['complete'])
        self.expected_initial = copy.deepcopy(first['retry']['clip'])
        self.generated_digest = 'c' * 64
        self.proposal = {'token': self.token, 'sourceText': self.unit['text'],
                         'override': {'phonemes': 'jˈuz bˈlu'},
                         'reason': 'A second independently reviewed input correction.',
                         'beforePhonemeSha256': self.expected_initial['phonemeSha256']}
        self.corrected = c.prepare_correction(self.unit, self.proposal, first['retryOverride'])
        self.new = self.clip(self.corrected, self.generated_digest)
        self.save_plan()
        self.calls.clear()
        return first

    def assert_three_version_chain(self, first, *, complete):
        report = self.read('retries.json')
        self.assertEqual(len(report['archivedCases']), 1)
        archived = report['archivedCases'][0]
        self.assertEqual({k: v for k, v in archived.items() if k != 'archiveReason'}, first,
                         'The previous case, including both original ASR records, must remain intact')
        for version in ['initial', 'retry']:
            self.assertTrue(c.retry.has_actual_asr(archived[version]['clip'], archived[version]['asr']))
        second = report['records'][self.token]
        self.assertEqual(second['predecessor'], {
            'archiveIndex': 0, 'token': self.token,
            'selectedSha256': first['selectedSha256'],
        })
        self.assertEqual(second['initial']['clip'], first['retry']['clip'])
        self.assertTrue(c.retry.has_actual_asr(second['initial']['clip'], second['initial']['asr']))
        self.assertEqual(second['retry']['clip']['sha256'], 'c' * 64)
        self.assertEqual(second['complete'], complete)
        self.assertEqual({archived['initial']['clip']['sha256'],
                          archived['retry']['clip']['sha256'],
                          second['initial']['clip']['sha256'],
                          second['retry']['clip']['sha256']}, {'a' * 64, 'b' * 64, 'c' * 64})
        if complete:
            self.assertTrue(c.retry.has_actual_asr(second['retry']['clip'], second['retry']['asr']))
            self.assertEqual(second['selectedSha256'], 'c' * 64)
        return second

    @staticmethod
    def corrupt_history_asr(entry, version, corruption):
        if corruption == 'missing':
            entry[version].pop('asr')
        elif corruption == 'empty':
            entry[version]['asr']['recognized'] = ''
        else:
            other = 'retry' if version == 'initial' else 'initial'
            entry[version]['asr']['sha256'] = entry[other]['clip']['sha256']

    def assert_rejected_before_authors(self, message):
        # Check the persisted bytes, not merely the final decoded override.
        # A rejected run must not briefly install an override or repair away bad history.
        before = {p: p.read_bytes() for p in [self.out / 'overrides.json', self.out / 'retries.json',
                  self.pack_path, self.audit_path, self.out / 'normalization-review.json']}
        self.calls.clear()
        with patch.object(c, 'atomic', wraps=c.atomic) as writes:
            with self.assertRaisesRegex(ValueError, message):
                self.flow()
        self.assertEqual(writes.call_count, 0, 'Reject before any correction checkpoint is written')
        self.assertEqual(self.calls, [], 'Reject before audit, synthesis or final sync starts')
        for path, data in before.items():
            self.assertEqual(path.read_bytes(), data, str(path))

    def test_second_correction_archives_a_to_b_and_completes_b_to_c_idempotently(self):
        first = self.prepare_second_correction()
        result = self.flow()
        self.assertEqual(result['regeneratedKeys'], 1)
        self.assert_three_version_chain(first, complete=True)
        completed = self.read('retries.json')
        self.calls.clear()
        result = self.flow()
        self.assertEqual((result['regeneratedKeys'], result['alreadyCompleted']), (0, 1))
        self.assertEqual(self.read('retries.json'), completed)
        self.assertTrue(all('--sync-only' in command for command in self.calls))
        self.assertEqual(self.read('en/vocab.json')['clips'][self.neighbor_key], self.neighbor)

    def test_second_correction_failed_asr_resumes_without_losing_any_version(self):
        first = self.prepare_second_correction()
        self.audit_mode = 'error'
        with self.assertRaisesRegex(ValueError, 'awaits a changed audio file and real current ASR'):
            self.flow()
        pending = self.assert_three_version_chain(first, complete=False)
        self.assertEqual(pending['phase'], 'awaiting-real-ASR')
        self.assertEqual(pending['retry']['asr']['status'], 'error')
        self.assertEqual(self.read('en/vocab.json')['clips'][self.unit['key']]['sha256'], 'c' * 64)
        self.assertEqual(self.read('overrides.json')['entries'][self.token], self.corrected)
        self.audit_mode = 'matched'
        self.flow()
        resumed = self.assert_three_version_chain(first, complete=True)
        self.assertEqual(resumed['initial'], pending['initial'])
        self.assertEqual(self.read('normalization-review.json')['confirmedInputCorrections'][0]['selectedSha256'],
                         'c' * 64)

    def test_second_correction_rejects_corrupt_completed_history_before_writes(self):
        self.prepare_second_correction()
        pristine = self.read('retries.json')
        for version in ['initial', 'retry']:
            for corruption in ['missing', 'empty', 'old SHA']:
                with self.subTest(version=version, corruption=corruption):
                    damaged = copy.deepcopy(pristine)
                    self.corrupt_history_asr(damaged['records'][self.token], version, corruption)
                    c.atomic(self.out / 'retries.json', damaged)
                    self.assert_rejected_before_authors('Previous completed correction')

    def test_second_correction_rejects_changed_selected_audio_or_override_before_writes(self):
        self.prepare_second_correction()
        original_pack, original_audit = self.read('en/vocab.json'), self.read('audit/en/vocab.json')
        original_overrides = self.read('overrides.json')
        for change in ['current SHA', 'current override']:
            with self.subTest(change=change):
                c.atomic(self.pack_path, original_pack)
                c.atomic(self.audit_path, original_audit)
                c.atomic(self.out / 'overrides.json', original_overrides)
                if change == 'current SHA':
                    changed = copy.deepcopy(original_pack)
                    changed['clips'][self.unit['key']]['sha256'] = 'd' * 64
                    c.atomic(self.pack_path, changed)
                    audit = copy.deepcopy(original_audit)
                    audit['records'][self.unit['key']] = actual(changed['clips'][self.unit['key']])
                    c.atomic(self.audit_path, audit)
                else:
                    changed = copy.deepcopy(original_overrides)
                    changed['entries'][self.token]['speed'] = .95
                    c.atomic(self.out / 'overrides.json', changed)
                self.assert_rejected_before_authors('Previous completed correction')

    def test_second_correction_resume_rejects_corrupted_archive_before_writes(self):
        self.prepare_second_correction()
        self.audit_mode = 'error'
        with self.assertRaisesRegex(ValueError, 'awaits a changed audio file and real current ASR'):
            self.flow()
        pristine = self.read('retries.json')
        self.audit_mode = 'matched'
        for version in ['initial', 'retry']:
            for corruption in ['missing', 'empty', 'old SHA']:
                with self.subTest(version=version, corruption=corruption):
                    damaged = copy.deepcopy(pristine)
                    self.corrupt_history_asr(damaged['archivedCases'][0], version, corruption)
                    c.atomic(self.out / 'retries.json', damaged)
                    self.assert_rejected_before_authors('Archived completed correction')


SUPERVISOR = r'''
import importlib.util, json, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location('supervised_correction', sys.argv[1])
c = importlib.util.module_from_spec(spec); spec.loader.exec_module(c)
config = json.loads(Path(sys.argv[2]).read_text())
c.ROOT = Path(config['root'])
c.run_command(config['command'], Path(config['work']))
'''


class CommandSupervisionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name).resolve()
        self.work = self.base / 'work'
        self.work.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def command(self, code=0, hold=False):
        # A short wait lets process_identity inspect even the successful child.
        return [sys.executable, '-c',
                f'import time; time.sleep({20 if hold else 0.2}); raise SystemExit({code})']

    def ledger(self):
        return c.read(self.work / 'bank-retry-children.json', {})

    def assert_reaped(self, expected_code):
        record = self.ledger()
        self.assertEqual(record['state'], 'exited')
        child = record['children']['correction']
        self.assertEqual(child['returncode'], expected_code)
        self.assertTrue(child['identity'], 'Run with permission for read-only host ps')
        with self.assertRaises(ProcessLookupError):
            os.kill(child['pid'], 0)
        self.assertEqual(c.retry.running(self.work), [])

    def test_normal_exit_and_failure_are_recorded_and_reaped(self):
        before = {s: signal.getsignal(s) for s in [signal.SIGTERM, signal.SIGINT]}
        with patch.object(c, 'ROOT', self.base):
            c.run_command(self.command(), self.work)
            self.assert_reaped(0)
            with self.assertRaises(subprocess.CalledProcessError) as failure:
                c.run_command(self.command(7), self.work)
            self.assertEqual(failure.exception.returncode, 7)
            self.assert_reaped(7)
        for s, handler in before.items():
            self.assertEqual(signal.getsignal(s), handler)

    def supervisor(self):
        script = self.base / 'supervisor.py'
        script.write_text(SUPERVISOR)
        config = self.base / 'config.json'
        config.write_text(json.dumps({'root': str(self.base), 'work': str(self.work),
                                      'command': self.command(hold=True)}))
        process = subprocess.Popen([sys.executable, str(script), str(SCRIPT), str(config)],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            deadline = time.monotonic() + 15
            while True:
                if process.poll() is not None:
                    self.fail('Supervisor exited before its child: ' + repr(process.communicate()))
                record = self.ledger()
                if record.get('children', {}).get('correction', {}).get('identity'):
                    return process, record['children']['correction']
                if time.monotonic() > deadline:
                    self.fail('Timed out waiting for supervised child and host ps identity')
                time.sleep(.02)
        except BaseException:
            process.terminate()
            process.communicate(timeout=12)
            raise

    def test_sigterm_reaps_child_and_closes_ledger(self):
        process, child = self.supervisor()
        try:
            process.send_signal(signal.SIGTERM)
            stdout, stderr = process.communicate(timeout=12)
            self.assertEqual(process.returncode, 128 + signal.SIGTERM, (stdout, stderr))
            self.assert_reaped(-signal.SIGTERM)
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate(timeout=5)
            with contextlib.suppress(ProcessLookupError):
                os.kill(child['pid'], signal.SIGTERM)

    def test_sigkill_leaves_detectable_live_child_ledger_until_explicit_cleanup(self):
        process, child = self.supervisor()
        try:
            process.kill()
            # The still-live child owns inherited stdout/stderr; wait only for
            # the killed supervisor until the child has been explicitly stopped.
            process.wait(timeout=5)
            self.assertEqual(self.ledger()['state'], 'running')
            self.assertEqual(c.retry.running(self.work), ['retry-correction'], {
                'alive': c.retry.alive(child['pid']), 'saved': child['identity'],
                'current': c.retry.process_identity(child['pid']), 'ledger': self.ledger()})
            # This process did not spawn the orphan directly; the test stops it
            # explicitly, while the persisted identity remains evidence to block
            # overlapping authors after a real uncatchable parent termination.
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
            with contextlib.suppress(ProcessLookupError):
                os.kill(child['pid'], signal.SIGTERM)
            deadline = time.monotonic() + 5
            while c.retry.alive(child['pid']) and time.monotonic() < deadline:
                time.sleep(.02)
            if c.retry.alive(child['pid']):
                os.kill(child['pid'], signal.SIGKILL)
            process.communicate(timeout=5)


if __name__ == '__main__':
    unittest.main()
