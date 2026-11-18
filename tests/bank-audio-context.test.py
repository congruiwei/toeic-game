"""Private draft. No synthesis/model load; exact PCM, strict comparator, fake ASR."""
import copy,importlib.util,json,tempfile,types,unittest
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
def load(name,file):
 s=importlib.util.spec_from_file_location(name,ROOT/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
probe=load('context_probe','scripts/contextual-audio-probe.py')
cmp=load('context_compare','scripts/audio-compare.py')
evidence=load('context_evidence','scripts/audio-evidence.py')
def normalizer(text,language):return text

def fixture(word='signed',tail=None,bank='vocab',key=None):
 tail=word if tail is None else tail
 u={'language':'en','bank':bank,'key':key or 'v-test/meaning','text':word,'voiceId':'af_heart','required':True,'group':'p2-first'}
 c={'src':'./audio/generated/en/af_heart/'+'a'*32+'.m4a','sha256':'b'*64,'bytes':100,'duration':.5,'text':word,'spoken':word,'language':'en','voiceId':'af_heart','required':True,'inputSha256':'c'*64,'phonemeSha256':'d'*64,'asrStatus':'review'}
 g={'model':probe.MODEL,'modelSha256':probe.MODEL_SHA,'device':'cpu','computeType':'int8','beamSize':5,'conditionOnPreviousText':False,'prompt':None,'hotwords':None,'vadFilter':False,'wordTimestamps':True,'temperature':0}
 original={'sha256':c['sha256'],'expected':word,'spoken':word,'recognized':'incorrect original recognition','status':'review','recognitionMethod':'individual-beam5','singleFileVerification':True,'recognitionGeneration':copy.deepcopy(g)}
 source=np.linspace(-.3,.4,8000,dtype=np.float32);carrier_pcm=np.linspace(.1,-.2,16000,dtype=np.float32)
 whole,meta=probe.build_probe(source,carrier_pcm)
 carrier={'text':probe.PREFIX,'voiceId':'af_heart','audioSha256':'e'*64,'pcmSha256':meta['carrierPCMSha256'],'frames':16000,'sampleRate':16000,'synthesis':{'modelSha256':'f'*64,'voicesSha256':'f'*64,'phonemeSha256':'f'*64,'targetTextUsed':False}}
 transcript=(probe.PREFIX+' '+tail).strip()
 ws=[{'word':' The','start':0.,'end':.2},{'word':' word','start':.2,'end':.5},{'word':' is','start':.5,'end':.8}]
 tailwords=probe.words(tail)
 for i,t in enumerate(tailwords):ws.append({'word':' '+t,'start':1.21+i*.45/max(1,len(tailwords)),'end':1.21+(i+1)*.45/max(1,len(tailwords))})
 result={'recognized':transcript,'recognitionGeneration':copy.deepcopy(g),'recognitionMethod':'context-individual-beam5','probePCMSha256':meta['probePCMSha256'],'segments':[{'start':0.,'end':1.7,'text':transcript,'avgLogprob':-.1,'noSpeechProb':.01}],'words':ws}
 return u,c,original,carrier,meta,result,source,carrier_pcm,whole

def assess(f):return probe.assess(*f[:6],cmp,normalizer,evidence,{'p2-first'})

class ContextTest(unittest.TestCase):
 def test_unchanged_pcm_bytes_and_exact_silence(self):
  *_,source,carrier,whole=fixture();joined,meta=probe.build_probe(source,carrier)
  self.assertTrue(probe.verify_pcm(meta,source,carrier,whole));self.assertEqual(joined[meta['spanStartFrame']:].tobytes(),source.tobytes())
  self.assertTrue((joined[len(carrier):meta['spanStartFrame']]==0).all())
  self.assertEqual(meta['targetSpanSha256'],meta['sourcePCMSha256'])
 def test_gain_resample_trim_or_tampered_span_rejected(self):
  *_,source,carrier,whole=fixture();_,meta=probe.build_probe(source,carrier)
  changed=whole.copy();changed[-1]*=.9
  for s,c,w,m in [(source*.9,carrier,whole,meta),(source[::2],carrier,whole,meta),(source[:-1],carrier,whole,meta),(source,carrier,changed,meta),(source,carrier,whole,dict(meta,spanStartFrame=1))]:
   with self.subTest(length=len(s)),self.assertRaises(ValueError):probe.verify_pcm(m,s,c,w)
 def test_pcm_wrong_type_empty_nan_or_silent_rejected(self):
  for bad in [np.zeros(3,dtype=np.float32),np.array([],dtype=np.float32),np.array([np.nan],dtype=np.float32),np.array([1.],dtype=np.float64),np.ones((2,2),dtype=np.float32)]:
   with self.assertRaises(ValueError):probe.pcm_bytes(bad)
 def test_exact_narrow_eligibility(self):
  u=fixture()[0];self.assertTrue(probe.eligible(u))
  for changes in [{'text':'The manager signed it.'},{'text':'business trip'},{'language':'ja'},{'required':False},{'bank':'grammar'},{'key':'v-test/example/0'}]:self.assertFalse(probe.eligible(dict(u,**changes)))
  p=dict(u,bank='part2',key='p2-first/options/0/0',group='p2-first',text='Where');self.assertTrue(probe.eligible(p,{'p2-first'}));self.assertFalse(probe.eligible(p))
  l=dict(u,bank='labels',key='labels/af_heart/A',text='A.');self.assertTrue(probe.eligible(l));self.assertFalse(probe.eligible(dict(l,text='The letter A.')))
 def test_proof_accepts_current_original_but_does_not_rewrite_individual_asr(self):
  f=fixture();proof=assess(f);self.assertEqual(proof['status'],'accepted');self.assertEqual(proof['originalASR']['status'],'review')
  self.assertFalse(proof['originalIndividualASRMatched']);self.assertFalse(proof['originalAudioResynthesized']);self.assertEqual(proof['comparison']['proofExpected'],proof['comparison']['proofRecognized'])
  self.assertTrue(probe.valid_acceptance(f[0],dict(f[1],asrStatus='accepted'),proof,cmp,normalizer,evidence))
 def test_tail_article_policy_is_disabled_and_letter_a_preserved(self):
  self.assertTrue(cmp.compare('a signed','signed','en',source_text='a signed')['equivalent'])
  for word,tail in [('signed','a signed'),('signed','the signed'),('A.','The'),('A.',''),('signed','signed a')]:
   f=fixture(word,tail,bank='labels' if word=='A.' else 'vocab',key='labels/af_heart/A' if word=='A.' else None);self.assertEqual(assess(f)['status'],'review',(word,tail))
  f=fixture('A.','A',bank='labels',key='labels/af_heart/A');self.assertEqual(assess(f)['status'],'accepted');self.assertIs(assess(f)['comparison']['provenance']['articlePolicyEnabled'],False)
 def test_false_homophones_and_ed_omissions_remain_review(self):
  for word,tail in [('Will','Well'),('Who','Hell'),('liked','like'),('signed','sign'),('returned','return'),('visitors','visitor'),('can','cannot')]:
   with self.subTest(word=word):self.assertEqual(assess(fixture(word,tail))['status'],'review')
 def test_exact_dictionary_homophone_can_pass_without_resynthesis(self):
  self.assertEqual(assess(fixture('beech','beach'))['status'],'accepted')
 def test_prefix_no_cherry_picked_tail_or_extra_tokens(self):
  for text in ['A word is signed','The word was signed','Please say The word is signed','The word is','The word is wrong signed']:
   f=list(fixture());f[5]['recognized']=text;f[5]['segments'][0]['text']=text
   self.assertEqual(assess(f)['status'],'review')
 def test_word_evidence_covers_every_recognized_token(self):
  f=list(fixture());f[5]['words'].pop(1);self.assertEqual(assess(f)['status'],'review')
  f=list(fixture());f[5]['words'][-1]['word']=' sign';self.assertEqual(assess(f)['status'],'review')
 def test_timestamp_tail_not_in_carrier_prefix_not_in_target(self):
  for which,field,value in [(-1,'start',.3),(1,'end',1.6),(-1,'end',2.1),(-1,'start',float('nan'))]:
   f=list(fixture());f[5]['words'][which][field]=value;self.assertEqual(assess(f)['status'],'review')
 def test_strong_model_and_no_prompt_hotwords_enforced(self):
  for key,value in [('model','medium'),('modelSha256','0'*64),('beamSize',1),('prompt','signed'),('hotwords','signed'),('conditionOnPreviousText',True),('vadFilter',True),('wordTimestamps',False),('temperature',.2)]:
   f=list(fixture());f[5]['recognitionGeneration'][key]=value
   with self.subTest(key=key),self.assertRaises(ValueError):assess(f)
  f=list(fixture());del f[5]['recognitionGeneration']['prompt']
  with self.assertRaises(ValueError):assess(f)
 def test_actual_segments_and_probe_hash_required(self):
  for key,value in [('segments',[]),('probePCMSha256','0'*64),('recognitionMethod','batch-beam1')]:
   f=list(fixture());f[5][key]=value
   with self.assertRaises(ValueError):assess(f)
  f=list(fixture());f[5]['segments'][0]['text']='The word is sign'
  with self.assertRaises(ValueError):assess(f)
 def test_current_source_and_original_strong_asr_bound(self):
  for name,value in [('sha256','0'*64),('spoken','other'),('status','matched'),('recognized','')]:
   f=list(fixture());f[2][name]=value
   with self.subTest(name=name),self.assertRaises(ValueError):assess(f)
  f=list(fixture());f[2]['recognitionGeneration']['model']='medium'
  with self.assertRaises(ValueError):assess(f)
  f=list(fixture());f[1]['voiceId']='am_puck'
  with self.assertRaises(ValueError):assess(f)
 def test_acceptance_cannot_transfer_to_other_audio_text_voice_or_input(self):
  f=fixture();proof=assess(f)
  for key,value in [('sha256','0'*64),('text','sign'),('voiceId','am_puck'),('inputSha256','0'*64),('phonemeSha256','0'*64)]:self.assertFalse(probe.valid_acceptance(f[0],dict(f[1],**{key:value}),proof,cmp,normalizer,evidence))
  bad=copy.deepcopy(proof);bad['originalASR']['recognized']='';self.assertFalse(probe.valid_acceptance(f[0],f[1],bad,cmp,normalizer,evidence))
  bad=copy.deepcopy(proof);bad['comparison']['provenance']['articlePolicyEnabled']=True;self.assertFalse(probe.valid_acceptance(f[0],f[1],bad,cmp,normalizer,evidence))
 def test_known_inserted_silence_is_allowed_but_carrier_or_silence_only_is_not(self):
  f=list(fixture());f[5]['words'][-1]['start']=1.05
  new=assess(f);old=probe.assess(*f[:6],cmp,normalizer,evidence,{'p2-first'},assessment_version=1)
  self.assertEqual(new['status'],'accepted');self.assertEqual(old['status'],'review');self.assertNotEqual(new['id'],old['id']);self.assertEqual(new['assessmentVersion'],2);self.assertNotIn('assessmentVersion',old)
  for start,end in [(.99,1.6),(1.05,1.19),(1.05,1.2)]:
   f=list(fixture());f[5]['words'][-1].update(start=start,end=end);self.assertEqual(assess(f)['status'],'review')
 def test_source_leading_silence_is_not_audible_overlap(self):
  f=list(fixture());f[6][:3200]=0.;f[8],f[4]=probe.build_probe(f[6],f[7]);f[5]['probePCMSha256']=f[4]['probePCMSha256'];f[5]['words'][-1].update(start=1.05,end=1.3)
  self.assertGreaterEqual(f[4]['sourceActivity']['startFrame'],3200);self.assertEqual(assess(f)['status'],'review')
  f[5]['words'][-1]['end']=1.55;self.assertEqual(assess(f)['status'],'accepted')
 def test_v1_valid_proof_remains_valid_and_v2_cannot_erase_v1_review(self):
  f=list(fixture());old=probe.assess(*f[:6],cmp,normalizer,evidence,{'p2-first'},assessment_version=1)
  self.assertTrue(probe.valid_acceptance(f[0],f[1],old,cmp,normalizer,evidence))
  f[5]['words'][-1]['start']=1.05;prior=probe.assess(*f[:6],cmp,normalizer,evidence,{'p2-first'},assessment_version=1);row={'contextProbes':[copy.deepcopy(prior)]};new=assess(f)
  accepted=probe.stage_proof(row,*f[:3],new,cmp,normalizer,evidence);self.assertEqual(len(row['contextProbes']),2);self.assertEqual(row['contextProbes'][0],prior);self.assertTrue(probe.valid_context_record(f[0],f[1],accepted,row,cmp,normalizer,evidence))
 def test_fake_model_receives_exact_pcm_and_no_target_text(self):
  f=fixture();calls=[]
  class Model:
   def transcribe(self,wave,**options):
    calls.append((wave.copy(),options));r=f[5];ws=[types.SimpleNamespace(**dict(w,probability=.9)) for w in r['words']]
    s=types.SimpleNamespace(start=0.,end=1.7,text=r['recognized'],avg_logprob=-.1,no_speech_prob=.01,words=ws)
    return iter([s]),None
  result=probe.run_asr(Model(),f[-1],f[5]['recognitionGeneration'])
  self.assertEqual(calls[0][0].tobytes(),f[-1].tobytes());self.assertEqual(result['recognized'],'The word is signed');self.assertEqual(len(result['words']),4)
  self.assertIsNone(calls[0][1]['initial_prompt']);self.assertIsNone(calls[0][1]['hotwords']);self.assertNotIn('signed',json.dumps(calls[0][1]));self.assertTrue(calls[0][1]['word_timestamps']);self.assertEqual(calls[0][1]['beam_size'],5)
  self.assertEqual(assess(tuple(list(f[:5])+[result]+list(f[6:])))['status'],'accepted')


class PublicationTest(unittest.TestCase):
 def test_ledger_first_resume_is_idempotent(self):
  f=fixture();proof=assess(f);row={'baseline':{'keep':'original'},'contextProbes':[copy.deepcopy(proof)]}
  published=probe.stage_proof(row,*f[:3],proof,cmp,normalizer,evidence)
  self.assertEqual(len(row['contextProbes']),1);self.assertEqual(row['baseline'],{'keep':'original'})
  self.assertTrue(probe.valid_context_record(f[0],f[1],published,row,cmp,normalizer,evidence))
  for name in f[2]:
   if name!='status':self.assertEqual(published[name],f[2][name])
  again=probe.stage_proof(row,*f[:3],proof,cmp,normalizer,evidence);self.assertEqual(again,published);self.assertEqual(len(row['contextProbes']),1)
 def test_failed_probe_keeps_original_review_and_history(self):
  f=fixture('liked','like');proof=assess(f);row={};published=probe.stage_proof(row,*f[:3],proof,cmp,normalizer,evidence)
  self.assertEqual(published,f[2]);self.assertEqual(proof['status'],'review');self.assertEqual(len(row['contextProbes']),1)
  self.assertFalse(probe.valid_context_record(f[0],f[1],published,row,cmp,normalizer,evidence))
 def test_two_source_versions_keep_two_original_pcm_proofs(self):
  f=fixture();p1=assess(f);row={};probe.stage_proof(row,*f[:3],p1,cmp,normalizer,evidence)
  second=list(copy.deepcopy(f));second[1]['sha256']='8'*64;second[2]['sha256']='8'*64;p2=assess(second)
  published=probe.stage_proof(row,*second[:3],p2,cmp,normalizer,evidence)
  self.assertEqual(len(row['contextProbes']),2);self.assertEqual(row['contextProbes'][0],p1);self.assertNotEqual(p1['id'],p2['id'])
  self.assertTrue(probe.valid_context_record(second[0],second[1],published,row,cmp,normalizer,evidence))
  self.assertFalse(probe.valid_context_record(f[0],f[1],published,row,cmp,normalizer,evidence))
 def test_existing_proof_cannot_be_rewritten_or_duplicated(self):
  f=fixture();proof=assess(f);row={'contextProbes':[copy.deepcopy(proof)]};bad=copy.deepcopy(proof);bad['reasons']=['changed']
  with self.assertRaises(ValueError):probe.stage_proof(row,*f[:3],bad,cmp,normalizer,evidence)
  row['contextProbes'].append(copy.deepcopy(proof))
  with self.assertRaises(ValueError):probe.stage_proof(row,*f[:3],proof,cmp,normalizer,evidence)
 def test_unrelated_code_hash_changes_preserve_historical_proof_but_not_semantics(self):
  f=fixture();proof=assess(f);proof['comparison']['provenance']['ruleFileSha256']='1'*64;proof['comparison']['provenance']['normalizerFileSha256']='2'*64
  self.assertTrue(probe.valid_acceptance(f[0],f[1],proof,cmp,normalizer,evidence))
  row={'contextProbes':[copy.deepcopy(proof)]};published=probe.stage_proof(row,*f[:3],assess(f),cmp,normalizer,evidence)
  self.assertEqual(row['contextProbes'][0],proof);self.assertTrue(probe.valid_context_record(f[0],f[1],published,row,cmp,normalizer,evidence))
  bad=copy.deepcopy(proof);bad['comparison']['provenance']['ruleFileSha256']='not-a-sha';self.assertFalse(probe.valid_acceptance(f[0],f[1],bad,cmp,normalizer,evidence))
  bad=copy.deepcopy(proof);bad['comparison']['normalizedRecognized']=['sign'];self.assertFalse(probe.valid_acceptance(f[0],f[1],bad,cmp,normalizer,evidence))
 def test_current_audit_may_not_borrow_valid_proof_for_changed_transcript(self):
  f=fixture();proof=assess(f);row={};published=probe.stage_proof(row,*f[:3],proof,cmp,normalizer,evidence)
  for key,value in [('recognized','new arbitrary transcript'),('spoken','different'),('recognitionMethod','batch-beam1')]:
   changed=copy.deepcopy(published);changed[key]=value;self.assertFalse(probe.valid_context_record(f[0],f[1],changed,row,cmp,normalizer,evidence))
  changed=copy.deepcopy(published);changed['acceptance']['sourceAudioSha256']='0'*64;self.assertFalse(probe.valid_context_record(f[0],f[1],changed,row,cmp,normalizer,evidence))

if __name__=='__main__':unittest.main(verbosity=2)
