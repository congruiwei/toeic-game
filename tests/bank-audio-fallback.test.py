"""Isolated fallback coverage/sync tests; model construction and inference are mocked."""
import copy,importlib.util,json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch,MagicMock
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('fallback_bank',ROOT/'scripts/generate-bank-audio.py');bank=importlib.util.module_from_spec(spec);spec.loader.exec_module(bank)
class FallbackTest(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name);self.root=self.base/'repo';self.out=self.root/'data/audio';self.work=self.base/'work';self.key='read-test/documents/0/text/0';self.token='ja:reading:'+self.key
  self.unit={'language':'ja','bank':'reading','key':self.key,'text':'領収書です。','voiceId':'jf_alpha','required':True,'kind':'sentence'}
  self.source={'version':1,'model':'kokoro','voices':{'ja':['jf_alpha']},'units':[self.unit]}
  self.generation={'model':bank.STRONG_FALLBACK_MODEL,'modelSha256':bank.STRONG_FALLBACK_SHA256,'device':'cpu','computeType':'int8','beamSize':5,'conditionOnPreviousText':False,'prompt':None,'vadFilter':False}
  def version(char):
   c={**self.unit,'spoken':self.unit['text'],'sha256':char*64,'inputSha256':'e'*64,'src':'./audio/generated/ja/jf_alpha/'+char*32+'.m4a','bytes':100,'duration':1.,'decodedPeak':.5,'asrStatus':'review'}
   a={'sha256':c['sha256'],'expected':c['text'],'spoken':c['spoken'],'recognized':'別の認識です。','status':'review','recognitionMethod':'individual-beam5','singleFileVerification':True,'recognitionGeneration':self.generation}
   return {'clip':c,'asr':a,'archive':{'published':False,'copyVerified':True,'sha256':c['sha256'],'bytes':c['bytes']}}
  self.original,self.candidate=version('a'),version('b');self.record=copy.deepcopy(self.candidate['asr'])
  self.fallback={'playback':'system','language':'ja','text':self.unit['text'],'voiceId':'jf_alpha','reason':'unresolved-after-strong-asr-retry','auditedSha256':'b'*64}
  self.row={'token':self.token,'repair':{'method':'reviewed-pace-change','original':self.original,'candidate':self.candidate,'disposition':'system-fallback','complete':True,'baseOverride':{},'appliedOverride':{'speed':.9}}}
  self.pack={'version':1,'bank':'reading','language':'ja','clips':{},'fallbacks':{self.key:self.fallback}}
 def tearDown(self):self.tmp.cleanup()
 def install(self):
  bank.atomic(self.out/'source.json',self.source);bank.atomic(self.out/'ja/reading.json',self.pack)
  bank.atomic(self.out/'quality-review.json',{'version':1,'records':{self.token:self.row}})
  bank.atomic(self.out/'audit/ja/reading.json',{'records':{self.key:self.record}})
 def flush(self):
  self.install()
  with patch.multiple(bank,ROOT=self.root,OUT=self.out):bank.flush(self.source,'c'*64,{}, {('ja','reading'):copy.deepcopy(self.pack)})
  return bank.read(self.out/'manifest.json',{}),bank.read(self.out/'ja/reading.json',{})
 def test_fallback_counts_playback_but_never_recorded_or_audited(self):
  m,p=self.flush();self.assertEqual(m['totals']['count'],0);self.assertEqual(m['totals']['requiredCount'],0);self.assertEqual(m['totals']['requiredAudited'],0)
  self.assertEqual(m['totals']['systemFallbackCount'],1);self.assertEqual(m['totals']['requiredFallbackCount'],1)
  self.assertTrue(m['requiredPlaybackComplete']);self.assertTrue(m['recordedAuditComplete']);self.assertFalse(m['requiredComplete']);self.assertFalse(m['requiredAuditComplete'])
  self.assertEqual(p['fallbacks'],self.pack['fallbacks']);self.assertEqual(p['fallbackCount'],1);self.assertEqual(m['packs'][0]['requiredFallbackCount'],1)
  self.assertEqual(bank.read(self.out/'audit/ja/reading.json',{})['records'][self.key],self.record)
 def test_invalid_repair_or_actual_evidence_cannot_be_coverage(self):
  cases=[lambda f,r,a:r['repair'].update(complete=False),lambda f,r,a:r['repair']['candidate']['clip'].update(sha256='a'*64),lambda f,r,a:r['repair']['candidate']['asr'].update(recognized=''),lambda f,r,a:a.update(sha256='c'*64),lambda f,r,a:f.update(language='en'),lambda f,r,a:r['repair']['candidate']['asr']['recognitionGeneration'].update(model='whisper-medium'),lambda f,r,a:r['repair']['candidate']['asr']['recognitionGeneration'].update(modelSha256='f'*64)]
  for mutate in cases:
   f,r,a=copy.deepcopy((self.fallback,self.row,self.record));mutate(f,r,a);self.assertFalse(bank.valid_system_fallback(self.unit,f,r,a))
 def test_invalid_declaration_stops_sync_instead_of_regenerating(self):
  self.fallback['auditedSha256']='f'*64
  with self.assertRaisesRegex(ValueError,'Invalid system fallback'):self.flush()
 def prepare_main(self):
  self.install();models=self.work/'models';models.mkdir(parents=True);(models/'kokoro-v1.0.onnx').write_bytes(b'not a model');(models/'voices-v1.0.bin').write_bytes(b'not voices')
 def run_main(self,sync):
  argv=['generate-bank-audio.py','--workdir',str(self.work),'--force']+(['--sync-only'] if sync else [])
  fake=MagicMock();fake.create.side_effect=AssertionError('fallback must not synthesize')
  with patch.multiple(bank,ROOT=self.root,OUT=self.out),patch.object(sys,'argv',argv),patch.object(bank.importlib.metadata,'version',return_value='fixture'),patch.object(bank.ort,'InferenceSession',return_value=object()) as session,patch.object(bank.Kokoro,'from_session',return_value=fake):bank.main()
  fake.create.assert_not_called()
  if sync:session.assert_not_called()
  return bank.read(self.out/'ja/reading.json',{})
 def test_sync_only_preserves_declaration_and_candidate_audit(self):
  self.prepare_main();p=self.run_main(True);self.assertEqual(p['fallbacks'],self.pack['fallbacks']);self.assertEqual(p['clips'],{})
 def test_default_and_force_do_not_automatically_resynthesize_fallback(self):
  self.prepare_main();p=self.run_main(False);self.assertEqual(p['fallbacks'],self.pack['fallbacks']);self.assertEqual(p['clips'],{})
if __name__=='__main__':unittest.main()
