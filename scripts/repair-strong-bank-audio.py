#!/usr/bin/env python3
"""One real synthesis + strong ASR retry, with immutable before/after evidence.

Run after finalize-audio-reaudit.py. Public text and default source casting stay fixed.
Only independent English vocabulary heads may select a reviewed alternate voice.
Japanese candidates still failing comparison are explicitly unpublished and
delegated to device speech, never described as successfully recognized audio.
"""
import argparse
import copy
from contextlib import ExitStack
import fcntl
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

voice_spec=importlib.util.spec_from_file_location('repair_voice_rules',Path(__file__).with_name('audio-voice-override.py'))
voice_rules=importlib.util.module_from_spec(voice_spec);voice_spec.loader.exec_module(voice_rules)

STRONG_MODEL='whisper-large-v3-turbo'
STRONG_SHA='e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da'
STRONG_MODELS={STRONG_MODEL:STRONG_SHA,'whisper-large-v3':'69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1'}

def repair_snapshot_sha(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()

def validate_repair_history(row,repair,unit,evidence):
    previous=repair.get('previousRepair')
    if not previous:return
    history=row.get('priorRepairs',[]);index=previous.get('archiveIndex')
    if not isinstance(index,int) or isinstance(index,bool) or not 0<=index<len(history):raise ValueError('Missing prior repair snapshot')
    prior=history[index]
    if (not prior.get('complete') or prior.get('disposition')!='recorded-review' or
            repair_snapshot_sha(prior)!=previous.get('sha256') or
            prior.get('candidate')!=repair.get('original') or
            prior.get('proposal',{}).get('token')!=repair.get('proposal',{}).get('token')):
        raise ValueError('Prior repair snapshot binding changed')
    validate_repair_versions(prior,unit,evidence)
    validate_repair_history(row,prior,unit,evidence)

def validate_repair_versions(repair,unit,evidence):
    versions=[repair.get('original',{}),*repair.get('priorCandidates',[]),repair.get('candidate',{})]
    digests=[]
    for v in versions:
        c=v.get('clip') or {}
        if (not strong_evidence(evidence,c,v.get('asr')) or
                not voice_rules.matches_source(unit,c)):
            raise ValueError('Completed repair lost actual source/ASR history')
        expected=repair.get('baseOverride') if v is versions[0] else repair.get('appliedOverride')
        if not voice_rules.matches_selection(unit,c,expected):raise ValueError('Repair historical voice recipe changed')
        digests.append(c['sha256'])
    if len(set(digests))!=len(digests):raise ValueError('Completed repair versions must be distinct')

def archive_next_round(row,proposal,unit,clip,record,override,evidence,override_audio,previous_retry):
    old=row.get('repair') or {}
    if (unit['language']!='en' or not old.get('complete') or old.get('disposition')!='recorded-review' or
            proposal.get('previousRepairSha256')!=repair_snapshot_sha(old)):
        raise ValueError('A next-round plan requires the exact completed English repair')
    validate_repair_versions(old,unit,evidence);validate_repair_history(row,old,unit,evidence)
    if (not strong_evidence(evidence,clip,record) or record.get('status')!='review' or
            old.get('candidate')!={'clip':clip,'asr':record} or
            override_audio(override)!=override_audio(old.get('appliedOverride'))):
        raise ValueError('Next-round original differs from the selected prior repair')
    if (not previous_retry or not previous_retry.get('complete') or
            previous_retry.get('initial')!=old.get('original') or
            {k:previous_retry.get('retry',{}).get(k) for k in ['clip','asr']}!=old.get('candidate') or
            previous_retry.get('priorRetries',[])!=old.get('priorCandidates',[]) or
            previous_retry.get('selectedSha256')!=clip['sha256']):
        raise ValueError('Next-round quality and retry histories differ')
    history=row.setdefault('priorRepairs',[])
    if any(repair_snapshot_sha(p)==repair_snapshot_sha(old) for p in history):raise ValueError('Duplicate prior repair snapshot')
    previous={'archiveIndex':len(history),'sha256':repair_snapshot_sha(old)}
    history.append(copy.deepcopy(old));return previous


def load_module(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


def strong_evidence(evidence,clip,record):
    generation=(record or {}).get('recognitionGeneration',{})
    return bool(evidence.valid_asr(clip,record) and voice_rules.strict_comparison_evidence(clip,record) and record.get('comparison') and
        record.get('recognitionMethod')=='individual-beam5' and
        generation.get('model') in STRONG_MODELS and generation.get('modelSha256')==STRONG_MODELS[generation['model']])


def make_override(unit,proposal,base,known_correction=None):
    if proposal.get('sourceText')!=unit['text']:raise ValueError('Repair source text changed')
    change=proposal.get('override')
    if not isinstance(change,dict) or not change or set(change)-{'spoken','phonemes','speed','voiceId'}:
        raise ValueError('Invalid repair override')
    if not isinstance(proposal.get('method'),str) or not proposal['method'].strip():
        raise ValueError('Missing repair method')
    result=copy.deepcopy(base or {})
    if 'spoken' in change and 'phonemes' not in change:result.pop('phonemes',None)
    result.update(change)
    if not .75<=float(result.get('speed',1))<=1.2:raise ValueError('Invalid synthesis pace')
    for key in ['spoken','phonemes']:
        if key in result and (not isinstance(result[key],str) or not result[key].strip()):
            raise ValueError('Empty '+key)
    if known_correction and result.get('phonemes')!=known_correction.get('phonemes'):
        raise ValueError('Preserve the previously reviewed phoneme correction')
    audio=lambda x:{k:(x or {}).get(k,1 if k=='speed' else None) for k in ['spoken','phonemes','speed','voiceId']}
    voice_rules.selected_voice(unit,result)
    if audio(result)==audio(base):raise ValueError('Retry must change synthesis input')
    result['reason']='Strong-ASR clarity retry: '+proposal['method']
    return result


def append_retry_history(previous,unit,repair,candidate,record,archived):
    """Preserve prior authoring as a complete case, linked by the actual SHA."""
    original=repair['original']
    if (previous and previous.get('kind')=='strong-asr-clarity-retry' and previous.get('complete') and
            previous.get('initial')==original and previous.get('selectedSha256')==candidate['sha256'] and
            previous.get('retry',{}).get('clip')==candidate and previous.get('retry',{}).get('asr')==record):
        # Recover interruption after retries.json but before the quality ledger.
        if previous.get('priorRetries',[])!=repair.get('priorCandidates',[]):
            raise ValueError('Completed retry lost intermediate candidate evidence')
        return copy.deepcopy(previous)
    entry={'token':f"{unit['language']}:{unit['bank']}:{unit['key']}",
        'language':unit['language'],'bank':unit['bank'],'key':unit['key'],
        'kind':'strong-asr-clarity-retry','initial':copy.deepcopy(original),
        'baseOverride':copy.deepcopy(repair.get('baseOverride'))}
    if repair.get('priorCandidates'):
        entry['priorRetries']=copy.deepcopy(repair['priorCandidates'])
    if previous:
        if not previous.get('complete') or previous.get('selectedSha256')!=original['clip']['sha256']:
            raise ValueError('Previous completed retry must select this original media')
        entry['predecessor']={'archiveIndex':len(archived),'token':previous['token'],'selectedSha256':previous['selectedSha256']}
        archived.append({**copy.deepcopy(previous),'archiveReason':'Subsequent strong-ASR clarity retry'})
    entry.update(retry={'clip':copy.deepcopy(candidate),'asr':copy.deepcopy(record),'audioChanged':True},
        retryOverride=copy.deepcopy(repair['appliedOverride']),selectedSha256=candidate['sha256'],
        complete=True,phase='complete',outcome='strong-retry-'+record['status'],
        unresolved=record['status']=='review')
    versions=[entry['initial'],*entry.get('priorRetries',[]),entry['retry']]
    entry['synthesisAttemptCount']=len({v['clip']['sha256'] for v in versions})
    entry['asrAttemptCount']=sum(v['asr'].get('recognitionAttempts',1) for v in versions)
    return entry


def remember_superseded_candidate(repair,unit,clip,record,revised,generation,bank,evidence):
    """Keep actual intermediate evidence when its media missed the planned input."""
    prior=repair.get('priorCandidates',[])
    if not isinstance(prior,list) or len({v.get('clip',{}).get('sha256') for v in prior})!=len(prior):
        raise ValueError('Invalid intermediate candidate history')
    for version in prior:
        prior_clip=version.get('clip') or {}
        if (not strong_evidence(evidence,prior_clip,version.get('asr')) or
                prior_clip.get('sha256')==repair['original']['clip']['sha256'] or
                not voice_rules.matches_source(unit,prior_clip)):
            raise ValueError('Intermediate candidate history lost its actual source/ASR binding')
    if not clip or clip.get('sha256')==repair['original']['clip']['sha256']:return
    spoken,input_sha=bank.input_fingerprint(generation,unit,revised)
    if (clip.get('spoken')==spoken and bank.planned_clip_matches(clip,input_sha,revised,unit) and
            voice_rules.matches_selection(unit,clip,revised)):return
    if not strong_evidence(evidence,clip,record):
        raise ValueError('Superseded candidate needs its own actual strong ASR')
    if not voice_rules.matches_source(unit,clip):
        raise ValueError('Superseded candidate source/casting changed')
    snapshot={**copy.deepcopy(clip),'asrStatus':record['status']}
    version={'clip':snapshot,'asr':copy.deepcopy(record),
        'rejectionReason':'Actual synthesis input did not satisfy the unchanged reviewed repair proposal'}
    prior=repair.setdefault('priorCandidates',[])
    existing=[v for v in prior if v.get('clip',{}).get('sha256')==clip['sha256']]
    if existing:
        if len(existing)!=1 or existing[0]!=version:raise ValueError('Intermediate candidate evidence changed')
    else:prior.append(version)


def publish_fallback(packs,unit,candidate):
    pack=packs[(unit['language'],unit['bank'])]
    pack.setdefault('fallbacks',{})[unit['key']]={'playback':'system','language':'ja','text':unit['text'],'voiceId':unit['voiceId'],
        'reason':'unresolved-after-strong-asr-retry','auditedSha256':candidate['sha256']}
    pack['clips'].pop(unit['key'],None)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo',type=Path,default=Path(__file__).resolve().parents[1])
    parser.add_argument('--workdir',type=Path,default=Path.home()/'.local/share/toeic-kokoro')
    parser.add_argument('--plan',type=Path,required=True)
    parser.add_argument('--threads',type=int,default=4)
    parser.add_argument('--asr-model',choices=list(STRONG_MODELS),default=STRONG_MODEL)
    parser.add_argument('--apply',action='store_true')
    parser.add_argument('--finish-only',action='store_true',help='Validate existing real candidate evidence; no model execution')
    parser.add_argument('--next-round',action='store_true',help='Archive an exactly bound completed English repair before a reviewed new attempt')
    args=parser.parse_args();root=args.repo.resolve();out=root/'data/audio';work=args.workdir.resolve()
    if work==root or root in work.parents:raise ValueError('Keep model work outside the checkout')
    retry=load_module('strong_repair_retry',root/'scripts/retry-bank-audio.py')
    correction=load_module('strong_repair_correction',root/'scripts/correct-bank-audio.py')
    bank,evidence=retry.bank,retry.evidence
    read,atomic,sha=bank.read,bank.atomic,bank.sha
    author_inputs={}
    def read_author_input(path,default):
        value=read(path,default)
        raw=path.read_bytes() if path.exists() else None
        if (json.loads(raw) if raw is not None else default)!=value:
            raise ValueError('Author input changed while reading: '+str(path.relative_to(out)))
        author_inputs[path]=raw
        return value
    plan=read(args.plan,{})
    source_bytes=(out/'source.json').read_bytes();source=json.loads(source_bytes)
    if plan.get('sourceSha256')!=sha(source_bytes):raise ValueError('Stale source fingerprint')
    quality=read_author_input(out/'quality-review.json',{})
    if not quality.get('stages',{}).get('strongerASR'):raise ValueError('Finalize the full stronger-ASR stage first')
    proposals=plan.get('entries',[])
    if not proposals or len({p['token'] for p in proposals})!=len(proposals):raise ValueError('Empty/duplicate repair plan')
    units={f"{u['language']}:{u['bank']}:{u['key']}":u for u in source['units']}
    overrides=read_author_input(out/'overrides.json',{'version':1,'entries':{}})
    input_review=read_author_input(out/'normalization-review.json',{'version':1})
    deliveries={r['token']:r for r in input_review.get('confirmedInputCorrections',[])}
    retry_bytes=(out/'retries.json').read_bytes();previous_report=json.loads(retry_bytes)
    archived=previous_report.get('archivedCases',[])
    for entry in [*previous_report.get('records',{}).values(),*archived]:
        if not correction.predecessor_matches(entry,archived):raise ValueError('Broken previous retry predecessor: '+entry['token'])
        if entry.get('complete') and not correction.completed_history_evidence(entry):
            raise ValueError('Invalid completed previous retry evidence: '+entry['token'])
    packs={};audits={}
    def reload_packs(capture=False):
        packs.clear();audits.clear()
        reader=read_author_input if capture else read
        for u in source['units']:
            pair=(u['language'],u['bank'])
            if pair not in packs:
                packs[pair]=reader(out/pair[0]/(pair[1]+'.json'),{'clips':{}})
                audits[pair]=reader(out/'audit'/pair[0]/(pair[1]+'.json'),{'records':{}})
    def current(u):
        pair=(u['language'],u['bank']);return packs[pair]['clips'].get(u['key']),audits[pair]['records'].get(u['key'])
    reload_packs(capture=True);selected=[];completed=[];recover_fallbacks=[]
    current_generation=read_author_input(out/'manifest.json',{})['generation']
    for proposal in proposals:
        token=proposal['token'];u=units.get(token);row=quality.get('records',{}).get(token)
        if not u or u.get('nonSpoken') or not row:raise ValueError('Unknown repair source: '+token)
        if proposal.get('asrModel',STRONG_MODEL)!=args.asr_model:raise ValueError('Recognition model differs from the reviewed plan')
        if args.asr_model!=STRONG_MODEL and u['language']!='en':raise ValueError('Alternate recognizer is restricted to English repairs')
        old=row.get('repair');clip,record=current(u);previous_repair=None
        if old and old.get('proposal')!=proposal:
            if not args.next_round:raise ValueError('Finish or explicitly archive the existing repair plan: '+token)
            previous_repair=archive_next_round(row,proposal,u,clip,record,overrides['entries'].get(token),evidence,retry.override_audio,previous_report.get('records',{}).get(token))
            old=None
        if old:validate_repair_history(row,old,u,evidence)
        base=old.get('baseOverride') if old else overrides['entries'].get(token)
        revised=make_override(u,proposal,base,deliveries.get(token,{}).get('appliedOverride'))
        if old:
            if revised!=old.get('appliedOverride') or not strong_evidence(evidence,old['original']['clip'],old['original']['asr']):
                raise ValueError('Interrupted repair lost its binding/evidence: '+token)
            if not voice_rules.matches_selection(u,old['original']['clip'],old.get('baseOverride')):
                raise ValueError('Interrupted repair original source/casting changed: '+token)
            if retry.override_audio(overrides['entries'].get(token)) not in [retry.override_audio(base),retry.override_audio(revised)]:
                raise ValueError('Interrupted repair synthesis input changed: '+token)
            if old.get('complete'):
                validate_repair_versions(old,u,evidence)
                candidate=old.get('candidate',{})
                target_spoken,target_sha=bank.input_fingerprint(current_generation,u,revised)
                if not bank.planned_clip_matches(candidate.get('clip'),target_sha,revised,u) or candidate.get('clip',{}).get('spoken')!=target_spoken:
                    raise ValueError('Completed repair target input changed: '+token)
                if not strong_evidence(evidence,candidate.get('clip'),candidate.get('asr')) or candidate.get('asr',{}).get('recognitionGeneration',{}).get('model')!=args.asr_model:
                    raise ValueError('Completed repair lost candidate ASR: '+token)
                if old.get('disposition')=='system-fallback':
                    fallback=packs[(u['language'],u['bank'])].get('fallbacks',{}).get(u['key'],{})
                    # Recover a ledger checkpoint written before the pack flush.
                    if (clip and clip['sha256']==candidate['clip']['sha256'] and record==candidate['asr'] and
                            evidence.media_integrity(root,clip)['ok'] and not fallback):
                        recover_fallbacks.append((u,candidate))
                    elif clip or fallback.get('auditedSha256')!=candidate['clip']['sha256']:
                        raise ValueError('Completed fallback publication changed: '+token)
                elif (not strong_evidence(evidence,clip,record) or clip['sha256']!=candidate['clip']['sha256'] or
                        clip['inputSha256']!=candidate['clip']['inputSha256'] or not voice_rules.matches_selection(u,clip,revised) or
                        any(clip.get(k)!=candidate['clip'].get(k) for k in ['voiceId','sourceVoiceId','voiceOverrideInput','text','language','spoken','phonemeSha256','required','synthesisSpeed']) or not evidence.media_integrity(root,clip)['ok']):
                    raise ValueError('Completed recording publication changed: '+token)
                if retry.override_audio(overrides['entries'].get(token))!=retry.override_audio(revised):
                    raise ValueError('Completed repair synthesis input changed: '+token)
                completed.append(token);continue
        else:
            if not strong_evidence(evidence,clip,record) or record['status']!='review':
                raise ValueError('A repair requires current unresolved strong-ASR evidence: '+token)
            if not voice_rules.matches_selection(u,clip,base):
                raise ValueError('Repair original source/casting differs: '+token)
            previous=previous_report.get('records',{}).get(token)
            if previous and (not previous.get('complete') or previous.get('selectedSha256')!=clip['sha256']):
                raise ValueError('Previous retry has not completed this exact original media: '+token)
            if proposal.get('beforeSha256')!=clip['sha256']:raise ValueError('Stale candidate media: '+token)
            if proposal.get('beforePhonemeSha256') and proposal['beforePhonemeSha256']!=clip.get('phonemeSha256'):
                raise ValueError('Stale candidate phoneme evidence: '+token)
            old={'method':proposal['method'],'proposal':copy.deepcopy(proposal),'original':{'clip':copy.deepcopy(clip),'asr':copy.deepcopy(record)},
                'baseOverride':copy.deepcopy(base),'appliedOverride':copy.deepcopy(revised),'complete':False,'phase':'planned'}
            if previous_repair:old['previousRepair']=previous_repair
        selected.append((token,u,old,revised))
    if not args.apply:
        print(json.dumps({'dryRun':True,'retryKeys':len(selected),'alreadyCompleted':len(completed)},ensure_ascii=False));return
    if retry.running(work):raise RuntimeError('Wait for the current author before repairs')
    work.mkdir(parents=True,exist_ok=True)
    with (work/'bank-retry.lock').open('a') as controller_lock:
        fcntl.flock(controller_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        with ExitStack() as locks:
            for name in ['bank-generate.lock','bank-audit.lock']:
                lock=locks.enter_context((work/name).open('a'));fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            if sha((out/'source.json').read_bytes())!=plan['sourceSha256']:raise ValueError('Source changed')
            if (out/'retries.json').read_bytes()!=retry_bytes:raise ValueError('Retry history changed before author locks')
            for path,raw in author_inputs.items():
                if (path.read_bytes() if path.exists() else None)!=raw:
                    raise ValueError('Author input changed before locks: '+str(path.relative_to(out)))
            for token,u,repair,revised in selected:
                clip,record=current(u)
                if clip and not evidence.media_integrity(root,clip)['ok']:
                    raise ValueError('Repair candidate media changed before preserving evidence: '+token)
                remember_superseded_candidate(repair,u,clip,record,revised,current_generation,bank,evidence)
                quality['records'][token]['repair']=repair
                overrides['entries'][token]=revised
            # Before inputs change, preserve original bytes' actual evidence.
            atomic(out/'quality-review.json',quality);atomic(out/'overrides.json',overrides)
        token_file=work/'tmp/strong-repair-tokens.json';atomic(token_file,[t for t,*_ in selected])
        if selected and not args.finish_only:
            common=['--workdir',str(work),'--threads',str(args.threads),'--tokens-file',str(token_file)]
            for script,extra in [('generate-bank-audio.py',[]),('audit-bank-audio.py',['--model',args.asr_model,'--individual-only'])]:
                correction.run_command([sys.executable,str(root/'scripts'/script),*common,*extra],work)
        reload_packs();generation=read(out/'manifest.json',{})['generation']
        for u,candidate in recover_fallbacks:
            clip,record=current(u)
            if not clip or clip['sha256']!=candidate['clip']['sha256'] or record!=candidate['asr']:
                raise ValueError('Fallback recovery recording changed while acquiring author locks')
            publish_fallback(packs,u,candidate['clip'])
        report=read(out/'retries.json',{'version':1,'records':{}})
        # Validate every actual candidate before any publication disposition.
        candidates=[]
        for token,u,repair,revised in selected:
            clip,record=current(u);old_clip=repair['original']['clip']
            spoken,input_sha=bank.input_fingerprint(generation,u,revised)
            if (not strong_evidence(evidence,clip,record) or record.get('recognitionGeneration',{}).get('model')!=args.asr_model or clip['sha256']==old_clip['sha256'] or
                    not evidence.media_integrity(root,clip)['ok'] or not bank.planned_clip_matches(clip,input_sha,revised,u) or clip['inputSha256']!=input_sha or clip['spoken']!=spoken or
                    not voice_rules.matches_selection(u,clip,revised) or
                    ('phonemes' in revised and clip.get('phonemeSha256')!=sha(revised['phonemes'].encode()))):
                raise ValueError('Candidate awaits changed media and current strong ASR: '+token)
            clip['asrStatus']=record['status']
            candidates.append((token,u,repair,revised,clip,record))
        for token,u,repair,revised,clip,record in candidates:
            fallback=u['language']=='ja' and record['status']=='review'
            disposition='system-fallback' if fallback else 'recorded-'+record['status']
            repair.update(candidate={'clip':copy.deepcopy(clip),'asr':copy.deepcopy(record)},complete=True,phase='complete',disposition=disposition)
            previous=report['records'].get(token)
            if previous and not correction.completed_history_evidence(previous):
                raise ValueError('Previous retry lacks complete actual evidence: '+token)
            report['records'][token]=append_retry_history(previous,u,repair,clip,record,report.setdefault('archivedCases',[]))
            delivery=deliveries.get(token)
            if delivery:
                delivery.update(appliedOverride=copy.deepcopy(revised),selectedSha256=clip['sha256'],asrStatus=record['status'])
            if fallback:
                publish_fallback(packs,u,clip)
        retry.update_summaries(report)
        totals={lang:{'attempted':0,'matched':0,'review':0,'systemFallback':0} for lang in ['en','ja']}
        for row in quality['records'].values():
            r=row.get('repair',{})
            if not r.get('complete'):continue
            count=totals[row['language']];count['attempted']+=1
            field={'recorded-matched':'matched','recorded-review':'review','system-fallback':'systemFallback'}[r['disposition']]
            count[field]+=1
        models=sorted({row['repair']['candidate']['asr']['recognitionGeneration']['model'] for row in quality['records'].values() if row.get('repair',{}).get('complete')})
        quality['stages']['repairs']={'counts':totals,'model':models[0] if len(models)==1 else 'multiple-local-models',
            'modelSha256':STRONG_MODELS[models[0]] if len(models)==1 else None,
            'recognitionModels':[{'model':model,'modelSha256':STRONG_MODELS[model]} for model in models],
            'repairRounds':{lang:sum(1+len(row.get('priorRepairs',[])) for row in quality['records'].values()
                if row.get('language')==lang and row.get('repair',{}).get('complete')) for lang in ['en','ja']},
            'countingNote':'counts.attempted is unique source keys; repairRounds counts completed per-key rounds, not unique model calls.',
            'systemFallbackPolicy':'Device Japanese speech is not locally audited Kokoro audio.'}
        atomic(out/'retries.json',report)
        atomic(out/'normalization-review.json',input_review)
        atomic(out/'quality-review.json',quality)
        # flush validates explicit fallbacks against the completed ledger.
        bank.flush(source,sha(source_bytes),generation,packs)
        print(json.dumps({'completedThisRun':len(candidates),'alreadyCompleted':len(completed),'totals':totals},ensure_ascii=False))


if __name__=='__main__':main()
