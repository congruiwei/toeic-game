#!/usr/bin/env python3
"""Apply individually reviewed TTS-input corrections, retaining real evidence.

Display text is immutable. This tool runs only with other authors stopped.
Optional sources without audio receive a future override, not fabricated output.
"""
import argparse
import copy
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'data/audio'
spec=importlib.util.spec_from_file_location('correction_retry',ROOT/'scripts/retry-bank-audio.py')
retry=importlib.util.module_from_spec(spec);spec.loader.exec_module(retry)
bank=retry.bank
read,atomic,sha=bank.read,bank.atomic,bank.sha


def token(unit):return f"{unit['language']}:{unit['bank']}:{unit['key']}"


def prepare_correction(unit,proposal,base=None):
    if proposal.get('sourceText')!=unit['text']:raise ValueError('Correction source text changed: '+token(unit))
    if not isinstance(proposal.get('reason'),str) or not proposal['reason'].strip():raise ValueError('Missing correction reason')
    change=proposal.get('override')
    if not isinstance(change,dict) or not change or set(change)-{'spoken','phonemes','speed'}:raise ValueError('Invalid correction override')
    merged=copy.deepcopy(base or {})
    if 'spoken' in change and 'phonemes' not in change:merged.pop('phonemes',None)
    merged.update(change)
    if not .75<=float(merged.get('speed',1))<=1.2:raise ValueError('Invalid correction speed')
    for key in ['spoken','phonemes']:
        if key in merged and (not isinstance(merged[key],str) or not merged[key].strip()):raise ValueError('Empty correction '+key)
    if retry.override_audio(merged)==retry.override_audio(base):raise ValueError('Correction does not change synthesis input')
    merged['reason']='Confirmed input correction: '+proposal['reason']
    return merged


def correction_matches(unit,corrected,clip,generation):
    if not clip:return False
    spoken,input_sha=bank.input_fingerprint(generation,unit,corrected)
    return bool(all(clip.get(k)==unit[k] for k in ['text','voiceId','language']) and
        clip.get('spoken')==spoken and clip.get('inputSha256')==input_sha and
        float(clip.get('synthesisSpeed',1))==float(corrected.get('speed',1)) and
        ('phonemes' not in corrected or clip.get('phonemeSha256')==sha(corrected['phonemes'].encode())))


def initial_matches(entry,unit):
    initial=entry.get('initial',{})
    clip=initial.get('clip') or {}
    return bool(retry.has_actual_asr(clip,initial.get('asr')) and
        all(clip.get(k)==unit[k] for k in ['text','voiceId','language']) and
        clip.get('spoken')==retry.binding_for(unit,entry.get('baseOverride'))['spoken'])


def completed_history_evidence(entry):
    """Validate saved versions without reinterpreting their historical input."""
    versions=[entry.get('initial'),*entry.get('priorRetries',[]),entry.get('retry')]
    first=(entry.get('initial') or {}).get('clip') or {}
    return bool(entry.get('complete') and len(versions)>=2 and
        entry.get('synthesisAttemptCount',0)>=2 and entry.get('asrAttemptCount',0)>=2 and
        all(v and retry.has_actual_asr(v.get('clip'),v.get('asr')) and
            all(v['clip'].get(k)==first.get(k) for k in ['text','voiceId','language']) for v in versions) and
        len({v['clip']['sha256'] for v in versions})>=2 and
        any(v['clip']['sha256']==entry.get('selectedSha256') for v in versions))


def predecessor_matches(entry,archived):
    link=entry.get('predecessor')
    if not link:return True
    index=link.get('archiveIndex')
    if not isinstance(index,int) or isinstance(index,bool) or not 0<=index<len(archived):return False
    prior=archived[index]
    return bool(completed_history_evidence(prior) and
        prior.get('token')==link.get('token')==entry.get('token') and
        prior.get('selectedSha256')==link.get('selectedSha256')==entry.get('initial',{}).get('clip',{}).get('sha256'))


def finish_correction(entry,clip,record,unit,corrected,generation):
    if not initial_matches(entry,unit) or not correction_matches(unit,corrected,clip,generation) or not retry.ready_retry(entry,clip,record):
        raise ValueError('Correction lacks reviewed target input, changed audio SHA or current actual ASR: '+entry['token'])
    entry.update(retry={'clip':copy.deepcopy(clip),'asr':copy.deepcopy(record),'audioChanged':True},
        complete=True,phase='complete',selectedSha256=clip['sha256'],
        synthesisAttemptCount=2,
        asrAttemptCount=entry['initial']['asr'].get('recognitionAttempts',1)+record.get('recognitionAttempts',1),
        outcome='input-correction-matched' if record['status']=='matched' else 'input-correction-applied-asr-review',
        unresolved=record['status']=='review')
    # A reviewed correction must not revert to an input already known wrong.
    # Review is retained honestly; it is not converted into a match.
    return entry


