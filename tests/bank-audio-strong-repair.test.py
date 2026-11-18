import copy
import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT=Path(os.environ.get('TOEIC_TEST_REPO',Path(__file__).resolve().parents[1]))
spec=importlib.util.spec_from_file_location('repair',Path(os.environ.get('TOEIC_REPAIR_SCRIPT',ROOT/'scripts/repair-strong-bank-audio.py')))
repair=importlib.util.module_from_spec(spec);spec.loader.exec_module(repair)

class RepairTests(unittest.TestCase):
    def setUp(self):
        self.unit={'text':'The guests arrived early.','language':'en','voiceId':'af_heart','bank':'part2','key':'p2-example/audio/0'}
        self.proposal={'sourceText':self.unit['text'],'method':'Clearer articulation at a slower synthesis pace','override':{'speed':.9}}
    def test_preserves_original_text_and_known_phones(self):
        base={'phonemes':'correct phones','speed':.95}
        changed=repair.make_override(self.unit,self.proposal,base,base)
        self.assertEqual(changed['phonemes'],'correct phones');self.assertEqual(changed['speed'],.9)
        self.assertEqual(base['speed'],.95)
    def test_source_and_casting_rejected(self):
        for change in [{'voiceId':'af_bella'},{'text':'Changed'}]:
            p={**self.proposal,'override':change}
            with self.assertRaises(ValueError):repair.make_override(self.unit,p,{})
        with self.assertRaises(ValueError):repair.make_override(self.unit,{**self.proposal,'sourceText':'New source'}, {})
    def test_known_correct_phones_must_not_be_lost(self):
        p={**self.proposal,'override':{'spoken':'The guests arrived early.'}}
        with self.assertRaises(ValueError):repair.make_override(self.unit,p,{'phonemes':'phones'},{'phonemes':'phones'})
    def test_requires_real_input_change(self):
        with self.assertRaises(ValueError):repair.make_override(self.unit,self.proposal,{'speed':.9})
        for speed in [.74,1.21]:
            with self.assertRaises(ValueError):repair.make_override(self.unit,{**self.proposal,'override':{'speed':speed}}, {})
    def test_strong_model_binding(self):
        class Evidence:
            @staticmethod
            def valid_asr(clip,record):return True
        record={'comparison':{'equivalent':False},'recognitionMethod':'individual-beam5','recognitionGeneration':{'model':repair.STRONG_MODEL,'modelSha256':repair.STRONG_SHA}}
        self.assertTrue(repair.strong_evidence(Evidence,{},record))
        for field,value in [('model','whisper-small'),('modelSha256','0'*64)]:
            changed=copy.deepcopy(record);changed['recognitionGeneration'][field]=value
            self.assertFalse(repair.strong_evidence(Evidence,{},changed))
    def test_appends_real_versions_preserving_confirmed_history(self):
        version=lambda value:{'clip':{'sha256':value},'asr':{'status':'review','recognitionAttempts':1}}
        previous={'token':'en:part2:p2-example/audio/0','kind':'confirmed-input-correction','initial':version('a'),
            'retry':version('b'),'proposal':{'proof':'retained'},'complete':True,'selectedSha256':'b','predecessor':{'archiveIndex':2}}
        current={'original':version('b'),'appliedOverride':{'speed':.9}}
        archived=[{}, {}, {}]
        updated=repair.append_retry_history(previous,self.unit,current,version('c')['clip'],version('c')['asr'],archived)
        self.assertEqual(updated['kind'],'strong-asr-clarity-retry')
        self.assertEqual(archived[3]['proposal'],previous['proposal']);self.assertEqual(archived[3]['predecessor'],previous['predecessor'])
        self.assertEqual(updated['predecessor']['archiveIndex'],3);self.assertEqual(updated['initial']['clip']['sha256'],'b')
        self.assertEqual(updated['selectedSha256'],'c');self.assertEqual(updated['synthesisAttemptCount'],2)
        self.assertTrue(updated['unresolved']);self.assertEqual(updated['retry']['asr']['status'],'review')
        self.assertNotIn('priorRetries',previous)
        resumed=repair.append_retry_history(updated,self.unit,current,version('c')['clip'],version('c')['asr'],archived)
        self.assertEqual(resumed,updated);self.assertEqual(len(archived),4)

    def test_keeps_intermediate_real_candidate_without_duplicate_history(self):
        class Bank:
            @staticmethod
            def input_fingerprint(*args):return 'A.','expected'
            @staticmethod
            def planned_clip_matches(clip,*args):return clip.get('phonemeSha256')=='reviewed'
        u={'text':'A.','language':'en','voiceId':'am_puck','bank':'labels','key':'labels/am_puck/A'}
        clip={**u,'sha256':'b','inputSha256':'expected','spoken':'A.','phonemeSha256':'wrong'}
        record={'sha256':'b','status':'review','recognized':'Aye.'}
        case={'original':{'clip':{'sha256':'a'},'asr':{'status':'review'}},'appliedOverride':{'speed':.88}}
        with patch.object(repair,'strong_evidence',return_value=True):
            repair.remember_superseded_candidate(case,u,clip,record,{}, {},Bank,object())
            repair.remember_superseded_candidate(case,u,clip,record,{}, {},Bank,object())
        self.assertEqual(len(case['priorCandidates']),1)
        self.assertEqual(case['priorCandidates'][0]['asr'],record)
        updated=repair.append_retry_history(None,u,case,{**clip,'sha256':'c'},{**record,'sha256':'c'},[])
        self.assertEqual([v['clip']['sha256'] for v in [updated['initial'],*updated['priorRetries'],updated['retry']]],['a','b','c'])
        self.assertEqual(updated['synthesisAttemptCount'],3)
        self.assertEqual(updated['asrAttemptCount'],3)
        self.assertEqual(repair.append_retry_history(updated,u,case,updated['retry']['clip'],updated['retry']['asr'],[]),updated)
        damaged=copy.deepcopy(updated);damaged.pop('priorRetries')
        with self.assertRaises(ValueError):repair.append_retry_history(damaged,u,case,updated['retry']['clip'],updated['retry']['asr'],[])
        with patch.object(repair,'strong_evidence',return_value=False):
            with self.assertRaises(ValueError):repair.remember_superseded_candidate({'original':case['original']},u,clip,record,{}, {},Bank,object())
        with patch.object(repair,'strong_evidence',return_value=True):
            with self.assertRaises(ValueError):repair.remember_superseded_candidate(case,u,clip,{**record,'recognized':'Changed'}, {},{},Bank,object())

if __name__=='__main__':unittest.main()
