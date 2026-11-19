"""Isolated alternate-voice authoring regression; synthetic bytes, no models.

Real repair.main and generator fingerprint/publication helpers run against a
throw-away checkout. Only the generate/audit child callbacks are fake workers.
"""
import contextlib,copy,hashlib,importlib.util,io,json,os,re,shutil,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(os.environ.get('TOEIC_TEST_REPO',Path(__file__).resolve().parents[1]))
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
rules=load('test_voice_rules',ROOT/'scripts/audio-voice-override.py')
repair=load('test_voice_repair',ROOT/'scripts/repair-strong-bank-audio.py')
sha=lambda x:hashlib.sha256(x).hexdigest()
UNIT={'language':'en','bank':'vocab','key':'v-disburse/meaning','kind':'meaning','text':'disburse','voiceId':'af_heart','required':True}
PHONES='dɪsbˈɜɹs.'

class Eligibility(unittest.TestCase):
 def test_only_selected_voices_and_independent_english_heads(self):
  for voice in sorted(rules.VOICES):self.assertEqual(rules.selected_voice(UNIT,{'voiceId':voice,'phonemes':PHONES}),voice)
  invalid=[{**UNIT,'language':'ja'},{**UNIT,'bank':'listening','speaker':'A'},
   {**UNIT,'key':'v-disburse/example/0','kind':'sentence','text':'We disburse funds today.'},
   {**UNIT,'bank':'labels','kind':'label','text':'A.'},{**UNIT,'text':'market share'},
   {**UNIT,'kind':'sentence'},{**UNIT,'speaker':'A'},{**UNIT,'required':False},
   {**UNIT,'voiceId':'bf_emma'}]
  for unit in invalid:
   with self.subTest(unit=unit),self.assertRaises(ValueError):rules.selected_voice(unit,{'voiceId':'am_puck','phonemes':PHONES})
  for override in [{'voiceId':'af_nicole','phonemes':PHONES},{'voiceId':'am_puck'},{'voiceId':'am_puck','phonemes':' '}]:
   with self.subTest(override=override),self.assertRaises(ValueError):rules.selected_voice(UNIT,override)
 def test_default_source_and_actual_selected_voice_are_separate(self):
  clip={**UNIT,'voiceId':'am_puck','sourceVoiceId':'af_heart'};override={'voiceId':'am_puck','phonemes':PHONES}
  self.assertTrue(rules.matches_selection(UNIT,clip,override));self.assertEqual(rules.source_voice(clip),'af_heart')
  for change in [{'sourceVoiceId':'af_bella'},{'voiceId':'af_bella'},{'voiceId':'bf_emma'}]:
   with self.subTest(change=change):self.assertFalse(rules.matches_selection(UNIT,{**clip,**change},override))
  missing=dict(clip);missing.pop('sourceVoiceId');self.assertFalse(rules.matches_source(UNIT,missing))

