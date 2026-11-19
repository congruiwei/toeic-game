"""Isolated author/publication fixtures. Synthetic bytes and ASR, no models."""
import copy,fcntl,importlib.util,json,os,struct,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
SCRIPTS=Path(__file__).resolve().parents[1]/'scripts'
MAIN=Path(os.environ.get('TOEIC_TEST_REPO',Path.cwd()))
def load(path,name):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
pub=load(SCRIPTS/'publish-manual-kana.py','manual_fixture_publisher');p=pub.proof
evidence=load(MAIN/'scripts/audio-evidence.py','manual_actual_evidence');human=load(MAIN/'scripts/audio-human-review.py','manual_actual_human')

def comparison(spoken,recognized,source_text):
 eq=spoken==recognized and bool(recognized.strip())
 return dict(ruleVersion='strict-audio-equivalence-1',equivalent=eq,expectedSpoken=spoken,recognized=recognized,language='ja',reasons=['fixture-exact' if eq else 'fixture-mismatch'],proofExpected=spoken if eq else None,proofRecognized=spoken if eq else None,provenance=dict(sourceTextSha256=p.sha(source_text),ruleFileSha256='1'*64,normalizerFileSha256='1'*64,comparison='manual-kana-asr-only-1',normalizer='manual-kana-asr-only-1',phonemeOverride=True,articlePolicyEnabled=False),readingTrace={'expected':[],'recognized':[]})

def media_bytes(tag):
 def atom(name,data):return struct.pack('>I',8+len(data))+name.encode()+data
 movie=bytearray(20);struct.pack_into('>II',movie,12,1000,1000)
 sample=bytearray(28);struct.pack_into('>H',sample,16,1);struct.pack_into('>I',sample,24,24000*65536)
 return atom('ftyp',b'M4A ')+atom('moov',atom('mvhd',movie)+atom('stsd',bytes(8)+atom('mp4a',sample)))+atom('mdat',tag.encode())

