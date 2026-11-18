import importlib.util
from pathlib import Path
import sys
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
spec=importlib.util.spec_from_file_location('audio_plan',ROOT/'scripts/build-audio-repair-plan.py')
plan=importlib.util.module_from_spec(spec);spec.loader.exec_module(plan)

class TerminalWordTests(unittest.TestCase):
 def unit(self,**changes):
  return dict(language='en',bank='vocab',key='v-owner/meaning',text='owner',required=True,**changes)
 def test_adds_only_period_and_preserves_exact_phones(self):
  current='ˈOnɚ'
  self.assertEqual(plan.terminal_word_phonemes(self.unit(),current),current+'.')
  self.assertEqual(plan.terminal_word_phonemes(self.unit(),current+'  '),current+'.')
 def test_does_not_replace_reviewed_explicit_phones(self):
  self.assertIsNone(plan.terminal_word_phonemes(self.unit(),'ˈOnɚ',{'phonemes':'ˈOnɚ'}))
 def test_terminal_punctuation_is_retained(self):
  for suffix in ['.','!','?',';',':','…']:
   with self.subTest(suffix=suffix):self.assertIsNone(plan.terminal_word_phonemes(self.unit(),'ˈOnɚ'+suffix))
 def test_first_word_and_labels_are_narrow(self):
  u={'language':'en','bank':'part2','key':'p2-first/options/0/0','group':'p2-first','text':'Where','required':True}
  self.assertEqual(plan.terminal_word_phonemes(u,'wɛɹ',first_ids={'p2-first'}),'wɛɹ.')
  self.assertIsNone(plan.terminal_word_phonemes(u,'wɛɹ',first_ids=set()))
  label={'language':'en','bank':'labels','key':'labels/af_heart/A','text':'A.','required':True}
  self.assertEqual(plan.terminal_word_phonemes(label,'ˈA'),'ˈA.')
  self.assertIsNone(plan.terminal_word_phonemes({**label,'text':'AB'},'ˈA'))
 def test_sentences_nonhead_other_language_and_markers_excluded(self):
  for changes in [{'text':'The owner'},{'key':'v-owner/example/0'},{'language':'ja'}, {'required':False},{'nonSpoken':True}]:
   with self.subTest(changes=changes):self.assertIsNone(plan.terminal_word_phonemes({**self.unit(),**changes},'ˈOnɚ'))

if __name__=='__main__':unittest.main()
