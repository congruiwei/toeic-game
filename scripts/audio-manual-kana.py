"""Independent evidence gate for manually authored Japanese kana deliveries.

No model, tagger, filesystem, or network access. Failed/empty actual recognition
is retained as an attempted check; it can never authorize a recorded route.
"""
import copy
import hashlib
import json
import math
import re

METHOD='manually-authored-japanese-kana-v1'
MODEL='whisper-large-v3'
MODEL_SHA='69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1'
FIELDS=('src','sha256','bytes','duration','decodedPeak','headroomDb','language','voiceId','text','spoken','inputSha256','required','synthesisSpeed','phonemeSha256','speaker')

def sha(data):return hashlib.sha256(data if isinstance(data,bytes) else data.encode()).hexdigest()
def canonical(value):return json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':'))
def same_json(a,b):
    """JSON numbers survive a JS round trip; booleans are never numbers."""
    if type(a) in (int,float) and type(b) in (int,float):return math.isfinite(a) and math.isfinite(b) and a==b
    if type(a) is not type(b):return False
    if isinstance(a,dict):return a.keys()==b.keys() and all(same_json(a[k],b[k]) for k in a)
    if isinstance(a,list):return len(a)==len(b) and all(same_json(x,y) for x,y in zip(a,b))
    return a==b
def signed_snapshot(raw,value,digest_):
    # Hash the original signed serialization, not a later JSON writer's 0/0.0
    # spelling. Compare its parsed payload strictly, as the Node gate does.
    try:return isinstance(raw,str) and sha(raw)==digest_ and same_json(json.loads(raw),value)
    except (ValueError,TypeError,OverflowError):return False
def token(u):return ':'.join((u['language'],u['bank'],u['key']))
def need(ok,message):
    if not ok:raise ValueError(message)
def digest(value):return isinstance(value,str) and bool(re.fullmatch('[a-f0-9]{64}',value))
def finite(value):return type(value) in (int,float) and math.isfinite(value)
def binding(c):return {k:c[k] for k in FIELDS if k in c}
def history(value):
    if isinstance(value,list):return [history(v) for v in value]
    if isinstance(value,dict):return {k:history(v) for k,v in value.items() if k!='archive'}
    return value
def historical_sha(value):return sha(canonical(history(value)))
def delivery_sha(value):return sha(canonical({k:v for k,v in value.items() if k!='manualKanaSupersession'}))
def attempt_id(a):return sha(canonical({k:v for k,v in a.items() if k not in ('id','archive','proofCanonical')}))

def valid_reading(value):
    return isinstance(value,str) and bool(value.strip()) and not re.search(r'[^\u3041-\u3096ー— 、。，？！；：・「」『』（）、…,.!?:;“”()\n\t　]',value)