class Publication(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);b=Path(self.tmp.name);self.root=b/'repo';self.render=b/'render';self.work=b/'work';self.work.mkdir();self.out=self.root/'data/audio';self.out.mkdir(parents=True)
  self.gen=dict(recipe='fixture',modelSha256='3'*64,voicesSha256='4'*64,packages={'test':'only'},encoding={'codec':'aac'})
  self.g=dict(model=p.MODEL,modelSha256=p.MODEL_SHA,device='cpu',computeType='int8',beamSize=5,conditionOnPreviousText=False,prompt=None,vadFilter=False,packages={'fixture':'1'})
  self.units=[dict(language='ja',bank='grammar',key='j-one/sentence/0',text='荷物を受け取ります。',voiceId='jf_alpha',required=True),dict(language='ja',bank='grammar',key='j-two/sentence/0',text='箱が空です。',voiceId='jf_alpha',required=True),dict(language='en',bank='grammar',key='g/sentence/0',text='She signed it.',voiceId='af_heart',required=True)]
  self.readings={p.token(self.units[0]):'にもつを — うけとります。',p.token(self.units[1]):'はこが からです。'};self.readings_path=b/'readings.json';self.write(self.readings_path,self.readings)
  self.renderer_path=b/'fake-renderer.py';self.renderer_path.write_text('# deterministic fixture; no model\n')
  self.renderer=types.SimpleNamespace(__file__=str(self.renderer_path),render_phones=lambda text:'fixture phones '+text)
  self.bank=types.SimpleNamespace(input_payload=self.payload,input_fingerprint=lambda g,u,o:(o['spoken'],p.sha(json.dumps(self.payload(g,u,o)[1],sort_keys=True))),evidence=evidence,human_review=human,valid_system_fallback=lambda u,f,row,r:f['auditedSha256']==row['repair']['candidate']['clip']['sha256'] and r==row['repair']['candidate']['asr'],valid_published_asr=self.actual)
  self.quality={'version':1,'records':{},'stages':{'earlier':{'immutable':True}}};self.packs={('ja','grammar'):{'version':1,'language':'ja','bank':'grammar','clips':{},'fallbacks':{}},('en','grammar'):{'version':1,'language':'en','bank':'grammar','clips':{}}};self.audits={('ja','grammar'):{'records':{}},('en','grammar'):{'records':{}}}
  for i,u in enumerate(self.units):
   t=p.token(u);pair=(u['language'],u['bank'])
   old=self.old_version(u,'old-'+str(i));initial=self.old_version(u,'initial-'+str(i))
   if u['language']=='en':
    old['asr']['status']='matched';old['clip']['asrStatus']='matched';self.packs[pair]['clips'][u['key']]=old['clip'];media=self.root/old['clip']['src'];media.parent.mkdir(parents=True,exist_ok=True);media.write_bytes(media_bytes('old-'+str(i)))
   else:
    fallback=dict(playback='system',language='ja',text=u['text'],voiceId='jf_alpha',reason='unresolved-after-strong-asr-retry',auditedSha256=old['clip']['sha256']);self.packs[pair]['fallbacks'][u['key']]=fallback
    self.quality['records'][t]=dict(token=t,language='ja',bank='grammar',key=u['key'],baseline={'immutable':t},repair=dict(complete=True,disposition='system-fallback',method='fixture original repair',original=initial,candidate=old))
    self.make_render(u,self.readings[t],self.readings[t] if i==0 else '')
   self.audits[pair]['records'][u['key']]=old['asr']
  source=dict(version=1,model='fixture',voices={},units=self.units);self.write(self.out/'source.json',source);sourcehash=p.sha((self.out/'source.json').read_bytes());metas=[]
  for pair,pack in self.packs.items():
   pack['sourceSha256']=sourcehash
   relative=f'data/audio/{pair[0]}/{pair[1]}.json';self.write(self.root/relative,pack);self.write(self.out/'audit'/pair[0]/(pair[1]+'.json'),self.audits[pair]);raw=(self.root/relative).read_bytes();metas.append(dict(language=pair[0],bank=pair[1],src='./'+relative,count=len(pack['clips']),sha256=p.sha(raw),bytes=len(raw)))
  self.write(self.out/'manifest.json',dict(version=1,sourceSha256=sourcehash,generation=self.gen,packs=metas,totals={}))
  self.write(self.out/'human-review.json',{'version':1,'feedback':[],'requests':[],'batches':[]})
  self.write(self.out/'quality-review.json',self.quality);self.write(self.out/'overrides.json',dict(version=1,entries={t:{'spoken':'old reading','phonemes':'old phones'} for t in self.readings}))
  self.delivery=dict(token=p.token(self.units[0]),appliedOverride={'spoken':'old reading','phonemes':'old phones'},sourceBinding={'text':self.units[0]['text'],'language':'ja','voiceId':'jf_alpha'},delivery='regenerated-with-both-ASR-versions',selectedSha256='9'*64)
  self.write(self.out/'normalization-review.json',dict(version=1,confirmedInputCorrections=[self.delivery]));self.write(self.out/'retries.json',{'version':1,'records':{},'archivedCases':[],'fixture':'unchanged historical evidence'})
 def write(self,path,obj):path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(pub.body(obj))
 def payload(self,g,u,o):return o['spoken'],[{k:g[k] for k in ('recipe','modelSha256','voicesSha256','packages')},g['encoding'],u['voiceId'],o['spoken'],o['phonemes']]
 def old_version(self,u,tag):
  payload=media_bytes(tag);digest=p.sha(payload);clip=dict(src=f"./audio/generated/{u['language']}/{u['voiceId']}/{digest[:32]}.m4a",sha256=digest,bytes=len(payload),duration=1.,decodedPeak=.5,language=u['language'],voiceId=u['voiceId'],required=True,text=u['text'],spoken=u['text'],inputSha256='a'*64,phonemeSha256='b'*64,asrStatus='review')
  g={**self.g,'model':'whisper-large-v3-turbo','modelSha256':'e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da'}
  asr=dict(key=u['key'],src=clip['src'],sha256=digest,voiceId=u['voiceId'],expected=u['text'],spoken=u['text'],recognized='actual old fixture transcript',status='review',recognitionMethod='individual-beam5',singleFileVerification=True,recognitionGeneration=g)
  return dict(clip=clip,asr=asr,archive={'published':False,'sha256':digest,'bytes':len(payload),'copyVerified':True})
 def make_render(self,u,spoken,recognized):
  token=p.token(u);payload=media_bytes(token);digest=p.sha(payload);o=dict(spoken=spoken,phonemes=self.renderer.render_phones(spoken),reason='Manually authored kana reading');_,input_sha=self.bank.input_fingerprint(self.gen,u,o)
  c=dict(src='./audio/generated/ja/jf_alpha/'+digest[:32]+'.m4a',sha256=digest,bytes=len(payload),duration=1.,decodedPeak=.5,language='ja',voiceId='jf_alpha',required=True,text=u['text'],spoken=spoken,inputSha256=input_sha,phonemeSha256=p.sha(o['phonemes']),synthesisSpeed=1.,asrStatus='pending')
  media=self.render/c['src'];media.parent.mkdir(parents=True,exist_ok=True);media.write_bytes(payload);self.write(self.render/'clips'/(p.sha(token)+'.json'),dict(token=token,clip=c,override=o))
  fp=p.sha(json.dumps([self.g,digest,'ja'],sort_keys=True));raw=dict(generation=self.g,sha256=digest,fingerprint=fp,recognized=recognized,segments=[dict(start=0.,end=.8,text=recognized)] if recognized else [],elapsedSeconds=.1);self.write(self.render/'asr'/(fp+'.json'),raw)
 def actual(self,u,c,r,rows=None,ids=None):
  return p.valid_record(u,c,r,(rows or {}).get(p.token(u),{}),evidence.valid_asr) if c.get('manualKanaId') or r.get('manualKanaId') else evidence.valid_asr(c,r)
 def run_tool(self,apply=False,hook=None):return pub.publish(self.root,self.render,self.readings_path,self.work,apply,bank=self.bank,compare=comparison,renderer=self.renderer,after_write=hook)
 def snapshot(self):return {str(x.relative_to(self.root)):x.read_bytes() for x in self.root.rglob('*') if x.is_file()}
 def test_preview_is_read_only_and_retains_empty_actual_result(self):
  before=self.snapshot();r=self.run_tool();self.assertEqual(r['total'],2);self.assertEqual((r['matched'],r['failed'],r['empty']),(1,1,1));self.assertEqual(self.snapshot(),before);self.assertFalse((self.work/'tmp').exists())
 def test_apply_idempotent_keeps_english_history_and_failure_system_route(self):
  before=self.snapshot();self.run_tool(True);q=pub.read(self.out/'quality-review.json');report=pub.read(self.out/'manual-kana-review.json');audit=pub.read(self.out/'audit/ja/grammar.json');pack=pub.read(self.out/'ja/grammar.json')
  self.assertEqual((self.root/'data/audio/en/grammar.json').read_bytes(),before['data/audio/en/grammar.json']);self.assertEqual((self.out/'audit/en/grammar.json').read_bytes(),before['data/audio/audit/en/grammar.json']);self.assertEqual((self.out/'retries.json').read_bytes(),before['data/audio/retries.json'])
  for token,row in self.quality['records'].items():self.assertEqual(q['records'][token]['repair'],row['repair']);self.assertEqual(q['records'][token]['baseline'],row['baseline'])
  u=self.units[0];c=pack['clips'][u['key']];a=q['records'][p.token(u)]['manualKanaAttempts'][0];self.assertTrue(p.valid_record(u,c,audit['records'][u['key']],q['records'][p.token(u)],evidence.valid_asr));self.assertEqual(report['failures'][0]['recognized'],'');self.assertEqual(report['failures'][0]['reason'],'no-speech-recognized');self.assertNotIn(self.units[1]['key'],pack['clips'])
  d=pub.read(self.out/'normalization-review.json')['confirmedInputCorrections'][0];self.assertEqual({k:v for k,v in d.items() if k!='manualKanaSupersession'},self.delivery);self.assertTrue(p.valid_supersession(u,c,audit['records'][u['key']],q['records'][p.token(u)],d,evidence.valid_asr));human_doc=pub.read(self.out/'human-review.json');self.assertEqual(human_doc['requests'],[]);self.assertEqual((self.out/'human-review.json').read_bytes(),before['data/audio/human-review.json'])
  self.assertEqual(pub.read(self.out/'manifest.json')['totals']['forcedHumanReviewCount'],0)
  after=self.snapshot();self.assertEqual(self.run_tool(True)['publicWrites'],0);self.assertEqual(self.snapshot(),after)
 def test_after_ledger_interruption_resumes_exactly_without_duplicate_proof(self):
  def hook(path):
   if path.endswith('quality-review.json'):raise RuntimeError('fixture interruption')
  with self.assertRaisesRegex(RuntimeError,'fixture interruption'):self.run_tool(True,hook)
  self.run_tool(True);q=pub.read(self.out/'quality-review.json');self.assertTrue(all(len(r['manualKanaAttempts'])==1 for r in q['records'].values()))
 def test_missing_actual_result_or_changed_reading_refuses_before_writes(self):
  paths=list((self.render/'asr').glob('*.json'));paths[0].unlink();before=self.snapshot()
  with self.assertRaisesRegex(ValueError,'Missing or ambiguous actual'):self.run_tool(True)
  self.assertEqual(self.snapshot(),before)
 def test_actual_empty_transcription_cannot_be_made_matched(self):
  before=self.snapshot()
  def unsafe(spoken,recognized,text):r=comparison(spoken,recognized,text);r['equivalent']=True;r['proofExpected']=r['proofRecognized']='fabricated';return r
  with self.assertRaisesRegex(ValueError,'Empty actual'):
   pub.publish(self.root,self.render,self.readings_path,self.work,True,bank=self.bank,compare=unsafe,renderer=self.renderer)
  self.assertEqual(self.snapshot(),before)
 def test_failed_unrecognized_surface_retains_actual_asr_without_a_reading_trace(self):
  def cautious(spoken,recognized,text):
   r=comparison(spoken,recognized,text)
   if recognized:r.update(equivalent=False,proofExpected=None,proofRecognized=None,reasons=['unreviewed-numeric-symbol']);r.pop('readingTrace',None)
   return r
  result=pub.publish(self.root,self.render,self.readings_path,self.work,True,bank=self.bank,compare=cautious,renderer=self.renderer)
  self.assertEqual((result['matched'],result['failed'],result['empty']),(0,2,1));report=pub.read(self.out/'manual-kana-review.json');self.assertEqual(report['failures'][0]['recognized'],self.readings[p.token(self.units[0])])
 def test_uninstalled_completion_gate_fails_closed(self):
  self.bank.valid_published_asr=lambda *args:True;before=self.snapshot()
  with self.assertRaisesRegex(ValueError,'Install the manual-kana'):self.run_tool(True)
  self.assertEqual(self.snapshot(),before)
 def test_concurrent_change_after_checkpoint_is_not_overwritten(self):
  def hook(path):raise RuntimeError('stop')
  with self.assertRaises(RuntimeError):self.run_tool(True,hook)
  self.write(self.out/'overrides.json',{'another':'author'});before=self.snapshot()
  with self.assertRaisesRegex(ValueError,'Concurrent author'):self.run_tool(True)
  self.assertEqual(self.snapshot(),before)
 def test_interrupted_decision_code_change_refuses_before_any_more_writes(self):
  def hook(path):raise RuntimeError('fixture interruption')
  with self.assertRaises(RuntimeError):self.run_tool(True,hook)
  self.renderer_path.write_text('# changed pronunciation rule; review prepared decisions\n');before=self.snapshot()
  with self.assertRaisesRegex(ValueError,'Input file changed: fake-renderer.py'):self.run_tool(True)
  self.assertEqual(self.snapshot(),before)
 def test_duplicate_manual_reading_key_refuses_without_any_public_write(self):
  token=p.token(self.units[0]);self.readings_path.write_text('{'+json.dumps(token)+':"にもつ",'+json.dumps(token)+':"はこ"}')
  before=self.snapshot()
  with self.assertRaisesRegex(ValueError,'Duplicate JSON key'):self.run_tool(True)
  self.assertEqual(self.snapshot(),before)
 def test_completed_pretty_ledger_migrates_without_changing_evidence_and_is_idempotent(self):
  self.run_tool(True);journal=self.work/'tmp/manual-kana-publication'/(p.sha(self.readings_path.read_bytes())+'.json');tx=pub.read(journal)
  item=next(x for x in tx['writes'] if x['path']=='data/audio/quality-review.json');item.pop('compact',None);item['afterSha256']=p.sha(pub.body(item['json']));self.write(self.out/'quality-review.json',item['json']);self.write(journal,tx)
  before=pub.read(self.out/'quality-review.json');self.assertEqual(self.run_tool(True)['publicWrites'],1);self.assertEqual(pub.read(self.out/'quality-review.json'),before);self.assertEqual((self.out/'quality-review.json').read_bytes(),pub.body(before,compact=True));self.assertEqual(self.run_tool(True)['publicWrites'],0)
 def test_author_lock_blocks_all_writes(self):
  before=self.snapshot()
  with (self.work/'bank-audit.lock').open('a') as f:
   fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
   with self.assertRaises(BlockingIOError):self.run_tool(True)
  self.assertEqual(self.snapshot(),before)
 def test_proof_rejects_model_prompt_source_and_current_tampering(self):
  self.run_tool(True);q=pub.read(self.out/'quality-review.json');pack=pub.read(self.out/'ja/grammar.json');audit=pub.read(self.out/'audit/ja/grammar.json');u=self.units[0];row=q['records'][p.token(u)];c=pack['clips'][u['key']];r=audit['records'][u['key']]
  for target,value in [('model','whisper-small'),('prompt','expected text'),('beamSize',1)]:
   bad=copy.deepcopy(row);a=bad['manualKanaAttempts'][0];a['rawASR']['generation'][target]=value;a['proofCanonical']=p.canonical({k:v for k,v in a.items() if k not in ('id','archive','proofCanonical')});a['id']=p.sha(a['proofCanonical']);cc={**c,'manualKanaId':a['id']};rr={**r,'manualKanaId':a['id']};self.assertFalse(p.valid_record(u,cc,rr,bad,evidence.valid_asr))
  self.assertFalse(p.valid_record({**u,'text':'Changed'},c,r,row,evidence.valid_asr));self.assertFalse(p.valid_record(u,c,{**r,'recognized':'fabricated'},row,evidence.valid_asr))

if __name__=='__main__':unittest.main()
