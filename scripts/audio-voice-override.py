"""Bounded alternate casting for heads and exact user-reviewed English sources."""
import re
VOICES={'af_heart','am_puck','af_bella'}
# Exact user-reviewed sources; no general dialogue/sentence recasting.
REVIEWED_SOURCES={('listening', 'p4-g01-q3/options/0/0'): ('An order number', 'am_puck'), ('listening', 'p4-g26-q1/options/2/0'): ('A8', 'af_bella'), ('reading', 'read-sound-bag/documents/2/text/6'): ('Ina: Thanks.', 'af_bella'), ('reading', 'read-sound-check/documents/0/text/0'): ('Nell: I tested guide 14.', 'af_bella'), ('labels', 'labels/af_bella/A'): ('A.', 'af_bella'), ('labels', 'labels/am_puck/A'): ('A.', 'am_puck'), ('labels', 'labels/am_puck/B'): ('B.', 'am_puck')}

def reviewed_source(unit):
    return bool(unit and unit.get("language")=="en" and not unit.get("speaker") and
        REVIEWED_SOURCES.get((unit.get("bank"),unit.get("key")))==(unit.get("text"),unit.get("voiceId")))

def eligible(unit):
    return reviewed_source(unit) or bool(unit and unit.get('language')=='en' and unit.get('bank')=='vocab' and
        unit.get('key','').endswith('/meaning') and unit.get('kind','meaning')=='meaning' and
        unit.get('required',True) and not unit.get('speaker') and
        re.fullmatch(r"[A-Za-z]+(?:[-'][A-Za-z]+)*",unit.get('text','')) and unit.get('voiceId') in VOICES)

def source_voice(clip):
    return (clip or {}).get('sourceVoiceId',(clip or {}).get('voiceId'))

def selected_voice(unit,override=None):
    override=override or {}; voice=override.get('voiceId',unit['voiceId'])
    if 'voiceId' in override and (not eligible(unit) or voice not in VOICES or
            not isinstance(override.get('phonemes'),str) or not override['phonemes'].strip()):
        raise ValueError('Voice override requires a reviewed independent English vocabulary head')
    return voice

def matches_source(unit,clip):
    if not clip or any(clip.get(k)!=unit.get(k) for k in ['text','language']):return False
    if source_voice(clip)!=unit.get('voiceId'):return False
    if clip.get('voiceId')==unit.get('voiceId'):
        return 'sourceVoiceId' not in clip or clip['sourceVoiceId']==unit['voiceId']
    return eligible(unit) and clip.get('voiceId') in VOICES and clip.get('sourceVoiceId')==unit['voiceId']

def matches_selection(unit,clip,override=None):
    try:return matches_source(unit,clip) and clip.get('voiceId')==selected_voice(unit,override)
    except (ValueError,KeyError,TypeError):return False

def valid_entry_voices(entry):
    versions=[entry.get('initial',{}),*entry.get('priorRetries',[]),entry.get('retry',{})]
    first=versions[0].get('clip') or {}; source=source_voice(first)
    unit={'text':first.get('text'),'voiceId':source,'language':first.get('language'),
          'bank':entry.get('bank'),'key':entry.get('key'),'kind':'meaning','required':first.get('required',True)}
    if not all(matches_source(unit,v.get('clip')) for v in versions):return False
    if not matches_selection(unit,first,entry.get('baseOverride')):return False
    revised=entry.get('retryOverride')
    return all(matches_selection(unit,v.get('clip'),revised) for v in versions[1:])

def clip_recipe_proof(unit,clip):
    """Intrinsic metadata binding; authoring additionally checks the planned hash."""
    if not matches_source(unit,clip):return False
    if clip['voiceId']==unit['voiceId']:return 'voiceOverrideInput' not in clip
    import json,hashlib
    try:
        raw=clip['voiceOverrideInput'];payload=json.loads(raw)
        if hashlib.sha256(raw.encode()).hexdigest()!=clip['inputSha256'] or not isinstance(payload,list) or len(payload) not in (5,6):return False
        if payload[2]!=clip['voiceId'] or payload[3]!=clip['spoken'] or not isinstance(payload[4],str) or hashlib.sha256(payload[4].encode()).hexdigest()!=clip['phonemeSha256']:return False
        if len(payload)==6 and (not isinstance(payload[5],dict) or set(payload[5])!={'speed'}):return False
        speed=payload[5]['speed'] if len(payload)==6 else 1
        return .75<=speed<=1.2 and speed==clip.get('synthesisSpeed',1)
    except (KeyError,ValueError,TypeError,AttributeError):return False

def comparison_options(clip):
    return {'allow_articles':not bool(clip.get('sourceVoiceId') and clip['sourceVoiceId']!=clip.get('voiceId'))}

def strict_comparison_evidence(clip,record):
    return comparison_options(clip)['allow_articles'] or (record or {}).get('comparison',{}).get('provenance',{}).get('articlePolicyEnabled') is False
