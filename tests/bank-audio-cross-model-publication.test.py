"""Isolated publication, interruption and real completion-gate regressions."""
import contextlib,copy,importlib.util,io,json,shutil,sys,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch,MagicMock
ROOT=Path.cwd();HERE=Path(__file__).resolve().parent

def load(name,p):
 s=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
pure=load('publish_pure',HERE/'bank-audio-cross-model.test.py');pub=load('publisher',HERE.parent/'scripts/publish-cross-model.py')

class Publish(unittest.TestCase):
 def setUp(self):
  # Preserve strict whole-tree snapshots without interpreter cache writes.
  bytecode=patch.object(sys,'dont_write_bytecode',True);bytecode.start();self.addCleanup(bytecode.stop)
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);base=Path(self.temp.name).resolve();self.root=base/'repo';self.work=base/'work';self.work.mkdir();self.out=self.root/'data/audio';self.out.mkdir(parents=True);scripts=self.root/'scripts';scripts.mkdir();self.interrupt=False;self.flushes=0
  for name in ['audio-compare.py','audio-evidence.py','audio-voice-override.py','audio-human-review.py','generate-audition.py']:
   shutil.copy(ROOT/'scripts'/name,scripts/name)
  for name in ['audio-cross-model.py']:
   shutil.copy(HERE.parent/'scripts'/name,scripts/name)
  shutil.copy(ROOT/'scripts/generate-bank-audio.py',scripts/'generate-bank-audio.py')
  self.bank=load('integration_full_bank',scripts/'generate-bank-audio.py')
  u,c,o,row,f=pure.fixture();data=b'fixture media; no real codec/model';c.update(sha256=pure.m.sha(data),bytes=len(data))
  path=self.root/c['src'];path.parent.mkdir(parents=True);path.write_bytes(data)
  for a in [o,f]:a['sha256']=c['sha256'];a['comparison']['audioSha256']=c['sha256'];a['fingerprint']=pure.m.fingerprint(a['recognitionGeneration'],c)
  row['repair']['candidate']={'clip':copy.deepcopy(c),'asr':copy.deepcopy(o)}
  self.u,self.c,self.o,self.row,self.f=u,c,o,row,f;self.t=pub.proof.token(u)
  self.source={'model':'fixture','voices':{},'units':[u]};self.write('source.json',self.source);sourcehash=pub.proof.sha((self.out/'source.json').read_bytes())
  self.write('manifest.json',{'sourceSha256':sourcehash,'generation':{},'packs':[{'language':'en','bank':'grammar','src':'./data/audio/en/grammar.json'}]});self.write('en/grammar.json',{'clips':{u['key']:c}});self.write('audit/en/grammar.json',{'records':{u['key']:o}});self.write('quality-review.json',{'records':{self.t:row}});self.write('retries.json',{'preserved':'all Turbo retry snapshots'});self.write('overrides.json',{'entries':{},'preserved':'unchanged synthesis input'})
  self.p=pub.proof.assess(u,c,o,row,f,pure.cmp,self.bank.normalize,self.bank.evidence)
  raw={'sha256':c['sha256'],'recognized':f['recognized'],'generation':f['recognitionGeneration'],'segments':f['segments'],'method':'individual-beam5','recognitionAttempts':1}
  self.cache=self.work/'tmp/bank-asr'/(f['fingerprint']+'.json');self.cache.parent.mkdir(parents=True);self.cache.write_text(json.dumps(raw))
  plan={'version':1,'kind':pub.proof.METHOD,'sourceSha256':sourcehash,'modelRepository':pub.proof.REPOSITORY,'modelRevision':pub.proof.REVISION,'modelSha256':pub.proof.MODEL_SHA,'entries':[pub.runner.binding(u,c,o,row)]}
  self.report={'version':1,'complete':True,'method':pub.proof.METHOD,'originalTurboChanged':False,'publicWrites':0,'plan':plan,'records':{self.t:{'proof':self.p,'rawASR':raw}}}
  atomic=self.bank.atomic
  def write_atomic(path,value):
   if self.interrupt and path==self.out/'audit/en/grammar.json':self.interrupt=False;raise RuntimeError('fixture interruption after ledger')
   atomic(path,value)
  self.bank.atomic=write_atomic
 def write(self,name,value):p=self.out/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(value))
 def files(self):return {str(p.relative_to(self.root)):p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
 def publish(self,apply=True):return pub.publish(self.root,self.work,self.report,apply,bank_loader=lambda:self.bank)
 def test_preview_is_read_only(self):
  before=self.files();r=self.publish(False);self.assertTrue(r['dryRun']);self.assertEqual(self.files(),before)
 def test_publish_and_resume_preserve_turbo_repair_and_retry(self):
  retries=(self.out/'retries.json').read_bytes();overrides=(self.out/'overrides.json').read_bytes();self.publish()
  row=json.loads((self.out/'quality-review.json').read_text())['records'][self.t];record=json.loads((self.out/'audit/en/grammar.json').read_text())['records'][self.u['key']]
  self.assertEqual(row['repair'],self.row['repair']);self.assertEqual(record['recognized'],self.o['recognized']);self.assertEqual(record['comparison'],self.o['comparison']);self.assertEqual(record['recognitionGeneration'],self.o['recognitionGeneration']);self.assertEqual((self.out/'retries.json').read_bytes(),retries);self.assertEqual((self.out/'overrides.json').read_bytes(),overrides)
  self.assertTrue(self.bank.valid_published_asr(self.u,self.c,record,{self.t:row},set()));manifest=json.loads((self.out/'manifest.json').read_text());self.assertEqual(manifest['totals']['requiredAudited'],1);self.assertTrue(manifest['recordedAuditComplete'])
  before=self.files();self.publish();self.assertEqual(self.files(),before)
 def test_ledger_then_audit_interruption_recovers_without_duplicate_proof(self):
  self.interrupt=True
  with self.assertRaisesRegex(RuntimeError,'after ledger'):self.publish()
  q=json.loads((self.out/'quality-review.json').read_text());self.assertEqual(len(q['records'][self.t]['crossModelChecks']),1);self.assertEqual(json.loads((self.out/'audit/en/grammar.json').read_text())['records'][self.u['key']]['status'],'review')
  self.publish();q=json.loads((self.out/'quality-review.json').read_text());self.assertEqual(len(q['records'][self.t]['crossModelChecks']),1)
 def test_missing_installed_gate_fails_before_any_public_write(self):
  before=self.files()
  with patch.object(self.bank,'valid_published_asr',return_value=False):
   with self.assertRaisesRegex(ValueError,'dedicated cross-model'):self.publish()
  self.assertEqual(self.files(),before)
 def test_stale_media_raw_cache_and_candidate_refuse_before_writes(self):
  for mutate in ['media','cache','candidate']:
   with self.subTest(mutate=mutate):
    if mutate=='media':self.report['plan']['entries'][0]['audioSha256']='f'*64
    elif mutate=='cache':self.cache.write_text('{}')
    else:self.report['records'][self.t]['proof']['originalASR']['recognized']='rewritten'
    before=self.files()
    with self.assertRaises(ValueError):self.publish()
    self.assertEqual(self.files(),before)
    self.report['plan']['entries'][0]['audioSha256']=self.c['sha256'];self.cache.write_text(json.dumps(self.report['records'][self.t]['rawASR']))
 def test_default_auditor_keeps_original_turbo_and_full_proof(self):
  self.publish();before=json.loads((self.out/'audit/en/grammar.json').read_text())['records'][self.u['key']]
  shutil.copy(ROOT/'scripts/audit-bank-audio.py',self.root/'scripts/audit-bank-audio.py')
  audit=load('patched_full_auditor',self.root/'scripts/audit-bank-audio.py');small=self.work/'models/whisper-small/model.bin';small.parent.mkdir(parents=True);small.write_bytes(b'fixture no model');fake=MagicMock()
  with patch.object(audit,'WhisperModel',return_value=fake),patch.object(sys,'argv',['audit','--workdir',str(self.work),'--individual-only']),contextlib.redirect_stdout(io.StringIO()):audit.main()
  fake.transcribe.assert_not_called();current=json.loads((self.out/'audit/en/grammar.json').read_text())['records'][self.u['key']];self.assertEqual(current,before)
  stats=json.loads((self.out/'audit-summary.json').read_text());self.assertEqual(stats['crossModelAccepted'],1);self.assertEqual(stats['matched'],0);self.assertEqual(stats['singleCallsThisRun'],0)
if __name__=='__main__':unittest.main(verbosity=2)