def validate_attempt(unit,a,row,validate_original):
    need(isinstance(unit,dict) and unit.get('language')=='ja' and unit.get('voiceId')=='jf_alpha' and unit.get('required') is True and not unit.get('nonSpoken'),'Invalid manual-kana source')
    need(isinstance(a,dict) and a.get('version')==1 and a.get('method')==METHOD and a.get('token')==token(unit),'Manual-kana identity changed')
    need(signed_snapshot(a.get('proofCanonical'),{k:v for k,v in a.items() if k not in ('id','archive','proofCanonical')},a.get('id')),'Manual-kana proof digest changed')
    expected={k:unit[k] for k in ('language','bank','key','text','voiceId','required','speaker') if k in unit}
    need(a.get('source')==expected and valid_reading(a.get('reading')),'Manual reading/source binding changed')
    old=a.get('before',{});repair=row.get('repair',{})
    need(repair.get('complete') is True and repair.get('disposition')=='system-fallback' and signed_snapshot(old.get('repairCanonical'),history(repair),old.get('repairSha256')),'Original fallback repair changed')
    f=old.get('fallback',{});previous=repair.get('candidate',{})
    need(f.get('playback')=='system' and f.get('language')=='ja' and f.get('text')==unit['text'] and f.get('voiceId')==unit['voiceId'] and f.get('reason')=='unresolved-after-strong-asr-retry' and f.get('auditedSha256')==previous.get('clip',{}).get('sha256'),'Original fallback binding changed')
    for version in (repair.get('original',{}),previous):
        need(validate_original(version.get('clip'),version.get('asr')),'Original actual fallback evidence missing')
    need(old.get('audit')==previous.get('asr'),'Original fallback transcript changed')
    c=a.get('candidate',{}).get('clip',{});r=a.get('candidate',{}).get('asr',{});o=a.get('override',{})
    need(all(c.get(k)==unit.get(k) for k in ('language','text','voiceId','required')) and c.get('speaker')==unit.get('speaker') and not any(k in c for k in ('sourceVoiceId','voiceOverrideInput')),'New media source/casting changed')
    need(digest(c.get('sha256')) and c['sha256']!=previous['clip']['sha256'] and re.fullmatch(r'\./audio/generated/ja/jf_alpha/[a-f0-9]{32}\.m4a',c.get('src','')),'New media path/SHA invalid')
    need(type(c.get('bytes')) is int and c['bytes']>0 and finite(c.get('duration')) and c['duration']>0 and finite(c.get('decodedPeak')) and .005<c['decodedPeak']<=.95,'New media metadata invalid')
    need(c.get('spoken')==a['reading']==o.get('spoken') and isinstance(o.get('phonemes'),str) and o['phonemes'] and c.get('phonemeSha256')==sha(o['phonemes']) and c.get('synthesisSpeed')==1 and o.get('speed',1)==1,'Manual kana/phoneme binding changed')
    need(not set(o)-{'spoken','phonemes','reason','speed'},'Unexpected manual synthesis override')
    raw_input=a.get('inputFingerprintInput');need(isinstance(raw_input,str) and sha(raw_input)==c.get('inputSha256'),'Manual synthesis fingerprint changed')
    generation=a.get('synthesisGeneration',{});synthesis={k:generation.get(k) for k in ('recipe','modelSha256','voicesSha256','packages')}
    need(json.loads(raw_input)==[synthesis,generation.get('encoding'),'jf_alpha',a['reading'],o['phonemes']],'Manual synthesis recipe changed')
    need(digest(a.get('rendererSha256')) and digest(a.get('readingsSha256')),'Manual author/renderer provenance missing')
    raw=a.get('rawASR',{});g=raw.get('generation',{})
    need(g.get('model')==MODEL and g.get('modelSha256')==MODEL_SHA and g.get('device')=='cpu' and g.get('computeType')=='int8' and g.get('beamSize')==5 and g.get('conditionOnPreviousText') is False and 'prompt' in g and g['prompt'] is None and g.get('hotwords') is None and g.get('vadFilter') is False,'Actual full-model identity missing')
    need(raw.get('sha256')==c['sha256'] and isinstance(raw.get('recognized'),str) and not raw.get('error'),'Actual recognition checkpoint missing')
    fp=a.get('asrFingerprintInput');need(isinstance(fp,str) and json.loads(fp)==[g,c['sha256'],'ja'] and sha(fp)==raw.get('fingerprint'),'Actual recognition fingerprint changed')
    segments=raw.get('segments');need(isinstance(segments,list),'Actual recognition segments missing')
    for seg in segments:
        need(isinstance(seg,dict) and isinstance(seg.get('text'),str) and finite(seg.get('start')) and finite(seg.get('end')) and 0<=seg['start']<=seg['end'],'Actual segment metadata invalid')
    need(' '.join(s['text'].strip() for s in segments).strip()==raw['recognized'],'Actual transcript differs from segments')
    need(r.get('key')==unit['key'] and all(r.get(k)==c.get(k) for k in ('src','sha256','voiceId','spoken')) and r.get('expected')==c['text'] and r.get('recognized')==raw['recognized'] and r.get('segments')==segments and r.get('recognitionGeneration')==g and r.get('fingerprint')==raw['fingerprint'] and r.get('recognitionMethod')=='individual-beam5' and r.get('singleFileVerification') is True,'Published check differs from actual ASR')
    cmp=r.get('comparison',{});p=cmp.get('provenance',{})
    need(cmp.get('ruleVersion')=='strict-audio-equivalence-1' and cmp.get('audioSha256')==c['sha256'] and cmp.get('expectedSpoken')==c['spoken'] and cmp.get('recognized')==r['recognized'] and cmp.get('language')=='ja' and type(cmp.get('equivalent')) is bool and isinstance(cmp.get('reasons'),list) and cmp['reasons'] and all(isinstance(x,str) and x for x in cmp['reasons']),'Manual comparison binding invalid')
    need(p.get('sourceTextSha256')==sha(c['text']) and all(digest(p.get(k)) for k in ('ruleFileSha256','normalizerFileSha256')) and p.get('ruleFileSha256')==p.get('normalizerFileSha256') and p.get('comparison')==p.get('normalizer')=='manual-kana-asr-only-1' and p.get('phonemeOverride') is True and p.get('articlePolicyEnabled') is False and (not cmp.get('equivalent') or cmp.get('readingTrace',{}).get('expected')==[] and isinstance(cmp.get('readingTrace',{}).get('recognized'),list)),'Manual comparison provenance missing')
    matched=cmp['equivalent']
    if matched:need(raw['recognized'].strip() and isinstance(cmp.get('proofExpected'),str) and cmp['proofExpected'].strip() and cmp['proofExpected']==cmp.get('proofRecognized'),'Empty/unproven recognition cannot pass')
    expected_status='matched' if matched else ('review' if raw['recognized'].strip() else 'error')
    need(r.get('status')==c.get('asrStatus')==expected_status and a.get('disposition')==('recorded-matched' if matched else 'system-fallback'),'Manual decision differs from actual comparison')
    need(a.get('recognitionAttempted') is True and a.get('originalAudioReplaced') is matched,'Manual completion claim invalid')
    return True

def find_attempt(row,identifier):
    matches=[a for a in row.get('manualKanaAttempts',[]) if a.get('id')==identifier]
    need(len(matches)==1,'Missing/duplicate manual-kana attempt')
    return matches[0]

def valid_record(unit,clip,record,row,validate_original):
    try:
        identifier=clip.get('manualKanaId');need(digest(identifier) and record.get('manualKanaId')==identifier,'Manual route marker missing')
        a=find_attempt(row,identifier);validate_attempt(unit,a,row,validate_original)
        c=a['candidate']['clip'];r=a['candidate']['asr']
        need(a['disposition']=='recorded-matched' and {k:v for k,v in clip.items() if k!='manualKanaId'}==c and clip.get('asrStatus')=='matched','Manual matched media differs')
        need({k:v for k,v in record.items() if k!='manualKanaId'}==r,'Manual current transcript changed')
        return True
    except (ValueError,KeyError,TypeError,AttributeError,IndexError):return False

def valid_supersession(unit,clip,record,row,delivery,validate_original):
    try:
        s=delivery.get('manualKanaSupersession',{})
        return bool(s.get('method')==METHOD and s.get('attemptId')==clip.get('manualKanaId') and signed_snapshot(s.get('priorDeliveryCanonical'),{k:v for k,v in delivery.items() if k!='manualKanaSupersession'},s.get('priorDeliverySha256')) and valid_record(unit,clip,record,row,validate_original))
    except (ValueError,KeyError,TypeError,AttributeError):return False
