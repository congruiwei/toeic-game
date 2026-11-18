# -*- coding: utf-8 -*-
import copy,importlib.util,json,hashlib,tempfile,types,unittest,fcntl,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('lex',ROOT/'scripts/accept-repair-equivalence.py');lex=importlib.util.module_from_spec(s);s.loader.exec_module(lex)
def fixture(rule_id='route-root-oot',before=None,after=None,approved=None):
 rule=lex.RULES[rule_id];approved=approved or next((x for x in rule['approvedInputs'] if x['sourceText']==rule['sourceWord']),rule['approvedInputs'][0]);before=before or approved['sourceText'];after=after or re.sub(re.escape(rule['sourceWord']),rule['recognizedWord'],before,count=1,flags=re.I)
 lang,bank,key=approved['tokens'][0].split(':',2)
 u={'language':lang,'bank':bank,'key':key,'text':before,'voiceId':approved['voiceId'],'required':True};t=lex.token(u)
 recipe={'spoken':before,'phonemes':approved['phonemes'],'speed':.88}
 generation={'recipe':'fixture','modelSha256':'1'*64,'voicesSha256':'2'*64,'packages':{},'encoding':{'container':'m4a'}}
 media=b'fixture-media-not-real-audio';digest=lex.sha(media)
 c={'src':'./audio/generated/en/'+u['voiceId']+'/'+'a'*32+'.m4a','sha256':digest,'bytes':len(media),'duration':.6,'language':'en','voiceId':u['voiceId'],'required':True,'text':before,'spoken':before,'phonemeSha256':lex.sha(recipe['phonemes'].encode()),'inputSha256':lex.recipe_fingerprint(generation,u,recipe),'synthesisSpeed':.88,'asrStatus':'review'}
 g={'model':lex.MODEL,'modelSha256':lex.MODEL_SHA,'device':'cpu','computeType':'int8','beamSize':5,'prompt':None,'conditionOnPreviousText':False,'vadFilter':False}
 a={'key':u['key'],'src':c['src'],'sha256':digest,'voiceId':c['voiceId'],'expected':before,'spoken':before,'recognized':after,'status':'review','recognitionMethod':'individual-beam5','singleFileVerification':True,'recognitionGeneration':g,'segments':[{'start':0.0,'end':.5,'text':after,'avgLogprob':-.1,'noSpeechProb':1e-10}]}
 a['fingerprint']=lex.sha(json.dumps([g,digest,'en'],sort_keys=True).encode())
 a['comparison']={'ruleVersion':'strict-audio-equivalence-1','equivalent':False,'audioSha256':digest,'expectedSpoken':before,'recognized':after,'language':'en','reasons':['non-equivalent-segments-remain'],'provenance':{'sourceTextSha256':lex.sha(before.encode()),'ruleFileSha256':'3'*64,'normalizerFileSha256':'4'*64}}
 repair={'complete':True,'disposition':'recorded-review','original':{'clip':dict(c,sha256='5'*64),'asr':{'untouched':'original evidence'}},'candidate':{'clip':copy.deepcopy(c),'asr':copy.deepcopy(a)},'appliedOverride':recipe}
 row={'token':t,'baseline':{'immutable':True},'comparison':{'immutable':True},'repair':repair};return u,c,a,row,generation,media

