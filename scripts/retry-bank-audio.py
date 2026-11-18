#!/usr/bin/env python3
"""Resume-safe local re-synthesis of actual ASR discrepancies.

Run only when the two initial writers have stopped, or use --wait. Never
rewrites source banks. A failed retry cannot replace a better original audio.
"""
import argparse
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('bank',ROOT/'scripts/generate-bank-audio.py')
bank=importlib.util.module_from_spec(spec);spec.loader.exec_module(bank)
read,atomic,sha=bank.read,bank.atomic,bank.sha
OUT=ROOT/'data/audio'


evidence_spec=importlib.util.spec_from_file_location('audio_evidence',Path(__file__).with_name('audio-evidence.py'))
evidence=importlib.util.module_from_spec(evidence_spec)
evidence_spec.loader.exec_module(evidence)
has_actual_asr=evidence.valid_asr


def binding_for(unit,base_override=None):
    override=base_override or {}
    return {'text':unit['text'],'voiceId':unit['voiceId'],'language':unit['language'],
        'spoken':override.get('spoken',bank.normalize(unit['text'],unit['language'])),
        'phonemes':override.get('phonemes'),'speed':float(override.get('speed',1.0)),
        **({'selectedVoiceId':bank.voice_rules.selected_voice(unit,override)} if 'voiceId' in override else {})}


def override_audio(override):
    override=override or {}
    return {k:override.get(k,1.0 if k=='speed' else None) for k in ['spoken','phonemes','speed','voiceId']}


def case_matches(entry,unit,current_override=None):
    token=f"{unit['language']}:{unit['bank']}:{unit['key']}"
    if entry.get('token')!=token:return False
    if any(entry.get(k)!=unit[k] for k in ['language','bank','key']):return False
    base=entry.get('baseOverride')
    if override_audio(current_override) not in [override_audio(base),override_audio(entry.get('retryOverride',base))]:return False
    initial=entry.get('initial',{}).get('clip',{})
    before=entry.get('sourceBinding') or {'text':initial.get('text'),'voiceId':bank.voice_rules.source_voice(initial),
        'language':initial.get('language'),'spoken':initial.get('spoken'),
        'phonemes':(base or {}).get('phonemes'),'speed':float((base or {}).get('speed',1.0)),
        **({'selectedVoiceId':initial.get('voiceId')} if 'voiceId' in (base or {}) else {})}
    return before==binding_for(unit,base)


def ready_retry(entry,clip,record):
    return bool(clip and clip.get('sha256')!=entry.get('initial',{}).get('clip',{}).get('sha256') and has_actual_asr(clip,record))


def initial_coverage(source,packs,audits):
    errors=[]
    for unit in source['units']:
        if not unit.get('required') or unit.get('nonSpoken'):continue
        pair=(unit['language'],unit['bank']);clip=packs.get(pair,{}).get('clips',{}).get(unit['key'])
        record=audits.get(pair,{}).get('records',{}).get(unit['key'])
        if not clip or not bank.voice_rules.clip_recipe_proof(unit,clip) or not has_actual_asr(clip,record):
            errors.append(f"{unit['language']}:{unit['bank']}:{unit['key']}")
    return errors


def alive(pid):
    try:os.kill(pid,0);return True
    except ProcessLookupError:return False


def stable_process_identity(value):
    if not value or value.startswith('start='):return value
    parts=value.strip().split(None,5)
    if len(parts)<5:return ''
    # macOS Python can replace argv[0] with its Framework executable after
    # Popen. Birth time and the remaining script/arguments stay stable.
    tail=parts[5].split(None,1) if len(parts)==6 else []
    return 'start='+' '.join(parts[:5])+'\nargs='+(tail[1] if len(tail)>1 else '')


def identity_parts(value):
    value=stable_process_identity(value)
    if not value or not value.startswith('start=') or '\nargs=' not in value:return None,None
    born,args=value[6:].split('\nargs=',1)
    return (born,args) if born.strip() else (None,None)


def process_identity(pid,expected_argv=None):
    """A read-only PID-reuse check, stored outside the published repository."""
    for attempt in range(5):
        result=subprocess.run(['ps','-p',str(pid),'-o','lstart=','-o','command='],capture_output=True,text=True)
        identity=stable_process_identity(result.stdout.strip()) if result.returncode==0 else ''
        born,args=identity_parts(identity)
        if expected_argv is not None:
            # ps can expose the real birth time before Python's argv is ready.
            # Persist birth + the command we actually spawned immediately;
            # never sleep before the first recoverable child ledger write.
            return 'start='+born+'\nargs='+' '.join(expected_argv[1:]) if born else ''
        if not born or args or attempt==4:return identity
        # This is observation of an already registered child, not capture.
        time.sleep(.02)