def current_correction(entry,unit,override,clip,record,generation):
    """A completed correction is reusable only with its exact selected input."""
    selected=entry.get('retry',{}).get('clip',{})
    return bool(initial_matches(entry,unit) and completed_history_evidence(entry) and retry.case_matches(entry,unit,override) and
        retry.override_audio(override)==retry.override_audio(entry.get('retryOverride')) and
        clip and entry.get('selectedSha256')==clip.get('sha256')==selected.get('sha256') and
        clip.get('inputSha256')==selected.get('inputSha256') and clip.get('spoken')==selected.get('spoken') and
        correction_matches(unit,override,clip,generation) and retry.has_actual_asr(clip,record))


summaries=retry.attempt_summaries


def run_command(command,work):
    """Supervise one author, with the same recoverable ledger as pace retries."""
    work=Path(work);work.mkdir(parents=True,exist_ok=True)
    ledger=work/'bank-retry-children.json'
    state={'version':1,'parentPid':os.getpid(),'state':'running','kind':'confirmed-input-correction','children':{}}
    previous={};child=None
    def interrupted(signum,frame):raise SystemExit(128+signum)
    try:
        for signum in [signal.SIGTERM,signal.SIGINT]:
            previous[signum]=signal.signal(signum,interrupted)
        child=subprocess.Popen(command,cwd=ROOT)
        state['children']['correction']={'pid':child.pid,'identity':retry.process_identity(child.pid,command),'argv':command}
        atomic(ledger,state)
        code=child.wait()
        if code:raise subprocess.CalledProcessError(code,command)
    finally:
        if child:
            if child.poll() is None:child.terminate()
            try:code=child.wait(timeout=10)
            except subprocess.TimeoutExpired:child.kill();code=child.wait()
            state['children'].setdefault('correction',{'pid':child.pid})['returncode']=code
        state['state']='exited';atomic(ledger,state)
        for signum,handler in previous.items():signal.signal(signum,handler)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--plan',type=Path,required=True)
    parser.add_argument('--workdir',type=Path,default=Path.home()/'.local/share/toeic-kokoro')
    parser.add_argument('--threads',type=int,default=2);parser.add_argument('--apply',action='store_true')
    parser.add_argument('--stream',action='store_true',help='Use the tested producer/consumer supervisor for corrected generation and ASR')
    args=parser.parse_args();work=args.workdir.resolve()
    if work==ROOT or ROOT in work.parents:parser.error('Keep authoring work outside the repository')
    plan=read(args.plan,{})
    source_bytes=(OUT/'source.json').read_bytes();source=json.loads(source_bytes)
    if plan.get('sourceSha256')!=sha(source_bytes):raise ValueError('Correction plan source fingerprint is stale')
    units={token(u):u for u in source['units']};proposals=plan.get('entries',[])
    if len({p['token'] for p in proposals})!=len(proposals):raise ValueError('Duplicate correction token')
    overrides=read(OUT/'overrides.json',{'version':1,'entries':{}})
    report=read(OUT/'retries.json',{'version':1,'records':{}})
    review=read(OUT/'normalization-review.json',{'version':1})
    prior={p['token']:p for p in review.get('confirmedInputCorrections',[])}
    generation=read(OUT/'manifest.json',{}).get('generation',{})
    pack_cache={};audit_cache={}
    def current(unit):
        pair=(unit['language'],unit['bank'])
        if pair not in pack_cache:
            pack_cache[pair]=read(OUT/pair[0]/(pair[1]+'.json'),{'clips':{}})
            audit_cache[pair]=read(OUT/'audit'/pair[0]/(pair[1]+'.json'),{'records':{}})
        return pack_cache[pair]['clips'].get(unit['key']),audit_cache[pair]['records'].get(unit['key'])
    selected=[];deferred=[];completed=[]
    for proposal in proposals:
        unit=units.get(proposal['token'])
        if not unit or unit.get('nonSpoken'):raise ValueError('Unknown/nonspoken correction source')
        old=report['records'].get(proposal['token'])
        archived=report.get('archivedCases',[])
        if any(row.get('token')==proposal['token'] and row.get('complete') and not completed_history_evidence(row) for row in archived):
            raise ValueError('Archived completed correction lost its real ASR evidence: '+proposal['token'])
        if old and not predecessor_matches(old,archived):
            raise ValueError('Archived completed correction predecessor binding changed: '+proposal['token'])
        previous_plan=prior.get(proposal['token'])
        resuming=old and old.get('kind')=='confirmed-input-correction' and old.get('proposal')==proposal
        resumed_plan=previous_plan and previous_plan.get('proposal')==proposal
        if old and old.get('kind')=='confirmed-input-correction' and not old.get('complete') and not resuming:
            raise ValueError('Finish the previous confirmed correction before changing its plan')
        base=old.get('baseOverride') if resuming else previous_plan.get('baseOverride') if resumed_plan else overrides['entries'].get(proposal['token'])
        corrected=prepare_correction(unit,proposal,base)
        if resuming and not retry.case_matches(old,unit,overrides['entries'].get(proposal['token'])):
            raise ValueError('Interrupted correction source or override binding changed')
        if resuming and not initial_matches(old,unit):
            raise ValueError('Interrupted correction lost its original real ASR evidence')
        if resumed_plan and (previous_plan.get('sourceBinding')!=retry.binding_for(unit,base) or
                retry.override_audio(overrides['entries'].get(proposal['token'])) not in [retry.override_audio(base),retry.override_audio(corrected)]):
            raise ValueError('Deferred correction source or override binding changed')
        clip,record=current(unit)
        if old and old.get('kind')=='confirmed-input-correction' and old.get('complete') and not resuming:
            if not current_correction(old,unit,overrides['entries'].get(proposal['token']),clip,record,generation):
                raise ValueError('Previous completed correction lost its input or real ASR evidence: '+proposal['token'])
        if resuming and old.get('complete'):
            if not current_correction(old,unit,overrides['entries'].get(proposal['token']),clip,record,generation):
                raise ValueError('Completed correction lost its current input or ASR binding')
            # Repair a crash after the per-case checkpoint but before the
            # summary checkpoint, without generating the clip again.
            prior[proposal['token']]={'token':proposal['token'],'proposal':copy.deepcopy(proposal),'baseOverride':copy.deepcopy(base),
                'sourceBinding':retry.binding_for(unit,base),'appliedOverride':copy.deepcopy(corrected),
                'delivery':'regenerated-with-both-ASR-versions','selectedSha256':clip['sha256'],'asrStatus':record['status']}
            completed.append(proposal['token'])
            continue
        # A never-generated source is corrected before its first normal build;
        # this is not counted as a regeneration or an invented prior ASR.
        if (not clip and not resuming) or (resumed_plan and previous_plan.get('delivery','').startswith('future-')):
            deferred.append((proposal,unit,base,corrected));continue
        if clip and not resuming:
            expected=proposal.get('beforePhonemeSha256')
            if expected and expected!=clip.get('phonemeSha256'):raise ValueError('Reviewed old phonemes changed: '+proposal['token'])
        selected.append((proposal,unit,base,corrected,resuming))
    if not args.apply:
        print(json.dumps({'dryRun':True,'regenerationTargets':len(selected),'futureGenerationOverrides':len(deferred),'alreadyCompleted':len(completed)},ensure_ascii=False));return
    if retry.running(work):raise RuntimeError('Stop generation, audit and inherited retry children before corrections')
    state=read(work/'bank-processes.json',{}).get('processes',{})
    if state.get('retry',{}).get('pid') and retry.alive(state['retry']['pid']):raise RuntimeError('Stop the waiting retry controller before corrections')
    work.mkdir(parents=True,exist_ok=True)
    with (work/'bank-retry.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        token_path=work/'tmp/bank-correction-tokens.json'
        if sha((OUT/'source.json').read_bytes())!=plan['sourceSha256']:raise ValueError('Source changed before applying correction plan')
        all_tokens=[p['token'] for p,*_ in selected];existing=[p['token'] for p,_,_,_,resuming in selected if not resuming]
        def command(script,*extra):
            run_command([sys.executable,str(ROOT/'scripts'/script),'--workdir',str(work),'--threads',str(args.threads),*extra],work)
        # Capture real initial recognition before changing any synthesis input.
        if existing:
            atomic(token_path,existing);command('audit-bank-audio.py','--individual-only','--tokens-file',str(token_path))
            pack_cache.clear();audit_cache.clear()
            generation=read(OUT/'manifest.json',{}).get('generation',{})
        for proposal,unit,base,corrected,resuming in selected:
            clip,record=current(unit)
            if clip and not resuming:
                if not retry.has_actual_asr(clip,record):raise ValueError('Missing real initial ASR: '+proposal['token'])
                previous=report['records'].get(proposal['token'])
                predecessor=None
                if previous:
                    if not completed_history_evidence(previous):raise ValueError('Previous completed correction lacks complete history')
                    archived=report.setdefault('archivedCases',[])
                    predecessor={'archiveIndex':len(archived),'token':previous['token'],'selectedSha256':previous['selectedSha256']}
                    archived.append(dict(copy.deepcopy(previous),archiveReason='Subsequent confirmed input correction'))
                report['records'][proposal['token']]={'token':proposal['token'],'language':unit['language'],'bank':unit['bank'],'key':unit['key'],
                    'kind':'confirmed-input-correction','proposal':proposal,'reasons':['confirmed-input-error',proposal['reason']],
                    'initial':{'clip':copy.deepcopy(clip),'asr':copy.deepcopy(record)},'baseOverride':copy.deepcopy(base),
                    'sourceBinding':retry.binding_for(unit,base),'retryOverride':copy.deepcopy(corrected),
                    'complete':False,'phase':'correcting-reviewed-input','synthesisAttemptCount':1,
                    'asrAttemptCount':record.get('recognitionAttempts',1)}
                if predecessor:report['records'][proposal['token']]['predecessor']=predecessor
            overrides['entries'][proposal['token']]=corrected
        for proposal,unit,base,corrected in deferred:overrides['entries'][proposal['token']]=corrected
        for proposal,unit,base,corrected,*_ in [*selected,*deferred]:
            prior[proposal['token']]={'token':proposal['token'],'proposal':copy.deepcopy(proposal),'baseOverride':copy.deepcopy(base),
                'sourceBinding':retry.binding_for(unit,base),'appliedOverride':copy.deepcopy(corrected),
                'delivery':('future-required-generation' if unit.get('required') else 'future-optional-only') if any(p['token']==proposal['token'] for p,*_ in deferred) else 'pending-regeneration'}
        if plan.get('excludedReadings'):
            excluded={r['term']:r for r in review.get('reviewedReadingsKept',[])}
            for row in plan['excludedReadings']:excluded[row['term']]=copy.deepcopy(row)
            review['reviewedReadingsKept']=list(excluded.values())
        if plan.get('alreadyCorrectChecks'):
            kept={r['token']:r for r in review.get('alreadyCorrectInputChecks',[])}
            for row in plan['alreadyCorrectChecks']:kept[row['token']]=copy.deepcopy(row)
            review['alreadyCorrectInputChecks']=list(kept.values())
        # Save the original binding and real initial evidence before any override.
        atomic(OUT/'retries.json',report)
        review['confirmedInputCorrections']=list(prior.values());atomic(OUT/'normalization-review.json',review)
        atomic(OUT/'overrides.json',overrides)
        try:
            if all_tokens:
                atomic(token_path,all_tokens)
                if args.stream:
                    prefix=[sys.executable]
                    common=['--workdir',str(work),'--threads',str(args.threads),'--tokens-file',str(token_path)]
                    retry.run_workers([*prefix,str(ROOT/'scripts/generate-bank-audio.py'),*common],
                        [*prefix,str(ROOT/'scripts/audit-bank-audio.py'),*common,'--individual-only'],work,stream=True)
                else:
                    command('generate-bank-audio.py','--tokens-file',str(token_path))
                    command('audit-bank-audio.py','--individual-only','--tokens-file',str(token_path))
            pack_cache.clear();audit_cache.clear()
            generation=read(OUT/'manifest.json',{}).get('generation',{})
            for proposal,unit,base,corrected,resuming in selected:
                clip,record=current(unit)
                entry=report['records'][proposal['token']]
                if not correction_matches(unit,corrected,clip,generation) or not retry.ready_retry(entry,clip,record):
                    entry.update(phase='awaiting-real-ASR',complete=False,retry={'clip':clip,'asr':record})
                    atomic(OUT/'retries.json',report)
                    raise ValueError('Correction awaits a changed audio file and real current ASR: '+proposal['token'])
                finish_correction(entry,clip,record,unit,corrected,generation)
                atomic(OUT/'retries.json',report)
                prior[proposal['token']].update(delivery='regenerated-with-both-ASR-versions',selectedSha256=clip['sha256'],asrStatus=record['status'])
            retry.update_summaries(report)
            atomic(OUT/'retries.json',report)
            for note in review.get('asrTextReviewNotes',[]):
                row=prior.get(note.get('token'))
                if note.get('confirmedInputError') and note.get('token') in all_tokens+completed and row and row.get('delivery')=='regenerated-with-both-ASR-versions':
                    note.update(disposition='corrected-input-retained-see-case',correctedAudioSha256=row['selectedSha256'])
            review['confirmedInputCorrections']=list(prior.values());atomic(OUT/'normalization-review.json',review)
        finally:
            # Even an interrupted/failed recognition must leave the lightweight
            # index reflecting current files and its honest pending ASR state.
            if sys.exc_info()[0] is not SystemExit:command('generate-bank-audio.py','--sync-only')
        print(json.dumps({'regeneratedKeys':len(selected),'futureGenerationOverrides':len(deferred),'alreadyCompleted':len(completed),'attempts':report['separateAttemptSummary']},ensure_ascii=False))


if __name__=='__main__':main()
