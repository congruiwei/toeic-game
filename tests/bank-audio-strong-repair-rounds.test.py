"""Real main with synthetic file evidence and fake author callbacks; no model."""
import contextlib,copy,hashlib,importlib.util,io,json,os
from pathlib import Path
import sys,unittest
from unittest.mock import patch
ROOT=Path(os.environ.get('TOEIC_TEST_REPO',Path.cwd()));HERE=Path(__file__).resolve().parent

def load(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
repair=load('rounds',Path(os.environ.get('TOEIC_REPAIR_SCRIPT',ROOT/'scripts/repair-strong-bank-audio.py')))
flow=load('original_flow',ROOT/'tests/bank-audio-strong-repair-flow.test.py');flow.repair=repair
sha=lambda v:hashlib.sha256(v).hexdigest()

class Rounds(unittest.TestCase):
 def setUp(self):
  self.f=flow.FlowTests();self.f.setUp();self.addCleanup(self.f.tearDown);f=self.f
  def tr(v):
   if isinstance(v,dict):return {tr(k):tr(x) for k,x in v.items()}
   if isinstance(v,list):return [tr(x) for x in v]
   if isinstance(v,str):
    if v=='ja':return 'en'
    if v=='jf_alpha':return 'af_heart'
    return v.replace('ja:reading:','en:reading:').replace('/ja/jf_alpha/','/en/af_heart/').replace('領収書を確認しました。','The crew returned trays.').replace('領収書を変更しました。','The crew return trays.')
   return v
  for name in ['unit','token','first','original','candidate','pending','quality','report','source','pack','proposal']:setattr(f,name,tr(getattr(f,name)))
  for version,speed in [(f.first,1.1),(f.original,1.),(f.candidate,.9)]:
   c=version['clip'];a=version['asr'];oldpath=f.root/c['src'].replace('/en/af_heart/','/ja/jf_alpha/');newpath=f.root/c['src'];newpath.parent.mkdir(parents=True,exist_ok=True);newpath.write_bytes(oldpath.read_bytes())
   c['spoken'],c['inputSha256']=f.bank.input_fingerprint(f.gen,f.unit,{'speed':speed})
   a['expected']=c['text'];a['spoken']=c['spoken'];a['comparison'].update(expectedSpoken=c['spoken'],language='en');a['comparison']['provenance']['sourceTextSha256']=sha(c['text'].encode())
  f.pending['original']=copy.deepcopy(f.original);f.quality['records'][f.token]['repair']=copy.deepcopy(f.pending)
  f.report['records'][f.token]['initial']=copy.deepcopy(f.first);f.report['records'][f.token]['retry']=copy.deepcopy(f.original)
  f.pack['clips'][f.key]=copy.deepcopy(f.candidate['clip'])
  f.write('source.json',f.source);f.source_sha=sha((f.out/'source.json').read_bytes())
  for name,value in [('quality-review.json',f.quality),('retries.json',f.report),('overrides.json',{'version':1,'entries':{f.token:f.changed}}),('en/reading.json',f.pack),('audit/en/reading.json',{'records':{f.key:f.candidate['asr']}})]:f.write(name,value)
  f.plan.write_text(json.dumps({'sourceSha256':f.source_sha,'entries':[f.proposal]}));f.run_repair()
  self.first_quality=f.read('quality-review.json')['records'][f.token]['repair'];self.first_report=f.read('retries.json')
  self.proposal={'token':f.token,'sourceText':f.unit['text'],'beforeSha256':f.candidate['clip']['sha256'],'previousRepairSha256':repair.repair_snapshot_sha(self.first_quality),'method':'Second clarity variant','override':{'speed':.98}}
  f.plan.write_text(json.dumps({'sourceSha256':f.source_sha,'entries':[self.proposal]}))
  self.c=copy.deepcopy(f.candidate);c=self.c['clip'];a=self.c['asr'];payload=b'third actual fixture media, not synthesis';c.update(sha256=sha(payload),bytes=len(payload),synthesisSpeed=.98,src='./audio/generated/en/af_heart/'+sha(payload)[:32]+'.m4a');c['spoken'],c['inputSha256']=f.bank.input_fingerprint(f.gen,f.unit,{'speed':.98});a.update(sha256=c['sha256'],spoken=c['spoken']);a['comparison'].update(audioSha256=c['sha256'],expectedSpoken=c['spoken']);self.c_payload=payload;self.calls=[]
 def run_main(self,*,finish=False,next_round=True,fail_after_generate=False,race=None):
  f=self.f;original=repair.load_module
  def factory(name,path):
   m=original(name,path)
   if name=='strong_repair_retry' and race:
    def raced_running(work):
     value=f.read(race);value['concurrentProof']='must be preserved';f.write(race,value);return []
    m.running=raced_running
   if name=='strong_repair_correction':
    def command(cmd,work):
     which=Path(cmd[1]).name;self.calls.append(which)
     row=f.read('quality-review.json')['records'][f.token]
     self.assertEqual(row['priorRepairs'],[self.first_quality]);self.assertEqual(row['repair']['previousRepair']['sha256'],repair.repair_snapshot_sha(self.first_quality))
     if which=='generate-bank-audio.py':
      path=f.root/self.c['clip']['src'];path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(self.c_payload)
      f.write('en/reading.json',{'clips':{f.key:{**self.c['clip'],'asrStatus':'pending'}}})
      if fail_after_generate:raise RuntimeError('fixture interruption after changed media')
     else:f.write('audit/en/reading.json',{'records':{f.key:self.c['asr']}})
    m.run_command=command
   return m
  argv=['repair','--repo',str(f.root),'--workdir',str(f.work),'--plan',str(f.plan),'--apply']
  if next_round:argv+=['--next-round']
  if finish:argv+=['--finish-only']
  with patch.object(sys,'argv',argv),patch.object(repair,'load_module',side_effect=factory),contextlib.redirect_stdout(io.StringIO()):repair.main()
 def disk(self):return {str(p.relative_to(self.f.out)):p.read_bytes() for p in self.f.out.rglob('*.json')}
 def test_real_main_archives_complete_prior_repair_and_is_idempotent(self):
  self.run_main();f=self.f;row=f.read('quality-review.json')['records'][f.token];report=f.read('retries.json')
  self.assertEqual(row['priorRepairs'],[self.first_quality]);self.assertTrue(row['repair']['complete']);self.assertEqual(row['repair']['original'],self.first_quality['candidate'])
  self.assertEqual(report['archivedCases'][-1]['initial'],self.first_quality['original']);self.assertEqual(report['records'][f.token]['initial'],self.first_quality['candidate']);self.assertEqual({k:report['records'][f.token]['retry'][k] for k in ['clip','asr']},self.c)
  before=self.disk();self.calls=[];self.run_main(finish=True);self.assertEqual(self.calls,[]);self.assertEqual(self.disk(),before)
 def test_interruption_preserves_original_and_resumes_without_duplicate_archive(self):
  with self.assertRaisesRegex(RuntimeError,'fixture interruption'):self.run_main(fail_after_generate=True)
  f=self.f;row=f.read('quality-review.json')['records'][f.token];self.assertFalse(row['repair']['complete']);self.assertEqual(row['priorRepairs'],[self.first_quality])
  f.write('audit/en/reading.json',{'records':{f.key:self.c['asr']}});self.calls=[];self.run_main(finish=True)
  self.assertEqual(self.calls,[]);self.assertEqual(len(f.read('quality-review.json')['records'][f.token]['priorRepairs']),1)
  self.assertEqual(len(f.read('retries.json')['archivedCases']),2)
 def test_explicit_next_round_flag_required_before_any_write(self):
  before=self.disk()
  with self.assertRaisesRegex(ValueError,'explicitly archive'):self.run_main(next_round=False)
  self.assertEqual(self.calls,[]);self.assertEqual(self.disk(),before)
 def test_old_snapshot_or_current_override_drift_rejected_before_writes(self):
  f=self.f;plan=json.loads(f.plan.read_text());plan['entries'][0]['previousRepairSha256']='0'*64;f.plan.write_text(json.dumps(plan));before=self.disk()
  with self.assertRaisesRegex(ValueError,'exact completed'):self.run_main()
  self.assertEqual(self.disk(),before);self.assertEqual(self.calls,[])
 def test_next_round_preserves_prior_intermediate_candidate_in_both_histories(self):
  f=self.f;version=copy.deepcopy(f.candidate);payload=b'intermediate failed-input fixture';digest=sha(payload);c=version['clip'];c.update(sha256=digest,bytes=len(payload),src='./audio/generated/en/af_heart/'+digest[:32]+'.m4a');(f.root/c['src']).write_bytes(payload);version['asr']['sha256']=digest;version['asr']['comparison']['audioSha256']=digest;version['rejectionReason']='fixture target input mismatch'
  self.first_quality['priorCandidates']=[copy.deepcopy(version)];q=f.read('quality-review.json');q['records'][f.token]['repair']=copy.deepcopy(self.first_quality);f.write('quality-review.json',q)
  r=f.read('retries.json');r['records'][f.token].update(priorRetries=[copy.deepcopy(version)],synthesisAttemptCount=3,asrAttemptCount=3);f.write('retries.json',r)
  plan=json.loads(f.plan.read_text());plan['entries'][0]['previousRepairSha256']=repair.repair_snapshot_sha(self.first_quality);f.plan.write_text(json.dumps(plan));self.run_main()
  self.assertEqual(f.read('quality-review.json')['records'][f.token]['priorRepairs'][0]['priorCandidates'],[version]);self.assertEqual(f.read('retries.json')['archivedCases'][-1]['priorRetries'],[version])
 def test_current_override_drift_rejected_before_writes(self):
  f=self.f;value=f.read('overrides.json');value['entries'][f.token]['speed']=1.02;f.write('overrides.json',value);before=self.disk()
  with self.assertRaisesRegex(ValueError,'selected prior repair'):self.run_main()
  self.assertEqual(self.calls,[]);self.assertEqual(self.disk(),before)
 def test_concurrent_evidence_update_between_preflight_and_locks_is_preserved(self):
  for file in ['quality-review.json','overrides.json','en/reading.json','audit/en/reading.json']:
   with self.subTest(file=file):
    before=self.disk()
    with self.assertRaisesRegex(ValueError,'Author input changed before locks'):self.run_main(race=file)
    after=self.disk();self.assertEqual(self.calls,[]);self.assertEqual(self.f.read(file)['concurrentProof'],'must be preserved')
    for name,data in before.items():
     if name!=file:self.assertEqual(after[name],data)
    (self.f.out/file).write_bytes(before[file])
 def test_missing_original_asr_is_not_repaired_by_a_new_snapshot_hash(self):
  f=self.f;q=f.read('quality-review.json');old=q['records'][f.token]['repair'];old['original']['asr']['recognized']='';f.write('quality-review.json',q)
  plan=json.loads(f.plan.read_text());plan['entries'][0]['previousRepairSha256']=repair.repair_snapshot_sha(old);f.plan.write_text(json.dumps(plan));before=self.disk()
  with self.assertRaisesRegex(ValueError,'actual source/ASR'):self.run_main()
  self.assertEqual(self.disk(),before);self.assertEqual(self.calls,[])
 def test_resumed_prior_snapshot_damage_rejected_before_author_or_write(self):
  with self.assertRaises(RuntimeError):self.run_main(fail_after_generate=True)
  f=self.f;q=f.read('quality-review.json');q['records'][f.token]['priorRepairs'][0]['candidate']['asr']['recognized']='tampered';f.write('quality-review.json',q);before=self.disk();self.calls=[]
  with self.assertRaisesRegex(ValueError,'snapshot binding'):self.run_main(finish=True)
  self.assertEqual(self.calls,[]);self.assertEqual(self.disk(),before)

if __name__=='__main__':unittest.main()
