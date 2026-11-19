"""Renderer recovery fixtures. Real character lookup; fake model/AAC/ASR only."""
import copy
import hashlib
import importlib.util
import json
import sys
import tempfile
import types
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('kana_renderer_test', ROOT/'scripts/render-kana-audio.py')
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)


class RendererTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.out = self.base/'render'
        self.models = self.base/'models'
        self.bank_out = self.base/'bank'
        self.readings_path = self.base/'readings.json'
        self.units = [dict(language='ja',bank='vocab',key='v-one/meaning',text='受取人',voiceId='jf_alpha',required=True),
                      dict(language='ja',bank='reading',key='r/0',text='受け取り人',voiceId='jf_alpha',required=True,speaker='B')]
        self.readings = {renderer.key(u):'うけとりにん。' for u in self.units}
        self.write(self.readings_path,self.readings)
        for name, content in [('kokoro-v1.0.onnx',b'test model'),('voices-v1.0.bin',b'test voices'),('whisper-large-v3/model.bin',b'test whisper')]:
            p=self.models/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(content)
        self.gen=dict(recipe='fixture',modelSha256=renderer.digest(b'test model'),voicesSha256=renderer.digest(b'test voices'),packages={'fixture':'1'},encoding='fixture encoder')
        self.write(self.bank_out/'source.json',{'units':self.units})
        self.write(self.bank_out/'manifest.json',{'generation':self.gen})
        self.synth_calls=[];self.asr_calls=[];self.load_calls=[]
        self.transcript='受取人。'
        self.fail_encode=False
        codec=types.SimpleNamespace(ROOT=self.out,ENCODING='fixture encoder',trim_edges=lambda audio:audio)
        self.bank=types.SimpleNamespace(OUT=self.bank_out,codec=codec,RATE=24000,atomic=self.write,encode_bank=self.encode,
            input_fingerprint=lambda g,u,o:(o['spoken'],renderer.digest(json.dumps([g,u,o],sort_keys=True).encode())))
        self.bank.ort=types.SimpleNamespace(SessionOptions=types.SimpleNamespace,set_seed=lambda n:None,InferenceSession=self.load)
        self.bank.Kokoro=types.SimpleNamespace(from_session=lambda *args:self.synth)
        self.synth=types.SimpleNamespace(tokenizer=types.SimpleNamespace(vocab=set(renderer.render_phones('うけとりにん。はこ。'))),create=self.create)
        self.fake_whisper=types.SimpleNamespace(WhisperModel=lambda *args,**kwargs:self.asr)
        self.asr=types.SimpleNamespace(transcribe=self.transcribe)

    def write(self,path,value):
        path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(json.dumps(value,ensure_ascii=False))

    def load(self,*args,**kwargs):
        self.load_calls.append((args,kwargs));return object()

    def create(self,phones,**kwargs):
        self.synth_calls.append((phones,kwargs));return phones.encode(),24000

    def encode(self,audio,path,tmp):
        if self.fail_encode:raise RuntimeError('interrupted encoder')
        path.parent.mkdir(parents=True,exist_ok=True);data=b'fixture AAC '+audio;path.write_bytes(data)
        return dict(src='./'+path.relative_to(self.out).as_posix(),sha256=renderer.digest(data),bytes=len(data),duration=1.,decodedPeak=.5)

    def transcribe(self,path,**kwargs):
        self.asr_calls.append((path,kwargs))
        rows=[] if not self.transcript else [types.SimpleNamespace(start=0.,end=.8,text=self.transcript,avg_logprob=-.2,no_speech_prob=.01)]
        return iter(rows),None

    def run_phase(self,phase):
        argv=['renderer',phase,'--readings',str(self.readings_path),'--out',str(self.out),'--models',str(self.models)]
        with ExitStack() as stack:
            stack.enter_context(patch.object(sys,'argv',argv))
            stack.enter_context(patch.object(renderer,'load_module',return_value=self.bank))
            stack.enter_context(patch.object(renderer,'FULL_SHA',renderer.digest(b'test whisper')))
            stack.enter_context(patch.object(renderer.importlib.metadata,'version',return_value='1'))
            stack.enter_context(patch.dict(sys.modules,{'faster_whisper':self.fake_whisper}))
            renderer.main()

    def bundle(self,unit=None):
        unit=unit or self.units[0]
        return self.out/'clips'/(renderer.digest(renderer.key(unit).encode())+'.json')

    def test_only_character_mapping_and_authored_particles_are_used(self):
        from misaki.cutlet import Cutlet
        with patch.object(Cutlet,'__init__',side_effect=AssertionError('tagger must not initialize')):
            self.assertNotEqual(renderer.render_phones('は'),renderer.render_phones('わ'))
            self.assertNotEqual(renderer.render_phones('へ'),renderer.render_phones('え'))
            self.assertNotEqual(renderer.render_phones('じゅう'),renderer.render_phones('じゆう'))
            self.assertNotEqual(renderer.render_phones('えい'),renderer.render_phones('えー'))
            self.assertIn('“',renderer.render_phones('（はこ）'))
            for bad in ['受取人','12じ','ABC','','  ','。']:
                with self.subTest(bad=bad),self.assertRaises(ValueError):renderer.render_phones(bad)

    def test_identical_phones_share_media_without_losing_source_identity(self):
        self.run_phase('render');self.assertEqual(len(self.synth_calls),1)
        a,b=(renderer.read(self.bundle(u)) for u in self.units)
        self.assertEqual(a['clip']['sha256'],b['clip']['sha256'])
        self.assertNotEqual(a['token'],b['token']);self.assertNotEqual(a['clip']['inputSha256'],b['clip']['inputSha256'])
        self.assertNotIn('speaker',a['clip']);self.assertEqual(b['clip']['speaker'],'B')
        before={str(p):p.read_bytes() for p in self.out.rglob('*') if p.is_file()}
        self.run_phase('render');self.assertEqual(len(self.synth_calls),1)
        self.assertEqual(before,{str(p):p.read_bytes() for p in self.out.rglob('*') if p.is_file()})
        self.run_phase('asr');self.run_phase('asr');self.assertEqual(len(self.asr_calls),1)
        self.assertEqual(self.asr_calls[0][1],dict(language='ja',task='transcribe',beam_size=5,condition_on_previous_text=False,initial_prompt=None,hotwords=None,vad_filter=False,temperature=0.0,word_timestamps=False))

    def test_corrupt_media_or_metadata_is_not_reused(self):
        self.run_phase('render');meta=next((self.out/'media').glob('*.json'));original=renderer.read(meta)
        for field,value in [('src','../../wrong.m4a'),('bytes',0),('duration',float('nan')),('sha256','0'*64)]:
            before=len(self.synth_calls);self.write(meta,{**original,field:value});self.run_phase('render');self.assertEqual(len(self.synth_calls),before+1)
        (self.out/original['src']).write_bytes(b'wrong same-path media')
        before=len(self.synth_calls);self.run_phase('render');self.assertEqual(len(self.synth_calls),before+1)

    def test_stale_or_tampered_bundle_cannot_be_recognized(self):
        self.run_phase('render');bundle=self.bundle();original=renderer.read(bundle)
        for field,value in [('inputSha256','0'*64),('phonemeSha256','1'*64),('voiceId','af_heart'),('src','../../outside.m4a'),('text','changed')]:
            bad=copy.deepcopy(original);bad['clip'][field]=value;self.write(bundle,bad)
            with self.subTest(field=field),self.assertRaisesRegex(ValueError,'checkpoint'):self.run_phase('asr')
            self.assertFalse(self.asr_calls)
        self.write(bundle,original);self.readings[renderer.key(self.units[0])]='はこ。';self.write(self.readings_path,self.readings)
        with self.assertRaisesRegex(ValueError,'checkpoint'):self.run_phase('asr')

    def test_asr_cache_requires_exact_sha_fingerprint_and_actual_segment_text(self):
        self.run_phase('render');self.run_phase('asr');cache=next((self.out/'asr').glob('*.json'));original=renderer.read(cache)
        for field,value in [('sha256','0'*64),('fingerprint','1'*64),('generation',{}),('recognized','fabricated'),('segments',[]),('elapsedSeconds',float('nan'))]:
            before=len(self.asr_calls);self.write(cache,{**original,field:value});self.run_phase('asr');self.assertEqual(len(self.asr_calls),before+1)

    def test_actual_no_speech_is_kept_as_a_completed_attempt(self):
        self.run_phase('render');self.transcript='';self.run_phase('asr')
        cache=next((self.out/'asr').glob('*.json'));before=cache.read_bytes()
        self.run_phase('asr');self.assertEqual(len(self.asr_calls),1);self.assertEqual(cache.read_bytes(),before)
        self.assertEqual(renderer.read(cache)['recognized'],'');self.assertEqual(renderer.read(cache)['segments'],[])

    def test_invalid_inputs_and_duplicate_json_fail_before_model_loading(self):
        token=renderer.key(self.units[0])
        for raw in [json.dumps({token:'ABC'}),json.dumps({'unknown':'はこ。'}),json.dumps({token:1}),'{}',f'{{"{token}":"はこ。","{token}":"うけとりにん。"}}']:
            self.readings_path.write_text(raw)
            with self.subTest(raw=raw),self.assertRaises(ValueError):self.run_phase('render')
            self.assertFalse(self.load_calls);self.assertFalse(self.synth_calls)

    def test_symlink_escape_and_changed_environment_are_rejected(self):
        self.out.mkdir();escape=self.base/'elsewhere';escape.mkdir();(self.out/'audio').symlink_to(escape,target_is_directory=True)
        with self.assertRaisesRegex(ValueError,'escapes'):self.run_phase('render')
        self.assertFalse(self.load_calls);(self.out/'audio').unlink()
        self.gen['packages']['fixture']='different';self.write(self.bank_out/'manifest.json',{'generation':self.gen})
        with self.assertRaisesRegex(ValueError,'packages'):self.run_phase('render')
        self.assertFalse(self.load_calls)

    def test_interrupted_encoder_does_not_publish_a_checkpoint_and_can_resume(self):
        self.fail_encode=True
        with self.assertRaisesRegex(RuntimeError,'interrupted'):self.run_phase('render')
        self.assertFalse(self.bundle().exists())
        self.fail_encode=False;self.run_phase('render');self.run_phase('asr')
        self.assertTrue(self.bundle().is_file());self.assertEqual(len(self.asr_calls),1)

    def test_media_checkpoint_survives_interruption_before_source_bundle(self):
        original=self.bank.atomic
        def stop_at_bundle(path,value):
            if path.parent.name=='clips':raise RuntimeError('interrupted bundle')
            original(path,value)
        self.bank.atomic=stop_at_bundle
        with self.assertRaisesRegex(RuntimeError,'interrupted bundle'):self.run_phase('render')
        self.assertFalse(self.bundle().exists());self.assertEqual(len(self.synth_calls),1)
        self.bank.atomic=original;self.run_phase('render')
        self.assertEqual(len(self.synth_calls),1);self.assertTrue(self.bundle().is_file())

    def test_incomplete_asr_iterator_never_becomes_a_cached_success(self):
        self.run_phase('render');normal=self.asr.transcribe
        def interrupted(*args,**kwargs):
            rows,_=normal(*args,**kwargs)
            def stream():
                yield next(rows)
                raise RuntimeError('recognizer stopped')
            return stream(),None
        self.asr.transcribe=interrupted
        with self.assertRaisesRegex(RuntimeError,'recognizer stopped'):self.run_phase('asr')
        self.assertFalse(list((self.out/'asr').glob('*.json')))
        self.asr.transcribe=normal;self.run_phase('asr')
        self.assertEqual(len(self.asr_calls),2);self.assertEqual(len(list((self.out/'asr').glob('*.json'))),1)


if __name__=='__main__':unittest.main()
