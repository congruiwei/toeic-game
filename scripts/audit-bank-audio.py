#!/usr/bin/env python3
"""Actually transcribe every delivered M4A with local Whisper; retain differences.

No expected sentence is supplied as a prompt/hotword to the recognizer. A
matching transcript is evidence, not proof of human-level pronunciation quality.
"""
import argparse
import fcntl
import difflib
import hashlib
import importlib.util
import importlib.metadata
import json
import math
import os
from pathlib import Path
import re
import time
import unicodedata

import numpy as np
from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'data/audio'
spec = importlib.util.spec_from_file_location('bank_generator', ROOT/'scripts/generate-bank-audio.py')
bank = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bank)
atomic, read, sha = bank.atomic, bank.read, bank.sha


class EmptyTranscriptError(ValueError):
    def __init__(self,result):
        super().__init__('ASR executed but returned an empty transcript; not completed recognition')
        self.recognition_result=result


evidence_spec=importlib.util.spec_from_file_location('audio_evidence',Path(__file__).with_name('audio-evidence.py'))
evidence=importlib.util.module_from_spec(evidence_spec)
evidence_spec.loader.exec_module(evidence)
actual_evidence=evidence.valid_asr


def generator_stopped(work, producer_pid=None):
    pid=producer_pid or read(work/'bank-processes.json',{}).get('processes',{}).get('generate',{}).get('pid')
    if not isinstance(pid,int) or pid<=0:return False
    try:os.kill(pid,0);return False
    except ProcessLookupError:return True
    except PermissionError:return False


def watch_complete(manifest,stats,producer_pid=None,producer_dead=False):
    # A streaming retry starts from a previously complete manifest. Do not
    # mistake that old snapshot for the producer's completed replacement set.
    return bool((manifest.get('requiredComplete') or manifest.get('complete')) and
                not stats['errors'] and (not producer_pid or producer_dead))


def distance(a, b):
    previous = list(range(len(b)+1))
    for i, x in enumerate(a, 1):
        current = [i]
        for j, y in enumerate(b, 1):
            current.append(min(current[-1]+1, previous[j]+1, previous[j-1]+(x != y)))
        previous = current
    return previous[-1]


def normalized(text, language):
    text = bank.normalize(text, language).casefold().replace('’', "'")
    if language == 'en':
        contractions = {"can't":"cannot", "won't":"will not", "i'm":"i am", "it's":"it is",
            "that's":"that is", "there's":"there is", "let's":"let us", "you're":"you are",
            "we're":"we are", "they're":"they are", "i've":"i have", "we've":"we have",
            "don't":"do not", "doesn't":"does not", "didn't":"did not", "isn't":"is not",
            "wasn't":"was not", "aren't":"are not", "weren't":"were not", "i'll":"i will",
            "we'll":"we will", "you'll":"you will", "they'll":"they will"}
        for before, after in contractions.items():
            text = re.sub(r'\b'+re.escape(before)+r'\b', after, text)
        return re.findall(r'[a-z]+', text)
    return list(''.join(c for c in text if unicodedata.category(c)[0] not in 'PZS'))


def differences(a, b):
    return [{'operation':tag,'expected':' '.join(a[i:j]),'recognized':' '.join(b[k:l])}
            for tag,i,j,k,l in difflib.SequenceMatcher(a=a,b=b,autojunk=False).get_opcodes() if tag!='equal']



