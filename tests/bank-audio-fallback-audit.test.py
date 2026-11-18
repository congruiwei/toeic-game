"""Auditor retains prior failed-candidate evidence without auditing device speech."""
import contextlib,importlib.util,io,json,os,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch,MagicMock
ROOT=Path(os.environ.get('TOEIC_TEST_REPO',Path.cwd()))
AUDITOR=Path(os.environ.get('TOEIC_AUDIT_SCRIPT',ROOT/'scripts/audit-bank-audio.py'))
# The private candidate keeps imports relative to its intended checkout.
source=AUDITOR.read_text().replace("ROOT = Path(__file__).resolve().parents[1]",'ROOT = Path('+repr(str(ROOT))+')')
namespace={'__file__':str(ROOT/'scripts/audit-bank-audio.py'),'__name__':'auditor_fixture'}
exec(compile(source,str(AUDITOR),'exec'),namespace)

class AuditFallbackTests(unittest.TestCase):
 def test_playback_completion_does_not_claim_device_voice_asr(self):
  fn=namespace['watch_complete']
  self.assertTrue(fn({'requiredPlaybackComplete':True,'requiredComplete':False},{'errors':0}))
  self.assertFalse(fn({'requiredPlaybackComplete':True},{'errors':1}))
  self.assertFalse(fn({'requiredPlaybackComplete':True},{'errors':0},producer_pid=123,producer_dead=False))
 def test_actual_loop_keeps_fallback_record_but_does_not_schedule_it(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory)/'repo';out=root/'data/audio';work=Path(directory)/'work';(work/'models/whisper-small').mkdir(parents=True);(work/'models/whisper-small/model.bin').write_bytes(b'fixture-model-hash-only')
   def write(path,value):path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value))
   key='read-fixture/documents/0/text/0';candidate={'status':'review','recognized':'候補音声の認識です。','sha256':'b'*64}
   write(out/'manifest.json',{'requiredPlaybackComplete':True,'packs':[{'language':'ja','bank':'reading','src':'./data/audio/ja/reading.json'}]})
   write(out/'ja/reading.json',{'clips':{},'fallbacks':{key:{'playback':'system'}},'sourceSha256':'a'*64})
   write(out/'audit/ja/reading.json',{'records':{key:candidate,'obsolete':{'status':'error'}}})
   fake=MagicMock();old_root,old_out=namespace['ROOT'],namespace['OUT']
   namespace['ROOT'],namespace['OUT']=root,out
   try:
    with patch.dict(namespace,{'WhisperModel':lambda *a,**k:fake}),patch.object(sys,'argv',['audit','--workdir',str(work),'--individual-only']),contextlib.redirect_stdout(io.StringIO()):namespace['main']()
   finally:namespace['ROOT'],namespace['OUT']=old_root,old_out
   fake.transcribe.assert_not_called()
   records=json.loads((out/'audit/ja/reading.json').read_text())['records'];self.assertEqual(records,{key:candidate})
   stats=json.loads((out/'audit-summary.json').read_text());self.assertEqual(stats['records'],0);self.assertEqual(stats['review'],0);self.assertEqual(stats['retainedSystemFallbackRecords'],1);self.assertEqual(stats['singleCallsThisRun'],0)

if __name__=='__main__':unittest.main()