class VoiceRepair(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='voice-repair-',dir='/private/tmp');self.addCleanup(self.temp.cleanup)
  self.root=Path(self.temp.name)/'repo';self.work=Path(self.temp.name)/'external-work';self.work.mkdir();self.out=self.root/'data/audio';self.out.mkdir(parents=True);(self.root/'scripts').mkdir()
  for name in ['audio-voice-override.py','audio-human-review.py','retry-bank-audio.py','correct-bank-audio.py','generate-bank-audio.py','generate-audition.py','audio-evidence.py']:
   shutil.copyfile(ROOT/'scripts'/name,self.root/'scripts'/name)
  self.bank=load('fixture_voice_bank',self.root/'scripts/generate-bank-audio.py');self.unit=copy.deepcopy(UNIT);self.token='en:vocab:'+self.unit['key'];self.key=self.unit['key']
  self.gen={'recipe':'synthetic-fixture','modelSha256':'1'*64,'voicesSha256':'2'*64,'packages':{},'encoding':{}}
  self.identity={'model':repair.STRONG_MODEL,'modelSha256':repair.STRONG_SHA,'device':'cpu','computeType':'int8','beamSize':5,'conditionOnPreviousText':False,'prompt':None,'vadFilter':False}
  self.base={'spoken':'disburse','phonemes':PHONES,'speed':1.0};self.current_override={**self.base,'speed':.88,'reason':'fixture same-voice pace retry'}
  self.first=self.version('original-A',self.base);self.current=self.version('pace-A',self.current_override)
  self.initial_repair={'proposal':{'token':self.token,'sourceText':'disburse','beforeSha256':self.first['clip']['sha256'],'method':'fixture pace retry','override':self.current_override},'method':'fixture pace retry','original':copy.deepcopy(self.first),'candidate':copy.deepcopy(self.current),'baseOverride':copy.deepcopy(self.base),'appliedOverride':copy.deepcopy(self.current_override),'complete':True,'phase':'complete','disposition':'recorded-review'}
  self.quality={'version':1,'stages':{'strongerASR':{'sentinel':'unchanged'}},'records':{self.token:{'token':self.token,'language':'en','bank':'vocab','key':self.key,'baseline':{'sentinel':'immutable'},'repair':copy.deepcopy(self.initial_repair)}}}
  self.initial_retry={'token':self.token,'language':'en','bank':'vocab','key':self.key,'kind':'strong-asr-clarity-retry','initial':copy.deepcopy(self.first),'retry':copy.deepcopy(self.current),'baseOverride':copy.deepcopy(self.base),'retryOverride':copy.deepcopy(self.current_override),'selectedSha256':self.current['clip']['sha256'],'complete':True,'phase':'complete','synthesisAttemptCount':2,'asrAttemptCount':2,'outcome':'strong-retry-review','unresolved':True}
  self.source={'version':1,'model':'synthetic fixture','voices':{'en':['af_heart','am_puck','af_bella']},'units':[self.unit]}
  self.write('source.json',self.source);self.source_bytes=(self.out/'source.json').read_bytes();self.source_sha=sha(self.source_bytes)
  for name,value in [('quality-review.json',self.quality),('retries.json',{'version':1,'records':{self.token:self.initial_retry}}),('overrides.json',{'version':1,'entries':{self.token:self.current_override}}),('normalization-review.json',{'version':1}),('manifest.json',{'generation':self.gen})]:self.write(name,value)
  self.publish_fixture(self.current);self.plan=Path(self.temp.name)/'plan.json';self.calls=[];self.prepare('am_puck')
 def write(self,name,value):
  p=self.out/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
 def read(self,name):return json.loads((self.out/name).read_text())
 def version(self,label,override):
  voice=self.bank.voice_rules.selected_voice(self.unit,override);payload=('SYNTHETIC NOT AUDIO '+label+' '+voice).encode();digest=sha(payload);src=f'./audio/generated/en/{voice}/{digest[:32]}.m4a';p=self.root/src;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(payload)
  spoken,input_sha=self.bank.input_fingerprint(self.gen,self.unit,override)
  clip={'language':'en','text':'disburse','voiceId':voice,'required':True,'src':src,'sha256':digest,'bytes':len(payload),'duration':.9,'decodedPeak':.5,'spoken':spoken,'inputSha256':input_sha,'phonemeSha256':sha(override['phonemes'].encode()),'synthesisSpeed':override.get('speed',1),'asrStatus':'review'}
  if voice!=self.unit['voiceId']:clip.update(sourceVoiceId=self.unit['voiceId'],voiceOverrideInput=json.dumps(self.bank.input_payload(self.gen,self.unit,override)[1],sort_keys=True))
  asr={'key':self.key,'src':src,'voiceId':voice,'expected':'disburse','spoken':spoken,'sha256':digest,'recognized':'disperse','status':'review','recognitionMethod':'individual-beam5','singleFileVerification':True,'recognitionGeneration':copy.deepcopy(self.identity),'segments':[{'start':0,'end':.8,'text':'disperse'}]}
  asr['comparison']={'ruleVersion':'strict-audio-equivalence-1','audioSha256':digest,'expectedSpoken':spoken,'recognized':'disperse','language':'en','equivalent':False,'reasons':['fixture-difference'],'provenance':{'sourceTextSha256':sha(b'disburse'),'ruleFileSha256':'3'*64,'normalizerFileSha256':'4'*64,'articlePolicyEnabled':voice==self.unit['voiceId']}}
  return {'clip':clip,'asr':asr}
 def publish_fixture(self,version,pending=False):
  self.write('en/vocab.json',{'version':1,'language':'en','bank':'vocab','clips':{self.key:{**version['clip'],'asrStatus':'pending' if pending else 'review'}}})
  if not pending:self.write('audit/en/vocab.json',{'records':{self.key:copy.deepcopy(version['asr'])}})
 def prepare(self,voice,asr_model=None):
  old=self.read('quality-review.json')['records'][self.token]['repair'];base=self.read('overrides.json')['entries'][self.token]
  self.proposal={'token':self.token,'sourceText':'disburse','beforeSha256':old['candidate']['clip']['sha256'],'previousRepairSha256':repair.repair_snapshot_sha(old),'method':'Fixture selected-voice retry','override':{'voiceId':voice,'phonemes':PHONES}}
  if asr_model is not None:self.proposal['asrModel']=asr_model
  self.plan.write_text(json.dumps({'sourceSha256':self.source_sha,'entries':[self.proposal]}))
  self.revised=repair.make_override(self.unit,self.proposal,base);self.next_version=self.version('alternate-'+voice,self.revised)
  if asr_model is not None:self.next_version['asr']['recognitionGeneration'].update(model=asr_model,modelSha256=repair.STRONG_MODELS[asr_model])
 def main(self,finish=False,interrupt=False,bad_voice=False,bad_source=False,bad_proof=False,asr_model=None):
  original=repair.load_module
  def factory(name,path):
   module=original(name,path)
   if name=='strong_repair_correction':
    def worker(command,work):
     script=Path(command[1]).name;self.calls.append(script)
     self.assertEqual(json.loads((self.work/'tmp/strong-repair-tokens.json').read_text()),[self.token])
     self.assertEqual((self.out/'source.json').read_bytes(),self.source_bytes)
     if script=='generate-bank-audio.py':
      v=copy.deepcopy(self.next_version)
      if bad_voice:v['clip']['voiceId']='af_bella'
      if bad_source:v['clip']['sourceVoiceId']='af_bella'
      if bad_proof=='tampered':
       payload=json.loads(v['clip']['voiceOverrideInput']);payload[2]='af_bella';v['clip']['voiceOverrideInput']=json.dumps(payload,sort_keys=True)
      elif bad_proof:v['clip'].pop('voiceOverrideInput',None)
      self.generated=v;self.publish_fixture(v,pending=True)
      if interrupt:raise RuntimeError('fixture interrupted after generated alternate media')
     elif script=='audit-bank-audio.py':
      self.assertIn('--individual-only',command);self.assertEqual(command[command.index('--model')+1],asr_model or repair.STRONG_MODEL)
      self.write('audit/en/vocab.json',{'records':{self.key:copy.deepcopy(self.generated['asr'])}})
     else:raise AssertionError(script)
    module.run_command=worker
   return module
  argv=['repair','--repo',str(self.root),'--workdir',str(self.work),'--plan',str(self.plan),'--apply','--next-round']
  if finish:argv.append('--finish-only')
  if asr_model is not None:argv.extend(['--asr-model',asr_model])
  with patch.object(sys,'argv',argv),patch.object(repair,'load_module',side_effect=factory),contextlib.redirect_stdout(io.StringIO()):repair.main()
 def snapshot(self):return {str(p.relative_to(self.out)):p.read_bytes() for p in self.out.rglob('*.json')}
 def test_input_hash_binds_actual_voice_and_preserves_old_default_recipe(self):
  oldspoken,oldhash=self.bank.input_fingerprint(self.gen,self.unit,self.current_override);oldpayload=[{k:self.gen[k] for k in ['recipe','modelSha256','voicesSha256','packages']},self.gen['encoding'],'af_heart','disburse',PHONES,{'speed':.88}]
  self.assertEqual(oldhash,sha(json.dumps(oldpayload,sort_keys=True).encode()))
  self.assertNotEqual(oldhash,self.next_version['clip']['inputSha256']);self.assertEqual(json.loads(self.next_version['clip']['voiceOverrideInput'])[2],'am_puck');self.assertEqual(sha(self.next_version['clip']['voiceOverrideInput'].encode()),self.next_version['clip']['inputSha256'])
 def test_actual_main_two_voice_rounds_keep_source_and_every_original_snapshot(self):
  self.main();after_b=copy.deepcopy(self.read('quality-review.json')['records'][self.token]['repair']);self.assertEqual(after_b['candidate']['clip']['voiceId'],'am_puck');self.assertEqual(after_b['candidate']['clip']['sourceVoiceId'],'af_heart');self.assertEqual(after_b['original'],self.current)
  self.prepare('af_bella');self.main();row=self.read('quality-review.json')['records'][self.token];entry=self.read('retries.json')['records'][self.token]
  self.assertEqual(row['priorRepairs'],[self.initial_repair,after_b]);self.assertEqual(row['repair']['original'],after_b['candidate']);self.assertEqual(row['repair']['candidate']['clip']['voiceId'],'af_bella');self.assertEqual(row['repair']['candidate']['clip']['sourceVoiceId'],'af_heart');self.assertEqual(entry['initial'],after_b['candidate']);self.assertEqual(len(self.read('retries.json')['archivedCases']),2);self.assertEqual(row['baseline'],{'sentinel':'immutable'});self.assertEqual((self.out/'source.json').read_bytes(),self.source_bytes)
  retry=load('voice_retry_case',self.root/'scripts/retry-bank-audio.py');self.assertTrue(retry.case_matches(entry,self.unit,row['repair']['appliedOverride']),'already-switched original must match its default sourceVoiceId')
  before=self.snapshot();self.calls=[];self.main(finish=True);self.assertEqual(self.calls,[]);self.assertEqual(self.snapshot(),before)
 def test_interruption_keeps_original_and_resumes_without_duplicate_history(self):
  with self.assertRaisesRegex(RuntimeError,'fixture interrupted'):self.main(interrupt=True)
  pending=self.read('quality-review.json')['records'][self.token];self.assertFalse(pending['repair']['complete']);self.assertEqual(pending['repair']['original'],self.current);self.assertEqual(pending['priorRepairs'],[self.initial_repair])
  self.write('audit/en/vocab.json',{'records':{self.key:self.next_version['asr']}});self.calls=[];self.main(finish=True);self.assertEqual(self.calls,[]);row=self.read('quality-review.json')['records'][self.token];self.assertTrue(row['repair']['complete']);self.assertEqual(len(row['priorRepairs']),1);self.assertEqual(len(self.read('retries.json')['archivedCases']),1)
  before=self.snapshot();self.main(finish=True);self.assertEqual(self.snapshot(),before)
 def test_fake_worker_cannot_publish_wrong_actual_voice(self):
  with self.assertRaisesRegex(ValueError,'Candidate awaits'):self.main(bad_voice=True)
  row=self.read('quality-review.json')['records'][self.token];self.assertFalse(row['repair']['complete']);self.assertEqual(row['repair']['original'],self.current)
 def test_fake_worker_cannot_publish_forged_default_source_voice(self):
  with self.assertRaisesRegex(ValueError,'Candidate awaits'):self.main(bad_source=True)
  self.assertFalse(self.read('quality-review.json')['records'][self.token]['repair']['complete'])
 def test_fake_worker_cannot_complete_without_actual_voice_recipe_binding(self):
  with self.assertRaisesRegex(ValueError,'Candidate awaits'):self.main(bad_proof=True)
  self.assertFalse(self.read('quality-review.json')['records'][self.token]['repair']['complete'])
 def test_fake_worker_cannot_complete_with_a_different_voice_recipe_payload(self):
  with self.assertRaisesRegex(ValueError,'Candidate awaits'):self.main(bad_proof='tampered')
  self.assertFalse(self.read('quality-review.json')['records'][self.token]['repair']['complete'])
 def test_completed_resume_rejects_voice_metadata_tamper_before_writes(self):
  self.main()
  for field,value in [('voiceId','af_bella'),('sourceVoiceId','af_bella')]:
   pack=self.read('en/vocab.json');original=copy.deepcopy(pack);pack['clips'][self.key][field]=value;self.write('en/vocab.json',pack);before=self.snapshot();self.calls=[]
   with self.subTest(field=field),self.assertRaises(ValueError):self.main(finish=True)
   self.assertEqual(self.calls,[]);self.assertEqual(self.snapshot(),before);self.write('en/vocab.json',original)
 def test_next_round_requires_the_unchanged_source_cast(self):
  pack=self.read('en/vocab.json');pack['clips'][self.key]['sourceVoiceId']='am_puck';self.write('en/vocab.json',pack);before=self.snapshot()
  with self.assertRaises(ValueError):self.main()
  self.assertEqual(self.calls,[]);self.assertEqual(self.snapshot(),before)

 def test_full_candidate_keeps_turbo_history_and_reports_the_actual_model(self):
  full='whisper-large-v3';self.prepare('am_puck',full);self.main(asr_model=full)
  quality=self.read('quality-review.json');row=quality['records'][self.token];current=row['repair']
  self.assertTrue(current['complete']);self.assertEqual(current['candidate']['asr']['recognitionGeneration']['model'],full)
  self.assertEqual(current['candidate']['asr']['recognitionGeneration']['modelSha256'],repair.STRONG_MODELS[full])
  self.assertEqual(current['original'],self.current);self.assertEqual(row['priorRepairs'],[self.initial_repair])
  self.assertEqual(current['original']['asr']['recognitionGeneration']['model'],repair.STRONG_MODEL)
  self.assertEqual(quality['stages']['strongerASR'],{'sentinel':'unchanged'})
  summary=quality['stages']['repairs'];self.assertEqual(summary['model'],full);self.assertEqual(summary['modelSha256'],repair.STRONG_MODELS[full])
  self.assertEqual(summary['recognitionModels'],[{'model':full,'modelSha256':repair.STRONG_MODELS[full]}])
  self.assertEqual(summary['counts']['en'],{'attempted':1,'matched':0,'review':1,'systemFallback':0})
  self.assertEqual(self.read('retries.json')['records'][self.token]['initial'],self.current)
  before=self.snapshot();self.calls=[];self.main(finish=True,asr_model=full)
  self.assertEqual(self.calls,[]);self.assertEqual(self.snapshot(),before)
 def test_plan_and_cli_recognizer_mismatch_fail_before_the_first_write(self):
  full='whisper-large-v3'
  for plan_model,cli_model in [(full,None),(None,full)]:
   self.prepare('am_puck',plan_model);before=self.snapshot();self.calls=[]
   with self.subTest(plan=plan_model,cli=cli_model),self.assertRaisesRegex(ValueError,'Recognition model differs'):
    self.main(asr_model=cli_model)
   self.assertEqual(self.calls,[]);self.assertEqual(self.snapshot(),before)
   self.assertFalse((self.work/'tmp/strong-repair-tokens.json').exists())
  before=self.snapshot()
  with contextlib.redirect_stderr(io.StringIO()),self.assertRaises(SystemExit):self.main(asr_model='unapproved-model')
  self.assertEqual(self.calls,[]);self.assertEqual(self.snapshot(),before)
 def test_unapproved_or_wrong_sha_candidate_cannot_complete_a_full_model_plan(self):
  full='whisper-large-v3';self.prepare('am_puck',full)
  self.next_version['asr']['recognitionGeneration'].update(model='unapproved-model',modelSha256=repair.STRONG_MODELS[full])
  with self.assertRaisesRegex(ValueError,'Candidate awaits'):self.main(asr_model=full)
  self.assertFalse(self.read('quality-review.json')['records'][self.token]['repair']['complete'])
  self.assertEqual(self.calls,['generate-bank-audio.py','audit-bank-audio.py'])
  # Resume only inspects actual persisted evidence; no new fake/model call.
  for model,model_sha in [(full,'f'*64),(repair.STRONG_MODEL,repair.STRONG_SHA)]:
   record=copy.deepcopy(self.next_version['asr']);record['recognitionGeneration'].update(model=model,modelSha256=model_sha)
   self.write('audit/en/vocab.json',{'records':{self.key:record}});self.calls=[]
   with self.subTest(model=model,sha=model_sha),self.assertRaisesRegex(ValueError,'Candidate awaits'):
    self.main(finish=True,asr_model=full)
   row=self.read('quality-review.json')['records'][self.token]
   self.assertFalse(row['repair']['complete']);self.assertEqual(row['repair']['original'],self.current)
   self.assertEqual(row['priorRepairs'],[self.initial_repair]);self.assertEqual(self.calls,[])
   self.assertNotIn('repairs',self.read('quality-review.json')['stages'])


