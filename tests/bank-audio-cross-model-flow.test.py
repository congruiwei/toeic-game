"""Real CLI + disposable files and a fake ASR class; never runs a model."""
import contextlib,copy,importlib.util,io,json,sys,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path.cwd();HERE=Path(__file__).resolve().parent
def load(name,p):
 s=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
pure=load('cross_pure_fixture',HERE/'bank-audio-cross-model.test.py');runner=load('cross_runner',HERE.parent/'scripts/crosscheck-final-english.py')
class Flow(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);base=Path(self.temp.name);self.root=base/'repo';self.work=base/'work';self.out=base/'report';self.work.mkdir();self.pub=self.root/'data/audio';self.calls=[];self.busy=False
  data=b'fake m4a bytes only for isolated tests';digest=runner.sha(data);units=[];clips={};records={};rows={}
  for i in range(51):
   u,c,a,row,_=pure.fixture();u['key']=f'g{i}/sentence/0';c.update(u);c.update(sha256=digest,bytes=len(data));a.update(key=u['key'],sha256=digest);a['comparison']['audioSha256']=digest;a['fingerprint']=runner.proof.fingerprint(a['recognitionGeneration'],c);row['repair']['candidate']={'clip':copy.deepcopy(c),'asr':copy.deepcopy(a)}
   units.append(u);clips[u['key']]=c;records[u['key']]=a;rows[runner.proof.token(u)]=row
  self.write(self.pub/'source.json',{'units':units});self.write(self.pub/'en/grammar.json',{'clips':clips});self.write(self.pub/'audit/en/grammar.json',{'records':records});self.write(self.pub/'quality-review.json',{'records':rows})
  media=self.root/c['src'];media.parent.mkdir(parents=True);media.write_bytes(data)
  for filename in ['bank-strong-repair-supervisor.json','bank-strong-repair-round2.json']:
   self.write(self.work/filename,{'state':'complete','phases':{lang:{'state':'complete','counts':{'expected':24 if lang=='en' else 956,'complete':24 if lang=='en' else 956,'errors':[],'pending':[]}} for lang in ['en','ja']}})
  model=b'fake model bytes, no inference';modeldir=self.work/'models'/runner.proof.MODEL;modeldir.mkdir(parents=True);(modeldir/'model.bin').write_bytes(model)
  modelsha=runner.sha(model);self.shapatch=patch.object(runner.proof,'MODEL_SHA',modelsha);self.shapatch.start();self.addCleanup(self.shapatch.stop)
  self.write(modeldir/'official-download-verification.json',{'repo':runner.proof.REPOSITORY,'revision':runner.proof.REVISION,'complete':True,'files':[{'name':'model.bin','bytes':len(model),'sha256':modelsha}]})
  self.original_load=runner.load;self.bank=types.SimpleNamespace(normalize=pure.normalize)
  def custom(name,path):
   if name=='cross_evidence':return pure.ev
   if name=='cross_retry':return types.SimpleNamespace(running=lambda work:['audit'] if self.busy else [],bank=self.bank)
   if name=='cross_comparison':return pure.cmp
   return self.original_load(name,path)
  self.lp=patch.object(runner,'load',side_effect=custom);self.lp.start();self.addCleanup(self.lp.stop)
  owner=self
  class FakeModel:
   def __init__(self,*args,**kwargs):owner.calls.append(('model',args,kwargs))
   def transcribe(self,path,**kwargs):
    owner.calls.append(('transcribe',path,kwargs));return iter([types.SimpleNamespace(start=0.,end=2.,text='The staff signed the report.',avg_logprob=-.1,no_speech_prob=.01)]),types.SimpleNamespace(duration=2.)
  fw=types.ModuleType('faster_whisper');fw.WhisperModel=FakeModel;self.mp=patch.dict(sys.modules,{'faster_whisper':fw});self.mp.start();self.addCleanup(self.mp.stop)
 def write(self,path,value):path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value))
 def snapshot(self):return {str(p.relative_to(self.root)):p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
 def call(self,*extra):
  argv=['cross','--repo',str(self.root),'--workdir',str(self.work),'--out',str(self.out),*extra]
  with patch.object(sys,'argv',argv),contextlib.redirect_stdout(io.StringIO()):runner.main()
 def prepare(self):self.call();return str(self.out/'plan.json')
 def test_prepare_does_not_load_model_or_write_public_data(self):
  before=self.snapshot();self.prepare();self.assertEqual(self.calls,[]);self.assertEqual(self.snapshot(),before)
 def test_real_run_and_cached_resume_keep_all_turbo_and_public_files(self):
  plan=self.prepare();before=self.snapshot();self.call('--run','--plan',plan);r=json.loads((self.out/'report.json').read_text());self.assertTrue(r['complete']);self.assertEqual(r['accepted'],51);self.assertEqual(self.snapshot(),before)
  self.assertEqual(len([x for x in self.calls if x[0]=='transcribe']),1);opts=next(x[2] for x in self.calls if x[0]=='transcribe');self.assertIsNone(opts['initial_prompt']);self.assertIsNone(opts['hotwords']);self.assertEqual(opts['beam_size'],5)
  self.calls=[];self.call('--run','--finish-only','--plan',plan);self.assertEqual(self.calls,[]);self.assertEqual(json.loads((self.out/'report.json').read_text()),r);self.assertEqual(self.snapshot(),before)
 def test_active_author_refuses_before_loading(self):
  plan=self.prepare();self.busy=True
  with self.assertRaisesRegex(ValueError,'existing authors'):self.call('--run','--plan',plan)
  self.assertEqual(self.calls,[])
 def test_incomplete_ja_refuses_before_loading(self):
  plan=self.prepare();self.write(self.work/'bank-strong-repair-supervisor.json',{'state':'running','phases':{'en':{'state':'complete'},'ja':{'state':'running'}}})
  with self.assertRaisesRegex(ValueError,'completed EN and JA'):self.call('--run','--plan',plan)
  self.assertEqual(self.calls,[])
 def test_stale_plan_refuses_before_loading(self):
  plan=Path(self.prepare());v=json.loads(plan.read_text());v['entries'][0]['audioSha256']='0'*64;self.write(plan,v)
  with self.assertRaisesRegex(ValueError,'Final source/media'):self.call('--run','--plan',str(plan))
  self.assertEqual(self.calls,[])
 def test_missing_round_two_refuses_before_loading(self):
  plan=self.prepare();(self.work/'bank-strong-repair-round2.json').unlink()
  with self.assertRaisesRegex(ValueError,'including round two'):self.call('--run','--plan',plan)
  self.assertEqual(self.calls,[])
 def test_no_inference_at_or_below_target(self):
  s=json.loads((self.pub/'source.json').read_text());s['units']=s['units'][:50];self.write(self.pub/'source.json',s);plan=self.prepare()
  with self.assertRaisesRegex(ValueError,'above 50'):self.call('--run','--plan',plan)
  self.assertEqual(self.calls,[])
if __name__=='__main__':unittest.main(verbosity=2)
