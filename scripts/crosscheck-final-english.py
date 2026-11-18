#!/usr/bin/env python3
"""Additional same-media full large-v3 review; all outputs external, no public writes."""
import argparse,copy,fcntl,hashlib,importlib.metadata,importlib.util,json,os,signal,tempfile,time
from contextlib import ExitStack
from pathlib import Path
HERE=Path(__file__).resolve().parent

def load(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
proof=load('full_model_proof',HERE/'audio-cross-model.py')
need,sha=proof.need,proof.sha

def read(path):return json.loads(path.read_text())
def atomic(path,value):
 path.parent.mkdir(parents=True,exist_ok=True)
 with tempfile.NamedTemporaryFile(mode='w',dir=path.parent,delete=False,encoding='utf-8') as f:
  json.dump(value,f,ensure_ascii=False,indent=2);f.write('\n');f.flush();os.fsync(f.fileno());name=f.name
 os.replace(name,path)
def file_sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  while chunk:=f.read(4*1024*1024):h.update(chunk)
 return h.hexdigest()
def completed_authors(work):
 for name in ['bank-strong-repair-supervisor.json','bank-strong-repair-round2.json']:
  need((work/name).exists(),'Wait for completed EN and JA phases, including round two')
  state=read(work/name);need(state.get('state')=='complete','Wait for completed EN and JA phases, including round two')
  for language in ['en','ja']:
   phase=state.get('phases',{}).get(language,{});counts=phase.get('counts',{})
   need(phase.get('state')=='complete' and type(counts.get('expected')) is int and counts['expected']>0 and counts.get('complete')==counts['expected'] and not counts.get('errors') and not counts.get('pending'),'Wait for completed EN and JA counts, including round two')
def binding(u,c,a,row):return {'token':proof.token(u),'audioSha256':c['sha256'],'clipSha256':sha(proof.canonical(proof.media(c))),'originalASRSha256':sha(proof.canonical(a)),'repairSha256':sha(proof.canonical(row['repair']))}
def snapshot(root,evidence):
 out=root/'data/audio';source_bytes=(out/'source.json').read_bytes();source=json.loads(source_bytes);quality=read(out/'quality-review.json');pairs={};items=[]
 for u in source['units']:
  if u.get('language')!='en' or not u.get('required') or u.get('nonSpoken'):continue
  pair=(u['language'],u['bank'])
  if pair not in pairs:pairs[pair]=(read(out/pair[0]/(pair[1]+'.json')),read(out/'audit'/pair[0]/(pair[1]+'.json')))
  c=pairs[pair][0].get('clips',{}).get(u['key']);a=pairs[pair][1].get('records',{}).get(u['key'])
  if not c or not a or a.get('status')!='review':continue
  row=quality['records'][proof.token(u)];proof.current_original(u,c,a,row,evidence)
  need(evidence.media_integrity(root,c)['ok'],'Current media integrity changed: '+proof.token(u))
  items.append((u,c,a,row))
 return {'version':1,'kind':proof.METHOD,'sourceSha256':sha(source_bytes),'modelRepository':proof.REPOSITORY,'modelRevision':proof.REVISION,'modelSha256':proof.MODEL_SHA,'entries':[binding(*x) for x in items]},items

def identity():
 return {'model':proof.MODEL,'modelSha256':proof.MODEL_SHA,'modelRepository':proof.REPOSITORY,'modelRevision':proof.REVISION,'device':'cpu','computeType':'int8',
  'packages':{n:importlib.metadata.version(n) for n in ['faster-whisper','ctranslate2','av']},'beamSize':5,'conditionOnPreviousText':False,'prompt':None,'hotwords':None,'vadFilter':False,'temperature':0,'wordTimestamps':False,'task':'transcribe','audioInput':'unchanged-delivered-m4a'}

def transcribe(model,path,clip,generation):
 started=time.monotonic()
 segments,info=model.transcribe(str(path),language='en',task='transcribe',beam_size=5,condition_on_previous_text=False,initial_prompt=None,hotwords=None,vad_filter=False,temperature=0.0,word_timestamps=False)
 segments=list(segments)
 return {'sha256':clip['sha256'],'recognized':' '.join(s.text.strip() for s in segments).strip(),'segments':[{'start':s.start,'end':s.end,'text':s.text,'avgLogprob':s.avg_logprob,'noSpeechProb':s.no_speech_prob} for s in segments],
  'generation':generation,'method':'individual-beam5','recognitionAttempts':1,'elapsedSeconds':round(time.monotonic()-started,3),'duration':info.duration}

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--repo',type=Path,required=True);p.add_argument('--workdir',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--plan',type=Path);p.add_argument('--run',action='store_true');p.add_argument('--finish-only',action='store_true');p.add_argument('--threads',type=int,default=4);args=p.parse_args()
 root,work,out=(x.resolve() for x in [args.repo,args.workdir,args.out]);need(all(x!=root and root not in x.parents for x in [work,out]),'Models, cache and reports must remain outside the repository')
 ev=load('cross_evidence',root/'scripts/audio-evidence.py')
 if not args.run:
  plan,items=snapshot(root,ev);atomic(out/'plan.json',plan);summary={'remainingReview':len(items),'uniqueMedia':len({c['sha256'] for _,c,_,_ in items}),'eligibleOnlyIfAbove50':len(items)>50,'modelLoaded':False,'publicWrites':0};atomic(out/'preflight.json',summary);print(json.dumps(summary));return
 need(args.plan,'An explicitly frozen final plan is required')
 retry=load('cross_retry',root/'scripts/retry-bank-audio.py');need(not retry.running(work),'Wait for all existing authors to exit')
 completed_authors(work)
 with ExitStack() as locks:
  for name in ['bank-retry.lock','bank-generate.lock','bank-audit.lock']:
   f=locks.enter_context((work/name).open('a'));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  completed_authors(work)
  current,items=snapshot(root,ev);need(current==read(args.plan),'Final source/media/repair/Turbo evidence changed; rebuild plan');need(len(items)>50,'Cross-model inference only when final English reviews remain above 50')
  bank=retry.bank;comparison=load('cross_comparison',root/'scripts/audio-compare.py');g=identity();modeldir=work/'models'/proof.MODEL
  verification=read(modeldir/'official-download-verification.json');need(verification.get('repo')==proof.REPOSITORY and verification.get('revision')==proof.REVISION and verification.get('complete') is True,'Missing fixed official model verification')
  for f in verification['files']:
   path=modeldir/f['name'];need(path.parent==modeldir and path.stat().st_size==f['bytes'] and file_sha(path)==f['sha256'],'Official model file changed')
  need(file_sha(modeldir/'model.bin')==proof.MODEL_SHA,'Wrong full-model weights')
  model=None;report={'version':1,'method':proof.METHOD,'plan':current,'records':{},'complete':False,'originalTurboChanged':False,'publicWrites':0};ledger=work/'bank-full-crosscheck-process.json';state={'version':1,'method':proof.METHOD,'pid':os.getpid(),'state':'running','startedAt':time.time()};atomic(ledger,state)
  oldhandlers={x:signal.getsignal(x) for x in [signal.SIGINT,signal.SIGTERM]}
  def stop(signum,frame):raise SystemExit(128+signum)
  for x in oldhandlers:signal.signal(x,stop)
  try:
   for u,c,a,row in items:
    fp=proof.fingerprint(g,c);cache=work/'tmp/bank-asr'/(fp+'.json');raw=read(cache) if cache.exists() else None
    if raw is None:
     need(not args.finish_only,'Full-model actual ASR is not ready')
     if model is None:
      from faster_whisper import WhisperModel
      model=WhisperModel(str(modeldir),device='cpu',compute_type='int8',cpu_threads=args.threads,num_workers=1,local_files_only=True)
     need(ev.media_integrity(root,c)['ok'],'Audio changed before recognition')
     raw=transcribe(model,root/c['src'],c,g);atomic(cache,raw)
    need(raw.get('sha256')==c['sha256'] and raw.get('generation')==g and raw.get('method')=='individual-beam5' and all(raw.get(k) is None for k in ['prompt','hotwords','initialPrompt','initial_prompt']),'Actual full-model cache changed')
    need(ev.media_integrity(root,c)['ok'],'Audio changed during recognition')
    t=proof.token(u)
    try:
     full=proof.compare_record(u,c,raw,comparison,bank.normalize,phoneme_override=bool(row['repair'].get('appliedOverride',{}).get('phonemes')))
     assessment=proof.assess(u,c,a,row,full,comparison,bank.normalize,ev)
     report['records'][t]={'proof':assessment,'rawASR':raw}
    except (ValueError,KeyError,TypeError) as error:
     report['records'][t]={'status':'review','errorType':type(error).__name__,'reason':str(error),'sourceAudioSha256':c['sha256'],'originalASR':copy.deepcopy(a),'rawASR':raw}
    atomic(out/'report.json',report)
    print(json.dumps({'done':len(report['records']),'total':len(items),'token':t,'status':report['records'][t].get('proof',{}).get('status','review')}),flush=True)
   final,_=snapshot(root,ev);need(final==current,'Public source/ASR changed during external cross-check')
   report['complete']=True;report['accepted']=sum(r.get('proof',{}).get('status')=='accepted' for r in report['records'].values());report['review']=len(items)-report['accepted'];atomic(out/'report.json',report)
   state.update(state='complete',returncode=0);print(json.dumps({'complete':True,'accepted':report['accepted'],'review':report['review'],'publicWrites':0}),flush=True)
  except BaseException as error:
   state.update(state='interrupted' if isinstance(error,SystemExit) else 'error',returncode=error.code if isinstance(error,SystemExit) else 1,errorType=type(error).__name__);raise
  finally:
   state['finishedAt']=time.time();atomic(ledger,state)
   for s,h in oldhandlers.items():signal.signal(s,h)
if __name__=='__main__':main()
