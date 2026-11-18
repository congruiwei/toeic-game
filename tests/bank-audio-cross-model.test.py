"""Pure synthetic evidence fixtures. Does not import/load any ASR or TTS model."""
import copy,importlib.util,json,unittest
from pathlib import Path
ROOT=Path.cwd();HERE=Path(__file__).resolve().parent

def load(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
m=load('cross',HERE.parent/'scripts/audio-cross-model.py');cmp=load('cmp',ROOT/'scripts/audio-compare.py');ev=load('ev',ROOT/'scripts/audio-evidence.py')
def normalize(s,language):return s

def fixture(text='The staff signed the report.',old='The staff sign the report.',heard=None):
 u={'language':'en','bank':'grammar','key':'g/sentence/0','text':text,'voiceId':'af_heart','required':True};c={**u,'src':'./audio/generated/en/af_heart/'+'a'*32+'.m4a','sha256':'a'*64,'bytes':10,'duration':2,'spoken':text,'inputSha256':'b'*64,'phonemeSha256':'c'*64,'asrStatus':'review'}
 tg={'model':m.TURBO,'modelSha256':m.TURBO_SHA,'device':'cpu','computeType':'int8','beamSize':5,'prompt':None,'conditionOnPreviousText':False,'vadFilter':False,'packages':{}}
 fg={**tg,'model':m.MODEL,'modelSha256':m.MODEL_SHA,'modelRepository':m.REPOSITORY,'modelRevision':m.REVISION,'temperature':0,'wordTimestamps':False,'hotwords':None,'task':'transcribe','audioInput':'unchanged-delivered-m4a'}
 def raw(recognized,g):return {'sha256':c['sha256'],'recognized':recognized,'generation':g,'segments':[{'text':recognized,'start':0,'end':2}],'recognitionAttempts':1}
 original=m.compare_record(u,c,raw(old,tg),cmp,normalize);full=m.compare_record(u,c,raw(heard or text,fg),cmp,normalize)
 row={'repair':{'complete':True,'disposition':'recorded-review','candidate':{'clip':copy.deepcopy(c),'asr':copy.deepcopy(original)},'appliedOverride':{}}}
 return u,c,original,row,full
class Cross(unittest.TestCase):
 def test_acceptance_preserves_turbo_transcript_and_repair(self):
  u,c,o,row,full=fixture();before=copy.deepcopy(row)
  p=m.assess(u,c,o,row,full,cmp,normalize,ev);self.assertEqual(p['status'],'accepted');row['crossModelChecks']=[p]
  a=m.accepted_record(p);self.assertEqual(a['recognized'],o['recognized']);self.assertEqual(a['comparison'],o['comparison']);self.assertEqual(a['recognitionGeneration'],o['recognitionGeneration']);self.assertEqual(row['repair'],before['repair'])
  self.assertTrue(m.valid_record(u,c,a,row,cmp,normalize,ev))
 def test_full_model_still_missing_ed_retains_review(self):
  u,c,o,row,f=fixture(heard='The staff sign the report.');p=m.assess(u,c,o,row,f,cmp,normalize,ev)
  self.assertEqual(p['status'],'review')
  with self.assertRaises(ValueError):m.accepted_record(p)
 def test_tense_and_polarity_conflicts_are_not_equivalence(self):
  for text,heard in [('The worker has fallen.','The worker is falling.'),('I liked the plan.','I like the plan.'),("We are not ready.",'We are ready.')]:
   with self.subTest(text=text):
    u,c,o,row,f=fixture(text,heard,heard);self.assertEqual(m.assess(u,c,o,row,f,cmp,normalize,ev)['status'],'review')
 def test_prompt_or_wrong_model_rejected(self):
  for key,value in [('prompt','expected text'),('hotwords','signed'),('model',m.TURBO),('modelSha256','d'*64),('modelRevision','0'*40)]:
   with self.subTest(key=key):
    u,c,o,row,f=fixture();f['recognitionGeneration'][key]=value;f['fingerprint']=m.fingerprint(f['recognitionGeneration'],c)
    with self.assertRaises(ValueError):m.assess(u,c,o,row,f,cmp,normalize,ev)
 def test_final_media_and_candidate_snapshot_must_match(self):
  u,c,o,row,f=fixture();c['sha256']='e'*64
  with self.assertRaises(ValueError):m.assess(u,c,o,row,f,cmp,normalize,ev)
  u,c,o,row,f=fixture();row['repair']['candidate']['asr']['recognized']='rewritten original'
  with self.assertRaises(ValueError):m.assess(u,c,o,row,f,cmp,normalize,ev)
 def test_wrong_full_fingerprint_rejected(self):
  u,c,o,row,f=fixture();f['fingerprint']='d'*64
  with self.assertRaises(ValueError):m.assess(u,c,o,row,f,cmp,normalize,ev)
 def test_single_heads_do_not_delete_articles(self):
  u,c,o,row,f=fixture('available','unavailable','the available');p=m.assess(u,c,o,row,f,cmp,normalize,ev)
  self.assertFalse(p['articlePolicyEnabled']);self.assertEqual(p['status'],'review')
 def test_missing_duplicate_proof_and_changed_raw_turbo_rejected(self):
  u,c,o,row,f=fixture();p=m.assess(u,c,o,row,f,cmp,normalize,ev);a=m.accepted_record(p)
  self.assertFalse(m.valid_record(u,c,a,row,cmp,normalize,ev));row['crossModelChecks']=[p,p];self.assertFalse(m.valid_record(u,c,a,row,cmp,normalize,ev))
  row['crossModelChecks']=[p];a['recognized']=f['recognized'];self.assertFalse(m.valid_record(u,c,a,row,cmp,normalize,ev))
 def test_unreproducible_or_empty_comparison_rejected(self):
  u,c,o,row,f=fixture();f['comparison']['proofRecognized']='another proof'
  with self.assertRaises(ValueError):m.assess(u,c,o,row,f,cmp,normalize,ev)
 def test_empty_or_rewritten_segments_rejected(self):
  for segments in [[],[{'text':'other text','start':0,'end':1}],[{'text':'The staff signed the report.','start':float('nan'),'end':2}]]:
   u,c,o,row,f=fixture();f['segments']=segments
   with self.assertRaises(ValueError):m.assess(u,c,o,row,f,cmp,normalize,ev)
if __name__=='__main__':unittest.main(verbosity=2)
