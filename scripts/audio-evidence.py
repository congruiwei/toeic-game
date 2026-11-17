"""Shared completion gate for local generation, audit and retry authoring."""
import hashlib
from pathlib import Path
import re


def valid_asr(clip,record):
    if not isinstance(clip,dict) or not isinstance(record,dict):return False
    generation=record.get('recognitionGeneration')
    if not isinstance(generation,dict):return False
    if not (record.get('sha256')==clip.get('sha256') and record.get('expected')==clip.get('text') and
            record.get('spoken')==clip.get('spoken') and isinstance(record.get('recognized'),str) and record['recognized'].strip() and
            record.get('status') in ['matched','review','accepted'] and 'prompt' in generation and generation['prompt'] is None and
            generation.get('model') and re.fullmatch('[a-f0-9]{64}',generation.get('modelSha256','')) and
            generation.get('device')=='cpu' and generation.get('computeType')=='int8' and
            generation.get('conditionOnPreviousText') is False and generation.get('vadFilter') is False):return False
    if record.get('recognitionMethod')=='individual-beam5':
        return record.get('singleFileVerification') is True and generation.get('beamSize')==5
    if record.get('recognitionMethod')=='batch-beam1':
        screening=record.get('screening') or {}
        return (record.get('singleFileVerification') is False and generation.get('beamSize')==1 and
                screening.get('boundaryStable') is True and screening.get('normalizedExact') is True and
                bool(re.fullmatch('[a-f0-9]{64}',screening.get('batchId',''))))
    return False


def media_integrity(root,clip):
    src=clip.get('src','')
    if not re.fullmatch(r'\./audio/generated/(en|ja)/[a-z_]+/[a-f0-9]{32}\.m4a',src):
        return {'ok':False,'reason':'Invalid delivered media path'}
    target=Path(root)/src
    try:data=target.read_bytes()
    except OSError as error:return {'ok':False,'reason':f'Delivered media missing/unreadable: {error.__class__.__name__}'}
    digest=hashlib.sha256(data).hexdigest()
    if len(data)!=clip.get('bytes') or digest!=clip.get('sha256'):
        return {'ok':False,'reason':'Delivered media SHA or byte count differs','actualSha256':digest}
    return {'ok':True}
