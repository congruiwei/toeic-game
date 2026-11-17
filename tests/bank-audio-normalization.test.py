import importlib.util
import json
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('bank',ROOT/'scripts/generate-bank-audio.py')
bank=importlib.util.module_from_spec(spec);spec.loader.exec_module(bank)

class NormalizationTest(unittest.TestCase):
    def test_japanese_clock_range_and_duration_have_different_readings(self):
        self.assertEqual(bank.normalize('09:00–09:30','ja'),'くじからくじさんじゅっぷん')
        self.assertEqual(bank.normalize('09:05','ja'),'くじごふん')
        self.assertEqual(bank.normalize('10:10','ja'),'じゅうじじゅっぷん')
        self.assertEqual(bank.normalize('9時間','ja'),'きゅうじかん')
        self.assertEqual(bank.normalize('4時','ja'),'よじ')
    def test_minutes_do_not_turn_into_sufficient_or_fraction(self):
        self.assertEqual(bank.normalize('10分あります。','ja'),'じゅっぷんあります。')
        self.assertEqual(bank.normalize('十分あります。','ja'),'十分あります。')
        self.assertEqual(bank.normalize('5分の1','ja'),'ごぶんのいち')
        self.assertEqual(bank.normalize('2分の休憩','ja'),'にふんの休憩')
    def test_months_and_calendar_days(self):
        self.assertEqual(bank.normalize('4月と7月と9月','ja'),'しがつとしちがつとくがつ')
        self.assertEqual(bank.normalize('毎月1日に1回','ja'),'毎月ついたちにいっかい')
        self.assertEqual(bank.normalize('14日以内','ja'),'じゅうよっか以内')
        self.assertEqual(bank.normalize('1日分','ja'),'いちにち分')
    def test_unaffected_number_contexts_keep_dictionary_reading(self):
        for source,expected in [('1箱','一箱'),('4年','四年'),('1冊','一冊'),('4か月','四か月')]:
            self.assertEqual(bank.normalize(source,'ja'),expected)
    def test_counters_are_contextual(self):
        cases={'1本':'いっぽん','2本':'にほん','3本':'さんぼん','6本':'ろっぽん','8本':'はっぽん','80本':'はちじゅっぽん','160本':'ひゃくろくじゅっぽん','1分':'いっぷん','2分':'にふん','1足':'いっそく','1個':'いっこ','1枚':'いちまい','3階':'さんがい','2人':'ふたり'}
        for source,expected in cases.items():
            with self.subTest(source=source):self.assertEqual(bank.normalize(source,'ja'),expected)
        self.assertEqual(bank.normalize('数本の傘','ja'),'すうほんの傘')
    def test_japanese_codes_and_measurement(self):
        self.assertEqual(bank.normalize('C4 | 再使用可能な表紙用紙','ja'),'シー よん 、 再使用可能な表紙用紙')
        self.assertEqual(bank.normalize('C 乗り場','ja'),'シー 乗り場')
        self.assertEqual(bank.normalize('2 mm','ja'),'に ミリメートル')
    def test_english_code_letter_boundaries_and_units(self):
        for code,expected in [('A4','A. four'),('L1','L. one'),('H1','H. one'),('C1','C. one')]:
            self.assertEqual(bank.normalize(code,'en'),expected)
        self.assertEqual(bank.normalize('2 mm','en'),'two millimeters')
        self.assertEqual(bank.normalize('2mm','en'),'two millimeters')
        self.assertEqual(bank.normalize('09:00–09:30','en'),'nine o clock to nine thirty')
    def test_reviewed_video_timestamp_and_compound_price_overrides(self):
        entries=json.loads((ROOT/'data/audio/overrides.json').read_text())['entries']
        self.assertIn('にふんじゅうびょう',entries['ja:reading:read-captions/documents/1/text/2']['spoken'])
        self.assertIn('two minutes ten seconds',entries['en:reading:read-captions/documents/1/text/2']['spoken'])
        self.assertEqual(entries['en:reading:read-seats/documents/0/text/0']['spoken'],'Pay a sixty-dollar deposit per booking.')
        self.assertIn('one dollar sixty cents',entries['en:reading:read-banding/documents/0/text/2']['spoken'])
        self.assertIn('いちドルろくじゅうセント',entries['ja:reading:read-banding/documents/0/text/2']['spoken'])
    def test_money_is_cardinal_not_counter_contraction(self):
        self.assertEqual(bank.normalize('$30','ja'),'さんじゅうドル')
        self.assertEqual(bank.normalize('$60','ja'),'ろくじゅうドル')
        self.assertEqual(bank.normalize('1回$35','ja'),'いっかいさんじゅうごドル')
        self.assertEqual(bank.normalize('$35 at 8:15','en'),'thirty-five dollars at eight fifteen')
    def test_visual_markers_not_letter_labels(self):
        self.assertEqual(bank.normalize('A','en'),'A.')
        self.assertEqual(bank.normalize('R','en'),'R.')
        self.assertEqual(bank.normalize('[2]','en'),'')
        self.assertEqual(bank.normalize('[2]','ja'),'')
    def test_actual_g2p_letter_and_counter(self):
        engines={}
        a=bank.phonemize(bank.normalize('A4','en'),'en',engines)
        self.assertTrue(a.startswith('ˈA '),a)
        j=bank.phonemize(bank.normalize('2本','ja'),'ja',engines)
        self.assertIn('ho',j);self.assertNotIn('po',j)
        clock=bank.phonemize(bank.normalize('09:05','ja'),'ja',engines)
        self.assertIn('kɯ',clock);self.assertNotIn('kʲɨː',clock)
        fraction=bank.phonemize(bank.normalize('業界売上の10分の1から5分の1になり','ja'),'ja',engines)
        self.assertIn('ʥɨːbɯɴ',fraction,fraction)
    def test_review_does_not_replace_valid_japanese_readings(self):
        engines={}
        for word,expected in [('施錠','seʥoː'),('手製','teseː'),('係官','kakaɾʲikaɴ')]:
            with self.subTest(word=word):
                self.assertEqual(bank.normalize(word,'ja'),word)
                self.assertEqual(bank.phonemize(word,'ja',engines),expected)
        sentence='係官は7人ですが、施錠はしません。'
        normalized=bank.normalize(sentence,'ja')
        self.assertIn('ななにん',normalized)
        self.assertIn('施錠はしません',normalized)

if __name__=='__main__':unittest.main()
