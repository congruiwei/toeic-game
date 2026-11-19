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
 def test_node_round_trip_preserves_signed_numeric_evidence_and_pending_recovers(self):
  # Archive/queue tooling writes JSON in Node: 0.0 becomes 0 while the signed
  # canonical strings remain byte-for-byte unchanged. Use actual Node here.
  for name in ['quality-review.json','normalization-review.json','ja/grammar.json','audit/ja/grammar.json']:
   path=self.out/name
   subprocess.run(['node','-e',"const fs=require('fs'),p=process.argv[1];fs.writeFileSync(p,JSON.stringify(JSON.parse(fs.readFileSync(p,'utf8'))));",str(path)],check=True)
  u,row,c,r=self.selected();self.assertTrue(self.bank.valid_published_asr(u,c,r,{pure.p.token(u):row},set()))
  delivery=self.data('normalization-review.json')['confirmedInputCorrections'][0]
  self.assertTrue(self.bank._manual_kana_checks.valid_supersession(u,c,r,row,delivery,pure.evidence.valid_asr))
  packs={(lang,'grammar'):self.data(f'{lang}/grammar.json') for lang in ['en','ja']};packs[('ja','grammar')]['clips'][u['key']]['asrStatus']='pending'
  self.bank.flush(self.data('source.json'),self.data('manifest.json')['sourceSha256'],self.f.gen,packs)
  self.assertEqual(self.data('ja/grammar.json')['clips'][u['key']]['asrStatus'],'matched')
  self.assertEqual(self.data('manifest.json')['totals']['requiredAudited'],2)
  for mutation in ['number','boolean','hash','history']:
   bad=copy.deepcopy(row);a=bad['manualKanaAttempts'][0]
   if mutation=='number':a['rawASR']['segments'][0]['start']=.01
   elif mutation=='boolean':a['rawASR']['segments'][0]['start']=False
   elif mutation=='hash':a['proofCanonical']+=' '
   else:bad['repair']['candidate']['asr']['recognized']='changed historical transcript'
   self.assertFalse(self.bank.valid_published_asr(u,c,r,{pure.p.token(u):bad},set()),mutation)
 def test_full_node_validator_accepts_bound_delivery_and_refuses_lost_report(self):
  script="const m=await import(process.argv[1]);const r=await m.validateAudio({root:process.argv[2]});console.log(JSON.stringify(r));process.exitCode=r.ok?0:1"
  def run():
   r=subprocess.run(['node','--input-type=module','-e',script,(self.root/'scripts/validate-bank-audio.mjs').as_uri(),str(self.root)],capture_output=True,text=True,check=False)
   return r,json.loads(r.stdout) if r.stdout.strip() else {}
  r,report=run();self.assertEqual(r.returncode,0,r.stderr+'\n'+r.stdout);self.assertEqual(report['systemFallbackCount'],1);self.assertEqual(report['forcedHumanReviewCount'],0);self.assertEqual(report['pendingInputCorrections'],[])
  (self.out/'manual-kana-review.json').unlink();r,report=run();self.assertNotEqual(r.returncode,0);self.assertIn('Missing manual kana report',report['errors'])
 def test_new_source_preserves_historical_report_fingerprint_but_not_changed_old_source(self):
  old_report=(self.out/'manual-kana-review.json').read_bytes();old_quality=(self.out/'quality-review.json').read_bytes()
  source=self.data('source.json');source['units'].append(dict(language='en',bank='grammar',key='new/optional',text='New optional sentence.',voiceId='af_heart',kind='sentence',required=False))
  self.f.write(self.out/'source.json',source);digest=pure.p.sha((self.out/'source.json').read_bytes())
  packs={(lang,'grammar'):self.data(f'{lang}/grammar.json') for lang in ['en','ja']}
  self.bank.flush(source,digest,{**self.f.gen,'sourceSha256':digest},packs)
  script="const {validateAudio}=await import(process.argv[1]);const r=await validateAudio({root:process.argv[2]});console.log(JSON.stringify(r));process.exitCode=r.ok?0:1"
  def run():
   p=subprocess.run(['node','--input-type=module','-e',script,(self.root/'scripts/validate-bank-audio.mjs').as_uri(),str(self.root)],capture_output=True,text=True);return p,json.loads(p.stdout)
  result,report=run();self.assertEqual(result.returncode,0,result.stderr+'\n'+result.stdout)
  self.assertEqual((self.out/'manual-kana-review.json').read_bytes(),old_report);self.assertEqual((self.out/'quality-review.json').read_bytes(),old_quality)
  broken=self.data('manual-kana-review.json');broken['sourceSha256']='f'*64;self.f.write(self.out/'manual-kana-review.json',broken)
  result,report=run();self.assertNotEqual(result.returncode,0);self.assertIn('Manual kana report source fingerprint mismatch',report['errors'])
  (self.out/'manual-kana-review.json').write_bytes(old_report)
  broken_quality=self.data('quality-review.json');broken_quality['baselineSourceSha256']='e'*64;self.f.write(self.out/'quality-review.json',broken_quality)
  result,report=run();self.assertNotEqual(result.returncode,0);self.assertIn('Manual kana report source fingerprint mismatch',report['errors'])
  (self.out/'quality-review.json').write_bytes(old_quality)
  source['units'][0]['text']='Changed old Japanese source.';self.f.write(self.out/'source.json',source)
  result,report=run();self.assertNotEqual(result.returncode,0);self.assertTrue(any('manual' in error.lower() for error in report['errors']))
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