class VoiceComparisonPolicy(unittest.TestCase):
 def compare(self,expected,heard,clip):
  comparison=load('voice_comparison_policy',ROOT/'scripts/audio-compare.py')
  return comparison.compare(expected,heard,'en',normalizer=lambda text,language:text,source_text=expected,**rules.comparison_options(clip))
 def test_alternate_head_requires_the_exact_word_without_added_articles(self):
  clip={'voiceId':'am_puck','sourceVoiceId':'af_heart'}
  for heard in ['an owner','the owner','a owner']:
   self.assertFalse(self.compare('owner',heard,clip)['equivalent'])
  self.assertTrue(self.compare('owner','Owner.',clip)['equivalent'])
 def test_original_sentence_article_policy_is_unchanged(self):
  self.assertTrue(self.compare('The owner moved.','Owner moved.',{'voiceId':'af_heart'})['equivalent'])
 def test_changed_voice_cannot_publish_missing_or_relaxed_comparison_policy(self):
  clip={'voiceId':'am_puck','sourceVoiceId':'af_heart'}
  for record in [{},{'comparison':{'provenance':{'articlePolicyEnabled':True}}}]:self.assertFalse(rules.strict_comparison_evidence(clip,record))
  self.assertTrue(rules.strict_comparison_evidence(clip,{'comparison':{'provenance':{'articlePolicyEnabled':False}}}))

if __name__=='__main__':unittest.main()
