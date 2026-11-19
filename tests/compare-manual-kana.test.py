"""Pure dictionary/comparison regressions; no synthesis or ASR model is loaded."""
import hashlib
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('manual_kana', ROOT/'scripts/compare-manual-kana.py')
subject = importlib.util.module_from_spec(spec)
spec.loader.exec_module(subject)


class ManualKanaTests(unittest.TestCase):
    def yes(self, spoken, recognized, source=None):
        result = subject.compare(spoken, recognized, source or recognized)
        self.assertTrue(result['equivalent'], result)
        self.assertEqual(result['proofExpected'], result['proofRecognized'])
        return result

    def no(self, spoken, recognized, source=None):
        result = subject.compare(spoken, recognized, source or recognized)
        self.assertFalse(result['equivalent'], result)
        return result

    def test_reference_is_never_given_to_a_tagger(self):
        original = subject._tagger()
        seen=[]
        def tag(text):
            seen.append(text)
            return original(text)
        with patch.object(subject, '_tagger', return_value=tag):
            result=self.yes('せーきゅーします', '請求します')
        self.assertEqual(seen, ['請求します'])
        self.assertEqual(result['expectedSpoken'], 'せーきゅーします')
        self.assertEqual(result['readingTrace']['expected'], [])
        self.assertEqual(result['normalizedExpected'], 'せーきゅーします')

    def test_reference_non_kana_rejected_before_dictionary(self):
        with patch.object(subject, '_tagger', side_effect=AssertionError('must not run')):
            for invalid in ['請求します','セイキュウ','12じ','ABC','']:
                with self.subTest(invalid=invalid):self.no(invalid, '請求します')

    def test_current_surface_and_pron_allow_authored_long_vowels(self):
        self.yes('そーりょーわ かいけいがかりえ せーきゅーします。','送料は会計係へ請求します。')
        self.yes('そうりょうわ かいけいがかりえ せいきゅうします。','送料は会計係へ請求します。')
        self.yes('とーきょー','東京')
        self.yes('とおり','通り')
        self.yes('とーり','通り')
        self.yes('せいぞー','製造')
        self.yes('せーぞう','製造')
        self.yes('しょーせい','焼成')
        self.no('せぞー','製造')
        self.no('きそー','競う')

    def test_long_vowels_are_not_optional(self):
        self.no('ときょ','東京')
        self.no('せきゅ','請求')
        self.no('おばさん','おばあさん')
        self.no('びる','ビール')

    def test_dictionary_split_explicit_long_mark_stays_with_adjacent_literal(self):
        self.yes('だーら','だーら','Dara')
        self.yes('だーらこちらのそーこ','だーら、こちらの倉庫','Dara：こちらの倉庫')
        self.no('だら','だーら','Dara')
        self.no('だーら','だら','Dara')
        self.no('だーら','だ、ーら','Dara')
        self.no('だーら','だ ーら','Dara')
        self.no('あー','ー')

    def test_sokuon_and_small_kana_are_not_optional(self):
        self.no('して','知って')
        self.no('きやく','客')
        self.no('じゆう','十')
        self.no('きて','切って')

    def test_standard_yotsugana_pairs_have_identical_renderer_phones(self):
        renderer_spec=importlib.util.spec_from_file_location('manual_renderer',ROOT/'scripts/render-kana-audio.py')
        renderer=importlib.util.module_from_spec(renderer_spec);renderer_spec.loader.exec_module(renderer)
        for a,b in [('にづみば','にずみば'),('ちぢむ','ちじむ'),('ぢゃ','じゃ')]:
            with self.subTest(a=a,b=b):
                self.assertEqual(renderer.render_phones(a),renderer.render_phones(b))
                self.yes(a,b)
        self.no('にづみば','にすみば')
        self.no('ちぢむ','ちちむ')
        self.no('はゔ','はぶ')
        self.no('いく','いっく')

    def test_pure_kana_asr_is_not_reinterpreted_by_dictionary_pron(self):
        self.yes('おもう','おもう')
        self.no('おもー','おもう')
        self.yes('おー','おお')
        self.no('おー','おう')
        self.no('てーる','ている')
        self.no('えー','えい')

    def test_no_long_vowel_fold_across_verb_or_morpheme_boundaries(self):
        # Globally folding を into お would let the following redistribute
        # a long vowel across the noun/particle/verb boundary and pass.
        self.no('さしだしにんのじゅーしょをおおうから','差出人の重傷を負うから','差出人の住所を覆うから')
        self.yes('おう','追う')
        self.no('おー','追う')
        self.yes('やとう','雇う')
        self.no('やとー','雇う')
        self.yes('のうえ','の上')
        self.no('のーえ','の上')
        self.no('おーけとり','お受け取り')

    def test_inflected_surface_never_uses_lemma(self):
        self.yes('おもった','思った')
        self.no('おもうた','思った')
        self.yes('いかなかった','行かなかった')
        self.no('いくなかった','行かなかった')

    def test_tense_and_negation_are_preserved(self):
        self.no('はっそーします','発送しません')
        self.no('はっそーしました','発送します')
        self.no('はっそーしません','発送しました')
        self.yes('はっそーしません','発送しません')

    def test_particles_are_read_but_not_added_or_removed(self):
        self.yes('とうきょうわ とおい','東京は遠い')
        self.yes('とうきょうえ','東京へ')
        self.yes('はこを','箱を')
        self.yes('はこお','箱を')
        self.no('とうきょう','東京へ')
        self.no('とうきょうに','東京へ')
        self.no('とうきょうわ','東京が')

    def test_spelling_change_with_same_proven_reading_is_allowed(self):
        self.yes('こーえん','公園')
        self.yes('こーえん','講演')
        self.no('こーえん','公演者')

    def test_numeric_value_unit_and_sign(self):
        self.yes('じゅーにどる','12ドル')
        self.yes('じゅうにどる','十二ドル')
        self.no('じゅーにどる','13ドル')
        self.no('じゅーにどる','12セント')
        self.yes('まいなすごどる','-$5')
        self.no('ごどる','-$5')
        self.no('まいなすごどる','$5')
        self.no('まいなすごどる','+$5')
        self.yes('ぷらすご','+5')
        self.no('ご','+5')
        self.no('ご','5','-5')
        self.no('ごどる','$5','-$5')
        self.yes('ひゃくまん','100万')
        self.yes('ひゃくはちまん','108万')
        self.no('ひゃくまん','108万')
        self.no('ひゃくまん','100億')
        self.yes('ぜろまん','0万')
        self.no('ぜろ','0万')

    def test_currency_decimals_fraction_and_unknown_notation_fail_closed(self):
        for value in ['$5.50','1.5','1/2','1,2','€5','5%']:
            with self.subTest(value=value):self.no('ご',value)
        self.yes('せんにひゃく','1,200')
        self.no('せんにひゃく','1,020')

    def test_clock_preserves_exact_hour_and_minute(self):
        self.yes('じゅーよじ ごじゅっぷん','14:50')
        self.yes('じゅうよじ ごじゅっぷん','14時50分')
        self.yes('しちじ ろっぷん','7:06')
        self.yes('くじ','9:00')
        self.no('じゅーよじ ごじゅっぷん','14:15')
        self.no('じゅーよじ ごじゅっぷん','15:50')
        self.no('くじ','9:60')
        self.no('にじゅーごじ','25:00')

    def test_calendar_date_and_counter_irregularities(self):
        self.yes('はちがつ ついたち','8月1日')
        self.yes('しがつ にじゅーよっか','4月24日')
        self.yes('じゅーがつ とおか','10月10日')
        self.no('はちがつ ついたち','8月2日')
        self.no('はちがつ ついたち','7月1日')
        self.no('じゅーさんがつ ついたち','13月1日')
        self.no('しがつ さんじゅーににち','4月32日')
        self.yes('はっこ','8個')
        self.no('わっこ','8個')
        self.yes('いっしゅーかん','1週間')
        self.yes('よじかん','4時間')
        self.yes('にじゅーよにん','24人')
        self.yes('ひゃくつー','100通')
        self.no('ひゃっつー','100通')

    def test_reviewed_weekdays_and_native_counts(self):
        self.yes('きんよーびに はっこ','金曜日に8個')
        self.no('きんよーびに はっこ','木曜日に8個')
        self.no('きんよーひ','金曜日')
        self.yes('ひとつと よっつ','一つと4つ')
        self.no('ひとつと よっつ','2つと4つ')
        self.yes('さんぶんめ','3文目')
        self.no('さんあやめ','3文目')
        self.yes('いってん','1点')
        self.yes('にじゅっぱこ','20箱')
        self.no('にじゅっぱこ','21箱')
        self.yes('よんじゅっぷんかん','40分間')
        self.yes('にめー','2名')
        self.no('にめー','3名')
        self.yes('にちゃく','2着')
        self.yes('いっさつ','1冊')
        self.yes('いっそく','1足')
        self.yes('ひとくみ','1組')
        self.yes('ふたくみ','2組')
        self.yes('いちにちじゅー','1日中')
        self.yes('せんけんめ','1000件目')
        self.yes('にはく','2泊')
        self.yes('にはくぶん','二泊分')
        self.no('にぱく','2泊')
        self.no('にはく','3泊')

    def test_gram_symbol_requires_original_unit_and_exact_amount(self):
        self.yes('にひゃくぐらむ','200g','200グラム')
        self.yes('わずかにひゃくぐらむ','わずか200g','わずか200グラム')
        self.no('にひゃくぐらむ','201g','200グラム')
        self.no('にひゃくぐらむ','200kg','200グラム')
        self.no('にひゃくぐらむ','200g','型番200g')
        self.no('にひゃくぐらむ','200g','1200グラム')
        self.no('にひゃくぐらむ','200g','1.200グラム')

    def test_numeric_percent_and_decimals_are_exact_not_fuzzy(self):
        self.yes('さんぱーせんと','3%')
        self.yes('じゅっぱーせんと','10%')
        self.yes('じゅうぱーせんと','10パーセント')
        self.no('じゅっぱーせんと','11%')
        self.yes('いちどる ろくじゅーせんと','$1.60')
        self.no('いちどる ろくじゅーせんと','$1.06')
        self.yes('れいてんご','0.5')
        self.yes('れーてんご','0.5')
        self.yes('ぜろてんご','0.5')
        self.no('れいてんご','0.6')
        self.no('れいてんごぜろ','0.5')
        self.no('いちてんにさん','1.023')
        self.no('じゅうじじゅっぷんさん','10:10:03')
        self.no('いちてんにさん','1.2.3')
        self.no('いちてんにさん','1.2,3')
        self.no('いちてんにさん','1.2/3')
        self.no('いちてんにさん','1.2:3')
        self.no('いちどる ろくじゅーせんと さん','$1.60.3')
        self.no('いちどる ろくじゅーせんと に','$1.60/2')
        self.no('じゅうじじゅっぷんさん','10:10.3')
        self.no('ろくがつようかご','June 8.5')
        self.no('しがつよっかご','4月4日.5')
        self.yes('いちてんにさん','1.23.')

    def test_reviewed_kana_words_do_not_generalize_to_verb_readings(self):
        self.yes('ありがとーございます','ありがとうございます')
        self.yes('ちょーつがい','ちょうつがい')
        self.yes('じょーろ','じょうろ')
        self.yes('どーすべきですか','どうすべきですか')
        self.yes('できるよーに','できるように')
        self.yes('そーでしょう','そうでしょう')
        self.yes('こんにちわ','こんにちは')
        self.yes('もーいちねん','もう1年')
        self.no('おもー','おもう','思う')
        self.no('よー','よう','酔う')
        self.no('やとー','やとう','雇う')

    def test_reviewed_compounds_and_unresolved_context_are_distinct(self):
        self.yes('だんぼーるばこ','段ボール箱')
        self.yes('だんぼーるばこ','ダンボール箱')
        self.yes('だんぼーるばこ','だんぼーる箱')
        self.no('だんぼーるはこ','段ボール箱')
        self.no('だんぼーるはこ','ダンボール箱')
        self.yes('うけとりにん','受取人')
        self.yes('うけとりにん','受け取り人')
        self.no('うけとりひと','受取人')
        # Exact written source equality alone does not resolve a homograph.
        self.no('からの はこ','空の箱','空の箱')
        self.no('くるまいすの かた','車いすの方','車いすの方')
        self.no('ほかんじょ','保管所','保管所')
        self.yes('ふそくのじたい','不足の事態')
        self.yes('しきんぶそく','資金不足')
        self.no('しきんふそく','資金不足')
        self.yes('こーくーがいしゃ','航空会社')
        self.no('こーくーかいしゃ','航空会社')
        self.yes('てにもつ','手荷物')
        self.no('しゅにもつ','手荷物')
        self.yes('はいすいこー','排水口')
        self.no('はいすいくち','排水口')
        self.yes('ひじょーぐち','非常口')
        self.no('ひじょーくち','非常口')
        self.yes('さしだしにん','差出人')
        self.no('さしだしひと','差出人')
        self.yes('におくりにん','荷送人')
        self.no('におくりびと','荷送人')
        self.yes('こーせーずり','校正刷り')
        self.no('こーせーすり','校正刷り')
        self.yes('みほんいち','見本市')
        self.yes('にゅーしゃび','入社日')
        self.no('にゅーしゃひ','入社日')
        self.yes('よていどおり','予定通り')
        self.yes('よてーどーり','予定通り')
        self.no('よていとおり','予定通り')
        # Both 未払い readings exist. Written equality does not establish
        # that this recording used the handwritten voiced variant.
        self.no('みばらい','未払い')

    def test_complete_words_have_primary_reading_not_character_splits(self):
        for source,correct,incorrect in [
            ('過去形','かこけい','かこかたち'),('御中','おんちゅー','ごちゅー'),
            ('貯水池','ちょすいち','ちょすいいけ'),('番号札','ばんごーふだ','ばんごーさつ'),
            ('体内時計','たいないどけー','たいないとけー'),('支間','しかん','えだま'),
            ('接車','せっしゃ','せつくるま'),
            ('研修日','けんしゅーび','けんしゅーひ'),('納品日','のーひんび','のーひんひ'),
            ('到着日','とーちゃくび','とーちゃくひ'),
            ('利用日','りよーび','りよーひ'),('開始日','かいしび','かいしひ'),
            ('返却期限日','へんきゃくきげんび','へんきゃくきげんじつ'),
            ('初版本','しょはんぼん','しょはんぽん'),
            ('二段組','にだんぐみ','にだんくみ'),('二段組み','にだんぐみ','にだんくみ'),
        ]:
            with self.subTest(source=source):
                self.yes(correct,source)
                self.no(incorrect,source)
        self.no('おんちゅーげん','御中元')
        self.yes('ちょくせつしゃない','直接車内')
        self.no('ちょくせっしゃない','直接車内')
        self.yes('かわのせいそー','川の清掃')
        self.no('がわのせいそー','川の清掃')
        self.yes('おがわのせいそー','小川の清掃')
        self.no('おかわのせいそー','小川の清掃')
        self.yes('なにをしますか','何をしますか')
        self.yes('なにおしますか','何をしますか')
        self.no('なんをしますか','何をしますか')
        self.no('なにしますか','何をしますか')
        self.no('なにをしますか','何がしますか')

    def test_reviewed_noun_doori_preserves_other_grammatical_contexts(self):
        for original,kana in [('通常通り','つーじょーどおり'),('希望通り','きぼーどおり'),('順番通り','じゅんばんどおり'),('記載通り','きさいどおり'),('案内通り','あんないどおり')]:
            with self.subTest(original=original):
                self.yes(kana,original)
                self.no(kana.replace('どおり','とおり'),original)
        self.yes('おもったとおり','思った通り')
        self.no('おもったどおり','思った通り')
        self.yes('きぼうのとおり','希望の通り')
        self.no('きぼうどおり','希望の通り')
        self.no('じゅんばんどおりになっていません','順番通りになっています')
        self.yes('これまでどおり','これまで通り')
        self.no('これまでとおり','これまで通り')
        self.no('これまでどおり','これから通り')
        self.no('みほんし','見本市')

    def test_metre_symbol_uses_source_unit_and_preserves_adjacent_price(self):
        self.yes('きゅーじゅーめーとる','90m','90メートル')
        self.yes('いちめーとるろくどる','1m6ドル','1メートル $6')
        self.no('いちめーとるろくどる','1m16ドル','1メートル $6')
        self.no('きゅーじゅーめーとる','90mm','90メートル')
        self.no('きゅーじゅーめーとる','90m','900メートル')
        self.no('きゅーじゅーめーとる','90m','90グラム')
        self.no('きゅーじゅーめーとる','90m','1.90メートル')
        self.no('きゅーじゅーめーとる','90m.3','90メートル')

    def test_reviewed_two_days_later_is_a_complete_numeric_expression(self):
        self.yes('ふつかご','2日後')
        self.yes('ふつかごにわたします','二日後に渡します')
        self.no('ふつかあと','2日後')
        self.no('ふつかご','12日後')
        self.no('ふつかご','3日後')
        self.no('ふつかご','2日')
        self.no('ふつかご','2日後.3')

    def test_latin_exact_source_anchor_is_required(self):
        self.yes('まーら','Mara','Mara will reply.')
        self.no('まーら','Mara','Nina will reply.')
        self.no('まーら','Nina','Mara will reply.')
        self.no('だれか','UnreviewedName','UnreviewedName will reply.')
        self.yes('りー','Lee','Lee will reply.')
        self.no('り','Lee','Lee will reply.')

    def test_latin_does_not_consume_a_missing_particle(self):
        self.yes('まーらわ きます','Maraは来ます','Maraは来ます')
        self.no('まーらわ きます','Mara来ます','Maraは来ます')
        self.no('まーらが きます','Maraは来ます','Maraは来ます')
        self.no('まーらに きます','Mara来ます','Maraは来ます')

    def test_source_initial_and_surname_allow_only_missing_typographic_space(self):
        self.yes('えむ でいびす','M.DAVIS','[4] M. Davis')
        self.yes('えむ でーびす','M.DAVIS','[4] M. Davis')
        self.no('えむ でいびす','N.DAVIS','M. Davis')
        self.no('えむ でいびす','M.LANE','M. Davis')
        self.no('えむ でいびす','M.DAVIS','N. Davis')
        self.no('えむ でいびす','M.DAVIS','MDavis')
        self.no('えむ でいびす','M.DAVIS','M. Davis-Smith; Davis')
        self.no('えむ でいびす','M.DAVIS','M. Davis.Smith; Davis')
        self.no('えむ でいびす','M.DAVIS',"M. Davis'Smith; Davis")
        self.no('えむ でいびす','M.DAVIS','X-M. Davis; M')
        self.no('えむ でいびす','M.DAVIS.3','M. Davis')
        self.no('えむ でいびす','M.Unknown','M. Unknown')
        self.no('でいびす','M.DAVIS','M. Davis')
        self.no('えむ でいびす','4 M.DAVIS','[4] M. Davis')

    def test_reviewed_line_spelling_requires_the_source_loanword(self):
        self.yes('らいんのていし','LINEの停止','ラインの停止')
        self.no('らいのていし','LINEの停止','ラインの停止')
        self.no('らいんのていし','LINE停止','ラインの停止')
        self.no('らいん','LINE','オンライン')
        self.no('らいん','LINE','ｵﾝライン')
        self.no('らいん','LINE','ラインｽﾞ')
        self.no('らいん','LINE','レーン')
        self.no('らいん','LIEN','ライン')

    def test_source_explicit_be_can_be_transcribed_as_its_letter_homophone(self):
        self.yes('びーどーし','b動詞','be 動詞')
        self.yes('いずたんすーげんざいけいのびーどーし','is 単数現在形の b 動詞','Is（単数・現在形の be 動詞）')
        self.no('びーどーし','b動詞','have 動詞')
        self.no('びーどーし','d動詞','be 動詞')
        self.no('びどーし','b動詞','be 動詞')
        self.no('びーどーし','been動詞','be 動詞')

    def test_finite_latin_long_vowel_and_acronym_spellings(self):
        self.yes('れいん','Lane','Lane')
        self.yes('れーん','Lane','Lane')
        self.yes('でぃーいーぴーてぃー','dept.','dept.')
        self.no('でぱーとめんと','dept.','dept.')
        self.no('でぃーいーぴー','dept.','dept.')
        self.yes('えー','A','desk A')
        self.no('えー','B','desk A')
        self.no('てきとー','DEPT2','DEPT2')

    def test_source_calendar_does_not_reinterpret_names_or_change_dates(self):
        self.yes('ろくがつよーか','June 8','June 8')
        self.yes('しちがつついたち','July 1','July 1')
        self.yes('さんがつさんじゅーいちにち','March 31','March 31')
        self.no('ろくがつよーか','June 9','June 8')
        self.no('ろくがつよーか','July 8','June 8')
        self.no('ろくがつよーか','June 8','June works in room 8')

    def test_unsupported_unknowns_never_match_empty(self):
        self.no('なぞ','龘')
        self.no('あ','😀')
        self.no('あ','...')
        self.no('あ','')
        self.no('ー','ー')

    def test_shape_and_provenance_are_auditable(self):
        r=self.yes('せーきゅー','請求')
        self.assertEqual(r['ruleVersion'],'strict-audio-equivalence-1')
        self.assertEqual(r['language'],'ja')
        self.assertNotIn('audioSha256',r)
        self.assertEqual(r['recognized'],'請求')
        self.assertEqual(r['provenance']['sourceTextSha256'],hashlib.sha256('請求'.encode()).hexdigest())
        self.assertEqual(r['provenance']['ruleFileSha256'],hashlib.sha256((ROOT/'scripts/compare-manual-kana.py').read_bytes()).hexdigest())
        self.assertEqual(r['readingTrace']['recognized'][0]['surface'],'請求')
        self.assertEqual(subject._morae(r['readingTrace']['recognized'][0]['selected']),subject._morae('せーきゅー'))
        self.assertEqual(r['normalizedExpected'],'せーきゅー')


if __name__=='__main__':unittest.main()
