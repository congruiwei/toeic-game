#!/usr/bin/env python3
"""Resumable, local CPU Kokoro authoring. Never changes original bank text."""
import argparse
import fcntl
import hashlib
import importlib.util
import importlib.metadata
import json
import os
from pathlib import Path
import re
import tempfile
import time
import unicodedata

import numpy as np
import onnxruntime as ort
import soundfile as sf
from kokoro_onnx import Kokoro
from num2words import num2words

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/audio'
RATE = 24000
evidence_spec=importlib.util.spec_from_file_location('audio_evidence',Path(__file__).with_name('audio-evidence.py'))
evidence=importlib.util.module_from_spec(evidence_spec)
evidence_spec.loader.exec_module(evidence)
spec = importlib.util.spec_from_file_location('audition_encoder', ROOT / 'scripts/generate-audition.py')
codec = importlib.util.module_from_spec(spec)
spec.loader.exec_module(codec)
sha = lambda value: hashlib.sha256(value).hexdigest()


def public_error(error, work=None):
    value = str(error)
    replacements = [(str(ROOT) + os.sep, ''), (str(ROOT), '<workspace>')]
    if work is not None: replacements.append((str(work), '<local audio workdir>'))
    replacements.append((str(Path.home()), '<home>'))
    for before, after in replacements:
        value = value.replace(before, after)
    # Historic/custom work directories may differ from today's configured
    # directory. Strip remaining absolute local paths only in error fields;
    # relative media paths and URL schemes remain useful diagnostics.
    return re.sub(r"(?<![:\w./])/(?!/)[A-Za-z_.][^'\"\n,;)\]]*",'<local path>',value)


def public_errors(value):
    if isinstance(value, dict):
        return {key:public_error(item) if key in ('error', 'containerError') and isinstance(item,str)
                else public_errors(item) for key,item in value.items()}
    if isinstance(value,list):return [public_errors(item) for item in value]
    return value


def atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    if OUT in path.parents:value=public_errors(value)
    # Unique staging names also prevent an unrelated interrupted authoring
    # process from sharing/truncating another writer's staging inode.
    with tempfile.NamedTemporaryFile(mode='w',encoding='utf8',dir=path.parent,
                                     prefix=path.name+'.',suffix='.tmp',delete=False) as stream:
        tmp=Path(stream.name)
        try:
            stream.write(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
            stream.flush()
            os.fsync(stream.fileno())
            tmp.replace(path)
        finally:tmp.unlink(missing_ok=True)


def read(path, default):
    for attempt in range(5):
        try:return json.loads(path.read_text(encoding='utf8'))
        except FileNotFoundError:return default
        except json.JSONDecodeError:
            # An external/non-atomic writer can briefly expose an empty file.
            # Persistent malformed evidence remains an error, never an empty
            # successful audit or silently discarded checkpoint.
            if attempt==4:raise
            time.sleep(.05*(attempt+1))


def encode_bank(audio, output, temp):
    # EBU R128 integrated loudness needs a 400 ms gate. Very short letter
    # names otherwise yield -inf even though the waveform contains speech.
    # Add trailing silence only; do not stretch, repeat or trim phonemes.
    padding=max(0,round(.5*RATE)-len(audio)) if len(audio)<round(.4*RATE) else 0
    if padding:audio=np.pad(audio,(0,padding))
    result=codec.encode(audio,output,temp)
    if padding:result['trailingSilenceAddedSeconds']=round(padding/RATE,6)
    return result


def japanese_number(value):
    if '.' in value:
        a, b = value.split('.', 1)
        return japanese_number(a) + '点' + ''.join('零一二三四五六七八九'[int(c)] for c in b)
    n = int(value)
    if n == 0:
        return '零'
    result = ''
    for unit, label in [(10**12, '兆'), (10**8, '億'), (10**4, '万')]:
        if n >= unit:
            result += japanese_number(str(n // unit)) + label
            n %= unit
    for unit, label in [(1000, '千'), (100, '百'), (10, '十')]:
        if n >= unit:
            a, n = divmod(n, unit)
            result += ('' if a == 1 else '零一二三四五六七八九'[a]) + label
    return result + ('零一二三四五六七八九'[n] if n else '')


def japanese_kana(n):
    """Cardinal reading for numeric measures; lexical kanji remain untouched."""
    n=int(n)
    digits=['れい','いち','に','さん','よん','ご','ろく','なな','はち','きゅう']
    if n<10:return digits[n]
    if n<100:return ('' if n//10==1 else digits[n//10])+'じゅう'+(digits[n%10] if n%10 else '')
    if n<1000:return {1:'ひゃく',3:'さんびゃく',6:'ろっぴゃく',8:'はっぴゃく'}.get(n//100,digits[n//100]+'ひゃく')+(japanese_kana(n%100) if n%100 else '')
    if n<10000:return {1:'せん',3:'さんぜん',8:'はっせん'}.get(n//1000,digits[n//1000]+'せん')+(japanese_kana(n%1000) if n%1000 else '')
    if n<10**8:return japanese_kana(n//10000)+'まん'+(japanese_kana(n%10000) if n%10000 else '')
    return japanese_number(str(n))


def japanese_decimal(value):
    whole,dot,fraction=str(value).partition('.')
    return japanese_kana(whole)+('てん'+''.join(japanese_kana(c) for c in fraction) if dot else '')


def japanese_count(n,counter):
    n=int(n)
    special={
        '分':{0:'れいふん',1:'いっぷん',2:'にふん',3:'さんぷん',4:'よんぷん',5:'ごふん',6:'ろっぷん',7:'ななふん',8:'はっぷん',9:'きゅうふん',10:'じゅっぷん'},
        '本':{0:'れいほん',1:'いっぽん',2:'にほん',3:'さんぼん',4:'よんほん',5:'ごほん',6:'ろっぽん',7:'ななほん',8:'はっぽん',9:'きゅうほん',10:'じゅっぽん'},
        '回':{0:'れいかい',1:'いっかい',2:'にかい',3:'さんかい',4:'よんかい',5:'ごかい',6:'ろっかい',7:'ななかい',8:'はっかい',9:'きゅうかい',10:'じゅっかい'},
        '階':{0:'れいかい',1:'いっかい',2:'にかい',3:'さんがい',4:'よんかい',5:'ごかい',6:'ろっかい',7:'ななかい',8:'はっかい',9:'きゅうかい',10:'じゅっかい'},
        '足':{0:'れいそく',1:'いっそく',2:'にそく',3:'さんぞく',4:'よんそく',5:'ごそく',6:'ろくそく',7:'ななそく',8:'はっそく',9:'きゅうそく',10:'じゅっそく'},
        '個':{0:'れいこ',1:'いっこ',2:'にこ',3:'さんこ',4:'よんこ',5:'ごこ',6:'ろっこ',7:'ななこ',8:'はっこ',9:'きゅうこ',10:'じゅっこ'}}[counter]
    if n in special:return special[n]
    if n%10:return japanese_kana(n-n%10)+special[n%10]
    if n%100:return (japanese_kana(n-n%100) if n>=100 else '')+(japanese_kana(n%100//10) if n%100>=20 else '')+special[10]
    if n%1000:
        hundreds=japanese_kana(n%1000)
        return (japanese_kana(n-n%1000) if n>=1000 else '')+hundreds[:-1]+'っ'+{'分':'ぷん','本':'ぽん','回':'かい','階':'かい','個':'こ','足':'そく'}[counter]
    return japanese_kana(n)+{'分':'ふん','本':'ぼん','回':'かい','階':'がい','個':'こ','足':'ぞく'}[counter]


def japanese_hour(n,duration=False):
    n=int(n)
    if duration:return ('よ' if n==4 else japanese_kana(n))+'じかん'
    if n%10 in [4,7,9]:return (japanese_kana(n-n%10) if n>=10 else '')+{4:'よ',7:'しち',9:'く'}[n%10]+'じ'
    return japanese_kana(n)+'じ'


def japanese_day(n,date=False):
    n=int(n)
    special={1:'ついたち' if date else 'いちにち',2:'ふつか',3:'みっか',4:'よっか',5:'いつか',6:'むいか',7:'なのか',8:'ようか',9:'ここのか',10:'とおか',14:'じゅうよっか',20:'はつか',24:'にじゅうよっか'}
    return special.get(n,japanese_kana(n)+'にち')


def japanese_numeric_context(t):
    # Convert *original digits* with their unit before cardinal kanji conversion.
    # In particular, lexical 十分 (sufficient) must never become ten minutes.
    t=re.sub(r'(?<!\d)(\d{1,2}):(\d{2})(?!\d)',lambda m:japanese_hour(m[1])+(japanese_count(m[2],'分') if m[2]!='00' else ''),t)
    months=['','いちがつ','にがつ','さんがつ','しがつ','ごがつ','ろくがつ','しちがつ','はちがつ','くがつ','じゅうがつ','じゅういちがつ','じゅうにがつ']
    t=re.sub(r'(?<=月)[ \t]*(\d{1,2})日',lambda m:japanese_day(m[1],True),t)
    t=re.sub(r'(?<!\d)(1[0-2]|[1-9])[ \t]*月',lambda m:months[int(m[1])],t)
    t=re.sub(r'(?<!\d)(\d+)[ \t]*時間',lambda m:japanese_hour(m[1],True),t)
    t=re.sub(r'(?<!\d)(\d+)[ \t]*時(?!間)',lambda m:japanese_hour(m[1]),t)
    t=re.sub(r'(?<!\d)(\d+)[ \t]*分の[ \t]*(\d+)',lambda m:' '+japanese_kana(m[1])+'ぶんの'+japanese_kana(m[2])+' ',t)
    t=re.sub(r'(?<!\d)(\d+)[ \t]*(本|回|階|個|足)',lambda m:japanese_count(m[1],m[2]),t)
    t=re.sub(r'(?<!\d)(\d+)[ \t]*分(?!割|配|野)',lambda m:japanese_count(m[1],'分'),t)
    t=re.sub(r'(?<!\d)(\d+)[ \t]*人',lambda m:{1:'ひとり',2:'ふたり',4:'よにん'}.get(int(m[1]),japanese_kana(m[1])+'にん'),t)
    t=re.sub(r'(?<!\d)(\d+)[ \t]*枚',lambda m:japanese_kana(m[1])+'まい',t)
    t=re.sub(r'(?<!\d)(\d+)[ \t]*日',lambda m:japanese_day(m[1]),t)
    t=re.sub(r'(?<!\d)(\d+(?:\.\d+)?)[ \t]*(ドル|セント|ポイント)',lambda m:japanese_decimal(m[1])+m[2],t)
    return t.replace('百回','ひゃっかい')


def normalize(text, language):
    """Only the TTS input changes; the source and manifest text remain verbatim."""
    t = unicodedata.normalize('NFKC', text).replace('\u00a0', ' ')
    t = re.sub(r'\[[1-4]\]', ' ', t)
    t = re.sub(r'_{3,}', ' blank ' if language == 'en' else ' 空欄 ', t)
    t = t.replace('|', ', ' if language == 'en' else '、')
    t = t.replace('→', ' to ' if language == 'en' else 'から').replace('↔', ' and ' if language == 'en' else 'と')
    t = t.replace('–', '-').replace('—', ', ').replace('·', ', ')
    t = re.sub(r'(?<=\d),(?=\d{3}(?:\D|$))', '', t)
    if language == 'en':
        if re.fullmatch(r'[A-Z]', t.strip()):t=t.strip()+'.'
        t = re.sub(r'(\d{1,2}:\d{2})\s*[-~]\s*(\d{1,2}:\d{2})',r'\1 to \2',t)
        # Full stops disambiguate letter names: A four alone becomes the
        # indefinite article, while A. four is the actual letter /eɪ/.
        t = re.sub(r'\b([A-Z]{1,5})(\d+)\b', lambda m:' '.join(c+'.' for c in m[1])+' '+m[2],t)
        t = re.sub(r'(?<![A-Za-z])mm(?![A-Za-z])',' millimeters ',t)
        t = re.sub(r'\b(\d{1,2}):(\d{2})\b', lambda m: num2words(int(m[1])) + (' o clock' if m[2] == '00' else (' oh ' if int(m[2]) < 10 else ' ') + num2words(int(m[2]))), t)
        t = re.sub(r'\$(\d+(?:\.\d+)?)', lambda m: num2words(float(m[1]) if '.' in m[1] else int(m[1])) + (' dollar' if float(m[1]) == 1 else ' dollars'), t)
        t = re.sub(r'\b(\d+)(st|nd|rd|th)\b', lambda m: num2words(int(m[1]), to='ordinal'), t, flags=re.I)
        t = re.sub(r'\b(\d+(?:\.\d+)?)%', lambda m: num2words(float(m[1]) if '.' in m[1] else int(m[1])) + ' percent', t)
        t = re.sub(r'\d+(?:\.\d+)?', lambda m: num2words(float(m[0]) if '.' in m[0] else int(m[0])), t)
        t = t.replace('&', ' and ').replace('/', ' slash ')
    else:
        t = re.sub(r'(?<=\d)\s*[-~]\s*(?=\d)', 'から', t)
        t = t.replace('-', ' ').replace('~', '').replace('〜', '')
        t = t.replace('(', '、').replace(')', '、').replace('「', '').replace('」', '').replace('"', '')
        # The pinned Japanese lexicon incorrectly voices 数本 as すうぽん.
        # Explicit kana repairs the reading while display text stays unchanged.
        t = t.replace('過去形', 'かこけい').replace('数本', 'すうほん')
        t = re.sub(r'(\d+(?:\.\d+)?)[ \t]*mm(?![A-Za-z])',lambda m:japanese_decimal(m[1])+' ミリメートル',t)
        t = re.sub(r'(?<![A-Za-z])mm(?![A-Za-z])','ミリメートル',t)
        t = japanese_numeric_context(t)
        alphabet = dict(zip('ABCDEFGHIJKLMNOPQRSTUVWXYZ', ['エー','ビー','シー','ディー','イー','エフ','ジー','エイチ','アイ','ジェー','ケー','エル','エム','エヌ','オー','ピー','キュー','アール','エス','ティー','ユー','ブイ','ダブリュー','エックス','ワイ','ゼット']))
        t = re.sub(r'(?<![A-Za-z])([A-Z]{1,5})(\d+)(?![A-Za-z\d])',lambda m:' '.join(alphabet[c] for c in m[1])+' '+japanese_kana(m[2]),t)
        t = re.sub(r'(?<![A-Za-z])([A-Z]{1,5})(?=[^A-Za-z]|$)', lambda m: ' '.join(alphabet[c] for c in m[1])+' ', t)
        t = re.sub(r'\$\s*(\d+(?:\.\d+)?)', lambda m: japanese_decimal(m[1])+'ドル', t)
        t = re.sub(r'(\d+(?:\.\d+)?)%', lambda m: japanese_decimal(m[1])+'パーセント', t)
        t = re.sub(r'\d+(?:\.\d+)?', lambda m: japanese_number(m[0]), t)
        t = t.replace('一回', 'いっかい').replace('&', '、').replace('/', '、')
    return re.sub(r'\s+', ' ', t).strip()


def phonemize(spoken, language, engines):
    def english():
        if 'en' not in engines:
            from misaki import en, espeak
            engines['en'] = en.G2P(british=False, fallback=espeak.EspeakFallback(british=False))
        return engines['en']
    if language == 'en':
        return english()(spoken)[0]
    if 'ja' not in engines:
        from misaki import ja
        engines['ja'] = ja.JAG2P()
    # Japanese packs deliberately retain English names. Cutlet otherwise emits
    # those raw Latin strings as if they were model phonemes, which is incorrect.
    pieces = re.split(r"([A-Za-z]+(?:['’.-][A-Za-z]+)*(?: +[A-Za-z]+(?:['’.-][A-Za-z]+)*)*)", spoken)
    result = ' '.join(english()(piece)[0] if re.fullmatch(r"[A-Za-z][A-Za-z '.’-]*",piece) else engines['ja'](piece)[0]
                      for piece in pieces if piece.strip())
    return result.replace('«','"').replace('»','"')


def audit_records(language, bank):
    return read(OUT / 'audit' / language / (bank + '.json'), {}).get('records', {})


def input_fingerprint(generation,unit,override=None):
    """Exact synthesis-input binding shared with reviewed correction delivery."""
    override=override or {}
    synthesis={k:generation[k] for k in ['recipe','modelSha256','voicesSha256','packages']}
    spoken=override.get('spoken',normalize(unit['text'],unit['language']))
    speed=float(override.get('speed',1.0))
    if not .75<=speed<=1.2:raise ValueError('Invalid speed override')
    payload=[synthesis,generation.get('encoding',codec.ENCODING),unit['voiceId'],spoken,override.get('phonemes')]
    if speed!=1.0:payload.append({'speed':speed})
    if unit['language']=='ja' and re.search('[A-Za-z]',spoken):payload.append('mixed-japanese-v1')
    return spoken,sha(json.dumps(payload,sort_keys=True).encode())


def flush(source, source_hash, generation, packs):
    rows = []
    expected = {}
    required = {}
    for u in source['units']:
        if u.get('nonSpoken'):continue
        expected[(u['language'], u['bank'])] = expected.get((u['language'], u['bank']), 0) + 1
        if u.get('required',True):
            required.setdefault((u['language'],u['bank']),set()).add(u['key'])
    total = {'count': 0, 'expected': sum(expected.values()),'sourceUnits':len(source['units']),
             'nonSpoken':sum(bool(u.get('nonSpoken')) for u in source['units']),'requiredExpected':sum(map(len,required.values())),
             'requiredCount':0,'requiredAudited':0,'audioBytes': 0, 'duration': 0}
    all_files = {}
    audited = 0
    for pair, count in expected.items():
        language, bank = pair
        pack = packs.setdefault(pair, {'version': 1, 'language': language, 'bank': bank, 'clips': {}})
        clips = pack['clips']
        checks = audit_records(language, bank)
        for key, clip in clips.items():
            review = checks.get(key, {})
            clip['asrStatus'] = review['status'] if evidence.valid_asr(clip,review) else 'pending'
            if clip['asrStatus'] in ('matched', 'review', 'accepted'):
                audited += 1
                if key in required.get(pair,set()):total['requiredAudited']+=1
        required_count=len(set(clips)&required.get(pair,set()))
        required_expected=len(required.get(pair,set()))
        pack.update(sourceSha256=source_hash, generation=generation, complete=len(clips) == count,
                    requiredComplete=required_count==required_expected)
        target = OUT / language / (bank + '.json')
        atomic(target, pack)
        payload = target.read_bytes()
        unique = {c['src']: c for c in clips.values()}
        rows.append({'bank': bank, 'language': language, 'src': './' + target.relative_to(ROOT).as_posix(),
                     'count': len(clips), 'expected': count, 'requiredCount':required_count,'requiredExpected':required_expected,
                     'requiredComplete':pack['requiredComplete'],'bytes': len(payload), 'sha256': sha(payload),
                     'duration': round(sum(c['duration'] for c in unique.values()), 3),
                     'audioBytes': sum(c['bytes'] for c in unique.values()), 'complete': pack['complete']})
        all_files.update(unique)
        total['count'] += len(clips)
        total['requiredCount'] += required_count
    total.update(files=len(all_files), audioBytes=sum(c['bytes'] for c in all_files.values()),
                 duration=round(sum(c['duration'] for c in all_files.values()), 3), asrReviewed=audited)
    atomic(OUT / 'manifest.json', {'version': 1, 'model': source['model'], 'voices': source['voices'],
           'sourceSha256': source_hash, 'generation': generation, 'complete': total['count'] == total['expected'],
           'requiredComplete':total['requiredCount']==total['requiredExpected'],
           'requiredAuditComplete':total['requiredAudited']==total['requiredExpected'],
           'auditComplete': audited == total['expected'], 'packs': rows, 'totals': total})


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--workdir', type=Path, default=Path.home()/'.local/share/toeic-kokoro')
    p.add_argument('--threads', type=int, default=4)
    p.add_argument('--limit', type=int)
    p.add_argument('--benchmark', type=int, help='Generate a stratified sample, then stop')
    p.add_argument('--language', choices=['en', 'ja'])
    p.add_argument('--banks', nargs='+')
    p.add_argument('--keys', nargs='+')
    p.add_argument('--tokens-file', type=Path, help='JSON array of exact language:bank:key tokens')
    p.add_argument('--force', action='store_true', help='Recreate selected files, retaining before/after provenance')
    p.add_argument('--include-optional', action='store_true', help='Also generate optional point-to-read material')
    p.add_argument('--sync-only', action='store_true')
    args = p.parse_args()
    work = args.workdir.resolve()
    if work == ROOT or ROOT in work.parents:
        p.error('Keep workdir outside the checkout')
    temp = work/'tmp/bank-audio'
    temp.mkdir(parents=True, exist_ok=True)
    writer_lock=(work/'bank-generate.lock').open('a')
    fcntl.flock(writer_lock,fcntl.LOCK_EX)
    source_bytes = (OUT/'source.json').read_bytes()
    source, source_hash = json.loads(source_bytes), sha(source_bytes)
    overrides = read(OUT/'overrides.json', {'entries': {}})['entries']
    model, voicefile = work/'models/kokoro-v1.0.onnx', work/'models/voices-v1.0.bin'
    synthesis = {'recipe': codec.RECIPE, 'modelSha256': sha(model.read_bytes()), 'voicesSha256': sha(voicefile.read_bytes()),
                 'packages': {n: importlib.metadata.version(n) for n in ['kokoro-onnx','misaki','onnxruntime','soundfile','numpy']}}
    generation = {**synthesis, 'encoding': codec.ENCODING, 'sourceSha256': source_hash,
                  'normalization': 'bank-v3-japanese-contextual-numbers', 'overridesSha256': sha(json.dumps(overrides, sort_keys=True).encode())}
    packs = {}
    for u in source['units']:
        pair = (u['language'], u['bank'])
        if pair not in packs:
            old = read(OUT/pair[0]/(pair[1]+'.json'), {})
            # Entry input hashes decide reuse; adding unrelated sources does not discard audio.
            packs[pair] = {'version': 1, 'language': pair[0], 'bank': pair[1], 'clips': old.get('clips', {})}
    valid = {(u['language'], u['bank'], u['key']) for u in source['units'] if not u.get('nonSpoken')}
    for pair, pack in packs.items():
        pack['clips'] = {k: v for k, v in pack['clips'].items() if (*pair, k) in valid}
    planned, retired, integrity_failures = {}, {}, {}
    for u in source['units']:
        if u.get('nonSpoken'):continue
        token = f"{u['language']}:{u['bank']}:{u['key']}"
        override = overrides.get(token, {})
        spoken,input_sha=input_fingerprint(generation,u,override)
        planned[token] = (override, spoken, input_sha)
        clips = packs[(u['language'],u['bank'])]['clips']
        if u['key'] in clips:
            check=evidence.media_integrity(ROOT,clips[u['key']])
            if not check['ok']:
                integrity_failures[token]=check
                retired[token]=clips.pop(u['key'])
        if u['key'] in clips and clips[u['key']].get('inputSha256') != input_sha:
            retired[token] = clips.pop(u['key'])
        if u['key'] in clips:
            # Metadata changes do not require fresh synthesis. Keep even older
            # stratified benchmark entries ready before their turn in the run.
            clips[u['key']].update(text=u['text'],required=u.get('required',True))
            if u.get('speaker'):clips[u['key']]['speaker']=u['speaker']
            else:clips[u['key']].pop('speaker',None)
    if args.sync_only:
        flush(source, source_hash, generation, packs)
        writer_lock.close()
        return
    options = ort.SessionOptions()
    options.intra_op_num_threads = args.threads
    options.inter_op_num_threads = 1
    ort.set_seed(12345)
    kokoro = Kokoro.from_session(ort.InferenceSession(str(model), sess_options=options, providers=['CPUExecutionProvider']), str(voicefile))
    phonemizers, phones, emitted = {}, {}, {}
    for pack in packs.values():
        for clip in pack['clips'].values():
            if (ROOT/clip['src']).exists():
                emitted[Path(clip['src']).stem] = {k:v for k,v in clip.items() if k not in ('voiceId','language','text','spoken','inputSha256','asrStatus','required','speaker')}
    selected_tokens=set(read(args.tokens_file,[])) if args.tokens_file else None
    chosen = [u for u in source['units'] if (not args.language or u['language'] == args.language)
              and (not args.banks or u['bank'] in args.banks) and (not args.keys or u['key'] in args.keys)
              and (selected_tokens is None or f"{u['language']}:{u['bank']}:{u['key']}" in selected_tokens)
              and not u.get('nonSpoken') and (u.get('required',True) or args.include_optional or args.benchmark or args.keys or selected_tokens is not None)]
    if args.benchmark:
        chosen = [chosen[round(i*(len(chosen)-1)/(args.benchmark-1))] for i in range(args.benchmark)]
    else:
        # Finish the learning material before optional explanations and distractor glossaries.
        chosen.sort(key=lambda u:u.get('priority',1))
    if args.limit and not args.benchmark:
        chosen = chosen[:args.limit]
    failures = read(OUT/'generation-errors.json', {'errors': {}})['errors']
    history_path = OUT/'regenerations.json'
    history = read(history_path, {'version': 1, 'events': []})
    started, made, reused, audio_seconds = time.monotonic(), 0, 0, 0
    inference_seconds, encoding_seconds = 0, 0
    timings = []
    for index, u in enumerate(chosen):
        token = f"{u['language']}:{u['bank']}:{u['key']}"
        stamp = time.monotonic()
        inferred, encoded = 0, 0
        try:
            language, vid = u['language'], u['voiceId']
            override, spoken, input_sha = planned[token]
            speed=float(override.get('speed',1.0))
            if not spoken or re.search(r'\[[1-4]\]|\d|\$', spoken):
                raise ValueError('Unresolved numeric/empty spoken input')
            previous = packs[(language,u['bank'])]['clips'].get(u['key']) or retired.get(token)
            if previous and token not in integrity_failures and not args.force and previous.get('inputSha256') == input_sha and (ROOT/previous['src']).exists():
                previous['text'] = u['text']
                previous['required'] = u.get('required',True)
                if u.get('speaker'):previous['speaker']=u['speaker']
                reused += 1
                failures.pop(token, None)
                continue
            cache_key = (language,spoken,override.get('phonemes'),u['kind']=='label')
            if cache_key not in phones:
                phonemes = override.get('phonemes') or phonemize(spoken,language,phonemizers)
                if u['kind'] == 'label':
                    phonemes = {'A.':'ˈA','B.':'bˈi','C.':'sˈi','D.':'dˈi'}[u['text']]
                missing = set(phonemes) - set(kokoro.tokenizer.vocab)
                if not phonemes.strip() or '❓' in phonemes or missing:
                    raise ValueError(f'Unsupported phonemes: {sorted(missing)} / {phonemes}')
                phones[cache_key] = phonemes
            phonemes = phones[cache_key]
            dependencies=[synthesis, vid, phonemes]
            if speed!=1.0:dependencies.append({'speed':speed})
            fingerprint = sha(json.dumps(dependencies, sort_keys=True).encode())
            file_id = sha(json.dumps([fingerprint, codec.ENCODING]).encode())[:32]
            path = ROOT/'audio/generated'/language/vid/(file_id+'.m4a')
            if file_id in emitted and not args.force:
                record = dict(emitted[file_id])
            else:
                # Existing audition WAVs are mathematically identical inputs.
                wav = temp/(fingerprint+'.wav')
                old_wav = work/'tmp/audition'/(fingerprint+'.wav')
                if wav.exists() or old_wav.exists():
                    audio, rate = sf.read(wav if wav.exists() else old_wav, dtype='float32')
                else:
                    inference_start=time.monotonic()
                    audio, rate = kokoro.create(phonemes, voice=vid, speed=speed, is_phonemes=True, trim=False)
                    inferred=time.monotonic()-inference_start
                    audio = codec.trim_edges(audio)
                    sf.write(wav, audio, RATE, subtype='FLOAT')
                if rate != RATE:
                    raise ValueError('Unexpected sample rate')
                encoding_start=time.monotonic()
                record = encode_bank(audio,path,temp)
                encoded=time.monotonic()-encoding_start
                record['phonemeSha256'] = sha(phonemes.encode())
                emitted[file_id] = dict(record)
                atomic(temp/(fingerprint+'.json'), {**u,'spoken':spoken,'phonemes':phonemes,'generation':generation})
            record.update(voiceId=vid,language=language,text=u['text'],spoken=spoken,inputSha256=input_sha,
                          asrStatus='pending',required=u.get('required',True),synthesisSpeed=speed)
            if u.get('speaker'):record['speaker']=u['speaker']
            packs[(language,u['bank'])]['clips'][u['key']] = record
            if previous:
                history['events'].append({'key':u['key'],'bank':u['bank'],'language':language,'beforeSha256':previous['sha256'],
                    'afterSha256':record['sha256'],'reason':override.get('reason','Synthesis input or encoding changed'),
                    'synthesisSpeed':speed,'actualInferenceSeconds':round(inferred,3),'waveformCacheReused':inferred==0,
                    'priorMediaIntegrityFailure':integrity_failures.get(token)})
            failures.pop(token,None)
            made += 1
            inference_seconds+=inferred
            encoding_seconds+=encoded
            audio_seconds += record['duration']
            timings.append({'language':language,'bank':u['bank'],'duration':record['duration'],'elapsed':round(time.monotonic()-stamp,3),
                            'inferenceSeconds':round(inferred,3),'encodingSeconds':round(encoded,3)})
        except Exception as error:
            failures[token] = {'key':u['key'],'bank':u['bank'],'language':u['language'],'error':public_error(error,work)}
        if (index+1)%10 == 0:
            flush(source,source_hash,generation,packs)
            atomic(OUT/'generation-errors.json',{'version':1,'errors':failures})
            atomic(history_path,history)
            print(json.dumps({'processed':index+1,'selected':len(chosen),'generated':made,'reused':reused,'errors':len(failures),
                  'audioSeconds':round(audio_seconds,1),'elapsedSeconds':round(time.monotonic()-started,1),
                  'inferenceSeconds':round(inference_seconds,1),'encodingSeconds':round(encoding_seconds,1)}),flush=True)
    flush(source,source_hash,generation,packs)
    atomic(OUT/'generation-errors.json',{'version':1,'errors':failures})
    atomic(history_path,history)
    result={'generated':made,'reused':reused,'errors':len(failures),'elapsedSeconds':round(time.monotonic()-started,2),
            'audioSeconds':round(audio_seconds,2),'measurements':timings}
    atomic(OUT/('benchmark.json' if args.benchmark else 'generation-run.json'),result)
    print(json.dumps({k:v for k,v in result.items() if k!='measurements'}),flush=True)
    writer_lock.close()


if __name__ == '__main__':
    main()
