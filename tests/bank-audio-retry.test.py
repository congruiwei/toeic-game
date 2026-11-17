"""Pure retry/ASR boundary regressions; never synthesize or transcribe audio.

Run with the same local Python environment used for the audio scripts. Importing
those modules loads their dependencies, but these tests never call main(), a
model constructor, an audio decoder, subprocess.run(), or repository writers.
"""
import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bank_retry', ROOT / 'scripts/retry-bank-audio.py')
retry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retry)

UNIT = {
    'language': 'en', 'bank': 'vocab', 'key': 'v-test/example/0',
    'text': 'Please send the invoice.', 'voiceId': 'af_heart', 'required': True,
}
GENERATION = {
    'model': 'whisper-small', 'modelSha256': 'c' * 64,
    'device': 'cpu', 'computeType': 'int8',
    'beamSize': 5, 'conditionOnPreviousText': False,
    'prompt': None, 'vadFilter': False,
}


def token(unit):
    return f"{unit['language']}:{unit['bank']}:{unit['key']}"


def clip_for(unit=None, checksum='a' * 64):
    unit = copy.deepcopy(unit or UNIT)
    return {
        **unit, 'spoken': unit['text'], 'sha256': checksum,
        'inputSha256': 'd' * 64,
        'src': f"./audio/generated/{unit['language']}/{unit['voiceId']}/{checksum[:32]}.m4a",
        'bytes': 1000, 'duration': 2.5, 'decodedPeak': .45,
        'asrStatus': 'review', 'synthesisSpeed': 1.0,
    }


def actual_for(clip, status='review'):
    return {
        'key': clip['key'], 'src': clip['src'], 'sha256': clip['sha256'],
        'voiceId': clip['voiceId'], 'expected': clip['text'], 'spoken': clip['spoken'],
        'recognized': clip['spoken'], 'status': status,
        'recognitionMethod': 'individual-beam5', 'singleFileVerification': True,
        'recognitionGeneration': copy.deepcopy(GENERATION),
        'segments': [{'start': 0, 'end': 2.5, 'text': clip['spoken']}],
    }


def case_for(unit=None, base=None):
    unit = copy.deepcopy(unit or UNIT)
    base = copy.deepcopy(base)
    initial = clip_for(unit)
    initial['spoken'] = (base or {}).get('spoken', retry.bank.normalize(unit['text'], unit['language']))
    own_retry = dict(base or {}, speed=.90, reason='Retry the same material at a slower pace')
    return {
        'token': token(unit), 'language': unit['language'], 'bank': unit['bank'], 'key': unit['key'],
        'initial': {'clip': initial, 'asr': actual_for(initial)},
        'baseOverride': base, 'retryOverride': own_retry,
        'sourceBinding': retry.binding_for(unit, base),
        'synthesisAttemptCount': 1, 'asrAttemptCount': 1, 'complete': False,
    }