def child_identity_matches(entry):
    born,args=identity_parts(entry.get('identity',''))
    argv=entry.get('argv')
    known_argv=isinstance(argv,list) and bool(argv) and all(isinstance(v,str) for v in argv)
    if known_argv:
        expected=' '.join(argv[1:])
        if args and args!=expected:return False
        args=expected # Recover the old birth + transient-empty-argv ledger.
    current_born,current_args=identity_parts(process_identity(entry['pid']))
    if not born or not current_born:
        if not alive(entry['pid']):return False
        raise RuntimeError('Cannot verify live child birth identity; refusing overlapping author')
    if born!=current_born:return False
    if not args and not known_argv:
        raise RuntimeError('Live child has no saved command identity; refusing overlapping author')
    if current_args==args:return True
    if current_args and (args or known_argv):return False
    # Unknown arguments do not prove that the saved writer has disappeared.
    # Birth mismatch above still rejects PID reuse, even during startup.
    raise RuntimeError('Live child command line is incomplete; refusing overlapping author')


def running(work):
    processes=read(work/'bank-processes.json',{}).get('processes',{})
    busy=[role for role in ['generate','audit'] if processes.get(role,{}).get('pid') and alive(processes[role]['pid'])]
    children=read(work/'bank-retry-children.json',{})
    if children.get('state')=='running':
        for role,entry in children.get('children',{}).items():
            if entry.get('pid') and alive(entry['pid']) and child_identity_matches(entry):
                busy.append('retry-'+role)
    return busy


def run_workers(generate_cmd,audit_cmd,work,stream=False):
    """Run both real workers, accepting success only after both exit cleanly.

    Concurrent workers still have their own file locks and current-SHA ASR
    gates. No model, beam, input text or evidence requirements change.
    """
    if not stream:
        for command in [generate_cmd,audit_cmd]:subprocess.run(command,cwd=ROOT,check=True)
        return
    work=Path(work);work.mkdir(parents=True,exist_ok=True)
    ledger=work/'bank-retry-children.json'
    state={'version':1,'parentPid':os.getpid(),'state':'running','children':{}}
    children={}
    previous_handlers={}
    def interrupted(signum,frame):raise SystemExit(128+signum)
    try:
        for signum in [signal.SIGTERM,signal.SIGINT]:
            previous_handlers[signum]=signal.signal(signum,interrupted)
        for role,command in [('generate',generate_cmd),('audit',audit_cmd)]:
            if role=='audit':command=[*command,'--watch','--producer-pid',str(children['generate'].pid)]
            child=subprocess.Popen(command,cwd=ROOT)
            children[role]=child
            state['children'][role]={'pid':child.pid,'identity':'','argv':command}
            state['children'][role]['identity']=process_identity(child.pid,command)
            atomic(ledger,state)
        # Either worker failing must stop the other, rather than waiting hours
        # for a producer whose consumer has already crashed.
        while True:
            codes={role:child.poll() for role,child in children.items()}
            for role,code in codes.items():
                if code is not None and code!=0:raise subprocess.CalledProcessError(code,state['children'][role]['argv'])
            if all(code is not None for code in codes.values()):break
            time.sleep(.2)
    finally:
        for child in children.values():
            if child.poll() is None:child.terminate()
        for role,child in children.items():
            try:code=child.wait(timeout=10)
            except subprocess.TimeoutExpired:child.kill();code=child.wait()
            state['children'].setdefault(role,{'pid':child.pid})['returncode']=code
        state['state']='exited'
        atomic(ledger,state)
        for signum,handler in previous_handlers.items():signal.signal(signum,handler)


def classify(clip,record):
    reasons=[]
    if re.search(r'\d|\$',clip['text']):reasons.append('numeric-material-needs-verification')
    if re.search(r'\b[A-Z][a-z]+\b',clip['text'][1:]):reasons.append('named-or-capitalized-material-needs-verification')
    if record.get('errorRate',0)>=.25:reasons.append('large-transcript-difference')
    if any(d.get('operation')=='delete' for d in record.get('differences',[])):reasons.append('possible-omission-or-truncation')
    return reasons or ['transcript-difference']


