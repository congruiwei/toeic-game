"""Render hand-authored Japanese readings locally, then audit actual AAC with large-v3.

Both phases checkpoint outside the public site. Only the recognition side parses
Japanese writing; synthesis reads the author's kana directly, including particles.
"""
import argparse
import hashlib
import importlib.metadata
import importlib.util
import json
import math
import re
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
FULL_SHA = '69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1'


def load_module(filename):
    spec = importlib.util.spec_from_file_location(filename[:-3], HERE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    def unique(pairs):
        result = {}
        for name, value in pairs:
            if name in result:
                raise ValueError(f'Duplicate JSON key: {name}')
            result[name] = value
        return result
    return json.loads(path.read_text(), object_pairs_hook=unique)


def cached(path):
    try:
        return read(path)
    except (FileNotFoundError, json.JSONDecodeError, ValueError):
        return None


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def inside(out, path):
    if not path.resolve().is_relative_to(out.resolve()):
        raise ValueError(f'Artifact path escapes output directory: {path}')
    return path


def valid_media(meta, path, out):
    if not isinstance(meta, dict) or not path.is_file():
        return False
    return (meta.get('src') == './' + path.relative_to(out).as_posix()
            and meta.get('bytes') == path.stat().st_size
            and meta.get('sha256') == digest(path.read_bytes())
            and finite(meta.get('duration')) and .25 < meta['duration'] < 180
            and finite(meta.get('decodedPeak')) and .005 < meta['decodedPeak'] <= .95)


def valid_asr(raw, identity, audio_sha, fingerprint):
    if (not isinstance(raw, dict) or raw.get('generation') != identity
            or raw.get('sha256') != audio_sha or raw.get('fingerprint') != fingerprint
            or not isinstance(raw.get('recognized'), str) or not isinstance(raw.get('segments'), list)
            or not finite(raw.get('elapsedSeconds')) or raw['elapsedSeconds'] < 0):
        return False
    for segment in raw['segments']:
        if (not isinstance(segment, dict) or not isinstance(segment.get('text'), str)
                or not all(finite(segment.get(k)) for k in ('start','end','avgLogprob','noSpeechProb'))
                or not 0 <= segment['start'] <= segment['end']
                or not 0 <= segment['noSpeechProb'] <= 1):
            return False
    # A completed no-speech result remains actual evidence, not a cache miss.
    return raw['recognized'] == ' '.join(s['text'].strip() for s in raw['segments']).strip()


def key(unit):
    return ':'.join((unit['language'], unit['bank'], unit['key']))


def render_phones(reading):
    from misaki.cutlet import HEPBURN, Cutlet
    # Only this kana lookup method is used. Do not instantiate the word tagger.
    lookup = object.__new__(Cutlet)
    lookup.table = HEPBURN
    punct = {'、':',','，':',','。':'.','？':'?','！':'!','；':';','：':':','・':',','「':'“','」':'”','『':'“','』':'”','（':'(', '）':')','…':'…','　':' '}
    out = []
    for i, char in enumerate(reading):
        if char.isspace():
            out.append(' ')
        elif char in punct or char in ' ,.!?:;“”()—':
            out.append(punct.get(char,char))
        elif char in HEPBURN or char in 'んっー':
            out.append(lookup._get_single_mapping(reading[i-1] if i else None, char, reading[i+1:i+2]))
        else:
            raise ValueError(f'Unexpected character {char!r} in {reading!r}')
    result = ''.join(out).strip().replace('(', '“').replace(')', '”')
    if not re.search(r'[ぁ-ゖァ-ヶ]', reading):
        raise ValueError('A reading must contain kana')
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('phase', choices=['render','asr'])
    p.add_argument('--readings', required=True, type=Path)
    p.add_argument('--out', required=True, type=Path)
    p.add_argument('--models', type=Path, default=Path.home()/'.local/share/toeic-kokoro/models')
    p.add_argument('--await-render', action='store_true', help='Wait for each atomic render checkpoint during overlapped recognition')
    p.add_argument('--threads', type=int, default=4)
    args = p.parse_args()
    if args.out.resolve().is_relative_to(ROOT):
        p.error('Checkpoints must be outside the checkout')
    bank = load_module('generate-bank-audio.py')
    bank.codec.ROOT = args.out
    source_units = read(bank.OUT/'source.json')['units']
    units = {key(u):u for u in source_units}
    if len(units) != len(source_units):
        raise ValueError('Duplicate source token')
    gen = read(bank.OUT/'manifest.json')['generation']
    synthesis = {k:gen[k] for k in ('recipe','modelSha256','voicesSha256','packages')}
    if gen['encoding'] != bank.codec.ENCODING:
        raise ValueError('Encoder recipe differs from the recorded generation')
    readings = read(args.readings)
    if not isinstance(readings, dict) or not readings:
        raise ValueError('Readings must be a nonempty token-to-kana object')
    plans = []
    for token, spoken in readings.items():
        if token not in units or not isinstance(spoken, str):
            raise ValueError(f'Unknown token or invalid reading: {token}')
        unit = units[token]
        if unit['language'] != 'ja' or unit['voiceId'] != 'jf_alpha':
            raise ValueError(f'Only Japanese jf_alpha sources are supported: {token}')
        phones = render_phones(spoken)
        override = {'spoken':spoken,'phonemes':phones,'reason':'Manually authored kana reading'}
        _, input_sha = bank.input_fingerprint(gen,unit,override)
        fingerprint = digest(json.dumps([synthesis,'jf_alpha',phones],sort_keys=True).encode())
        fid = digest(json.dumps([fingerprint,bank.codec.ENCODING]).encode())[:32]
        bundle = inside(args.out,args.out/'clips'/(digest(token.encode())+'.json'))
        path = inside(args.out,args.out/'audio/generated/ja/jf_alpha'/(fid+'.m4a'))
        meta = inside(args.out,args.out/'media'/(fid+'.json'))
        plans.append((token,unit,spoken,phones,override,input_sha,bundle,path,meta))
    tmp = args.out/'tmp'
    tmp.mkdir(exist_ok=True, parents=True)
    if args.phase == 'render':
        if any(importlib.metadata.version(name) != version for name, version in gen['packages'].items()):
            raise ValueError('Installed synthesis packages differ from the recorded generation')
        for f,k in [('kokoro-v1.0.onnx','modelSha256'),('voices-v1.0.bin','voicesSha256')]:
            if digest((args.models/f).read_bytes()) != gen[k]:
                raise ValueError(f'Model checksum mismatch: {f}')
        opts = bank.ort.SessionOptions()
        opts.intra_op_num_threads = args.threads
        opts.inter_op_num_threads = 1
        bank.ort.set_seed(12345)
        session = bank.ort.InferenceSession(str(args.models/'kokoro-v1.0.onnx'), sess_options=opts, providers=['CPUExecutionProvider'])
        model = bank.Kokoro.from_session(session, str(args.models/'voices-v1.0.bin'))
    else:
        from faster_whisper import WhisperModel
        path = args.models/'whisper-large-v3'
        if digest((path/'model.bin').read_bytes()) != FULL_SHA:
            raise ValueError('Model checksum mismatch: whisper-large-v3')
        model = WhisperModel(str(path), device='cpu',compute_type='int8',cpu_threads=args.threads,num_workers=1,local_files_only=True)
        identity = dict(model=path.name,modelSha256=FULL_SHA,device='cpu',computeType='int8',beamSize=5,conditionOnPreviousText=False,prompt=None,vadFilter=False,packages={n:importlib.metadata.version(n) for n in ['faster-whisper','ctranslate2','av']})
    for i,(token,unit,spoken,phones,override,input_sha,bundle,path,meta) in enumerate(plans,1):
        if args.phase=='render':
            if not valid_media(cached(meta),path,args.out):
                assert not set(phones)-set(model.tokenizer.vocab),(token,phones,set(phones)-set(model.tokenizer.vocab))
                audio,rate = model.create(phones,voice='jf_alpha',speed=1.0,is_phonemes=True,trim=False)
                assert rate==bank.RATE
                bank.atomic(meta,bank.encode_bank(bank.codec.trim_edges(audio),path,tmp))
            clip = dict(read(meta),language='ja',voiceId='jf_alpha',text=unit['text'],spoken=spoken,inputSha256=input_sha,required=unit['required'],synthesisSpeed=1.0,phonemeSha256=digest(phones.encode()),asrStatus='pending')
            if unit.get('speaker'):clip['speaker']=unit['speaker']
            bank.atomic(bundle,dict(token=token,clip=clip,override=override))
        else:
            while args.await_render and not bundle.is_file():
                time.sleep(2)
            checkpoint = read(bundle)
            clip = checkpoint['clip']
            if (checkpoint.get('token') != token or checkpoint.get('override') != override
                    or clip.get('inputSha256') != input_sha or clip.get('text') != unit['text']
                    or clip.get('spoken') != spoken or clip.get('voiceId') != 'jf_alpha'
                    or clip.get('language') != 'ja' or clip.get('required') != unit['required']
                    or clip.get('speaker') != unit.get('speaker') or clip.get('synthesisSpeed') != 1.0
                    or clip.get('phonemeSha256') != digest(phones.encode())
                    or not valid_media(clip,path,args.out)):
                raise ValueError(f'Stale or invalid render checkpoint: {token}')
            fp=digest(json.dumps([identity,clip['sha256'],'ja'],sort_keys=True).encode())
            out=inside(args.out,args.out/'asr'/(fp+'.json'))
            if valid_asr(cached(out),identity,clip['sha256'],fp):continue
            start=time.monotonic()
            segments,_=model.transcribe(str(path),language='ja',task='transcribe',beam_size=5,condition_on_previous_text=False,initial_prompt=None,hotwords=None,vad_filter=False,temperature=0.0,word_timestamps=False)
            seg=[dict(start=s.start,end=s.end,text=s.text,avgLogprob=s.avg_logprob,noSpeechProb=s.no_speech_prob) for s in segments]
            bank.atomic(out,dict(generation=identity,sha256=clip['sha256'],fingerprint=fp,segments=seg,recognized=' '.join(s['text'].strip() for s in seg).strip(),elapsedSeconds=round(time.monotonic()-start,3)))
        if i%20==0 or i==len(readings): print(args.phase,i,'/',len(readings),flush=True)

if __name__=='__main__':
    main()
