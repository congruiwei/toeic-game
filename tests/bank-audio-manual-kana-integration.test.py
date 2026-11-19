"""Actual generator/auditor/Node gates over isolated kana publication fixtures."""
import contextlib,copy,importlib.util,io,json,os,shutil,subprocess,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import MagicMock,patch
ROOT=Path(os.environ.get('TOEIC_TEST_REPO',Path.cwd()))
BASE=Path(__file__).resolve().parents[1]
def load(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
pure=load('manual_integration_fixture',BASE/'tests/bank-audio-manual-kana.test.py')
class Integration(unittest.TestCase):
 def setUp(self):
  self.f=pure.Publication();self.f.setUp();self.addCleanup(self.f.doCleanups)
  self.f.run_tool(True);self.root=self.f.root;self.out=self.f.out
  # Copy only code into an isolated tree; the real models/data are never used.
  shutil.copytree(ROOT/'scripts',self.root/'scripts',dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__'))
  shutil.copytree(ROOT/'js',self.root/'js',dirs_exist_ok=True)
  for src in (BASE/'scripts').iterdir():
   if src.suffix in ('.py','.mjs'):shutil.copy2(src,self.root/'scripts'/src.name)
  self.bank=load('manual_integration_bank',self.root/'scripts/generate-bank-audio.py')
  self.audit=load('manual_integration_audit',self.root/'scripts/audit-bank-audio.py')
  for bank in ['part1','part2','listening','vocab','reading','grammar','methods']:
   self.f.write(self.root/'data'/f'{bank}.json',[]);self.f.write(self.root/'data/i18n/ja'/f'{bank}.json',{'version':1,'entries':{}})
  self.f.write(self.root/'data/i18n/ja/terms.json',{'version':1,'entries':{}})
 def data(self,name):return pure.pub.read(self.out/name)
 def selected(self):
  u=self.f.units[0];row=self.data('quality-review.json')['records'][pure.p.token(u)];c=self.data('ja/grammar.json')['clips'][u['key']];r=self.data('audit/ja/grammar.json')['records'][u['key']];return u,row,c,r
 def test_actual_flush_and_missing_manual_proof_fail_closed(self):
  u,row,c,r=self.selected();self.assertTrue(self.bank.valid_published_asr(u,c,r,{pure.p.token(u):row},set()));self.assertFalse(self.bank.valid_published_asr(u,c,r,{},set()))
  stripped_c={k:v for k,v in c.items() if k!='manualKanaId'};stripped_r={k:v for k,v in r.items() if k!='manualKanaId'};self.assertFalse(self.bank.valid_published_asr(u,stripped_c,stripped_r,{},set()))
  packs={(lang,'grammar'):self.data(f'{lang}/grammar.json') for lang in ['en','ja']};source=self.data('source.json')
  self.bank.flush(source,self.data('manifest.json')['sourceSha256'],self.f.gen,packs)
  result=self.data('manifest.json');self.assertEqual(result['totals']['requiredAudited'],2);self.assertTrue(result['requiredPlaybackComplete']);self.assertEqual(result['totals']['forcedHumanReviewCount'],0)
  q=self.data('quality-review.json');q['records'][pure.p.token(u)]['manualKanaAttempts']=[];self.f.write(self.out/'quality-review.json',q)
  self.bank.flush(source,result['sourceSha256'],self.f.gen,packs);self.assertEqual(self.data('manifest.json')['totals']['requiredAudited'],1);self.assertEqual(self.data('ja/grammar.json')['clips'][u['key']]['asrStatus'],'pending')
 def test_default_auditor_does_not_replace_manual_full_asr_or_failed_evidence(self):
  work=self.f.work;model=work/'models/whisper-small/model.bin';model.parent.mkdir(parents=True);model.write_bytes(b'fixture; model constructor mocked')
  before=self.data('audit/ja/grammar.json')['records'];fake=MagicMock()
  with patch.object(self.audit,'WhisperModel',return_value=fake),patch.object(sys,'argv',['audit','--workdir',str(work),'--language','ja','--individual-only']),contextlib.redirect_stdout(io.StringIO()):self.audit.main()
  fake.transcribe.assert_not_called();self.assertEqual(self.data('audit/ja/grammar.json')['records'],before);self.assertEqual(self.data('audit-summary.json')['singleCallsThisRun'],0)
 def test_full_node_validator_accepts_bound_delivery_and_refuses_lost_report(self):
  script="const m=await import(process.argv[1]);const r=await m.validateAudio({root:process.argv[2]});console.log(JSON.stringify(r));process.exitCode=r.ok?0:1"
  def run():
   r=subprocess.run(['node','--input-type=module','-e',script,(self.root/'scripts/validate-bank-audio.mjs').as_uri(),str(self.root)],capture_output=True,text=True,check=False)
   return r,json.loads(r.stdout) if r.stdout.strip() else {}
  r,report=run();self.assertEqual(r.returncode,0,r.stderr+'\n'+r.stdout);self.assertEqual(report['systemFallbackCount'],1);self.assertEqual(report['forcedHumanReviewCount'],0);self.assertEqual(report['pendingInputCorrections'],[])
  (self.out/'manual-kana-review.json').unlink();r,report=run();self.assertNotEqual(r.returncode,0);self.assertIn('Missing manual kana report',report['errors'])
 def test_verified_archive_and_public_clone_need_no_external_manual_history(self):
  fresh=pure.Publication();fresh.setUp();self.addCleanup(fresh.doCleanups)
  shutil.copytree(self.root/'scripts',fresh.root/'scripts',dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__'))
  shutil.copytree(self.root/'js',fresh.root/'js',dirs_exist_ok=True)
  bank=load('manual_archive_bank',fresh.root/'scripts/generate-bank-audio.py')
  for name in ['kokoro-v1.0.onnx','voices-v1.0.bin']:
   target=fresh.work/'models'/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(b'fixture; sync does not load a model')
  venv=Path(sys.executable).resolve().parent.parent
  # Use the invoked venv path rather than its resolved system Python binary.
  venv=Path(sys.executable).parent.parent
  (fresh.work/'venv').symlink_to(venv,target_is_directory=True)
  index=pure.pub.read(fresh.out/'manifest.json')
  generation={**index['generation'],'recipe':bank.codec.RECIPE,'encoding':bank.codec.ENCODING,'modelSha256':pure.p.sha((fresh.work/'models/kokoro-v1.0.onnx').read_bytes()),'voicesSha256':pure.p.sha((fresh.work/'models/voices-v1.0.bin').read_bytes()),'packages':{n:bank.importlib.metadata.version(n) for n in ['kokoro-onnx','misaki','onnxruntime','soundfile','numpy']}}
  fresh.gen=generation;index['generation']=generation
  for u in fresh.units[:2]:fresh.make_render(u,fresh.readings[pure.p.token(u)],fresh.readings[pure.p.token(u)] if u==fresh.units[0] else '')
  en=fresh.units[2];pack=pure.pub.read(fresh.out/'en/grammar.json');pack['clips'][en['key']]['inputSha256']=bank.input_fingerprint(generation,en,{})[1];fresh.write(fresh.out/'en/grammar.json',pack)
  for meta in index['packs']:
   raw=(fresh.root/meta['src']).read_bytes();meta['bytes']=len(raw);meta['sha256']=pure.p.sha(raw)
  fresh.write(fresh.out/'manifest.json',index)
  for name in ['part1','part2','listening','vocab','reading','grammar','methods']:
   fresh.write(fresh.root/'data'/f'{name}.json',[]);fresh.write(fresh.root/'data/i18n/ja'/f'{name}.json',{'version':1,'entries':{}})
  fresh.write(fresh.root/'data/i18n/ja/terms.json',{'version':1,'entries':{}})
  archived=[]
  for row in fresh.quality['records'].values():
   for version in [row['repair']['original'],row['repair']['candidate']]:
    c=version['clip'];archived.append({'formerSrc':c['src'],**version['archive']})
  fresh.write(fresh.out/'archive.json',{'version':1,'files':archived})
  fresh.run_tool(True)
  before_human=(fresh.out/'human-review.json').read_bytes();before_rows=pure.pub.read(fresh.out/'quality-review.json')['records']
  r=subprocess.run(['node','scripts/archive-bank-audio-history.mjs','--apply'],cwd=fresh.root,env={**os.environ,'TOEIC_TTS_DIR':str(fresh.work)},capture_output=True,text=True)
  self.assertEqual(r.returncode,0,r.stderr+'\n'+r.stdout);self.assertEqual((fresh.out/'human-review.json').read_bytes(),before_human);self.assertEqual(pure.pub.read(fresh.out/'quality-review.json')['records'],before_rows)
  clone=fresh.root.parent/'public-clone';shutil.copytree(fresh.root,clone);shutil.rmtree(fresh.work)
  r=subprocess.run(['node','scripts/validate-bank-audio.mjs'],cwd=clone,capture_output=True,text=True);self.assertEqual(r.returncode,0,r.stderr+'\n'+r.stdout)
  report=json.loads(r.stdout);self.assertTrue(report['ok']);self.assertEqual(report['systemFallbackCount'],1);self.assertEqual(report['forcedHumanReviewCount'],0)

if __name__=='__main__':unittest.main()
