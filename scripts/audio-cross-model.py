"""Strict additional full-model evidence; never rewrites original Turbo ASR."""
import copy,hashlib,json,math,re
METHOD='same-media-full-model-crosscheck-v1'
MODEL='whisper-large-v3'
REPOSITORY='Systran/faster-whisper-large-v3'
REVISION='edaa852ec7e145841d8ffdb056a99866b5f0a478'
MODEL_SHA='69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1'
TURBO='whisper-large-v3-turbo'
TURBO_SHA='e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da'
def canonical(x):return json.dumps(x,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()
def sha(x):return hashlib.sha256(x).hexdigest()
def need(x,why):
 if not x:raise ValueError(why)
def token(u):return f"{u['language']}:{u['bank']}:{u['key']}"
def digest(x):return isinstance(x,str) and bool(re.fullmatch('[a-f0-9]{64}',x))
def media(c):return {k:v for k,v in c.items() if k!='asrStatus'}
def fingerprint(g,c):return sha(json.dumps([g,c['sha256'],'en'],sort_keys=True).encode())
def allow_articles(unit):
 # A single headword or label is not a sentence; deletion is never evidence.
 return len(re.findall(r"[^\W_]+(?:['’\-][^\W_]+)*",unit['text'],re.UNICODE))>1

def json_semantics(value):
 if isinstance(value,dict):return {k:json_semantics(v) for k,v in value.items()}
 if isinstance(value,list):return [json_semantics(v) for v in value]
 if isinstance(value,float) and value.is_integer():return int(value)
 return value
def same_json(a,b):return json.dumps(json_semantics(a),sort_keys=True,ensure_ascii=False,allow_nan=False)==json.dumps(json_semantics(b),sort_keys=True,ensure_ascii=False,allow_nan=False)

def actual(c,a,evidence,model,model_sha,fingerprint_input=None):
 need(evidence.valid_asr(c,a),'Missing valid current actual ASR')
 g=a.get('recognitionGeneration',{})
 need(a.get('recognitionMethod')=='individual-beam5' and a.get('singleFileVerification') is True,'Individual beam5 required')
 need(g.get('model')==model and g.get('modelSha256')==model_sha and g.get('beamSize')==5 and g.get('device')=='cpu' and g.get('computeType')=='int8','Wrong fixed recognition model')
 need(g.get('conditionOnPreviousText') is False and g.get('vadFilter') is False and 'prompt' in g and g['prompt'] is None,'ASR context is not disabled')
 need(all(x.get(k) is None for x in [g,a] for k in ['prompt','hotwords','initialPrompt','initial_prompt']),'Target prompts/hotwords forbidden')
 need(all(a.get(k)==c.get(k) for k in ['src','sha256','voiceId']) and a.get('expected')==c['text'] and a.get('spoken')==c['spoken'],'ASR/source binding changed')
 segments=a.get('segments');need(isinstance(segments,list) and segments and ' '.join(s.get('text','').strip() for s in segments).strip()==a.get('recognized'),'Full segment evidence required')
 for s in segments:
  need(all(type(s.get(k)) in [int,float] and math.isfinite(s[k]) for k in ['start','end']) and 0<=s['start']<=s['end'],'Invalid actual segment times')
 if fingerprint_input is None:need(a.get('fingerprint')==fingerprint(g,c),'Actual recognition fingerprint changed')
 else:need(isinstance(fingerprint_input,str) and sha(fingerprint_input.encode())==a.get('fingerprint') and same_json(json.loads(fingerprint_input),[g,c['sha256'],'en']),'Stored actual recognition fingerprint changed')
 if model==MODEL:
  need(g.get('modelRepository')==REPOSITORY and g.get('modelRevision')==REVISION and g.get('temperature')==0 and g.get('wordTimestamps') is False and g.get('hotwords') is None and 'hotwords' in g,'Full-model provenance missing')
  need(g.get('audioInput')=='unchanged-delivered-m4a' and g.get('task')=='transcribe','Only the unchanged delivered file may be recognized')


def current_original(unit,clip,original,row,evidence,fingerprint_input=None):
 need(unit.get('language')=='en' and unit.get('required') is True and not unit.get('nonSpoken'),'Not required English audio')
 need(all(clip.get(k)==unit.get(k) for k in ['text','language','voiceId','required']),'Current source identity changed')
 need(all(digest(clip.get(k)) for k in ['sha256','inputSha256','phonemeSha256']),'Missing current fingerprints')
 actual(clip,original,evidence,TURBO,TURBO_SHA,fingerprint_input)
 need(original.get('key')==unit['key'] and original.get('status')=='review' and 'acceptance' not in original,'Original Turbo must remain a real review')
 repair=row.get('repair',{});candidate=repair.get('candidate',{})
 need(repair.get('complete') is True and repair.get('disposition')=='recorded-review','Finish actual repair before full-model cross-check')
 need(media(candidate.get('clip',{}))==media(clip) and candidate.get('asr')==original,'Latest repair candidate differs from current original Turbo evidence')
 return True

def compare_record(unit,clip,raw,comparison,normalizer,phoneme_override=False):
 need(raw.get('sha256')==clip['sha256'] and isinstance(raw.get('recognized'),str) and raw['recognized'].strip(),'No actual same-media transcript')
 c=comparison.compare(clip['spoken'],raw['recognized'],'en',normalizer=normalizer,source_text=clip['text'],phoneme_override=phoneme_override,allow_articles=allow_articles(unit));c['audioSha256']=clip['sha256']
 return {'key':unit['key'],'src':clip['src'],'sha256':clip['sha256'],'voiceId':clip['voiceId'],'expected':clip['text'],'spoken':clip['spoken'],
  'recognized':raw['recognized'],'segments':copy.deepcopy(raw['segments']),'fingerprint':fingerprint(raw['generation'],clip),'recognitionGeneration':copy.deepcopy(raw['generation']),
  'recognitionMethod':'individual-beam5','singleFileVerification':True,'recognitionAttempts':raw.get('recognitionAttempts',1),'status':'matched' if c['equivalent'] else 'review','comparison':c}

def semantic_comparison(a,b):
 left,right=copy.deepcopy(a),copy.deepcopy(b)
 for value in [left,right]:
  for field in ['ruleFileSha256','normalizerFileSha256']:
   need(digest(value.get('provenance',{}).get(field)),'Missing stored comparator code provenance');value['provenance'].pop(field)
 return left==right

def assess(unit,clip,original,row,full,comparison,normalizer,evidence,historical=None):
 historical=historical or {}
 current_original(unit,clip,original,row,evidence,historical.get('originalFingerprintInput'))
 actual(clip,full,evidence,MODEL,MODEL_SHA,historical.get('fullFingerprintInput'))
 need(full.get('key')==unit['key'] and 'acceptance' not in full,'Wrong full-model source key')
 expected=comparison.compare(clip['spoken'],full['recognized'],'en',normalizer=normalizer,source_text=clip['text'],phoneme_override=bool(row['repair'].get('appliedOverride',{}).get('phonemes')),allow_articles=allow_articles(unit));expected['audioSha256']=clip['sha256']
 need(semantic_comparison(expected,full['comparison']),'Stored full-model comparison cannot be reproduced')
 accepted=full.get('status')=='matched' and expected['equivalent'] is True
 original_canonical=historical.get('originalASRCanonical',canonical(original).decode());full_canonical=historical.get('fullASRCanonical',canonical(full).decode())
 need(isinstance(original_canonical,str) and same_json(json.loads(original_canonical),original),'Stored original ASR payload changed')
 need(isinstance(full_canonical,str) and same_json(json.loads(full_canonical),full),'Stored full ASR payload changed')
 identity={'method':METHOD,'token':token(unit),'sourceAudioSha256':clip['sha256'],'sourceInputSha256':clip['inputSha256'],'originalASRSha256':sha(original_canonical.encode()),'fullASRSha256':sha(full_canonical.encode())}
 return {'version':1,'id':sha(canonical(identity)),'method':METHOD,'token':token(unit),'sourceAudioSha256':clip['sha256'],'sourceClip':copy.deepcopy(media(clip)),
  'originalASR':copy.deepcopy(original),'fullASR':copy.deepcopy(full),'originalASRCanonical':original_canonical,'fullASRCanonical':full_canonical,'originalFingerprintInput':historical.get('originalFingerprintInput',json.dumps([original['recognitionGeneration'],clip['sha256'],'en'],sort_keys=True)),
  'fullFingerprintInput':historical.get('fullFingerprintInput',json.dumps([full['recognitionGeneration'],clip['sha256'],'en'],sort_keys=True)),'status':'accepted' if accepted else 'review',
  'originalIndividualASRMatched':False,'originalAudioResynthesized':False,'audioInput':'unchanged-delivered-m4a','articlePolicyEnabled':allow_articles(unit),
  'reason':'strict-same-media-full-model-equivalence' if accepted else 'full-model-still-not-equivalent'}

def accepted_record(p):
 need(p.get('status')=='accepted','A review proof cannot be published as accepted')
 return {**copy.deepcopy(p['originalASR']),'status':'accepted','acceptance':{'method':METHOD,'proofId':p['id'],'sourceAudioSha256':p['sourceAudioSha256'],'originalIndividualStatus':'review'}}

def valid_record(unit,clip,record,row,comparison,normalizer,evidence):
 try:
  ad=record.get('acceptance',{});need(record.get('status')=='accepted' and ad.get('method')==METHOD,'Wrong admission')
  found=[p for p in row.get('crossModelChecks',[]) if p.get('id')==ad.get('proofId')];need(len(found)==1,'Missing or duplicate full-model proof')
  p=found[0];expected=assess(unit,clip,p['originalASR'],row,p['fullASR'],comparison,normalizer,evidence,historical=p)
  return expected==p and expected['status']=='accepted' and record==accepted_record(p)
 except (ValueError,KeyError,TypeError,AttributeError):return False