def assign_words(rows, words, tolerance=.12):
    """Assign only by measured audio offsets, never by expected text.

    A word crossing an audio boundary, a zero/invalid timestamp or any word in
    a padding gap makes the adjacent file(s) unsafe for batch acceptance.
    """
    assigned=[{'words':[], 'boundaryReasons':[]} for _ in rows]
    def flag(index, reason):
        if reason not in assigned[index]['boundaryReasons']:
            assigned[index]['boundaryReasons'].append(reason)
    for word in words:
        start, end=word['start'], word['end']
        if not math.isfinite(start) or not math.isfinite(end) or end<=start:
            for i in range(len(rows)): flag(i,'invalid-word-timestamp')
            continue
        center=(start+end)/2
        chosen=next((i for i,r in enumerate(rows) if r['offset']<=center<=r['end']),None)
        if chosen is None:
            nearest=min(range(len(rows)),key=lambda i:min(abs(center-rows[i]['offset']),abs(center-rows[i]['end'])))
            flag(nearest,'word-in-padding')
            for i,r in enumerate(rows):
                if min(abs(center-r['offset']),abs(center-r['end']))<=.65:
                    flag(i,'word-in-padding')
            continue
        assigned[chosen]['words'].append(word)
        row=rows[chosen]
        if start<row['offset']-tolerance or end>row['end']+tolerance:
            flag(chosen,'word-crosses-file-boundary')
            for i,r in enumerate(rows):
                if i!=chosen and start<r['end'] and end>r['offset']:
                    flag(i,'word-crosses-file-boundary')
    return assigned


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--workdir',type=Path,default=Path.home()/'.local/share/toeic-kokoro')
    p.add_argument('--model',default='whisper-small')
    p.add_argument('--threads',type=int,default=2)
    p.add_argument('--limit',type=int,help='Limit new unique audio files, not source aliases')
    p.add_argument('--language',choices=['en','ja'])
    p.add_argument('--banks',nargs='+')
    p.add_argument('--tokens-file',type=Path,help='JSON array of exact language:bank:key tokens')
    p.add_argument('--watch',action='store_true')
    p.add_argument('--producer-pid',type=int,help='Explicit generating child PID for streamed retry supervision')
    p.add_argument('--idle-seconds',type=int,default=30)
    p.add_argument('--individual-only',action='store_true',help='Disable batch screening; still reuse completed ASR')
    args=p.parse_args()
    selected_tokens=set(read(args.tokens_file,[])) if args.tokens_file else None
    work=args.workdir.resolve()
    if work==ROOT or ROOT in work.parents:
        p.error('ASR models and caches must remain outside the repository')
    model_dir=work/'models'/args.model
    cache=work/'tmp/bank-asr'
    cache.mkdir(parents=True,exist_ok=True)
    writer_lock=(work/'bank-audit.lock').open('a')
    fcntl.flock(writer_lock,fcntl.LOCK_EX)
    # Keep this identity identical to the first individual run: valid earlier
    # beam-5 cache entries are real evidence and do not need new inference.
    individual={'model':args.model,'modelSha256':sha((model_dir/'model.bin').read_bytes()),'device':'cpu','computeType':'int8',
        'packages':{n:importlib.metadata.version(n) for n in ['faster-whisper','ctranslate2','av']},
        'beamSize':5,'conditionOnPreviousText':False,'prompt':None,'vadFilter':False}
    screening=dict(individual,beamSize=1,wordTimestamps=True,batchSeconds=24,leadingPadSeconds=.4,gapSeconds=.6,
        boundaryToleranceSeconds=.12,assignment='word-midpoint-in-actual-file-offset; strict-exact-v1')
    strategy={'individual':individual,'screening':None if args.individual_only else screening,
        'policy':'Stable boundary and normalized exact only; every other file gets individual beam-5 inference'}
    model=WhisperModel(str(model_dir),device='cpu',compute_type='int8',cpu_threads=args.threads,num_workers=1,local_files_only=True)
    ja=None
    phone_cache={}
    packs={}
    started=time.monotonic()
    counted=set()
    transcribed=0
    audio_seconds=0
    elapsed_transcribe=0
    single_calls=0
    batch_calls=0
    batch_files=0
    fallback_files=0
    failed_at={}

    def fingerprint(identity, clip, language):
        return sha(json.dumps([identity,clip['sha256'],language],sort_keys=True).encode())

    def checked_audio(item):
        path=ROOT/item['clip']['src']
        if sha(path.read_bytes())!=item['clip']['sha256']:
            raise ValueError('Delivered audio SHA differs from manifest')
        return path

    def count_file(item):
        nonlocal transcribed,audio_seconds
        token=(item['language'],item['clip']['sha256'])
        if token not in counted:
            counted.add(token)
            transcribed+=1
            audio_seconds+=item['clip']['duration']

    def single(item):
        nonlocal elapsed_transcribe,single_calls
        fp=fingerprint(individual,item['clip'],item['language'])
        cached=cache/(fp+'.json')
        prior={}
        if cached.exists():
            prior=read(cached,{})
            # Legacy beam-5 cache has no method field, but does contain exact
            # model parameters, audio SHA and executed segment evidence.
            if (isinstance(prior.get('recognized'),str) and prior['recognized'].strip() and
                    prior.get('sha256')==item['clip']['sha256'] and prior.get('generation')==individual and
                    prior.get('method') in [None,'individual-beam5'] and isinstance(prior.get('segments'),list)):
                return prior
        path=checked_audio(item)
        stamp=time.monotonic()
        segments,info=model.transcribe(str(path),language=item['language'],task='transcribe',beam_size=5,
            condition_on_previous_text=False,initial_prompt=None,hotwords=None,vad_filter=False,
            temperature=0.0,word_timestamps=False)
        segments=list(segments)  # Inference really executes here.
        elapsed=time.monotonic()-stamp
        result={'recognized':' '.join(s.text.strip() for s in segments).strip(),'duration':info.duration,
            'elapsedSeconds':round(elapsed,3),'generation':individual,'sha256':item['clip']['sha256'],
            'method':'individual-beam5','recognitionAttempts':prior.get('recognitionAttempts',0)+1,
            'segments':[{'start':s.start,'end':s.end,'text':s.text,'avgLogprob':s.avg_logprob,'noSpeechProb':s.no_speech_prob} for s in segments]}
        atomic(cached,result)
        elapsed_transcribe+=elapsed
        single_calls+=1
        count_file(item)
        if not result['recognized'].strip():raise EmptyTranscriptError(result)
        return result

    def compare(clip,result,language):
        nonlocal ja
        expected,heard=normalized(clip['spoken'],language),normalized(result['recognized'],language)
        errors=distance(expected,heard)
        phoneme_rate=None
        if language=='ja' and result.get('method')!='batch-beam1':
            if ja is None:
                from misaki import ja as misaki_ja
                ja=misaki_ja.JAG2P()
            texts=[clip['spoken'],bank.normalize(result['recognized'],'ja')]
            for text in texts:
                if text not in phone_cache:
                    phone_cache[text]=''.join(c for c in ja(text)[0] if c.isalnum() or unicodedata.category(c)[0]=='L')
            a,b=[phone_cache[t] for t in texts]
            phoneme_rate=round(distance(a,b)/max(len(a),1),4)
        if not result['recognized'].strip():raise EmptyTranscriptError(result)
        status='matched' if errors==0 or phoneme_rate==0 else 'review'
        return {'status':status,'metric':'WER' if language=='en' else 'CER',
            'errorRate':round(errors/max(len(expected),1),4),'phonemeErrorRate':phoneme_rate,
            'differences':differences(expected,heard)}

    def save_result(alias,result,screen=None):
        clip,language=alias['clip'],alias['language']
        generation=result.get('generation',individual)
        record={'key':alias['key'],'src':clip['src'],'sha256':clip['sha256'],'voiceId':clip['voiceId'],
            'fingerprint':fingerprint(generation,clip,language),'expected':clip['text'],'spoken':clip['spoken'],
            'recognized':result['recognized'],'segments':result['segments'],
            'recognitionMethod':result.get('method','individual-beam5'),'recognitionGeneration':generation,
            'singleFileVerification':result.get('method')!='batch-beam1','recognitionAttempts':result.get('recognitionAttempts',1)}
        if screen:
            record['screening']=dict(screen['screening'],recognized=screen['recognized'],
                normalizedExact=normalized(clip['spoken'],language)==normalized(screen['recognized'],language))
        record.update(compare(clip,result,language))
        alias['report']['records'][alias['key']]=record
        atomic(alias['target'],alias['report'])

    def fail(item,error):
        failed_at[(item['language'],item['clip']['sha256'])]=time.monotonic()
        for alias in item['aliases']:
            clip=alias['clip']
            alias['report']['records'][alias['key']]={'key':alias['key'],'src':clip['src'],'sha256':clip['sha256'],
                'status':'error','error':bank.public_error(error,work),'expected':clip['text'],'spoken':clip['spoken']}
            result=getattr(error,'recognition_result',None)
            if result:
                alias['report']['records'][alias['key']].update(recognized=result['recognized'],segments=result['segments'],
                    recognitionMethod='individual-beam5',recognitionGeneration=result['generation'],
                    singleFileVerification=True,transcriptionAttempted=True,recognitionAttempts=result.get('recognitionAttempts',1))
            atomic(alias['target'],alias['report'])

    def finalize(item,screen=None):
        nonlocal fallback_files
        try:
            verified=None
            needs_single=False
            for alias in item['aliases']:
                exact=screen and screen['recognized'] and screen['screening']['boundaryStable'] and (
                    normalized(screen['recognized'],item['language'])==normalized(alias['clip']['spoken'],item['language']))
                if exact:
                    save_result(alias,screen,screen)
                else:
                    if verified is None:
                        verified=single(item)
                        if screen: needs_single=True
                    save_result(alias,verified,screen)
            if needs_single: fallback_files+=1
        except Exception as error:
            fail(item,error)

    def run_batch(items):
        nonlocal elapsed_transcribe,batch_calls,batch_files
        # Arrays here are decoded from the actual delivered M4As, not synthesis
        # intermediates. Concatenation is for audit only, never for playback.
        chunks=[np.zeros(6400,dtype=np.float32)]
        rows=[]
        offset=.4
        for item in items:
            wave=item.pop('wave')
            rows.append({'offset':offset,'end':offset+len(wave)/16000,'sha256':item['clip']['sha256'],'src':item['clip']['src']})
            chunks.extend([wave,np.zeros(9600,dtype=np.float32)])
            offset=rows[-1]['end']+.6
        identifier=sha(json.dumps([screening,items[0]['language'],rows],sort_keys=True).encode())
        evidence_path=OUT/'audit-batches'/(identifier+'.json')
        stamp=time.monotonic()
        try:
            segments,_=model.transcribe(np.concatenate(chunks),language=items[0]['language'],task='transcribe',beam_size=1,
                condition_on_previous_text=False,initial_prompt=None,hotwords=None,vad_filter=False,
                temperature=0.0,word_timestamps=True)
            segments=list(segments)
            elapsed=time.monotonic()-stamp
            elapsed_transcribe+=elapsed
            batch_calls+=1
            batch_files+=len(items)
            words=[{'word':w.word,'start':w.start,'end':w.end,'probability':w.probability} for s in segments for w in (s.words or [])]
            assigned=assign_words(rows,words)
            evidence={'version':1,'id':identifier,'language':items[0]['language'],'generation':screening,
                'duration':offset,'elapsedSeconds':round(elapsed,3),'inputs':rows,'words':words,
                'segments':[{'start':s.start,'end':s.end,'text':s.text,'avgLogprob':s.avg_logprob,'noSpeechProb':s.no_speech_prob} for s in segments]}
            atomic(evidence_path,evidence)
            for item,row,assignment in zip(items,rows,assigned):
                recognized=''.join(w['word'] for w in assignment['words']).strip()
                result={'recognized':recognized,'duration':row['end']-row['offset'],
                    'generation':screening,'sha256':item['clip']['sha256'],'method':'batch-beam1',
                    'segments':[{'start':w['start']-row['offset'],'end':w['end']-row['offset'],'text':w['word'],'probability':w['probability']} for w in assignment['words']],
                    'screening':{'batchId':identifier,'evidence':'./'+str(evidence_path.relative_to(ROOT)),
                        'offset':row['offset'],'end':row['end'],'boundaryStable':not assignment['boundaryReasons'],
                        'boundaryReasons':assignment['boundaryReasons']}}
                fp=fingerprint(screening,item['clip'],item['language'])
                atomic(cache/(fp+'.json'),result)
                count_file(item)
                finalize(item,result)
        except Exception as error:
            # A failed batch must never discard its members. Each is still
            # transcribed individually, with the failed attempt retained.
            atomic(evidence_path,{'version':1,'id':identifier,'generation':screening,'inputs':rows,'error':bank.public_error(error,work)})
            for item in items: finalize(item)

    def flush_stats():
        records=[r for report in packs.values() for r in report['records'].values()]
        stats={'version':1,'generation':strategy,'transcribedFilesThisRun':transcribed,'records':len(records),
            'matched':sum(r['status']=='matched' for r in records),'review':sum(r['status']=='review' for r in records),
            'errors':sum(r['status']=='error' for r in records),'audioSecondsThisRun':round(audio_seconds,2),
            'inferenceSecondsThisRun':round(elapsed_transcribe,2),'wallSeconds':round(time.monotonic()-started,2),
            'batchCallsThisRun':batch_calls,'batchFilesThisRun':batch_files,'singleCallsThisRun':single_calls,
            'fallbackFilesThisRun':fallback_files}
        atomic(OUT/'audit-summary.json',stats)
        print(json.dumps({k:v for k,v in stats.items() if k not in ['generation','version']}),flush=True)
        return stats

    idle_after_generator_exit=0
    while True:
        manifest=read(OUT/'manifest.json',{'packs':[]})
        pending={}
        for meta in manifest['packs']:
            language,name=meta['language'],meta['bank']
            if (args.language and language!=args.language) or (args.banks and name not in args.banks): continue
            source=read(ROOT/meta['src'],{'clips':{}})
            target=OUT/'audit'/language/(name+'.json')
            pair=(language,name)
            if pair not in packs: packs[pair]=read(target,{'version':1,'language':language,'bank':name,'records':{}})
            report=packs[pair]
            report['generation']=strategy
            report['sourceSha256']=source.get('sourceSha256')
            # Removed/invalidated clips are not counted as current coverage.
            report['records']={k:r for k,r in report['records'].items() if k in source['clips']}
            for key,clip in source['clips'].items():
                if selected_tokens is not None and f'{language}:{name}:{key}' not in selected_tokens: continue
                existing=report['records'].get(key,{})
                identity=existing.get('recognitionGeneration',individual)
                done=identity in [individual,screening] and existing.get('fingerprint')==fingerprint(identity,clip,language) and actual_evidence(clip,existing)
                if done:
                    continue
                token=(language,clip['sha256'])
                if time.monotonic()-failed_at.get(token,-1000)<60: continue
                alias={'key':key,'clip':clip,'language':language,'report':report,'target':target}
                if token not in pending: pending[token]={'clip':clip,'language':language,'aliases':[]}
                pending[token]['aliases'].append(alias)
            atomic(target,report)
        queue=list(pending.values())
        if args.limit: queue=queue[:max(args.limit-transcribed,0)]
        # Bound each watch cycle so refreshed manifests and source fingerprints
        # are picked up promptly, even while the generator is still running.
        queue=queue[:120]
        batches={}
        durations={}
        for item in queue:
            lang=item['language']
            sfp=fingerprint(individual,item['clip'],lang)
            bfp=fingerprint(screening,item['clip'],lang)
            if (cache/(sfp+'.json')).exists():
                finalize(item)
                continue
            if not args.individual_only and (cache/(bfp+'.json')).exists():
                result=read(cache/(bfp+'.json'),{})
                if (result.get('generation')==screening and result.get('sha256')==item['clip']['sha256'] and
                        result.get('method')=='batch-beam1' and isinstance(result.get('recognized'),str) and
                        isinstance(result.get('segments'),list) and result.get('screening',{}).get('batchId')):
                    finalize(item,result)
                    continue
            if args.individual_only:
                finalize(item)
                continue
            try:
                wave=decode_audio(str(checked_audio(item)),sampling_rate=16000)
                duration=len(wave)/16000
                if not duration or not np.isfinite(wave).all(): raise ValueError('Invalid decoded audio')
                if duration+.4+.6>24:
                    finalize(item)
                    continue
                if batches.get(lang) and durations[lang]+duration+.6>24:
                    run_batch(batches[lang]);batches[lang]=[];durations[lang]=.4
                    flush_stats()
                item['wave']=wave
                batches.setdefault(lang,[]).append(item)
                durations[lang]=durations.get(lang,.4)+duration+.6
            except Exception as error:
                fail(item,error)
        for items in batches.values():
            if items: run_batch(items)
        stats=flush_stats()
        if (not args.watch and not queue) or (args.limit and transcribed>=args.limit): break
        if not queue:
            producer_dead=generator_stopped(work,args.producer_pid)
            if watch_complete(manifest,stats,args.producer_pid,producer_dead):break
            # Yield to the controller after two drained watch cycles if the
            # initial generator died. It can then regenerate missing clips;
            # remaining idle forever would block that recovery path.
            idle_after_generator_exit=idle_after_generator_exit+1 if producer_dead else 0
            if args.watch and idle_after_generator_exit>=2:
                print(json.dumps({'event':'initial-generator-stopped','action':'yield-for-controller-recovery'}),flush=True)
                break
            time.sleep(min(max(args.idle_seconds,1),30))
        else:idle_after_generator_exit=0
    print(json.dumps(stats),flush=True)
    writer_lock.close()


if __name__=='__main__':
    main()
