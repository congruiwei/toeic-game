"""Real CLI orchestration against disposable files + fake worker/decoder only."""
import contextlib,copy,importlib.util,io,json,sys,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('pure_context_tests',HERE/'bank-audio-context.test.py');pure=importlib.util.module_from_spec(spec);spec.loader.exec_module(pure)
probe,cmp,evidence=pure.probe,pure.cmp,pure.evidence
class FlowTest(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);base=Path(self.tmp.name).resolve();self.root=base/'repo';self.work=base/'work';self.out=self.root/'data/audio';self.out.mkdir(parents=True);self.work.mkdir()
  self.model_bytes=b'not a model; fixture only';self.modelsha=probe.sha(self.model_bytes)
  self.shaPatch=patch.object(probe,'MODEL_SHA',self.modelsha);self.shaPatch.start();self.addCleanup(self.shaPatch.stop)
  self.f=pure.fixture();u,c,o,carrier,meta,result,source,carrier_pcm,whole=self.f
  data=b'fake original media bytes';c['sha256']=probe.sha(data);c['bytes']=len(data);o['sha256']=c['sha256']
  path=self.root/c['src'];path.parent.mkdir(parents=True);path.write_bytes(data)
  self.source={'model':'fixture','voices':{'en':['af_heart']},'units':[u,dict(u,bank='listening',key='p3-unrelated/turns/0/0',text='An unrelated whole sentence.')]}
  self.write(self.out/'source.json',self.source);self.write(self.root/'data/part2.json',[])
  self.write(self.out/'en/vocab.json',{'version':1,'language':'en','bank':'vocab','clips':{u['key']:c}})
  self.write(self.out/'en/listening.json',{'version':1,'language':'en','bank':'listening','clips':{'keep':{'sentinel':'unrelated clip'}}})
  self.write(self.out/'audit/en/vocab.json',{'records':{u['key']:o}});self.write(self.out/'audit/en/listening.json',{'records':{'keep':{'sentinel':'unrelated audit'}}})
  self.write(self.out/'quality-review.json',{'stages':{'strongerASR':{'complete':True}},'records':{probe.token(u):{'baseline':{'preserved':True},'comparison':{'preserved':True}}}})
  self.write(self.out/'manifest.json',{'generation':{'fixture':True}})
  self.plan=self.root/'plan.json';self.write(self.plan,{'sourceSha256':probe.sha((self.out/'source.json').read_bytes()),'tokens':[probe.token(u)]})
  folder=self.work/'tmp/context-probes';folder.mkdir(parents=True);(folder/'carrier.wav').write_bytes(b'carrier fixture')
  carrier['audioSha256']=probe.sha((folder/'carrier.wav').read_bytes());self.write(folder/'carrier.json',carrier)
  modeldir=self.work/'models'/probe.MODEL;modeldir.mkdir(parents=True);(modeldir/'model.bin').write_bytes(self.model_bytes)
  self.calls=[];self.flushes=[];self.interrupt=False
  def atomic(path,value):
   if self.interrupt and path==self.out/'audit/en/vocab.json':self.interrupt=False;raise RuntimeError('Injected interruption after public ledger checkpoint')
   self.write(path,value)
  def flush(source,sourcehash,generation,packs):
   self.assertEqual(set(packs),{('en','vocab'),('en','listening')});self.assertEqual(packs[('en','listening')]['clips'],{'keep':{'sentinel':'unrelated clip'}});self.flushes.append(copy.deepcopy(packs))
   for pair,pack in packs.items():
    a=self.read(self.out/'audit'/pair[0]/(pair[1]+'.json'),{})
    for key,clip in pack['clips'].items():
     if key in a.get('records',{}) and 'status' in a['records'][key]:clip['asrStatus']=a['records'][key]['status']
    self.write(self.out/pair[0]/(pair[1]+'.json'),pack)
  self.bank=types.SimpleNamespace(read=self.read,atomic=atomic,normalize=pure.normalizer,flush=flush)
  modules={'context_bank':self.bank,'context_evidence':evidence,'context_comparison':cmp,'context_retry':types.SimpleNamespace(running=lambda work:False)}
  self.loadpatch=patch.object(probe,'load',side_effect=lambda name,path:modules[name]);self.loadpatch.start();self.addCleanup(self.loadpatch.stop)
  owner=self
  class FakeModel:
   def __init__(self,*args,**kwargs):owner.calls.append(('construct',args,kwargs))
   def transcribe(self,wave,**options):
    owner.calls.append(('transcribe',wave.copy(),options));r=owner.f[5]
    ws=[types.SimpleNamespace(**dict(w,probability=.9)) for w in r['words']]
    return iter([types.SimpleNamespace(start=0.,end=1.7,text=r['recognized'],avg_logprob=-.1,no_speech_prob=.01,words=ws)]),None
  fw=types.ModuleType('faster_whisper');fw.WhisperModel=FakeModel
  fa=types.ModuleType('faster_whisper.audio');fa.decode_audio=lambda path,sampling_rate:carrier_pcm.copy() if Path(path).name=='carrier.wav' else source.copy()
  self.modpatch=patch.dict(sys.modules,{'faster_whisper':fw,'faster_whisper.audio':fa});self.modpatch.start();self.addCleanup(self.modpatch.stop)
 def write(self,path,value):path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value))
 def read(self,path,default):return json.loads(path.read_text()) if path.exists() else default
 def run_cli(self,*extra):
  with patch.object(sys,'argv',['context-probe','--repo',str(self.root),'--workdir',str(self.work),'--plan',str(self.plan),*extra]),contextlib.redirect_stdout(io.StringIO()) as output:probe.main()
  return json.loads(output.getvalue())
 def test_dry_run_does_not_decode_synthesize_load_model_or_mutate(self):
  before={p.relative_to(self.root):p.read_bytes() for p in self.root.rglob('*') if p.is_file()};r=self.run_cli();self.assertTrue(r['dryRun']);self.assertEqual(r['eligiblePending'],1);self.assertEqual(self.calls,[])
  after={p.relative_to(self.root):p.read_bytes() for p in self.root.rglob('*') if p.is_file()};self.assertEqual(after,before)
 def test_real_main_publish_preserves_source_other_banks_and_is_idempotent(self):
  source_bytes=(self.out/'source.json').read_bytes();media=(self.root/self.f[1]['src']).read_bytes()
  self.run_cli('--apply');self.assertEqual(len([x for x in self.calls if x[0]=='transcribe']),1)
  a=self.read(self.out/'audit/en/vocab.json',{})['records'][self.f[0]['key']];row=self.read(self.out/'quality-review.json',{})['records'][probe.token(self.f[0])]
  self.assertTrue(probe.valid_context_record(self.f[0],self.f[1],a,row,cmp,pure.normalizer,evidence));self.assertEqual(a['recognized'],self.f[2]['recognized']);self.assertEqual(row['baseline'],{'preserved':True})
  self.run_cli('--apply','--finish-only');self.assertEqual(len([x for x in self.calls if x[0]=='transcribe']),1);self.assertEqual(len(self.flushes),2)
  self.assertEqual((self.out/'source.json').read_bytes(),source_bytes);self.assertEqual((self.root/self.f[1]['src']).read_bytes(),media)
  self.assertFalse(list(self.root.rglob('*.wav')));self.assertTrue(list((self.work/'tmp/context-probes').rglob('probe.wav')))
 def test_ledger_before_audit_interruption_resumes_cached_actual_result(self):
  self.interrupt=True
  with self.assertRaisesRegex(RuntimeError,'Injected interruption'):self.run_cli('--apply')
  row=self.read(self.out/'quality-review.json',{})['records'][probe.token(self.f[0])];self.assertEqual(len(row['contextProbes']),1)
  self.assertEqual(self.read(self.out/'audit/en/vocab.json',{})['records'][self.f[0]['key']]['status'],'review')
  self.run_cli('--apply','--finish-only');self.assertEqual(len([x for x in self.calls if x[0]=='transcribe']),1)
  row=self.read(self.out/'quality-review.json',{})['records'][probe.token(self.f[0])];self.assertEqual(len(row['contextProbes']),1)
 def test_finish_only_without_actual_result_refuses_and_starts_no_model(self):
  with self.assertRaisesRegex(ValueError,'ASR is not ready'):self.run_cli('--apply','--finish-only')
  self.assertEqual(self.calls,[]);self.assertEqual(self.read(self.out/'audit/en/vocab.json',{})['records'][self.f[0]['key']]['status'],'review')
 def test_missing_source_or_wrong_strong_model_refuses(self):
  self.write(self.plan,{'sourceSha256':'0'*64,'tokens':[probe.token(self.f[0])]})
  with self.assertRaisesRegex(ValueError,'Plan source changed'):self.run_cli('--apply')
  self.assertEqual(self.calls,[])

if __name__=='__main__':unittest.main(verbosity=2)
