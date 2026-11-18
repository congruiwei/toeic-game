#!/usr/bin/env python3
"""Narrow, auditable context verification of unchanged original word PCM.

Default is read-only planning. Carrier synthesis and ASR are explicit authoring
operations; all WAV/cache files stay outside the repository. No target text is
sent to synthesis or used as an ASR prompt/hotword.
"""
import argparse,copy,fcntl,hashlib,importlib.util,importlib.metadata,json,re,time,os,signal
from contextlib import ExitStack,contextmanager
from pathlib import Path
import numpy as np

PREFIX='The word is'
RATE=16000
GAP_FRAMES=3200
METHOD='unchanged-original-pcm-context-v1'
MODEL='whisper-large-v3-turbo'
MODEL_SHA='e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da'
TOLERANCE=.08
ASSESSMENT_VERSION=2
ACTIVITY_WINDOW=160
ACTIVITY_THRESHOLD=.001
sha=lambda b:hashlib.sha256(b).hexdigest()
def load(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def canonical(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
def require(ok,message):
 if not ok:raise ValueError(message)
def token(u):return f"{u['language']}:{u['bank']}:{u['key']}"
def eligible(u,first_ids=()):
 if u.get('language')!='en' or u.get('nonSpoken') or u.get('required') is not True:return False
 word=u.get('text','').strip()
 if u.get('bank')=='labels':return bool(re.fullmatch(r'labels/(af_heart|am_puck|af_bella)/[A-D]',u.get('key','')) and re.fullmatch('[A-D]\\.',word))
 if not re.fullmatch(r"[^\W\d_]+(?:['’\-][^\W\d_]+)*",word,flags=re.UNICODE) or len(word)>40:return False
 return (u.get('bank')=='vocab' and bool(re.fullmatch(r'v-[^/]+/meaning',u.get('key','')))) or (u.get('bank')=='part2' and u.get('group') in first_ids and '/options/' in u.get('key',''))
def pcm_bytes(wave):
 require(isinstance(wave,np.ndarray) and wave.ndim==1 and wave.dtype==np.float32 and len(wave)>0,'PCM must be nonempty mono float32')
 require(np.isfinite(wave).all() and np.max(np.abs(wave))>0,'PCM must contain finite audible data')
 return wave.astype('<f4',copy=False).tobytes()
def source_activity(source):
 active=[start for start in range(0,len(source),ACTIVITY_WINDOW) if float(np.sqrt(np.mean(source[start:start+ACTIVITY_WINDOW].astype(np.float64)**2)))>=ACTIVITY_THRESHOLD]
 require(bool(active),'Source PCM has no verifiable audible activity')
 return {'method':'rms-10ms-threshold-0.001-v1','windowFrames':ACTIVITY_WINDOW,'rmsThreshold':ACTIVITY_THRESHOLD,'startFrame':active[0],'endFrame':min(len(source),active[-1]+ACTIVITY_WINDOW)}

def build_probe(source,carrier):
 source_bytes,carrier_bytes=pcm_bytes(source),pcm_bytes(carrier)
 probe=np.concatenate([carrier,np.zeros(GAP_FRAMES,dtype=np.float32),source])
 start=len(carrier)+GAP_FRAMES
 require(probe[start:].astype('<f4',copy=False).tobytes()==source_bytes,'Target PCM changed while concatenating')
 return probe,{'sampleRate':RATE,'format':'float32-le-mono','sourcePCMSha256':sha(source_bytes),'carrierPCMSha256':sha(carrier_bytes),
  'probePCMSha256':sha(probe.astype('<f4',copy=False).tobytes()),'sourceActivity':source_activity(source),'carrierFrames':len(carrier),'gapFrames':GAP_FRAMES,
  'spanStartFrame':start,'spanFrames':len(source),'totalFrames':len(probe),'targetSpanSha256':sha(source_bytes),'targetPCMUnchanged':True}
def verify_pcm(meta,source,carrier,probe):
 expected,actual=build_probe(source,carrier)
 require(meta==actual,'PCM provenance changed')
 require(pcm_bytes(probe)==pcm_bytes(expected),'Probe is not the exact carrier/gap/original PCM sequence')
 return True
_WORD=re.compile(r"[^\W_]+(?:['’][^\W_]+)?",re.UNICODE)
def words(text):return [m.group().replace('’',"'") for m in _WORD.finditer(text)]
def extract_tail(record,pcm,assessment_version=ASSESSMENT_VERSION):
 recognized=record.get('recognized','');tokens=words(recognized)
 require([x.casefold() for x in tokens[:3]]==['the','word','is'] and len(tokens)>3,'Probe must begin with the exact fixed prefix and a nonempty tail')
 timed=[]
 for word in record.get('words',[]):
  start,end=word.get('start'),word.get('end')
  require(isinstance(start,(int,float)) and isinstance(end,(int,float)) and np.isfinite([start,end]).all() and 0<=start<end<=pcm['totalFrames']/RATE+TOLERANCE,'Invalid actual word timestamps')
  timed.extend((t,start,end) for t in words(word.get('word','')))
 require(all(timed[i][1]>=timed[i-1][1] and timed[i][2]>=timed[i-1][2] for i in range(1,len(timed))),'Word timestamps are not ordered')
 require([t.casefold() for t,_,_ in timed]==[t.casefold() for t in tokens],'Word evidence must cover the complete recognized transcript')
 boundary=pcm['spanStartFrame']/RATE;stop=(pcm['spanStartFrame']+pcm['spanFrames'])/RATE
 require(all(end<=boundary+TOLERANCE for _,_,end in timed[:3]),'Prefix crosses into target audio')
 if assessment_version==1:
  require(all(start>=boundary-TOLERANCE and end<=stop+TOLERANCE for _,start,end in timed[3:]),'Recognized tail is not aligned to the original target span')
 else:
  activity=pcm.get('sourceActivity',{})
  require(activity.get('method')=='rms-10ms-threshold-0.001-v1' and activity.get('windowFrames')==ACTIVITY_WINDOW and activity.get('rmsThreshold')==ACTIVITY_THRESHOLD and type(activity.get('startFrame')) is int and type(activity.get('endFrame')) is int and 0<=activity['startFrame']<activity['endFrame']<=pcm['spanFrames'],'Missing source activity evidence')
  audible_start=boundary+activity['startFrame']/RATE;audible_end=boundary+activity['endFrame']/RATE
  require(all(start>=pcm['carrierFrames']/RATE and end>audible_start and start<audible_end and end<=stop+TOLERANCE for _,start,end in timed[3:]),'Tail must start after the carrier and overlap audible original PCM, not only the inserted silence')
 return ' '.join(tokens[3:])
def strong(record):
 g=(record or {}).get('recognitionGeneration',{})
 return bool(g.get('model')==MODEL and g.get('modelSha256')==MODEL_SHA and g.get('device')=='cpu' and g.get('computeType')=='int8' and g.get('beamSize')==5 and g.get('prompt') is None and 'prompt' in g and g.get('hotwords') is None and 'hotwords' in g and g.get('conditionOnPreviousText') is False and g.get('vadFilter') is False and g.get('wordTimestamps') is True and g.get('temperature')==0)
def original_strong(clip,record,evidence):
 g=(record or {}).get('recognitionGeneration',{})
 return bool(evidence.valid_asr(clip,record) and record.get('status')=='review' and record.get('recognitionMethod')=='individual-beam5' and g.get('model')==MODEL and g.get('modelSha256')==MODEL_SHA)
def assess(unit,clip,original,carrier,pcm,result,comparison,normalizer,evidence,first_ids=(),assessment_version=ASSESSMENT_VERSION):
 require(assessment_version in [1,2],'Unknown context assessment version')
 require(eligible(unit,first_ids),'Source is not an eligible English word/first-word option/letter label')
 require(all(clip.get(k)==unit.get(k) for k in ['text','language','voiceId','required']),'Source/clip identity changed')
 require(original_strong(clip,original,evidence),'A current actual strong individual review is required')
 require(carrier.get('text')==PREFIX and carrier.get('voiceId') in ['af_heart','am_puck','af_bella'],'Carrier must be the fixed target-free phrase')
 require(carrier.get('sampleRate')==RATE and carrier.get('synthesis',{}).get('targetTextUsed') is False,'Carrier was not explicitly target-free')
 require(all(type(pcm.get(k)) is int and pcm[k]>0 for k in ['carrierFrames','spanStartFrame','spanFrames','totalFrames']),'Invalid PCM frame counts')
 require(carrier.get('pcmSha256')==pcm.get('carrierPCMSha256') and carrier.get('frames')==pcm.get('carrierFrames'),'Carrier PCM identity changed')
 require(all(re.fullmatch('[a-f0-9]{64}',str(v or '')) for v in [clip.get('sha256'),carrier.get('audioSha256'),pcm.get('probePCMSha256'),pcm.get('sourcePCMSha256')]),'Missing audio/PCM SHA')
 require(pcm.get('sampleRate')==RATE and pcm.get('format')=='float32-le-mono' and pcm.get('gapFrames')==GAP_FRAMES and pcm.get('spanStartFrame')==pcm.get('carrierFrames',0)+GAP_FRAMES and pcm.get('totalFrames')==pcm.get('spanStartFrame',0)+pcm.get('spanFrames',0) and pcm.get('spanFrames',0)>0 and pcm.get('targetPCMUnchanged') is True and pcm.get('sourcePCMSha256')==pcm.get('targetSpanSha256'),'Unproven unchanged target span')
 require(strong(result) and result.get('probePCMSha256')==pcm['probePCMSha256'] and result.get('recognitionMethod')=='context-individual-beam5' and isinstance(result.get('segments'),list) and result['segments'],'Missing actual context ASR provenance')
 require(' '.join(s.get('text','').strip() for s in result['segments']).strip()==result.get('recognized'),'Stored segments differ from full transcript')
 accepted=False;tail=None;checked=None;reasons=[]
 try:
  tail=extract_tail(result,pcm,assessment_version)
  checked=comparison.compare(clip['spoken'],tail,'en',normalizer=normalizer,source_text=clip['text'],allow_articles=False)
  accepted=checked['equivalent'] is True and checked['provenance'].get('articlePolicyEnabled') is False
  if not accepted:reasons.append('strict-tail-not-equivalent')
 except ValueError as error:reasons.append(str(error))
 identity={'token':token(unit),'sourceAudioSha256':clip['sha256'],'carrierPCMSha256':carrier['pcmSha256'],'probePCMSha256':pcm['probePCMSha256'],'modelSha256':MODEL_SHA,'method':METHOD}
 if assessment_version>=2:identity['assessmentVersion']=assessment_version
 output={'version':1,'id':sha(canonical(identity)),'method':METHOD,'token':token(unit),'sourceAudioSha256':clip['sha256'],'sourceClip':copy.deepcopy(clip),'originalASR':copy.deepcopy(original),
  'carrier':copy.deepcopy(carrier),'pcm':copy.deepcopy(pcm),'asr':copy.deepcopy(result),'recognizedTail':tail,'comparison':checked,'status':'accepted' if accepted else 'review','reasons':reasons or ['strict-context-tail-equivalence'],'originalAudioResynthesized':False,'originalIndividualASRMatched':False}
 if assessment_version>=2:output['assessmentVersion']=assessment_version
 return output
def same_semantic_proof(a,b):
 """Keep historical code hashes; still recheck every semantic/evidence field."""
 if a==b:return True
 try:
  left,right=copy.deepcopy(a),copy.deepcopy(b)
  for item in [left,right]:
   provenance=item['comparison']['provenance']
   for name in ['ruleFileSha256','normalizerFileSha256']:
    require(bool(re.fullmatch('[a-f0-9]{64}',str(provenance.get(name,'')))),'Invalid stored code provenance')
    del provenance[name]
  return left==right
 except (ValueError,KeyError,TypeError):return False

def valid_acceptance(unit,clip,proof,comparison,normalizer,evidence,first_ids=()):
 try:
  require(proof.get('status')=='accepted' and proof.get('sourceAudioSha256')==clip.get('sha256'),'Acceptance is stale')
  for name in ['src','sha256','bytes','text','spoken','language','voiceId','inputSha256','phonemeSha256']:
   require(proof['sourceClip'].get(name)==clip.get(name),'Accepted original identity changed')
  expected=assess(unit,proof['sourceClip'],proof['originalASR'],proof['carrier'],proof['pcm'],proof['asr'],comparison,normalizer,evidence,first_ids,proof.get('assessmentVersion',1))
  return same_semantic_proof(expected,proof) and expected['status']=='accepted'
 except (ValueError,KeyError,TypeError):return False


def valid_context_record(unit,clip,record,row,comparison,normalizer,evidence,first_ids=()):
 """Admission gate for a current public accepted record; no model/file access."""
 try:
  admission=record.get('acceptance',{})
  require(record.get('status')=='accepted' and admission.get('method')==METHOD and admission.get('sourceAudioSha256')==clip.get('sha256') and admission.get('originalIndividualStatus')=='review','Wrong context admission')
  matches=[p for p in row.get('contextProbes',[]) if p.get('id')==admission.get('proofId')]
  require(len(matches)==1,'Missing or duplicate context proof')
  proof=matches[0]
  require(valid_acceptance(unit,clip,proof,comparison,normalizer,evidence,first_ids),'Stale or invalid context proof')
  expected=copy.deepcopy(proof['originalASR']);expected['status']='accepted';expected['acceptance']={'method':METHOD,'proofId':proof['id'],'sourceAudioSha256':clip['sha256'],'originalIndividualStatus':'review'}
  return record==expected
 except (ValueError,KeyError,TypeError):return False

def stage_proof(row,unit,clip,original,proof,comparison,normalizer,evidence,first_ids=()):
 """Append immutable proof history, then return a current audit candidate."""
 require(proof.get('token')==token(unit) and proof.get('sourceAudioSha256')==clip.get('sha256') and proof.get('originalASR')==original,'Proof publication identity changed')
 history=row.setdefault('contextProbes',[])
 require(isinstance(history,list),'Invalid context proof history')
 matching=[p for p in history if p.get('id')==proof['id']]
 require(len(matching)<=1,'Duplicate context proof history')
 if matching:
  require(same_semantic_proof(matching[0],proof),'Existing context proof must not be overwritten')
  proof=matching[0]  # Preserve the original hashes and complete historical record.
 else:history.append(copy.deepcopy(proof))
 if proof['status']!='accepted':return copy.deepcopy(original)
 accepted=copy.deepcopy(original);accepted['status']='accepted';accepted['acceptance']={'method':METHOD,'proofId':proof['id'],'sourceAudioSha256':clip['sha256'],'originalIndividualStatus':'review'}
 require(valid_context_record(unit,clip,accepted,row,comparison,normalizer,evidence,first_ids),'Context admission proof failed')
 return accepted

def run_asr(model,probe,identity):
 """The model receives only waveform and fixed options, never target text."""
 segments,info=model.transcribe(probe,language='en',task='transcribe',beam_size=5,condition_on_previous_text=False,initial_prompt=None,hotwords=None,vad_filter=False,temperature=0.0,word_timestamps=True)
 segments=list(segments)
 return {'recognized':' '.join(s.text.strip() for s in segments).strip(),'recognitionGeneration':identity,'recognitionMethod':'context-individual-beam5','probePCMSha256':sha(pcm_bytes(probe)),
  'segments':[{'start':s.start,'end':s.end,'text':s.text,'avgLogprob':s.avg_logprob,'noSpeechProb':s.no_speech_prob} for s in segments],
  'words':[{'word':w.word,'start':w.start,'end':w.end,'probability':w.probability} for s in segments for w in (s.words or [])]}


@contextmanager
def author_run(bank,work):
 """External process checkpoint; author locks remain the exclusion mechanism."""
 path=work/'bank-context-probe-process.json';state={'version':1,'pid':os.getpid(),'state':'running','startedAt':time.time(),'method':METHOD}
 previous={s:signal.getsignal(s) for s in [signal.SIGTERM,signal.SIGINT]}
 def stopped(number,frame):raise SystemExit(128+number)
 for s in previous:signal.signal(s,stopped)
 bank.atomic(path,state)
 try:
  yield
  state.update(state='complete',returncode=0)
 except BaseException as error:
  state.update(state='interrupted' if isinstance(error,SystemExit) else 'error',returncode=error.code if isinstance(error,SystemExit) else 1,errorType=type(error).__name__)
  raise
 finally:
  state['finishedAt']=time.time();bank.atomic(path,state)
  for s,handler in previous.items():signal.signal(s,handler)

def prepare_carrier(bank,work):
 """Explicit future operation: synthesize ONLY the fixed carrier, never a target."""
 from faster_whisper.audio import decode_audio
 import soundfile as sf
 folder=work/'tmp/context-probes';folder.mkdir(parents=True,exist_ok=True);meta=folder/'carrier.json';wav=folder/'carrier.wav'
 if meta.exists():
  saved=bank.read(meta,{})
  require(saved.get('text')==PREFIX and sha(wav.read_bytes())==saved.get('audioSha256'),'Existing carrier changed')
  require(sha(pcm_bytes(decode_audio(str(wav),sampling_rate=RATE)))==saved['pcmSha256'],'Existing carrier PCM changed');return saved
 models=work/'models';options=bank.ort.SessionOptions();options.intra_op_num_threads=2;options.inter_op_num_threads=1
 session=bank.ort.InferenceSession(str(models/'kokoro-v1.0.onnx'),sess_options=options,providers=['CPUExecutionProvider']);kokoro=bank.Kokoro.from_session(session,str(models/'voices-v1.0.bin'))
 phonemes=bank.phonemize(PREFIX,'en',{});wave,rate=kokoro.create(phonemes,voice='af_heart',speed=1.,is_phonemes=True,trim=False)
 sf.write(wav,wave,rate,subtype='FLOAT');pcm=decode_audio(str(wav),sampling_rate=RATE)
 saved={'text':PREFIX,'voiceId':'af_heart','audioSha256':sha(wav.read_bytes()),'pcmSha256':sha(pcm_bytes(pcm)),'frames':len(pcm),'sampleRate':RATE,
  'synthesis':{'modelSha256':sha((models/'kokoro-v1.0.onnx').read_bytes()),'voicesSha256':sha((models/'voices-v1.0.bin').read_bytes()),'phonemeSha256':sha(phonemes.encode()),'targetTextUsed':False}}
 bank.atomic(meta,saved);return saved

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--repo',type=Path,default=Path(__file__).resolve().parents[1]);p.add_argument('--workdir',type=Path,default=Path.home()/'.local/share/toeic-kokoro');p.add_argument('--plan',type=Path);p.add_argument('--apply',action='store_true');p.add_argument('--finish-only',action='store_true');p.add_argument('--make-carrier',action='store_true');p.add_argument('--threads',type=int,default=4);args=p.parse_args()
 root=args.repo.resolve();work=args.workdir.resolve();out=root/'data/audio'
 require(work!=root and root not in work.parents,'All WAV/model files must stay outside the repository')
 bank=load('context_bank',root/'scripts/generate-bank-audio.py');evidence=load('context_evidence',root/'scripts/audio-evidence.py');comparison=load('context_comparison',root/'scripts/audio-compare.py');retry=load('context_retry',root/'scripts/retry-bank-audio.py')
 if args.make_carrier:
  require(args.apply,'Carrier synthesis requires --apply');require(not retry.running(work),'Wait for current audio authors')
  with ExitStack() as stack:
   work.mkdir(parents=True,exist_ok=True)
   for name in ['bank-retry.lock','bank-generate.lock','bank-audit.lock']:
    lock=stack.enter_context((work/name).open('a'));fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
   stack.enter_context(author_run(bank,work))
   print(json.dumps(prepare_carrier(bank,work),ensure_ascii=False));return
 require(args.plan,'--plan is required');plan=bank.read(args.plan,{})
 source_bytes=(out/'source.json').read_bytes();source=json.loads(source_bytes);require(plan.get('sourceSha256')==sha(source_bytes),'Plan source changed')
 units={token(u):u for u in source['units']};first_ids={q['id'] for q in bank.read(root/'data/part2.json',[]) if q.get('type')=='first'}
 quality_bytes=(out/'quality-review.json').read_bytes();quality=json.loads(quality_bytes);require(quality.get('stages',{}).get('strongerASR',{}).get('complete') is True,'Finalize the full stronger ASR stage first')
 wanted=plan.get('tokens',[]);require(wanted and len(wanted)==len(set(wanted)),'Empty/duplicate probe plan');items=[];packs={};audits={};snapshots={}
 for u in source['units']:
  pair=(u['language'],u['bank'])
  if pair in packs:continue
  for kind,target in [('pack',out/pair[0]/(pair[1]+'.json')),('audit',out/'audit'/pair[0]/(pair[1]+'.json'))]:
   snapshots[target]=target.read_bytes() if target.exists() else None
   value=json.loads(snapshots[target]) if snapshots[target] is not None else ({'version':1,'language':pair[0],'bank':pair[1],'clips':{}} if kind=='pack' else {'records':{}})
   (packs if kind=='pack' else audits)[pair]=value
 for id in wanted:
  u=units.get(id);require(u and eligible(u,first_ids),'Ineligible context source: '+id);row=quality.get('records',{}).get(id);require(row,'Missing quality ledger row: '+id)
  pair=(u['language'],u['bank'])
  clip=packs[pair]['clips'].get(u['key']);record=audits[pair]['records'].get(u['key']);require(clip and evidence.media_integrity(root,clip)['ok'],'Current original media missing/changed: '+id)
  previous=[x for x in row.get('contextProbes',[]) if x.get('sourceAudioSha256')==clip['sha256']]
  if (record or {}).get('status')=='accepted':
   require(valid_context_record(u,clip,record,row,comparison,bank.normalize,evidence,first_ids),'Accepted context evidence changed');continue
  require(original_strong(clip,record,evidence),'Current strong individual review required: '+id);items.append((u,row,copy.deepcopy(clip),copy.deepcopy(record),previous))
 if not args.apply:print(json.dumps({'dryRun':True,'eligiblePending':len(items),'alreadyAccepted':len(wanted)-len(items),'carrierReady':(work/'tmp/context-probes/carrier.json').exists()}));return
 require(not retry.running(work),'Wait for current audio authors')
 from faster_whisper.audio import decode_audio
 import soundfile as sf
 with ExitStack() as stack:
  work.mkdir(parents=True,exist_ok=True)
  for name in ['bank-retry.lock','bank-generate.lock','bank-audit.lock']:
   lock=stack.enter_context((work/name).open('a'));fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  stack.enter_context(author_run(bank,work))
  require((out/'source.json').read_bytes()==source_bytes and (out/'quality-review.json').read_bytes()==quality_bytes,'Source/ledger changed before locks')
  for file,saved in snapshots.items():require((file.read_bytes() if file.exists() else None)==saved,'Pack/audit changed before locks')
  folder=work/'tmp/context-probes';carrier=bank.read(folder/'carrier.json',{});require(carrier.get('text')==PREFIX,'Create the fixed carrier separately first')
  carrier_file=folder/'carrier.wav';require(sha(carrier_file.read_bytes())==carrier.get('audioSha256'),'Carrier file changed');carrier_pcm=decode_audio(str(carrier_file),sampling_rate=RATE)
  model_dir=work/'models'/MODEL;require(sha((model_dir/'model.bin').read_bytes())==MODEL_SHA,'Wrong strong model identity')
  identity={'model':MODEL,'modelSha256':MODEL_SHA,'device':'cpu','computeType':'int8','beamSize':5,'conditionOnPreviousText':False,'prompt':None,'hotwords':None,'vadFilter':False,'temperature':0,'wordTimestamps':True,'packages':{n:importlib.metadata.version(n) for n in ['faster-whisper','ctranslate2','av','numpy']}}
  model=None
  for u,row,clip,original,previous in items:
   require(evidence.media_integrity(root,clip)['ok'],'Original changed during preflight')
   pcm=decode_audio(str(root/clip['src']),sampling_rate=RATE);probe,meta=build_probe(pcm,carrier_pcm);verify_pcm(meta,pcm,carrier_pcm,probe)
   require(meta['carrierPCMSha256']==carrier['pcmSha256'],'Carrier decode changed')
   cache_id=sha(canonical({'source':clip['sha256'],'probe':meta['probePCMSha256'],'generation':identity,'method':METHOD}));cache=folder/cache_id;cache.mkdir(parents=True,exist_ok=True)
   wavefile=cache/'probe.wav';sf.write(wavefile,probe,RATE,subtype='FLOAT');reloaded,sample_rate=sf.read(wavefile,dtype='float32');require(sample_rate==RATE and pcm_bytes(reloaded)==pcm_bytes(probe),'Saved probe PCM changed')
   result=bank.read(cache/'asr.json',None)
   if result is None:
    require(not args.finish_only,'Actual probe ASR is not ready')
    if model is None:
     from faster_whisper import WhisperModel
     model=WhisperModel(str(model_dir),device='cpu',compute_type='int8',cpu_threads=args.threads,num_workers=1,local_files_only=True)
    result=run_asr(model,probe,identity);bank.atomic(cache/'asr.json',result)
   proof=assess(u,clip,original,carrier,meta,result,comparison,bank.normalize,evidence,first_ids);proof['probeWavSha256']=sha(wavefile.read_bytes())
   # Public acceptance checks reproduce the proof without optional external file metadata.
   core={k:v for k,v in proof.items() if k!='probeWavSha256'}
   bank.atomic(cache/'proof.json',proof)
   require(evidence.media_integrity(root,clip)['ok'],'Original media changed during ASR')
   published=stage_proof(row,u,clip,original,core,comparison,bank.normalize,evidence,first_ids)
   audits[(u['language'],u['bank'])]['records'][u['key']]=published
   # Ledger precedes audit publication, so interruption cannot publish a proofless acceptance.
   bank.atomic(out/'quality-review.json',quality)
   bank.atomic(out/'audit'/u['language']/(u['bank']+'.json'),audits[(u['language'],u['bank'])])
  proofs=[x for row in quality['records'].values() for x in row.get('contextProbes',[])]
  current=0
  for u in source['units']:
   a=audits[(u['language'],u['bank'])]['records'].get(u['key'],{});c=packs[(u['language'],u['bank'])]['clips'].get(u['key'],{})
   if a.get('status')=='accepted' and any(x['id']==a.get('acceptance',{}).get('proofId') and x['sourceAudioSha256']==c.get('sha256') and x['status']=='accepted' for x in proofs):current+=1
  quality['stages']['contextualProbes']={'method':METHOD,'fixedCarrier':PREFIX,'model':MODEL,'modelSha256':MODEL_SHA,'originalMediaUnchanged':True,'proofs':len(proofs),'acceptedProofs':sum(x['status']=='accepted' for x in proofs),'currentAccepted':current}
  bank.atomic(out/'quality-review.json',quality);generation=bank.read(out/'manifest.json',{})['generation'];bank.flush(source,sha(source_bytes),generation,packs)
  print(json.dumps(quality['stages']['contextualProbes']))
if __name__=='__main__':main()
