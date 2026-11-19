import importlib.util,pathlib,unittest,json,hashlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
def load(name,file):
 s=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
human=load('human','audio-human-review.py');repair=load('repair','repair-strong-bank-audio.py');voice=load('voice','audio-voice-override.py')
class HumanReview(unittest.TestCase):
 def setUp(self):
  self.u={'language':'en','bank':'labels','key':'labels/am_puck/B','voiceId':'am_puck','text':'B.'};self.c={'sha256':'a'*64};self.d={'version':1,'batches':[{'id':'b','source':'User verdicts','queueSha256':'c'*64,'count':1}],'feedback':[{'token':'en:labels:labels/am_puck/B','sha256':'a'*64,'text':'B.','label':'ok','batchId':'b'}],'requests':[]}
 def test_sha_and_verdict(self):
  self.assertEqual(human.validate_human_review(self.d),[]);self.assertEqual(human.human_review_state(self.d,self.u,self.c)['status'],'approved');self.assertEqual(human.human_review_state(self.d,self.u,{'sha256':'b'*64})['status'],'required')
  for label in ['problem','unsure']:
   self.d['feedback'][0]['label']=label;self.assertEqual(human.human_review_state(self.d,self.u,self.c)['status'],'required')
 def test_exact_voice_exception(self):
  self.assertEqual(voice.selected_voice(self.u,{'voiceId':'af_heart','phonemes':'bˈi.'}),'af_heart')
  for change in [{'key':'labels/am_puck/C'},{'text':'D.'},{'speaker':'A'},{'voiceId':'af_bella'}]:self.assertFalse(voice.eligible({**self.u,**change}))
 def test_integral_float_archive_roundtrip(self):
  old={'clip':{'duration':1.0},'segments':[{'start':0.0,'end':2.0}]};payload=json.dumps(old,sort_keys=True,ensure_ascii=False,separators=(',',':'));digest=hashlib.sha256(payload.encode()).hexdigest();row={'repairSnapshotPayloads':{digest:payload}};after={'clip':{'duration':1},'segments':[{'start':0,'end':2}]}
  self.assertTrue(repair.snapshot_matches(row,after,digest));self.assertFalse(repair.snapshot_matches({},after,digest));after['segments'][0]['end']=3;self.assertFalse(repair.snapshot_matches(row,after,digest))
 def test_payload_tampering_and_boolean_are_not_numeric_rewrites(self):
  old={'value':1.0};payload=json.dumps(old,sort_keys=True,separators=(',',':'));digest=hashlib.sha256(payload.encode()).hexdigest()
  self.assertFalse(repair.snapshot_matches({'repairSnapshotPayloads':{digest:payload+' '}},{'value':1},digest));self.assertFalse(repair.snapshot_matches({'repairSnapshotPayloads':{digest:payload}},{'value':True},digest))
 def test_archive_metadata_does_not_erase_actual_version_binding(self):
  v={'clip':{'sha256':'a'*64,'bytes':42},'asr':{'recognized':'actual'}};arch={**v,'archive':{'published':False,'sha256':'a'*64,'bytes':42,'copyVerified':True}}
  self.assertTrue(repair.same_archived_versions(arch,v));self.assertTrue(repair.same_archived_versions([arch],[v]));self.assertFalse(repair.same_archived_versions({**arch,'archive':{**arch['archive'],'sha256':'b'*64}},v));self.assertFalse(repair.same_archived_versions({**arch,'asr':{'recognized':'fake'}},v))
if __name__=='__main__':unittest.main()
