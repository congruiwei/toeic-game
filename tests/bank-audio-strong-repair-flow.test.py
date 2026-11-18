"""Isolated restart/publication tests; synthetic evidence, no inference or media claims."""
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
REPO=Path(os.environ.get('TOEIC_TEST_REPO',Path.cwd()))
spec=importlib.util.spec_from_file_location('repair_flow',Path(os.environ.get('TOEIC_REPAIR_SCRIPT',REPO/'scripts/repair-strong-bank-audio.py')))
repair=importlib.util.module_from_spec(spec);spec.loader.exec_module(repair)
sha=lambda x:hashlib.sha256(x).hexdigest()

class FlowTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();parent=Path(self.temp.name);self.root=parent/'repo';self.work=parent/'work';self.work.mkdir();self.out=self.root/'data/audio';self.out.mkdir(parents=True)
  (self.root/'scripts').mkdir()
  for name in ['retry-bank-audio.py','correct-bank-audio.py','generate-bank-audio.py','generate-audition.py','audio-evidence.py','audio-voice-override.py']:
   src=REPO/'scripts'/name
   if name=='generate-bank-audio.py':src=Path(os.environ.get('TOEIC_GENERATOR_SCRIPT',src))
   shutil.copyfile(src,self.root/'scripts'/name)
  self.bank=repair.load_module('fixture_generation',self.root/'scripts/generate-bank-audio.py')
  self.unit={'text':'領収書を確認しました。','language':'ja','voiceId':'jf_alpha','bank':'reading','key':'read-fixture/documents/0/text/0','required':True}
  self.token='ja:reading:'+self.unit['key'];self.key=self.unit['key']
  self.gen={'recipe':'fixture','modelSha256':'1'*64,'voicesSha256':'2'*64,'packages':{},'encoding':{}}
  self.base={'speed':1.0};self.changed={'speed':.9,'reason':'Strong-ASR clarity retry: Pace retry'}
  self.identity={'model':repair.STRONG_MODEL,'modelSha256':repair.STRONG_SHA,'device':'cpu','computeType':'int8','beamSize':5,'conditionOnPreviousText':False,'prompt':None,'vadFilter':False}
  def version(value,override):
   payload=('fixture bytes only '+value).encode();digest=sha(payload)
   src='./audio/generated/ja/jf_alpha/'+digest[:32]+'.m4a';target=self.root/src;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(payload)
   spoken,input_sha=self.bank.input_fingerprint(self.gen,self.unit,override)
   clip={**self.unit,'src':src,'sha256':digest,'bytes':len(payload),'duration':1.2,'decodedPeak':.5,'spoken':spoken,'inputSha256':input_sha,'asrStatus':'review','synthesisSpeed':override['speed']}
   a={'expected':clip['text'],'spoken':spoken,'sha256':digest,'recognized':'領収書を変更しました。','status':'review','recognitionMethod':'individual-beam5','singleFileVerification':True,'recognitionGeneration':self.identity}
   a['comparison']={'ruleVersion':'strict-audio-equivalence-1','audioSha256':digest,'expectedSpoken':spoken,'recognized':a['recognized'],'language':'ja','equivalent':False,'reasons':['fixture-difference'],
    'provenance':{'sourceTextSha256':sha(clip['text'].encode()),'ruleFileSha256':'3'*64,'normalizerFileSha256':'4'*64}}
   return {'clip':clip,'asr':a}
  self.first=version('first',{'speed':1.1});self.original=version('original',self.base);self.candidate=version('candidate',self.changed)
  self.proposal={'token':self.token,'sourceText':self.unit['text'],'beforeSha256':self.original['clip']['sha256'],'method':'Pace retry','override':{'speed':.9}}
  self.pending={'proposal':self.proposal,'method':'Pace retry','original':self.original,'baseOverride':self.base,'appliedOverride':self.changed,'complete':False,'phase':'planned'}
  self.quality={'version':1,'records':{self.token:{'token':self.token,'language':'ja','bank':'reading','key':self.key,'repair':self.pending}},'stages':{'strongerASR':{'complete':True}}}
  self.old_retry={'token':self.token,'language':'ja','bank':'reading','key':self.key,'kind':'legacy','initial':self.first,'retry':self.original,'complete':True,'selectedSha256':self.original['clip']['sha256'],'synthesisAttemptCount':2,'asrAttemptCount':2}
  self.report={'version':1,'records':{self.token:self.old_retry}}
  self.source={'model':'fixture','voices':{},'units':[self.unit]};self.write('source.json',self.source)
  self.source_sha=sha((self.out/'source.json').read_bytes())
  self.pack={'version':1,'language':'ja','bank':'reading','clips':{self.key:self.candidate['clip']}}
  for name,value in [('quality-review.json',self.quality),('overrides.json',{'version':1,'entries':{self.token:self.changed}}),('normalization-review.json',{'version':1}),('retries.json',self.report),('ja/reading.json',self.pack),('audit/ja/reading.json',{'records':{self.key:self.candidate['asr']}}),('manifest.json',{'generation':self.gen})]:self.write(name,value)
  self.plan=parent/'plan.json';self.plan.write_text(json.dumps({'sourceSha256':self.source_sha,'entries':[self.proposal]}))
 def tearDown(self):self.temp.cleanup()
 def write(self,name,value):
  path=self.out/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
 def read(self,name):return json.loads((self.out/name).read_text())
 def run_repair(self):
  with patch.object(sys,'argv',['repair','--repo',str(self.root),'--workdir',str(self.work),'--plan',str(self.plan),'--apply','--finish-only']),contextlib.redirect_stdout(io.StringIO()):repair.main()
 def assert_fallback(self):
  pack=self.read('ja/reading.json');self.assertEqual(pack['clips'],{});self.assertEqual(pack['fallbacks'][self.key]['auditedSha256'],self.candidate['clip']['sha256'])
  m=self.read('manifest.json');self.assertTrue(m['requiredPlaybackComplete']);self.assertFalse(m['requiredAuditComplete']);self.assertEqual(m['totals']['requiredCount'],0)
 def test_finishes_actual_candidate_and_reuses_without_duplicate_history(self):
  self.run_repair();self.assert_fallback();first=self.read('retries.json');self.run_repair();self.assert_fallback();self.assertEqual(self.read('retries.json'),first)
  self.assertEqual(len(first['archivedCases']),1);self.assertEqual(first['records'][self.token]['predecessor']['selectedSha256'],self.original['clip']['sha256'])
 def test_synchronizes_pending_generator_status_before_fallback_snapshot(self):
  self.pack['clips'][self.key]['asrStatus']='pending';self.write('ja/reading.json',self.pack)
  self.run_repair();self.assert_fallback()
  candidate=self.read('quality-review.json')['records'][self.token]['repair']['candidate']
  self.assertEqual(candidate['clip']['asrStatus'],'review');self.assertEqual(candidate['asr']['status'],'review')
 def test_recovers_after_retry_checkpoint_before_quality(self):
  self.run_repair();self.write('quality-review.json',self.quality);self.write('ja/reading.json',self.pack)
  self.run_repair();self.assert_fallback();self.assertEqual(len(self.read('retries.json')['archivedCases']),1)
 def test_recovers_after_quality_checkpoint_before_pack(self):
  self.run_repair();self.write('ja/reading.json',self.pack)
  self.run_repair();self.assert_fallback();self.assertEqual(len(self.read('retries.json')['archivedCases']),1)
 def test_bad_original_source_rejected_before_writes(self):
  self.quality['records'][self.token]['repair']['original']['clip']['voiceId']='af_heart';self.write('quality-review.json',self.quality)
  before=(self.out/'overrides.json').read_bytes()
  with self.assertRaisesRegex(ValueError,'source/casting'):self.run_repair()
  self.assertEqual((self.out/'overrides.json').read_bytes(),before)
 def test_broken_predecessor_rejected_before_writes(self):
  self.report['records'][self.token]['predecessor']={'archiveIndex':8,'token':self.token,'selectedSha256':'0'*64};self.write('retries.json',self.report)
  before=(self.out/'quality-review.json').read_bytes()
  with self.assertRaisesRegex(ValueError,'predecessor'):self.run_repair()
  self.assertEqual((self.out/'quality-review.json').read_bytes(),before)

if __name__=='__main__':unittest.main()