class ActualASRTest(unittest.TestCase):
    def test_actual_recognition_is_not_the_same_as_strict_matching(self):
        clip = clip_for()
        for status in ['matched', 'review', 'accepted']:
            with self.subTest(status=status):
                record = actual_for(clip, status)
                if status == 'review':
                    record['recognized'] = 'Please send an invoice.'
                self.assertTrue(retry.has_actual_asr(clip, record))
        japanese = clip_for({**UNIT, 'language': 'ja', 'voiceId': 'jf_alpha',
                            'text': '請求書を送ってください。'})
        self.assertTrue(retry.has_actual_asr(japanese, actual_for(japanese)))

    def test_empty_whitespace_and_non_string_recognition_never_count(self):
        clip = clip_for()
        for recognized in ['', ' ', '\n\t', None, False, 0, []]:
            with self.subTest(recognized=recognized):
                self.assertFalse(retry.has_actual_asr(clip, {**actual_for(clip), 'recognized': recognized}))
        self.assertFalse(retry.has_actual_asr(clip, None))
        for status in ['pending', 'error', 'unknown', None]:
            with self.subTest(status=status):
                self.assertFalse(retry.has_actual_asr(clip, {**actual_for(clip), 'status': status}))

    def test_recognition_must_bind_current_audio_and_both_source_strings(self):
        clip = clip_for()
        for field, value in [('sha256', 'b' * 64), ('expected', 'A different source sentence.'),
                             ('spoken', 'A different normalized sentence.')]:
            with self.subTest(field=field):
                self.assertFalse(retry.has_actual_asr(clip, {**actual_for(clip), field: value}))

    def test_unprompted_individual_provenance_is_required(self):
        clip = clip_for()
        variants = []
        record = actual_for(clip); record['recognitionGeneration']['prompt'] = clip['text']; variants.append(record)
        record = actual_for(clip); del record['recognitionGeneration']['prompt']; variants.append(record)
        record = actual_for(clip); del record['recognitionGeneration']; variants.append(record)
        record = actual_for(clip); record['singleFileVerification'] = False; variants.append(record)
        record = actual_for(clip); record['recognitionMethod'] = 'expected-text-copy'; variants.append(record)
        for index, record in enumerate(variants):
            with self.subTest(case=index):
                self.assertFalse(retry.has_actual_asr(clip, record))

    def test_batch_provenance_requires_stable_exact_boundaries(self):
        clip = clip_for()
        record = actual_for(clip, 'matched')
        record.update(recognitionMethod='batch-beam1', singleFileVerification=False,
                      screening={'batchId': 'e' * 64, 'boundaryStable': True, 'normalizedExact': True})
        record['recognitionGeneration']['beamSize'] = 1
        self.assertTrue(retry.has_actual_asr(clip, record))
        for key, value in [('boundaryStable', False), ('normalizedExact', False), ('batchId', '')]:
            bad = copy.deepcopy(record); bad['screening'][key] = value
            with self.subTest(field=key):
                self.assertFalse(retry.has_actual_asr(clip, bad))


class CaseBindingTest(unittest.TestCase):
    def test_resume_accepts_base_or_its_own_retry_without_mutating_inputs(self):
        unit = copy.deepcopy(UNIT)
        entry = case_for(unit, {'phonemes': 'ɪnvɔɪs', 'speed': 1.0, 'reason': 'Reviewed word pronunciation'})
        before = copy.deepcopy((entry, unit))
        for override in [entry['baseOverride'], entry['retryOverride']]:
            with self.subTest(override=override):
                self.assertTrue(retry.case_matches(entry, unit, copy.deepcopy(override)))
        cosmetic = {**entry['baseOverride'], 'reason': 'Updated explanatory note only'}
        self.assertTrue(retry.case_matches(entry, unit, cosmetic))
        self.assertEqual((entry, unit), before)

    def test_source_text_voice_and_token_changes_start_a_new_case(self):
        entry = case_for()
        for field, value in [('text', 'Please send the receipt.'), ('voiceId', 'am_puck'),
                             ('key', 'v-test/example/1'), ('bank', 'reading'), ('language', 'ja')]:
            with self.subTest(field=field):
                self.assertFalse(retry.case_matches(entry, {**UNIT, field: value}, entry['baseOverride']))

    def test_external_spoken_phoneme_or_speed_changes_cannot_reuse_a_case(self):
        entry = case_for(base={'spoken': UNIT['text'], 'phonemes': 'ɪnvɔɪs', 'speed': 1.0})
        for field, value in [('spoken', 'Please send the invoice tomorrow.'),
                             ('phonemes', 'changed-phonemes'), ('speed', .80)]:
            current = {**entry['baseOverride'], field: value}
            with self.subTest(field=field):
                self.assertFalse(retry.case_matches(entry, UNIT, current))

    def test_changed_normalization_invalidates_an_unoverridden_spoken_binding(self):
        entry = case_for()
        original = retry.bank.normalize
        with patch.object(retry.bank, 'normalize', side_effect=lambda text, lang: original(text, lang) + ' changed'):
            self.assertFalse(retry.case_matches(entry, UNIT, entry['baseOverride']))
        self.assertTrue(retry.case_matches(entry, UNIT, entry['baseOverride']))


