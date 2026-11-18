"""Actual publication dispatcher; synthetic fixtures, no inference or writes.

LEXICAL_INTEGRATION_ROOT selects the private patched overlay before deployment.
After deployment the repository parent is the default.
"""
import copy, importlib.util, json, os, unittest
from pathlib import Path

ROOT=Path(os.environ.get('LEXICAL_INTEGRATION_ROOT',Path(__file__).resolve().parents[1]))
spec=importlib.util.spec_from_file_location('lexical_integration_bank',ROOT/'scripts/generate-bank-audio.py')
bank=importlib.util.module_from_spec(spec);spec.loader.exec_module(bank)
fixtures=json.loads((Path(__file__).parent/'fixtures/lexical-proof.json').read_text())['records']+[json.loads((Path(__file__).parent/'fixtures/lexical-full-name-proof.json').read_text())]

class PublicationTests(unittest.TestCase):
 def test_actual_dispatcher_accepts_only_complete_bound_proofs(self):
  for f in fixtures:
   with self.subTest(rule=f['ruleId']):
    rows={f['row']['token']:f['row']}
    self.assertTrue(bank.valid_published_asr(f['unit'],f['clip'],f['record'],rows,set()))
    self.assertFalse(bank.valid_published_asr(f['unit'],f['clip'],f['record'],{},set()))
    original=f['row']['repair']['candidate']['asr']
    self.assertTrue(bank.valid_published_asr(f['unit'],f['clip'],original,rows,set()))
    for admission in ['absent',None,{},dict(f['record']['acceptance'],proofId='0'*64),{'method':'unknown'}]:
     bad=copy.deepcopy(f['record'])
     if admission=='absent':bad.pop('acceptance')
     else:bad['acceptance']=admission
     self.assertFalse(bank.valid_published_asr(f['unit'],f['clip'],bad,rows,set()))

if __name__=='__main__':unittest.main()