def build(f,rid='route-root-oot'):return lex.make_proof(f[0],f[1],f[2],f[3]['repair'],rid)
def stored(f,p):row=copy.deepcopy(f[3]);row['lexicalEquivalences']=[p];return row,lex.accepted_record(p)
class LexicalTests(unittest.TestCase):
 def test_all_finite_dictionary_rules_have_positive_proofs(self):
  for rid in lex.RULES:
   with self.subTest(rule=rid):
    f=fixture(rid);p=build(f,rid);row,a=stored(f,p);self.assertTrue(lex.valid_lexical_record(f[0],f[1],a,row));self.assertEqual(p['originalASR'],f[2]);self.assertEqual(p['newRecognitionCalls'],0);self.assertFalse(p['originalIndividualASRMatched'])
 def test_sentence_pair_does_not_hide_other_word_differences(self):
  rid='insures-ensures-in';base=lex.RULES[rid]['approvedInputs'][0]['sourceText'];self.assertEqual(build(fixture(rid),rid)['status'],'accepted')
  for tail in [base.replace('insures fragile items','ensures fragile item'),base.replace('insures','ensured'),base.replace('insures fragile','ensures'),base.replace('insures','does not ensure'),base.replace('insures','the ensures')]:
   with self.subTest(tail=tail),self.assertRaises(ValueError):build(fixture(rid,base,tail),rid)
 def test_near_phone_tense_plural_and_unsafe_variants_rejected(self):
  for before,after,rid in [('liked','like','route-root-oot'),('signed','sign','route-root-oot'),('route','roots','route-root-oot'),('disburse','disperse','route-root-oot'),('considerate','consider it','route-root-oot'),('our','are','route-root-oot'),('R','Arr.','route-root-oot'),('résumé','resumed','resume-noun-diacritics'),('resume','résumé','resume-noun-diacritics')]:
   with self.subTest(pair=(before,after)),self.assertRaises(ValueError):build(fixture(rid,before,after),rid)
 def test_selected_reading_cannot_use_any_dictionary_variant(self):
  f=fixture();f[3]['repair']['appliedOverride']['phonemes']='ɹˈWt.';f[1]['phonemeSha256']=lex.sha('ɹˈWt.'.encode());f[3]['repair']['candidate']['clip']=copy.deepcopy(f[1])
  with self.assertRaisesRegex(ValueError,'recipe binding'):build(f)
 def test_correct_phone_elsewhere_cannot_authorize_the_changed_word(self):
  with self.assertRaisesRegex(ValueError,'Full source/recipe'):
   lex.align('The route has a root.','The route has a root.','The root has a root.',lex.RULES['route-root-oot'],'ðə ɹˈaʊt hæz ə ɹˈut.')
  f=fixture();f[0]['key']='v-other-route/meaning'
  with self.assertRaises(ValueError):build(f)
 def test_all_identity_recipe_and_finalization_gates(self):
  for change in [lambda f:f[3]['repair'].update(complete=False),lambda f:f[3]['repair'].update(disposition='recorded-matched'),lambda f:f[1].update(voiceId='am_puck'),lambda f:f[1].update(sha256='0'*64),lambda f:f[1].update(phonemeSha256='0'*64),lambda f:f[3]['repair']['original']['clip'].update(sha256=f[1]['sha256']),lambda f:f[3]['repair']['appliedOverride'].update(spoken='wrong'),lambda f:f[3]['repair']['appliedOverride'].update(speed=1),lambda f:f[0].update(required=False),lambda f:f[0].update(bank='labels')]:
   f=fixture();change(f)
   with self.subTest(change=change),self.assertRaises(ValueError):build(f)
 def test_raw_asr_strong_model_and_segments_must_be_exact(self):
  for change in [lambda a:a['recognitionGeneration'].update(model='small'),lambda a:a['recognitionGeneration'].update(beamSize=1),lambda a:a['recognitionGeneration'].update(prompt='route'),lambda a:a['recognitionGeneration'].update(hotwords='route'),lambda a:a.update(recognized=''),lambda a:a.update(fingerprint='0'*64),lambda a:a['segments'][0].update(text='route'),lambda a:a.update(segments=[]),lambda a:a['comparison'].update(equivalent=True),lambda a:a['comparison']['provenance'].update(sourceTextSha256='0'*64)]:
   f=fixture();change(f[2]);f[3]['repair']['candidate']['asr']=copy.deepcopy(f[2])
   with self.subTest(change=change),self.assertRaises(ValueError):build(f)
 def test_public_acceptance_tampering_and_duplicate_proofs_rejected(self):
  f=fixture();p=build(f);row,a=stored(f,p)
  for change in [lambda r,a:r['lexicalEquivalences'].append(copy.deepcopy(p)),lambda r,a:r['lexicalEquivalences'][0]['rule'].update(phoneToken='wrong'),lambda r,a:r['lexicalEquivalences'][0]['decision'].update(differenceIndex=1),lambda r,a:r['lexicalEquivalences'][0].update(originalIndividualASRMatched=True),lambda r,a:a.update(recognized='route'),lambda r,a:a['comparison'].update(equivalent=True),lambda r,a:a['acceptance'].update(proofId='0'*64),lambda r,a:r['repair'].update(complete=False)]:
   r,b=copy.deepcopy(row),copy.deepcopy(a);change(r,b);self.assertFalse(lex.valid_lexical_record(f[0],f[1],b,r))
 def test_source_anchor_and_other_signs_are_preserved(self):
  rid='route-root-oot'
  for source,spoken,asr in [('route','root','root'),('route route','route route','root route'),('The route costs -5.','The route costs -5.','The root costs 5.'),('A route','A route','root')]:
   with self.subTest(source=source),self.assertRaises(ValueError):lex.align(source,spoken,asr,lex.RULES[rid],'ɹˈut')

 def test_full_model_name_spelling_proof_retains_the_same_strict_gates(self):
  rid='luis-lewis-loois';f=fixture(rid);a=f[2]
  a['recognitionGeneration'].update(model='whisper-large-v3',modelSha256=lex.MODELS['whisper-large-v3'])
  a['fingerprint']=lex.sha(json.dumps([a['recognitionGeneration'],f[1]['sha256'],'en'],sort_keys=True).encode())
  f[3]['repair']['candidate']['asr']=copy.deepcopy(a)
  p=build(f,rid);row,accepted=stored(f,p);self.assertTrue(lex.valid_lexical_record(f[0],f[1],accepted,row))
  for mutate in [lambda x:x[2]['recognitionGeneration'].update(modelSha256=lex.MODEL_SHA),lambda x:x[2]['recognitionGeneration'].update(model='unknown'),lambda x:x[2]['recognitionGeneration'].update(beamSize=1),lambda x:x[2]['recognitionGeneration'].update(prompt='Luis')]:
   bad=copy.deepcopy(f);mutate(bad);bad[3]['repair']['candidate']['asr']=copy.deepcopy(bad[2])
   with self.subTest(mutation=mutate),self.assertRaises(ValueError):build(bad,rid)
 def test_luis_rule_cannot_hide_other_name_readings_words_or_source_keys(self):
  rid='luis-lewis-loois';base=lex.RULES[rid]['approvedInputs'][0]['sourceText']
  for after in ['Lewis had the front desk till noon.','Lewis has front desk till noon.','Lewis has the front desks till noon.','Lewis has not the front desk till noon.','Louise has the front desk till noon.']:
   with self.subTest(after=after),self.assertRaises(ValueError):build(fixture(rid,after=after),rid)
  f=fixture(rid);f[0]['key']='p2-other/options/2/0'
  with self.assertRaises(ValueError):build(f,rid)
  with self.assertRaises(ValueError):lex.align(base,base,base.replace('Luis','Lewis'),lex.RULES[rid],'lʊˈis hæz ðə fɹˈʌnt dˈɛsk tˈɪl nˈun.')

class PublishingTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.base=Path(self.temp.name);self.root=self.base/'repo';self.work=self.base/'work';self.root.mkdir();self.work.mkdir();self.f=fixture();u,c,a,row,g,media=self.f
  def w(file,obj):p=self.root/file;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(obj,ensure_ascii=False))
  self.write=w;source={'units':[u]};raw=json.dumps(source,ensure_ascii=False);h=lex.sha(raw.encode());w('data/audio/source.json',source);w('data/audio/manifest.json',{'sourceSha256':h,'generation':g,'packs':[{'language':'en','bank':'vocab','src':'./data/audio/en/vocab.json'}]});w('data/audio/en/vocab.json',{'sourceSha256':h,'generation':g,'clips':{u['key']:c}});w('data/audio/audit/en/vocab.json',{'records':{u['key']:a}});w('data/audio/quality-review.json',{'version':1,'records':{lex.token(u):row},'stages':{'strongerASR':{'immutable':True}}});w('data/audio/overrides.json',{'entries':{lex.token(u):row['repair']['appliedOverride']}})
  p=self.root/c['src'];p.parent.mkdir(parents=True);p.write_bytes(media)
  self.cache=self.work/'tmp/bank-asr'/(a['fingerprint']+'.json');self.cache.parent.mkdir(parents=True);self.cache.write_text(json.dumps({'sha256':c['sha256'],'generation':a['recognitionGeneration'],'recognized':a['recognized'],'segments':a['segments']}))
  self.plan={'version':1,'sourceSha256':h,'entries':[{'token':lex.token(u),'sourceText':c['text'],'spoken':c['spoken'],'recognized':a['recognized'],'audioSha256':c['sha256'],'phonemeSha256':c['phonemeSha256'],'voiceId':c['voiceId'],'actualAsrFingerprint':a['fingerprint'],'ruleId':'route-root-oot'}]}
  def flush(source,source_hash,generation,packs):
   for pair,pack in packs.items():
    for key,clip in pack['clips'].items():clip['asrStatus']=lex.read(self.root/'data/audio/audit'/pair[0]/(pair[1]+'.json'))['records'][key]['status']
    w('data/audio/'+pair[0]+'/'+pair[1]+'.json',pack)
  self.bank=types.SimpleNamespace(valid_published_asr=lambda u,c,a,rows,ids:lex.valid_lexical_record(u,c,a,rows[lex.token(u)]),flush=flush)
 def tearDown(self):self.temp.cleanup()
 def snapshot(self):return {str(p.relative_to(self.root)):p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
 def test_preview_is_read_only_apply_preserves_history_and_is_idempotent(self):
  before=self.snapshot();r=lex.finalize(self.root,self.work,self.plan);self.assertTrue(r['dryRun']);self.assertEqual(self.snapshot(),before)
  r=lex.finalize(self.root,self.work,self.plan,True,lambda:self.bank);self.assertEqual(r['newAcceptances'],1)
  q=lex.read(self.root/'data/audio/quality-review.json');row=q['records'][lex.token(self.f[0])];self.assertEqual(row['baseline'],self.f[3]['baseline']);self.assertEqual(row['repair'],self.f[3]['repair']);self.assertEqual(q['stages']['strongerASR'],{'immutable':True})
  after=self.snapshot();r=lex.finalize(self.root,self.work,self.plan,True,lambda:self.bank);self.assertEqual(r['newAcceptances'],0);self.assertEqual(self.snapshot(),after)
 def test_invalid_candidate_cache_or_media_fails_before_any_write(self):
  for kind in ['plan','cache','media','override','no-hook']:
   with self.subTest(kind=kind):
    original=self.snapshot();cache=self.cache.read_bytes();plan=copy.deepcopy(self.plan);bank=self.bank
    if kind=='plan':plan['entries'][0]['recognized']='roots'
    elif kind=='cache':self.cache.write_text('{}')
    elif kind=='media':(self.root/self.f[1]['src']).write_bytes(b'changed')
    elif kind=='override':self.write('data/audio/overrides.json',{'entries':{}})
    else:bank=types.SimpleNamespace(valid_published_asr=lambda *a:False)
    unchanged=self.snapshot()
    with self.assertRaises((ValueError,KeyError)):lex.finalize(self.root,self.work,plan,True,lambda:bank)
    self.assertEqual(self.snapshot(),unchanged)
    for name,body in original.items():(self.root/name).write_bytes(body)
    self.cache.write_bytes(cache)
 def test_author_lock_refuses_and_ledger_first_interruption_resumes(self):
  before=self.snapshot()
  with (self.work/'bank-audit.lock').open('a') as lock:
   fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
   with self.assertRaises(BlockingIOError):lex.finalize(self.root,self.work,self.plan,True,lambda:self.bank)
  self.assertEqual(self.snapshot(),before)
  q=lex.read(self.root/'data/audio/quality-review.json');q['records'][lex.token(self.f[0])]['lexicalEquivalences']=[build(self.f)];self.write('data/audio/quality-review.json',q)
  lex.finalize(self.root,self.work,self.plan,True,lambda:self.bank);q=lex.read(self.root/'data/audio/quality-review.json');self.assertEqual(len(q['records'][lex.token(self.f[0])]['lexicalEquivalences']),1)

if __name__=='__main__':unittest.main()