class CoverageAndCompletionTest(unittest.TestCase):
    def coverage(self, source=None, clip=None, record=None):
        clip = copy.deepcopy(clip or clip_for())
        record = copy.deepcopy(record if record is not None else actual_for(clip))
        pair = (clip['language'], clip['bank'])
        return retry.initial_coverage(source or {'units': [copy.deepcopy(UNIT)]},
                                      {pair: {'clips': {clip['key']: clip}}},
                                      {pair: {'records': {clip['key']: record}}})

    def assert_missing(self, gaps, unit=UNIT):
        self.assertTrue(any(token(unit) in str(gap) for gap in gaps), gaps)

    def test_every_required_key_needs_a_current_clip_and_actual_audit(self):
        self.assertEqual(self.coverage(), [])
        self.assert_missing(retry.initial_coverage({'units': [UNIT]}, {}, {}))
        clip = clip_for(); pair = ('en', 'vocab')
        self.assert_missing(retry.initial_coverage({'units': [UNIT]}, {pair: {'clips': {UNIT['key']: clip}}}, {}))
        for patch_record in [{'recognized': ''}, {'recognized': '   '}, {'status': 'error'}, {'sha256': 'f' * 64}]:
            with self.subTest(patch=patch_record):
                self.assert_missing(self.coverage(record={**actual_for(clip), **patch_record}))

    def test_coverage_rejects_source_changes_even_when_old_audio_audit_agree(self):
        for field, value in [('text', 'Please send the receipt.'), ('voiceId', 'am_puck')]:
            with self.subTest(field=field):
                changed = {**UNIT, field: value}
                self.assert_missing(self.coverage(source={'units': [changed]}), changed)

    def test_optional_material_and_visual_markers_do_not_block_required_coverage(self):
        source = {'units': [UNIT, {**UNIT, 'key': 'optional/explanation/0', 'required': False},
                            {**UNIT, 'key': 'read-marker/options/0/0', 'text': '[1]',
                             'required': False, 'nonSpoken': True}]}
        self.assertEqual(self.coverage(source=source), [])

    def test_shared_audio_hash_does_not_hide_an_unaudited_source_alias(self):
        second = {**UNIT, 'key': 'v-another/example/0'}
        first_clip, second_clip = clip_for(), clip_for(second)
        pair = ('en', 'vocab')
        packs = {pair: {'clips': {UNIT['key']: first_clip, second['key']: second_clip}}}
        audits = {pair: {'records': {UNIT['key']: actual_for(first_clip)}}}
        self.assert_missing(retry.initial_coverage({'units': [UNIT, second]}, packs, audits), second)
        audits[pair]['records'][second['key']] = actual_for(second_clip)
        self.assertEqual(retry.initial_coverage({'units': [UNIT, second]}, packs, audits), [])

    def test_retry_readiness_requires_a_different_audio_and_actual_current_asr(self):
        entry = case_for(); second = clip_for(checksum='b' * 64)
        for status in ['matched', 'review', 'accepted']:
            with self.subTest(status=status):
                self.assertTrue(retry.ready_retry(entry, second, actual_for(second, status)))
        self.assertFalse(retry.ready_retry(entry, entry['initial']['clip'], entry['initial']['asr']))
        self.assertFalse(retry.ready_retry(entry, second, None))
        for patch_record in [{'recognized': ''}, {'recognized': ' \n '}, {'status': 'error'},
                             {'sha256': entry['initial']['clip']['sha256']},
                             {'expected': 'Old source wording.'}, {'spoken': 'Old normalization.'}]:
            with self.subTest(patch=patch_record):
                self.assertFalse(retry.ready_retry(entry, second, {**actual_for(second), **patch_record}))
        self.assertFalse(entry['complete'], 'the pure readiness check must not mark a failed case complete')


if __name__ == '__main__':
    unittest.main()