def attempt_summaries(entries):
    """Per-key evidence counts, distinct from actual cache-miss model calls."""
    def total(rows):
        return {'keys':len(rows),'complete':sum(bool(e.get('complete')) for e in rows),
            'matched':sum(bool(e.get('complete')) and not e.get('unresolved') for e in rows),
            'review':sum(bool(e.get('unresolved')) for e in rows),
            'perKeySynthesisVersions':sum(e.get('synthesisAttemptCount',0) for e in rows),
            'perKeyRecognitionAttempts':sum(e.get('asrAttemptCount',0) for e in rows)}
    return {'confirmedInputCorrections':total([e for e in entries if e.get('kind')=='confirmed-input-correction']),
        'automaticPaceRetries':total([e for e in entries if e.get('kind')!='confirmed-input-correction'])}


def update_summaries(report):
    entries=list(report.get('records',{}).values())
    report['summary']={'cases':len(entries),'completed':sum(bool(e.get('complete')) for e in entries),
        'resolved':sum(e.get('outcome') in ['retry-matched','input-correction-matched'] for e in entries),
        'unresolved':sum(bool(e.get('unresolved')) for e in entries),
        'synthesisAttempts':sum(e.get('synthesisAttemptCount',0) for e in entries),
        'asrAttempts':sum(e.get('asrAttemptCount',0) for e in entries)}
    report['separateAttemptSummary']=attempt_summaries(entries)


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--workdir',type=Path,default=Path.home()/'.local/share/toeic-kokoro')
    p.add_argument('--threads',type=int,default=2)
    p.add_argument('--wait',action='store_true',help='Wait for initial required generation and both writers to finish')
    p.add_argument('--allow-incomplete',action='store_true',help='Pilot only; requires the initial writers to be stopped')
    p.add_argument('--limit',type=int,help='Pilot retry count, ordered by transcript severity')
    p.add_argument('--tokens-file',type=Path,help='Optional fixed pilot token list')
    p.add_argument('--stream-retries',action='store_true',help='Overlap real retry generation and individual ASR with supervised child processes')
    args=p.parse_args();work=args.workdir.resolve()
    if work==ROOT or ROOT in work.parents:p.error('Temporary work must stay outside the repository')
    work.mkdir(parents=True,exist_ok=True)
    controller_lock=(work/'bank-retry.lock').open('a')
    fcntl.flock(controller_lock,fcntl.LOCK_EX)
    report_path=OUT/'retries.json'
    if report_path.exists():
        # A completed reviewed-input maintenance window can precede the
        # remaining initial bank work. Keep its lightweight summaries current
        # while this sole controller waits, without touching evidence records.
        pending_report=read(report_path,{})
        update_summaries(pending_report)
        atomic(report_path,pending_report)
    while True:
        manifest=read(OUT/'manifest.json',{})
        busy=running(work)
        unfinished=any(not e.get('complete') for e in read(OUT/'retries.json',{'records':{}})['records'].values())
        # --wait also recovers a dead initial generator with missing clips;
        # requiring completed generation here would prevent the repair below.
        if not busy and (args.wait or manifest.get('requiredComplete') or args.allow_incomplete or unfinished):break
        if not args.wait:p.error('Stop both initial writers and finish required generation before retry (or pass --wait)')
        time.sleep(30)
    path=OUT/'retries.json';report=read(path,{'version':1,'policy':'At most one completed automatic re-synthesis per discrepancy; failed recognition remains resumable','records':{}})
    source=read(OUT/'source.json',{})
    source_by_token={f"{u['language']}:{u['bank']}:{u['key']}":u for u in source['units']}
    if any(e.get('kind')=='confirmed-input-correction' and not e.get('complete') for e in report['records'].values()):
        controller_lock.close()
        raise RuntimeError('Resume correct-bank-audio.py with its reviewed plan before automatic pace retries')
    override_path=OUT/'overrides.json';overrides=read(override_path,{'version':1,'entries':{}})
    candidates=[]
    for token,entry in list(report['records'].items()):
        if entry.get('complete'):continue
        unit=source_by_token.get(token)
        if unit and case_matches(entry,unit,overrides['entries'].get(token)):
            candidates.append(entry)
        else:
            # Reconcile interrupted cases BEFORE syncing/generating. Never
            # restore an old text/voice or an obsolete automatic override.
            report.setdefault('archivedCases',[]).append(dict(entry,archiveReason='Source, voice, normalized input or externally changed override no longer matches'))
            del report['records'][token]
            if override_audio(overrides['entries'].get(token))==override_audio(entry.get('retryOverride')):
                initial=entry.get('initial',{}).get('clip',{})
                same_source=unit and unit['text']==initial.get('text') and unit['voiceId']==initial.get('voiceId')
                if same_source and entry.get('baseOverride') is not None:overrides['entries'][token]=entry['baseOverride']
                else:overrides['entries'].pop(token,None)
    atomic(override_path,overrides);atomic(path,report)
    # This repairs a crash after pack edits but before the final index sync,
    # including the successful no-review path. Interrupted normalization or
    # source changes may invalidate clips; resume generation before ASR.
    sync=[sys.executable,str(ROOT/'scripts/generate-bank-audio.py'),'--workdir',str(work),'--sync-only']
    subprocess.run(sync,cwd=ROOT,check=True)
    if not args.allow_incomplete:
        if not read(OUT/'manifest.json',{}).get('requiredComplete'):
            subprocess.run([sys.executable,str(ROOT/'scripts/generate-bank-audio.py'),'--workdir',str(work),'--threads',str(args.threads)],cwd=ROOT,check=True)
        # A dead initial auditor is not evidence of completed recognition.
        subprocess.run([sys.executable,str(ROOT/'scripts/audit-bank-audio.py'),'--workdir',str(work),'--threads',str(args.threads),'--individual-only'],cwd=ROOT,check=True)
        subprocess.run(sync,cwd=ROOT,check=True)
    manifest=read(OUT/'manifest.json',{})
    loaded_packs={};loaded_audits={}
    for meta in manifest.get('packs',[]):
        pair=(meta['language'],meta['bank'])
        loaded_packs[pair]=read(ROOT/meta['src'],{'clips':{}})
        loaded_audits[pair]=read(OUT/'audit'/pair[0]/(pair[1]+'.json'),{'records':{}})
    if not args.allow_incomplete:
        missing=initial_coverage(source,loaded_packs,loaded_audits)
        if missing:
            atomic(OUT/'retry-coverage-error.json',{'version':1,'missingActualASR':missing})
            if args.wait:
                time.sleep(30);controller_lock.close();os.execv(sys.executable,[sys.executable,*sys.argv])
            controller_lock.close()
            raise RuntimeError(f'Initial actual ASR coverage incomplete: {len(missing)} units')
        (OUT/'retry-coverage-error.json').unlink(missing_ok=True)
    resuming={e['token'] for e in candidates}
    for meta in manifest.get('packs',[]):
        pack=loaded_packs[(meta['language'],meta['bank'])]
        audit=loaded_audits[(meta['language'],meta['bank'])]
        for key,clip in pack['clips'].items():
            token=f"{meta['language']}:{meta['bank']}:{key}";record=audit['records'].get(key,{})
            if token in resuming:continue
            previous=report['records'].get(token)
            if not source_by_token.get(token,{}).get('required') or record.get('status')!='review' or not has_actual_asr(clip,record):continue
            # Completed attempts remain evidence; changes to the source/input
            # are a new case and can be investigated separately.
            if previous and previous.get('complete') and case_matches(previous,source_by_token[token],overrides['entries'].get(token)) and (
                    previous['initial']['clip']['inputSha256']==clip['inputSha256'] or previous.get('selectedSha256')==clip['sha256']):continue
            if not previous or previous.get('complete'):
                if previous:report.setdefault('archivedCases',[]).append(dict(previous,archiveReason='New synthesis input after a completed case'))
                base=overrides['entries'].get(token)
                normalized=(base or {}).get('spoken',bank.normalize(clip['text'],meta['language']))
                if normalized!=clip['spoken']:raise ValueError(f'Spoken/source binding must be fixed before retry: {token}')
                entry={'token':token,'language':meta['language'],'bank':meta['bank'],'key':key,
                    'reasons':classify(clip,record),'initial':{'clip':clip,'asr':record},'baseOverride':base,
                    'inputReview':{'sourceUnchanged':True,'normalizationMatches':True,
                        'phonemeOverride':bool((base or {}).get('phonemes')),'scope':'No expected-text ASR prompt; no automatic semantic or name rewriting'},
                    'synthesisAttemptCount':1,'asrAttemptCount':1,'complete':False,
                    'sourceBinding':binding_for(source_by_token[token],base)}
                report['records'][token]=entry
            else:entry=previous
            candidates.append(entry)
    candidates.sort(key=lambda e:e['initial']['asr'].get('errorRate',0),reverse=True)
    if args.tokens_file:
        selected=set(read(args.tokens_file,[]));candidates=[e for e in candidates if e['token'] in selected]
    if args.limit:candidates=candidates[:args.limit]
    # Nonselected cases are not unfinished work from this attempt.
    selected={e['token'] for e in candidates}
    report['records']={k:e for k,e in report['records'].items() if e.get('complete') or k in selected or k in resuming}
    atomic(path,report)
    if not candidates:
        update_summaries(report)
        atomic(path,report)
        atomic(override_path,overrides)
        subprocess.run(sync,cwd=ROOT,check=True)
        print(json.dumps({'retries':0,'message':'No new required discrepancies to retry'}));controller_lock.close();return
    tokens=[]
    for entry in candidates:
        speed=.90 if float((entry['baseOverride'] or {}).get('speed',1.0))!=.90 else .85
        override=dict(entry['baseOverride'] or {},speed=speed,
            reason='Actual ASR discrepancy: local re-synthesis at slower pace with original text, voice and phonemes retained')
        overrides['entries'][entry['token']]=override;entry['retrySpeed']=speed;entry['retryOverride']=override;tokens.append(entry['token'])
    atomic(override_path,overrides);atomic(path,report)
    temporary=work/'tmp/bank-retry-tokens.json';atomic(temporary,tokens)
    commands=[
        [sys.executable,str(ROOT/'scripts/generate-bank-audio.py'),'--workdir',str(work),'--threads',str(args.threads),'--tokens-file',str(temporary)],
        [sys.executable,str(ROOT/'scripts/audit-bank-audio.py'),'--workdir',str(work),'--threads',str(args.threads),'--individual-only','--tokens-file',str(temporary)]]
    run_workers(commands[0],commands[1],work,stream=args.stream_retries)
    packs={};audits={}
    for entry in candidates:
        pair=(entry['language'],entry['bank'])
        if pair not in packs:
            packs[pair]=read(OUT/pair[0]/(pair[1]+'.json'),{'clips':{}})
            audits[pair]=read(OUT/'audit'/pair[0]/(pair[1]+'.json'),{'records':{}})
        clip=packs[pair]['clips'].get(entry['key']);record=audits[pair]['records'].get(entry['key'],{})
        changed=clip and clip['sha256']!=entry['initial']['clip']['sha256']
        actually_recognized=ready_retry(entry,clip,record)
        attempted=changed and record.get('sha256')==clip['sha256'] and (actually_recognized or record.get('transcriptionAttempted'))
        previous_attempt=entry.get('retry',{})
        if (previous_attempt.get('asr') or {}).get('transcriptionAttempted') and not entry.get('complete'):
            entry.setdefault('failedRecognitionAttempts',[]).append(previous_attempt)
        entry.update(synthesisAttemptCount=2,asrAttemptCount=entry['initial']['asr'].get('recognitionAttempts',1)+(record.get('recognitionAttempts',1) if attempted else 0),
            retry={'clip':clip,'asr':record if changed and record.get('sha256')==clip['sha256'] else None,'audioChanged':bool(changed)},
            complete=bool(actually_recognized),phase='complete' if actually_recognized else 'awaiting-real-ASR')
        if actually_recognized and record['status']=='matched':
            entry.update(outcome='retry-matched',selectedSha256=clip['sha256'],unresolved=False)
        else:
            packs[pair]['clips'][entry['key']]=entry['initial']['clip']
            audits[pair]['records'][entry['key']]=entry['initial']['asr']
            if entry['baseOverride'] is None:overrides['entries'].pop(entry['token'],None)
            else:overrides['entries'][entry['token']]=entry['baseOverride']
            entry.update(outcome='retry-unresolved-original-retained' if actually_recognized else 'retry-failed-original-retained',
                selectedSha256=entry['initial']['clip']['sha256'],unresolved=True)
        audits[pair]['records'][entry['key']]['retryEvidence']='./data/audio/retries.json#'+entry['token']
    for pair,pack in packs.items():
        atomic(OUT/pair[0]/(pair[1]+'.json'),pack);atomic(OUT/'audit'/pair[0]/(pair[1]+'.json'),audits[pair])
    atomic(override_path,overrides)
    update_summaries(report)
    atomic(path,report)
    subprocess.run(sync,cwd=ROOT,check=True)
    print(json.dumps(report['summary']),flush=True)
    if args.wait and any(not e.get('complete') for e in report['records'].values()):
        time.sleep(30);controller_lock.close();os.execv(sys.executable,[sys.executable,*sys.argv])
    controller_lock.close()


if __name__=='__main__':main()
