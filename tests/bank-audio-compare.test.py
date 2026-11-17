"""No inference: actual bank normalization plus pinned offline lexical readings."""
import importlib.util
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
def module(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/file)
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
compare=module('audio_compare','scripts/audio-compare.py')
bank=module('bank_compare_normalizer','scripts/generate-bank-audio.py')

class EquivalenceTest(unittest.TestCase):
    def check(self,a,b,language='en',expected=True,source=None):
        result=compare.compare(a,b,language,normalizer=bank.normalize,source_text=source)
        self.assertIs(result['equivalent'],expected,(a,b,result))
        self.assertEqual(result['ruleVersion'],compare.RULE_VERSION)
        if expected:
            self.assertTrue(result['proofExpected'])
            self.assertEqual(result['proofExpected'],result['proofRecognized'])
        self.assertTrue(result['reasons']);self.assertIn('provenance',result)
        return result

    def test_compound_boundaries_from_actual_review(self):
        for a,b in [('worktable','work table'),('windowpane','window pane'),('preorders','pre-orders'),
                    ('noticeboard','notice board'),('waybill','way bill'),('fieldwork','field work'),
                    ('lockboxes','lock boxes'),('coworker','co-worker')]:
            with self.subTest(a=a):self.check(a,b)

    def test_arbitrary_letter_concatenation_is_not_a_rule(self):
        for a,b in [('therapist','the rapist'),('nowhere','now here'),('postpone','post pone'),
                    ('we cap meal','wecapmeal'),('a can toward','a contorted'),('café','caf')]:
            with self.subTest(a=a):self.check(a,b,expected=False)

    def test_exact_spelling_variants(self):
        for a,b in [('gray logo','grey logo'),('has been canceled','has been cancelled'),
                    ('color labels','colour labels'),('two liters','two litres'),('entrée','entree')]:self.check(a,b)

    def test_contractions_keep_the_pronoun_and_negation(self):
        for a,b in [("Who'll take minutes?",'Who will take minutes?'),("Who's responsible?",'Who is responsible?'),
                    ("Aren't tickets free?",'Are not tickets free?'),("We haven't signed.",'We have not signed.'),
                    ("The number's too small.",'The number is too small.')]:self.check(a,b)
        for a,b in [("Who'll take minutes?","We'll take minutes?"),("Aren't tickets free?",'On tickets free.'),
                    ("Aren't tickets free?",'Are tickets free?'),('can not attend','can attend')]:self.check(a,b,expected=False)

    def test_possessives_preserve_the_audible_s(self):
        self.check("The menu is the chef's.",'The menu is the chefs.')
        self.check('Its switch does not work.',"It's switch does not work.")
        self.check("The guest's surname is here.",'The guest surname is here.',expected=False)

    def test_article_policy_is_explicit_not_phonetic(self):
        for a,b in [('A lamp stands here.','The lamp stands here.'),('An office is open.','The office is open.'),('A locker','Locker')]:
            result=self.check(a,b);self.assertTrue(any('user-allowed-article:' in r for r in result['reasons']))
        self.check('a','the',expected=False);self.check('A4 paper','four paper',expected=False)

    def test_source_anchored_single_letter(self):
        self.check('A.','A',source='A.')
        result=self.check('A.','a',source='A.')
        self.assertIn('source-anchored-letter:A',result['reasons'])
        self.check('A.','a',expected=False)
        self.check('A.','the',source='A.',expected=False)

    def test_exact_homophones_and_head_confusables(self):
        for a,b in [('beech','beach'),('wait','weight'),('fare','fair')]:self.check(a,b)
        for a,b in [('Will','Well'),('Who','Hell'),('courier','career'),('vans','fans'),
                    ('read','reed'),('close','clothes'),('sing','sink'),('aisle',"I'll")]:self.check(a,b,expected=False)

    def test_tense_plural_and_completed_action_are_not_erased(self):
        for a,b in [('liked','like'),('signed','sign'),('arrived','arrive'),('sponsored','sponsor'),
                    ('tightened','tighten'),('used','use'),('returned','return'),('assumed','assume'),
                    ('asked','ask'),('visitor','visitors'),('desk','desks'),('artist','artists'),
                    ('It has closed.','It is closed.'),('A glass has fallen beneath the table.','The glass is falling beneath the table.')]:
            with self.subTest(a=a):self.check(a,b,expected=False)

    def test_numbers_currency_and_clock_anchor(self):
        self.check('We need ten copies.','We need 10 copies.')
        self.check('It costs twenty dollars.','It costs $20.')
        self.check('It starts at eight fifteen.','It starts at 815.',source='It starts at 8:15.')
        self.check('It starts at eight fifteen.','It starts at 815.',expected=False)
        self.check('It starts at eight fifteen.','It starts at 845.',source='It starts at 8:15.',expected=False)
        self.check('It costs eight hundred and fifteen dollars.','It costs $815.',source='It costs $815.')
        self.check('There are twelve copies.','There are twenty copies.',expected=False)

    def test_japanese_kana_kanji_and_particles(self):
        for a,b in [('取っ手','とって'),('折り畳んでいます。','折りたたんでいます。'),
                    ('会議へ行った。','会議え行った。'),('私は本を読む。','私わ本お読む。'),
                    ('情報','じょうほう'),('公園','講演')]:self.check(a,b,'ja')

    def test_japanese_long_vowels_do_not_delete_morae(self):
        self.check('コーヒー','こーひー','ja')
        for a,b in [('コーン','幸運'),('王','追う'),('おばさん','おばあさん'),
                    ('ビル','ビール'),('公園','講義')]:self.check(a,b,'ja',expected=False)

    def test_japanese_gemination_and_tense_remain(self):
        for a,b in [('学校','がこう'),('切手','きて'),('取っ手','とて'),
                    ('行きました。','行きます。'),('行きません。','行きます。'),
                    ('サッカー','さかー'),('台車','代謝')]:self.check(a,b,'ja',expected=False)

    def test_japanese_numbers_counters_and_mixed_english(self):
        self.check('ひとりがいます。','1人がいます。','ja')
        self.check('くじごふんに来てください。','09:05に来てください。','ja')
        self.check('くじごふんに来てください。','09:15に来てください。','ja',expected=False)
        self.check('Who、誰、','ふうだれ','ja',expected=False)
        self.check('Basic','ベーシック','ja',expected=False)
        self.check('Plus','プラス','ja',expected=False)
        self.check('Who、誰、','ふるだれ','ja',expected=False)

    def test_labels_signed_values_and_contextual_kanji(self):
        source='Returns is at Desk A on the directory.'
        self.check(source,'Returns is at Desk on the directory.',source=source,expected=False)
        self.check(source,'Returns is at Desk A on the directory.',source=source)
        self.check('The temperature is -5 degrees.','The temperature is 5 degrees.',expected=False)
        self.check('The temperature is minus five degrees.','The temperature is -5 degrees.')
        self.check('温度は-5度です。','温度は5度です。','ja',expected=False)
        for source,recognized,language in [('The temperature is -5 degrees.','The temperature is 5 degrees.','en'),('温度は-5度です。','温度は5度です。','ja')]:
            self.check(bank.normalize(source,language),recognized,language,source=source,expected=False)
        self.check('担当の方が来ます。','担当のほうが来ます。','ja',expected=False)
        self.check('空の箱です。','そらの箱です。','ja',expected=False)
        self.check('ほうがいいです。','方がいいです。','ja',expected=False)

    def test_all_eighteen_current_ed_omission_candidates_stay_review(self):
        cases=[
            ('en:part2:p2-031/options/2/0', 'Most of the staff liked the invitation design.', 'Most of the staff, like the invitation design.', 'Most of the staff liked the invitation design.'),
            ('en:part2:p2-050/options/1/0', 'We sponsored the concert in May.', 'We sponsor the concert in May.', 'We sponsored the concert in May.'),
            ('en:part2:p2-083/options/1/0', 'The guests arrived ten minutes early.', 'The guests arrive 10 minutes early.', 'The guests arrived ten minutes early.'),
            ('en:part2:p2-099/options/2/0', 'I tightened the handle screws.', 'I tighten the handle screws.', 'I tightened the handle screws.'),
            ('en:part2:p2-199/options/0/0', 'The bidders used the same online submission portal.', 'The bidders use the same online submission portal.', 'The bidders used the same online submission portal.'),
            ('en:listening:p4-g04/turns/0/2', 'That is encouraging, but two returned trays had loose corners.', 'That is encouraging, but two return trays had loose corners.', 'That is encouraging, but two returned trays had loose corners.'),
            ('en:listening:p3-g05/turns/2/0', 'I assumed the store crew would install them.', 'I assume the store crew would install them.', 'I assumed the store crew would install them.'),
            ('en:listening:p4-g05/turns/0/2', 'You asked to pause it while our large kiln is being replaced.', 'You ask to pause it while our large kiln is being replaced.', 'You asked to pause it while our large kiln is being replaced.'),
            ('en:listening:p3-g23-q1/options/3/0', 'Fewer credits appeared than expected.', 'if your credits appear than expected.', 'Fewer credits appeared than expected.'),
            ('en:listening:p3-g40-q3/options/1/0', 'To remove the patterned section', 'to remove the pattern section.', 'To remove the patterned section'),
            ('en:listening:p4-g40-q1/options/0/0', 'Packaging complaints moved to a separate list.', 'Packaging complaints move to a separate list.', 'Packaging complaints moved to a separate list.'),
            ('en:vocab:v-copy/example/0', "We've kept a certified copy of the signed permit and sent the sole original to the council.", "We've kept a certified copy of the sign permit and sent the soul original to the council.", "We've kept a certified copy of the signed permit and sent the sole original to the council."),
            ('en:vocab:v-lease/example/0', 'The signed lease grants temporary possession of the courtyard in exchange for monthly rent.', 'The sign lease grants temporary possession of the courtyard in exchange for monthly rent.', 'The signed lease grants temporary possession of the courtyard in exchange for monthly rent.'),
            ('en:vocab:v-restoration/example/0', 'Experts returned the original painted ceiling to its former appearance through careful restoration.', 'Experts return the original painted ceiling to its former appearance through careful restoration.', 'Experts returned the original painted ceiling to its former appearance through careful restoration.'),
            ('en:vocab:v-joint/example/0', 'Both owners signed the joint agreement, which binds them together rather than individually.', 'Both owners sign the joint agreement, which binds them together rather than individually.', 'Both owners signed the joint agreement, which binds them together rather than individually.'),
            ('en:vocab:v-detour/example/0', 'The signed detour provides an alternative route around the entire road closure before rejoining our original road.', 'The sign detour provides an alternative route around the entire road closure before rejoining our original road.', 'The signed detour provides an alternative route around the entire road closure before rejoining our original road.'),
            ('en:grammar:gram-passive-15/sentence/0', 'Last Friday the temporary bridge was opened to cyclists for the first time.', 'Last Friday, the temporary bridge was open to cyclists for the first time.', 'Last Friday the temporary bridge was opened to cyclists for the first time.'),
            ('en:grammar:gram-modifiers-12/sentence/0', 'The forms misplaced during the move had to be printed again.', "The form's misplace during the move had to be printed again.", 'The forms misplaced during the move had to be printed again.'),
        ]
        self.assertEqual(len(cases),18)
        for token,spoken,recognized,source in cases:
            with self.subTest(token=token):self.check(spoken,recognized,source=source,expected=False)

    def test_phone_only_override_cannot_borrow_dictionary_proof(self):
        r=compare.compare('差出人','差し出し人','ja',normalizer=bank.normalize,phoneme_override=True)
        self.assertFalse(r['equivalent']);self.assertIn('phoneme-override-not-proven-by-dictionary-reading',r['reasons'])
        r=compare.compare('差出人。','差出人','ja',normalizer=bank.normalize,phoneme_override=True)
        self.assertTrue(r['equivalent'])

    def test_empty_noise_and_provenance(self):
        for language in ['en','ja']:
            self.check('hello','',language,expected=False)
            self.check('','',language,expected=False)
            self.check('...','...',language,expected=False)
        result=self.check('取っ手','とって','ja')
        self.assertTrue(result['readingTrace']['expected'])
        self.assertEqual(result['provenance']['cmudict'],'1.1.3')
        self.assertEqual(result['provenance']['pykakasi'],'2.3.0')

if __name__=='__main__':unittest.main()
