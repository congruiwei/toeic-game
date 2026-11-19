"""CLI recovery simulations: temporary files and fake child commands only."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('fixtures',HERE/'bank-audio-retry.test.py')
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
r=f.retry

class RecoveryFlowTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name)
        self.root=self.base/'repo';self.out=self.root/'data/audio';self.work=self.base/'work'
        self.unit=copy.deepcopy(f.UNIT);self.clip=f.clip_for(self.unit);self.base_status='matched';self.fail_retry=False;self.calls=[]
        self.pack_path=self.out/'en/vocab.json';self.audit_path=self.out/'audit/en/vocab.json'
        r.atomic(self.out/'source.json',{'units':[self.unit]})
        r.atomic(self.out/'manifest.json',{'requiredComplete':True,'requiredAuditComplete':False,'packs':[{'language':'en','bank':'vocab','src':'./data/audio/en/vocab.json'}]})
        r.atomic(self.pack_path,{'clips':{self.unit['key']:self.clip}})
        r.atomic(self.audit_path,{'records':{self.unit['key']:f.actual_for(self.clip,'matched')}})
        r.atomic(self.out/'overrides.json',{'version':1,'entries':{}})
    def tearDown(self):self.tmp.cleanup()
    def command(self,command,**kwargs):
        self.calls.append(command)
        if '--sync-only' in command:
            index=r.read(self.out/'manifest.json',{});pack=r.read(self.pack_path,{});audit=r.read(self.audit_path,{})
            index['requiredComplete']=self.unit['key'] in pack.get('clips',{})
            index['requiredAuditComplete']=not r.initial_coverage({'units':[self.unit]},{('en','vocab'):pack},{('en','vocab'):audit})
            index['syncCount']=index.get('syncCount',0)+1;r.atomic(self.out/'manifest.json',index)
        elif 'generate-bank-audio.py' in str(command):
            new=f.clip_for(self.unit,'b'*64);new['synthesisSpeed']=.9
            r.atomic(self.pack_path,{'clips':{self.unit['key']:new}})
        elif 'audit-bank-audio.py' in str(command):
            clip=r.read(self.pack_path,{})['clips'][self.unit['key']]
            is_retry='--tokens-file' in command
            record=f.actual_for(clip,'matched' if is_retry else self.base_status)
            if not is_retry and self.base_status=='review':record.update(recognized='Please find the invoice.',errorRate=.25)
            if is_retry and self.fail_retry:record.update(status='error',recognized='',transcriptionAttempted=True,error='empty actual recognition',recognitionAttempts=1)
            r.atomic(self.audit_path,{'records':{self.unit['key']:record}})
        else:raise AssertionError(command)
        return types.SimpleNamespace(returncode=0)
    def run_flow(self,extra=None):
        with patch.multiple(r,ROOT=self.root,OUT=self.out),patch.object(r.sys,'argv',['retry-bank-audio.py','--workdir',str(self.work),*(extra or [])]),patch.object(r.subprocess,'run',side_effect=self.command):
            r.main()
    def test_dead_generator_with_missing_media_enters_repair_in_wait_mode(self):
        index=r.read(self.out/'manifest.json',{});index['requiredComplete']=False
        r.atomic(self.out/'manifest.json',index);r.atomic(self.pack_path,{'clips':{}});r.atomic(self.audit_path,{'records':{}})
        with patch.object(r.time,'sleep',side_effect=AssertionError('dead writers must not wait forever')):
            self.run_flow(['--wait'])
        final=r.read(self.out/'manifest.json',{})
        self.assertTrue(final['requiredComplete']);self.assertTrue(final['requiredAuditComplete'])
        self.assertTrue(any('generate-bank-audio.py' in str(c) and '--sync-only' not in c for c in self.calls))
        self.assertTrue(any('audit-bank-audio.py' in str(c) for c in self.calls))
    def test_no_candidates_still_drains_and_syncs_manifest(self):
        self.run_flow();index=r.read(self.out/'manifest.json',{})
        self.assertTrue(index['requiredAuditComplete']);self.assertGreaterEqual(index['syncCount'],3)
        self.assertTrue(any('audit-bank-audio.py' in str(c) for c in self.calls))
    def test_dead_auditor_missing_record_gets_actual_drain_before_completion(self):
        r.atomic(self.audit_path,{'records':{}})
        self.run_flow();self.assertTrue(r.read(self.out/'manifest.json',{})['requiredAuditComplete'])
        self.assertTrue(r.has_actual_asr(self.clip,r.read(self.audit_path,{})['records'][self.unit['key']]))
    def test_failed_retry_remains_incomplete_and_later_resumes(self):
        self.base_status='review';self.fail_retry=True;self.run_flow()
        entry=r.read(self.out/'retries.json',{})['records'][f.token(self.unit)]
        self.assertFalse(entry['complete']);self.assertEqual(entry['phase'],'awaiting-real-ASR')
        self.assertEqual(r.read(self.pack_path,{})['clips'][self.unit['key']]['sha256'],self.clip['sha256'])
        self.fail_retry=False;self.run_flow();entry=r.read(self.out/'retries.json',{})['records'][f.token(self.unit)]
        self.assertTrue(entry['complete']);self.assertEqual(entry['outcome'],'retry-matched')
        self.assertEqual(len(entry['failedRecognitionAttempts']),1)
    def test_changed_source_archives_interrupted_case_without_restoring_old_text(self):
        old=f.case_for(self.unit);r.atomic(self.out/'retries.json',{'version':1,'records':{f.token(self.unit):old}})
        r.atomic(self.out/'overrides.json',{'entries':{f.token(self.unit):old['retryOverride']}})
        self.unit['text']='Please send the revised invoice.';self.clip=f.clip_for(self.unit,'c'*64)
        r.atomic(self.out/'source.json',{'units':[self.unit]});r.atomic(self.pack_path,{'clips':{self.unit['key']:self.clip}})
        r.atomic(self.audit_path,{'records':{self.unit['key']:f.actual_for(self.clip,'matched')}})
        self.run_flow();report=r.read(self.out/'retries.json',{})
        self.assertEqual(len(report['archivedCases']),1);self.assertFalse(report['records'])
        self.assertEqual(r.read(self.pack_path,{})['clips'][self.unit['key']]['text'],self.unit['text'])
        self.assertNotIn(f.token(self.unit),r.read(self.out/'overrides.json',{})['entries'])
    def test_token_scope_preserves_unselected_complete_and_interrupted_history(self):
        selected=dict(self.unit,key='new/meaning',text='new')
        selected_clip=f.clip_for(selected,'d'*64)
        tokens=self.base/'selected.json';r.atomic(tokens,[f.token(selected)])
        for complete in [True,False]:
            with self.subTest(complete=complete):
                old=f.case_for(self.unit);old['complete']=complete
                # A stale unselected case used to be archived before the late
                # token filter, then removed from records during pruning.
                changed=dict(self.unit,text='Changed in an unrelated release')
                changed_clip=f.clip_for(changed,'c'*64)
                r.atomic(self.out/'source.json',{'units':[changed,selected]})
                r.atomic(self.out/'retries.json',{'version':1,'records':{f.token(self.unit):old},'archivedCases':[]})
                overrides={'entries':{f.token(self.unit):old['retryOverride']}}
                r.atomic(self.out/'overrides.json',overrides)
                r.atomic(self.pack_path,{'clips':{changed['key']:changed_clip,selected['key']:selected_clip}})
                records={changed['key']:f.actual_for(changed_clip,'review'),selected['key']:f.actual_for(selected_clip,'matched')}
                r.atomic(self.audit_path,{'records':records})
                self.run_flow(['--allow-incomplete','--tokens-file',str(tokens)])
                report=r.read(self.out/'retries.json',{})
                self.assertEqual(report['records'],{f.token(self.unit):old});self.assertEqual(report['archivedCases'],[])
                self.assertEqual(r.read(self.out/'overrides.json',{}),overrides)
                self.assertEqual(r.read(self.audit_path,{})['records'],records)

if __name__=='__main__':unittest.main()
