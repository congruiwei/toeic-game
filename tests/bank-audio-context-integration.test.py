"""Publication and default-audit gates, using fake PCM/evidence only."""
import contextlib,copy,importlib.util,io,json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import MagicMock,patch

ROOT=Path(__file__).resolve().parents[1]
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
pure=load('context_integration_fixture',ROOT/'tests/bank-audio-context.test.py')
bank=load('context_integration_bank',ROOT/'scripts/generate-bank-audio.py')
audit=load('context_integration_audit',ROOT/'scripts/audit-bank-audio.py')

class Integration(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)/'repo';self.out=self.root/'data/audio';self.out.mkdir(parents=True)
        f=pure.fixture();self.unit,self.clip,self.original=f[:3]
        proof=pure.probe.assess(*f[:6],pure.cmp,bank.normalize,bank.evidence)
        self.row={'contextProbes':[proof]}
        self.record=pure.probe.stage_proof(self.row,self.unit,self.clip,self.original,proof,pure.cmp,bank.normalize,bank.evidence)
        self.token=pure.probe.token(self.unit)
        self.source={'model':'fixture','voices':{},'units':[self.unit]}
        self.pack={'clips':{self.unit['key']:copy.deepcopy(self.clip)}}
        self.write('source.json',self.source)
        self.write('quality-review.json',{'records':{self.token:self.row}})
        self.write('en/vocab.json',self.pack)
        self.write('audit/en/vocab.json',{'records':{self.unit['key']:self.record}})
    def write(self,name,value):
        p=self.out/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(value))
    def test_flush_counts_only_a_bound_context_acceptance(self):
        self.assertTrue(bank.valid_published_asr(self.unit,self.clip,self.record,{self.token:self.row},set()))
        with patch.object(bank,'ROOT',self.root),patch.object(bank,'OUT',self.out):
            bank.flush(self.source,'1'*64,{}, {('en','vocab'):copy.deepcopy(self.pack)})
            good=json.loads((self.out/'manifest.json').read_text())
            self.assertTrue(good['requiredAuditComplete']);self.assertEqual(good['totals']['requiredAudited'],1)
            self.assertEqual(json.loads((self.out/'en/vocab.json').read_text())['clips'][self.unit['key']]['asrStatus'],'accepted')
            bad=copy.deepcopy(self.row);bad['contextProbes'][0]['pcm']['targetSpanSha256']='0'*64
            self.write('quality-review.json',{'records':{self.token:bad}})
            bank.flush(self.source,'1'*64,{}, {('en','vocab'):copy.deepcopy(self.pack)})
            failed=json.loads((self.out/'manifest.json').read_text())
            self.assertFalse(failed['requiredAuditComplete']);self.assertEqual(failed['totals']['requiredAudited'],0)
            self.assertEqual(json.loads((self.out/'en/vocab.json').read_text())['clips'][self.unit['key']]['asrStatus'],'pending')
    def test_unknown_acceptance_or_missing_ledger_cannot_count(self):
        for changes,row in [({'acceptance':{'method':'unknown'}},self.row),({},{}),({'recognized':'rewritten transcript'},self.row)]:
            with self.subTest(changes=changes):
                self.assertFalse(bank.valid_published_asr(self.unit,self.clip,{**self.record,**changes},{self.token:row},set()))
    def test_default_model_audit_preserves_valid_strong_context_record(self):
        work=Path(self.temp.name)/'work';model=work/'models/whisper-small/model.bin';model.parent.mkdir(parents=True);model.write_bytes(b'dummy file; no model is loaded')
        self.write('manifest.json',{'requiredComplete':True,'packs':[{'language':'en','bank':'vocab','src':'./data/audio/en/vocab.json'}]})
        fake=MagicMock()
        with patch.object(audit,'ROOT',self.root),patch.object(audit,'OUT',self.out),patch.object(audit,'WhisperModel',return_value=fake),patch.object(sys,'argv',['audit','--workdir',str(work),'--individual-only']),contextlib.redirect_stdout(io.StringIO()):
            audit.main()
        fake.transcribe.assert_not_called()
        current=json.loads((self.out/'audit/en/vocab.json').read_text())['records'][self.unit['key']]
        self.assertEqual(current,self.record)
        stats=json.loads((self.out/'audit-summary.json').read_text())
        self.assertEqual(stats['contextAccepted'],1);self.assertEqual(stats['matched'],0)
        self.assertEqual(stats['singleCallsThisRun'],0)

if __name__=='__main__':unittest.main()
