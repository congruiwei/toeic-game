"""Finite source-format regressions. No inference or new dictionaries."""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
HERE = ROOT / 'tests/fixtures/audio-formatting'
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result
compare = load('private_format_compare', ROOT / 'scripts/audio-compare.py')
bank = load('actual_bank_normalizer', ROOT / 'scripts/generate-bank-audio.py')

class FormattingTest(unittest.TestCase):
    def check(self, source, spoken, recognized, equivalent, reason=None):
        result = compare.compare(spoken, recognized, 'en', normalizer=bank.normalize, source_text=source)
        self.assertIs(result['equivalent'], equivalent, result)
        self.assertEqual(result['recognized'], recognized, 'Never replace actual transcript in proof record')
        self.assertEqual(result['expectedSpoken'], spoken)
        if equivalent:
            self.assertTrue(result['proofExpected'])
            self.assertEqual(result['proofExpected'], result['proofRecognized'])
            if reason:
                self.assertTrue(any(x.startswith(reason) for x in result['reasons']), result)
        return result

    def test_actual_eight_snapshot_cases_and_every_other_current_review_stays_review(self):
        approved = {'en:vocab:v-hire/example/0', 'en:vocab:v-abbreviate/example/0', 'en:vocab:v-socket/example/0',
                    'en:vocab:v-deposit/example/0', 'en:vocab:v-deduct/example/0', 'en:vocab:v-fare/example/0',
                    'en:listening:p3-g11/turns/2/0', 'en:vocab:v-capacity/example/0'}
        rows = json.loads((HERE / 'remaining-en-snapshot.json').read_text())
        self.assertEqual(len(rows), 85)
        changed = []
        for row in rows:
            with self.subTest(token=row['token']):
                r = self.check(row['text'], row['spoken'], row['recognized'], row['token'] in approved)
                if r['equivalent']:
                    changed.append(row['token'])
        self.assertEqual(set(changed), approved)

    def test_later_actual_review_adds_only_reviewed_currency_formats(self):
        rows = json.loads((HERE / 'remaining-en-later-snapshot.json').read_text())
        self.assertEqual(len(rows), 37)
        allowed = {'en:vocab:v-rebate/example/0', 'en:vocab:v-markup/example/0',
                   'en:vocab:v-markdown/example/0', 'en:vocab:v-unit-cost/example/0', 'en:vocab:v-respectively/example/0'}
        for row in rows:
            with self.subTest(token=row['token']):
                self.check(row['text'], row['spoken'], row['recognized'], row['token'] in allowed)

    def test_finite_diacritics_do_not_erase_word_distinctions(self):
        for source, heard, yes in [('The café opens.', 'The cafe opens.', True), ('Two cafés opened.', 'Two cafes opened.', True),
                                   ('The café opens.', 'The caf opens.', False), ('The résumé is here.', 'The resume is here.', False),
                                   ('Two cafés opened.', 'Two cafe opened.', False)]:
            self.check(source, source, heard, yes)

    def test_spelled_dept_only_when_source_and_actual_input_both_anchor_it(self):
        source = 'Abbreviate department to dept. on the label.'
        spoken = 'Abbreviate department to D E P T on the label.'
        self.check(source, spoken, 'Abbreviate department to DEPT on the label.', True, 'source-spelled-abbreviation:')
        for heard in ['Abbreviate department to DEPTs on the label.', 'Abbreviate department to DEP on the label.',
                      'Abbreviate department to department on the label.']:
            self.check(source, spoken, heard, False)
        self.check(None, 'D E P T', 'DEPT', False)
        self.check('This is dept.', 'This is department.', 'This is DEPT.', False)
        self.check('This is CAT.', 'This is C A T.', 'This is CAT.', False)

    def test_attached_v_uses_exact_source_value_and_unit(self):
        source = 'The socket is marked 120 V.'
        spoken = bank.normalize(source, 'en')
        self.check(source, spoken, 'The socket is marked 120V.', True, 'source-anchored-unit-spacing:')
        for heard in ['The socket is marked 121V.', 'The socket is marked 120W.', 'The socket is marked 120.',
                      'The socket is marked -120V.']:
            self.check(source, spoken, heard, False)
        self.check(None, 'The socket is marked one hundred and twenty V.', 'The socket is marked 120V.', False)

    def test_compound_currency_restores_only_same_written_amount_and_source_noun(self):
        source = 'A fifty-dollar deposit secures your place.'
        self.check(source, source, 'A $50 deposit secures your place.', True, 'source-anchored-adjectival-currency:')
        for heard in ['A fifty dollars deposit secures your place.', 'A $51 deposit secures your place.',
                      'A $50 deposits secures your place.', 'A $50 fee secures your place.',
                      'A -$50 deposit secures your place.', 'A +$50 deposit secures your place.']:
            self.check(source, source, heard, False)
        self.check(None, source, 'A $50 deposit secures your place.', False)
        self.check('I paid fifty dollars.', 'I paid fifty dollars.', 'I paid fifty dollar.', False)
        self.check(source, 'A fifty dollars deposit secures your place.', 'A $50 deposit secures your place.', True)
        # Prior line uses normal dollar formatting: it does not erase an actual
        # plural in the selected spoken input or relabel it as singular.

    def test_written_clock_is_narrow_and_preserves_wrong_value_and_sign(self):
        source = "It's already six fifteen."
        self.check(source, source, "It's already 6.15.", True, 'source-anchored-written-clock:')
        for heard in ["It's already 6.50.", "It's already $6.15.", "It's already -6.15.", "It's already 6.16."]:
            self.check(source, source, heard, False)
        self.check(None, source, "It's already 6.15.", False)
        self.check('The reading is six fifteen.', 'The reading is six fifteen.', 'The reading is 6.15.', False)

    def test_hundreds_style_restoration_only_for_raw_same_integer_not_audible_and(self):
        source = 'Capacity increased to one hundred sixty units.'
        self.check(source, source, 'Capacity increased to 160 units.', True, 'source-anchored-number-style:')
        for heard in ['Capacity increased to one hundred and sixty units.', 'Capacity increased to 161 units.',
                      'Capacity increased to -160 units.', 'Capacity increased to +160 units.', 'Capacity increased to 160 unit.']:
            self.check(source, source, heard, False)
        self.check(None, source, 'Capacity increased to 160 units.', False)

    def test_all_final_167_actual_reviews_change_only_the_24_reviewed_formats(self):
        rows = json.loads((HERE / 'english-final-snapshot.json').read_text())
        approved = {
            'en:listening:p3-g11/turns/2/0', 'en:vocab:v-abbreviate/example/0', 'en:vocab:v-socket/example/0',
            'en:vocab:v-hire/example/0', 'en:vocab:v-deposit/example/0', 'en:vocab:v-deduct/example/0',
            'en:vocab:v-fare/example/0', 'en:vocab:v-capacity/example/0', 'en:vocab:v-rebate/example/0',
            'en:vocab:v-markdown/example/0', 'en:vocab:v-markup/example/0', 'en:vocab:v-unit-cost/example/0',
            'en:vocab:v-respectively/example/0', 'en:vocab:v-renovate/example/0', 'en:vocab:v-clientele/example/0',
            'en:vocab:v-acquire/example/0', 'en:vocab:v-appreciate-gain-value/example/0',
            'en:vocab:v-board-committee/example/0', 'en:reading:read-mat/documents/0/text/3',
            'en:reading:read-mat/documents/0/text/5', 'en:reading:read-seats/documents/0/text/0',
            'en:reading:read-seats/documents/1/text/2', 'en:reading:read-banding/documents/0/text/2',
            'en:grammar:gram-preposition-02/sentence/0',
        }
        self.assertEqual(len(rows),167);self.assertEqual(len(approved),24)
        for row in rows:
            with self.subTest(token=row['token']):
                self.check(row['text'],row['spoken'],row['recognized'],row['token'] in approved)

    def test_possessive_diacritic_keeps_the_audible_s(self):
        source="The café's clientele is growing."
        self.check(source,source,"The cafe's clientele is growing.",True)
        self.check(source,source,'The cafe clientele is growing.',False)
        self.check('The café opens.','The café opens.','The cafes open.',False)

    def test_explicit_source_currency_with_reviewed_singular_spoken_input(self):
        source='Pay a $60 deposit per booking.'
        spoken='Pay a sixty-dollar deposit per booking.'
        self.check(source,spoken,source,True,'source-anchored-adjectival-currency:')
        for heard in ['Pay a sixty dollars deposit per booking.','Pay a $61 deposit per booking.',
                      'Pay a -$60 deposit per booking.','Pay a $60 deposits per booking.']:
            self.check(source,spoken,heard,False)
        self.check('Pay a $61 deposit per booking.',spoken,source,False)

    def test_symbol_scale_never_changes_amount_scale_or_explicit_unit_words(self):
        source='The buyers paid six million dollars to acquire the café.'
        self.check(source,source,'The buyers paid $6 million to acquire the cafe.',True,'source-anchored-scaled-currency:')
        for heard in ['The buyers paid $7 million to acquire the cafe.',
                      'The buyers paid $6 billion to acquire the cafe.',
                      'The buyers paid six dollars million to acquire the cafe.',
                      'The buyers paid $6 millions to acquire the cafe.',
                      'The buyers paid -$6 million to acquire the cafe.']:
            self.check(source,source,heard,False)

    def test_reviewed_vote_tally_is_not_arbitrary_hyphen_or_minus(self):
        source='The board voted seven to two to approve the plan.'
        self.check(source,source,'The board voted 7-2 to approve the plan.',True,'source-anchored-vote-tally:')
        for heard in ['The board voted 7-3 to approve the plan.',
                      'The board voted seven minus two to approve the plan.',
                      'The board voted seven and two to approve the plan.']:
            self.check(source,source,heard,False)
        self.check('The board measured seven to two.','The board measured seven to two.','The board measured 7-2.',False)

    def test_decimal_cents_and_mixed_digit_spelling_preserve_all_actual_tokens(self):
        source='Units 101 through 200 cost $1.60 each.'
        spoken='Units one hundred and one through two hundred cost one dollar sixty cents each.'
        heard='Units 100 and 1 through 200 cost $1.60 each.'
        self.check(source,spoken,heard,True,'source-anchored-cents-input:')
        for altered in [heard.replace('100 and 1','100 and 2'),heard.replace('$1.60','$1.06'),
                        heard.replace('$1.60','one dollar sixty'),heard.replace('$1.60','one dollars sixty cents'),
                        heard.replace('$1.60','-$1.60'),heard.replace('100 and 1','1001')]:
            self.check(source,spoken,altered,False)
        self.check(source.replace('$1.60','$1.06'),spoken,heard,False)

    def test_reviewed_currency_ellipsis_does_not_strip_explicit_dollars_or_wrong_values(self):
        cases=[
            ('The price fell from forty dollars to thirty.', 'The price fell from $40 to $30.'),
            ('It rose from two dollars per notebook to three.', 'It rose from $2 per notebook to $3.'),
            ('They cost eight and six dollars respectively.', 'They cost $8 and $6 respectively.'),
            ('It rose from eighty thousand dollars to ninety thousand.', 'It rose from $80,000 to $90,000.'),
        ]
        for source,heard in cases:
            with self.subTest(source=source):
                self.check(source,source,heard,True,'source-anchored-currency-ellipsis:')
                self.check(None,source,heard,False)
        self.check(cases[0][0],cases[0][0],'The price fell from forty dollars to thirty dollars.',False)
        self.check(cases[0][0],cases[0][0],'The price fell from $40 to $31.',False)
        self.check(cases[2][0],cases[2][0],'They cost $8 and $6 dollars respectively.',False)

    def test_provenance_binds_current_rule_and_normalizer_code(self):
        result = self.check('The café opened.', 'The café opened.', 'The cafe opened.', True)
        import hashlib
        self.assertEqual(result['provenance']['ruleFileSha256'], hashlib.sha256((ROOT / 'scripts/audio-compare.py').read_bytes()).hexdigest())
        self.assertEqual(result['provenance']['normalizerFileSha256'], hashlib.sha256((ROOT / 'scripts/generate-bank-audio.py').read_bytes()).hexdigest())

if __name__ == '__main__':
    unittest.main()
