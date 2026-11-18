#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Finite, selected-recipe lexical equivalence; no inference or media changes.

Default preview. --apply requires a completed repair and current actual strong
ASR/cache, takes author locks, and preserves all raw ASR/comparison history.
"""
import argparse,copy,fcntl,hashlib,importlib.util,json,math,re,sys
from contextlib import ExitStack
from pathlib import Path
METHOD='selected-recipe-lexical-equivalence-v1'
MODEL='whisper-large-v3-turbo'
MODEL_SHA='e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da'
MODELS={MODEL:MODEL_SHA,'whisper-large-v3':'69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1'}
HERE=Path(__file__).resolve().parent
RULES={r['id']:r for r in json.loads((HERE/'audio-lexical-rules.json').read_text())['rules']}
BIND=('src','sha256','bytes','duration','text','spoken','language','voiceId','inputSha256','phonemeSha256','required','synthesisSpeed')
sha=lambda b:hashlib.sha256(b).hexdigest()
def canonical(x):return json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
def read(p):return json.loads(p.read_text())
def need(ok,msg):
 if not ok:raise ValueError(msg)
def load(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def binding(c):return {k:c.get(k) for k in BIND}
def token(u):return f"{u['language']}:{u['bank']}:{u['key']}"
def digest(s):return isinstance(s,str) and bool(re.fullmatch('[a-f0-9]{64}',s))
def words(s):
 # Keep apostrophes, signs, currency, digits and all unfamiliar symbols. Only
 # ordinary sentence punctuation is ignored; never delete articles or suffixes.
 return [w.lower() for w in re.findall(r"[^\W_]+(?:['’\-][^\W_]+)*|[^\s]",s.replace('’',"'"),re.UNICODE) if w not in '.,;:!?"“”()']
def align(text,spoken,recognized,rule,phones):
 need(any(x.get('sourceText')==text and x.get('spoken')==spoken and x.get('phonemes')==phones and x.get('phonemeSha256')==sha(phones.encode()) for x in rule.get('approvedInputs',[])),'Full source/recipe binding was not reviewed')
 a,b=words(spoken),words(recognized);source=words(text)
 source_word,other=rule['sourceWord'].lower(),rule['recognizedWord'].lower()
 need(len(a)==len(b),'Token counts differ')
 diff=[i for i,(x,y) in enumerate(zip(a,b)) if x!=y]
 need(len(diff)==1,'Require exactly one approved lexical difference')
 i=diff[0];need(a[i]==source_word and b[i]==other,'Not the approved directional lexical pair')
 need(source.count(source_word)==1 and a.count(source_word)==1,'Require exactly one explicit source anchor')
 raw=[p.strip('.,;:!?') for p in phones.split()]
 need(raw.count(rule['phoneToken'])==1,'Selected recipe is not the dictionary-backed reading')
 return {'expectedTokens':a,'recognizedTokens':b,'differenceIndex':i,'sourceWord':source_word,'recognizedWord':other,'phoneToken':rule['phoneToken']}
def strong(c,a,key):
 g=a.get('recognitionGeneration',{});p=a.get('comparison',{});pr=p.get('provenance',{})
 need(a.get('status')=='review' and not a.get('acceptance') and not a.get('error'),'Need original unresolved individual ASR')
 need(a.get('key')==key and all(a.get(k)==c.get(k) for k in ['src','sha256','voiceId']) and a.get('expected')==c.get('text') and a.get('spoken')==c.get('spoken'),'ASR identity changed')
 need(isinstance(a.get('recognized'),str) and a['recognized'].strip(),'Empty actual transcript')
 need(a.get('recognitionMethod')=='individual-beam5' and a.get('singleFileVerification') is True and g.get('model') in MODELS and g.get('modelSha256')==MODELS[g['model']] and g.get('device')=='cpu' and g.get('computeType')=='int8' and g.get('beamSize')==5 and 'prompt' in g and g['prompt'] is None and g.get('conditionOnPreviousText') is False and g.get('vadFilter') is False,'Wrong actual ASR generation')
 need(all(x.get(k) is None for x in [a,g] for k in ['prompt','hotwords','initialPrompt','initial_prompt']),'Prompt or hotwords forbidden')
 seg=a.get('segments');need(isinstance(seg,list) and seg and ' '.join(s.get('text','').strip() for s in seg).strip()==a['recognized'],'Actual segments/transcript differ')
 for s in seg:need(all(type(s.get(k)) in [int,float] and math.isfinite(s[k]) for k in ['start','end']) and 0<=s['start']<=s['end'],'Invalid actual segment times')
 need(p.get('equivalent') is False and p.get('ruleVersion')=='strict-audio-equivalence-1' and p.get('audioSha256')==c['sha256'] and p.get('expectedSpoken')==c['spoken'] and p.get('recognized')==a['recognized'] and p.get('language')=='en' and pr.get('sourceTextSha256')==sha(c['text'].encode()) and all(digest(pr.get(k)) for k in ['ruleFileSha256','normalizerFileSha256']),'Invalid original comparison proof')
 need(digest(a.get('fingerprint')) and a['fingerprint']==sha(json.dumps([g,c['sha256'],'en'],sort_keys=True).encode()),'Actual ASR fingerprint differs')
def make_proof(u,c,a,repair,rule_id):
 need(u.get('language')=='en' and u.get('required') is True and not u.get('nonSpoken') and u.get('bank')!='labels','Ineligible source')
 need(rule_id in RULES,'Unknown finite rule');rule=RULES[rule_id]
 need(all(digest(c.get(k)) for k in ['sha256','phonemeSha256','inputSha256']) and re.fullmatch(r'\./audio/generated/en/[a-z_]+/[a-f0-9]{32}\.m4a',c.get('src','')),'Invalid recording binding')
 need(all(c.get(k)==u.get(k) for k in ['text','language','voiceId','required']),'Source identity changed')
 need(repair.get('complete') is True and repair.get('disposition')=='recorded-review','Repair is not completed unresolved recorded evidence')
 candidate=repair.get('candidate',{});need(binding(candidate.get('clip',{}))==binding(c) and candidate.get('asr')==a,'Final repair candidate differs')
 original=repair.get('original',{}).get('clip',{});need(digest(original.get('sha256')) and original.get('sha256')!=c['sha256'] and all(original.get(k)==c.get(k) for k in ['text','language','voiceId']),'Repair must preserve original source and change media')
 strong(c,a,u['key'])
 override=repair.get('appliedOverride',{});phones=override.get('phonemes')
 need(isinstance(phones,str) and phones.strip() and sha(phones.encode())==c.get('phonemeSha256'),'Recipe phoneme SHA differs')
 need(any(token(u) in x.get('tokens',[]) and x.get('voiceId')==c['voiceId'] and x.get('sourceText')==c['text'] and x.get('spoken')==c['spoken'] and x.get('phonemes')==phones for x in rule.get('approvedInputs',[])),'Source key/voice/recipe binding was not reviewed')
 need(override.get('spoken',c['spoken'])==c['spoken'] and override.get('speed',1)==c.get('synthesisSpeed',1),'Recipe spoken/speed changed')
 decision=align(c['text'],c['spoken'],a['recognized'],rule,phones)
 ident={'method':METHOD,'token':token(u),'audioSha256':c['sha256'],'phonemeSha256':c['phonemeSha256'],'inputSha256':c['inputSha256'],'ruleId':rule_id,'ruleSha256':sha(canonical(rule)),'actualAsrFingerprint':a['fingerprint'],'recognizedSha256':sha(a['recognized'].encode())}
 return {'version':1,'id':sha(canonical(ident)),'method':METHOD,'token':token(u),'sourceAudioSha256':c['sha256'],'sourceClip':copy.deepcopy(binding(c)),'originalASR':copy.deepcopy(a),'actualAsrFingerprintInput':json.dumps([a['recognitionGeneration'],c['sha256'],'en'],sort_keys=True),'rule':copy.deepcopy(rule),'ruleSha256':sha(canonical(rule)),'input':{'phonemes':phones,'phonemeSha256':c['phonemeSha256'],'spoken':c['spoken'],'voiceId':c['voiceId'],'synthesisSpeed':c.get('synthesisSpeed',1)},'decision':decision,'status':'accepted','originalAudioResynthesized':False,'newRecognitionCalls':0,'originalIndividualASRMatched':False}
def admission(p):return {'method':METHOD,'proofId':p['id'],'sourceAudioSha256':p['sourceAudioSha256'],'originalIndividualStatus':'review'}
def accepted_record(p):return {**copy.deepcopy(p['originalASR']),'status':'accepted','acceptance':admission(p)}
def valid_lexical_record(u,c,a,row):
 try:
  ad=a.get('acceptance',{});need(a.get('status')=='accepted' and ad.get('method')==METHOD,'Wrong admission')
  matches=[p for p in row.get('lexicalEquivalences',[]) if p.get('id')==ad.get('proofId')];need(len(matches)==1,'Missing/duplicate proof')
  p=matches[0];expected=make_proof(u,c,p['originalASR'],row['repair'],p['rule']['id'])
  return p==expected and a==accepted_record(p)
 except (ValueError,KeyError,TypeError,AttributeError):return False

def atomic(path,value):
 temp=path.with_name(path.name+'.tmp');temp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');temp.replace(path)
def recipe_fingerprint(generation,u,override):
 need(isinstance(override.get('spoken'),str) and isinstance(override.get('phonemes'),str),'Explicit retry recipe required')
 speed=float(override.get('speed',1));need(.75<=speed<=1.2,'Invalid retry pace')
 synthesis={k:generation[k] for k in ['recipe','modelSha256','voicesSha256','packages']}
 payload=[synthesis,generation['encoding'],u['voiceId'],override['spoken'],override['phonemes']]
 if speed!=1:payload.append({'speed':speed})
 return sha(json.dumps(payload,sort_keys=True).encode())
def prepare(root,work,plan):
 out=root/'data/audio';raw=(out/'source.json').read_bytes();source=json.loads(raw);index=read(out/'manifest.json');quality=read(out/'quality-review.json')
 need(plan.get('version')==1 and plan.get('sourceSha256')==index.get('sourceSha256')==sha(raw),'Stale source SHA')
 need(quality.get('stages',{}).get('strongerASR'),'Missing actual stronger-ASR stage')
 units={token(u):u for u in source['units']};packs={};audits={};overrides=read(out/'overrides.json')['entries']
 for meta in index['packs']:
  pair=(meta['language'],meta['bank']);need(pair not in packs and meta['src']==f'./data/audio/{pair[0]}/{pair[1]}.json','Invalid manifest pack')
  packs[pair]=read(root/meta['src']);need(packs[pair].get('sourceSha256')==index['sourceSha256'] and packs[pair].get('generation')==index['generation'],'Pack generation differs');audits[pair]=read(out/'audit'/pair[0]/(pair[1]+'.json'))
 entries=plan.get('entries');need(isinstance(entries,list) and entries and len({x['token'] for x in entries})==len(entries),'Empty/duplicate selected plan')
 chosen=[]
 for entry in entries:
  t=entry['token'];u=units.get(t);need(u,'Missing source key');pair=(u['language'],u['bank']);row=quality['records'].get(t);need(row,'Missing quality row')
  c=packs[pair].get('clips',{}).get(u['key']);a=audits[pair]['records'].get(u['key']);need(c and a and not packs[pair].get('fallbacks',{}).get(u['key']),'Current recording missing or unpublished')
  override=overrides.get(t,{});applied=row.get('repair',{}).get('appliedOverride',{});need(all(override.get(k,1 if k=='speed' else None)==applied.get(k,1 if k=='speed' else None) for k in ['spoken','phonemes','speed']) and recipe_fingerprint(index['generation'],u,override)==c['inputSha256'],'Current synthesis recipe differs')
  need(all(entry.get(k)==value for k,value in {'sourceText':c['text'],'spoken':c['spoken'],'recognized':a['recognized'],'audioSha256':c['sha256'],'phonemeSha256':c['phonemeSha256'],'voiceId':c['voiceId'],'actualAsrFingerprint':a['fingerprint']}.items()),'Approved candidate binding changed: '+t)
  need(re.fullmatch(r'\./audio/generated/en/[a-z_]+/[a-f0-9]{32}\.m4a',c['src']),'Unsafe media path');media=(root/c['src']).read_bytes();need(len(media)==c['bytes'] and sha(media)==c['sha256'],'Actual media SHA/size differs')
  if a.get('status')=='accepted':
   need(valid_lexical_record(u,c,a,row),'Existing acceptance invalid or belongs to a different method');p=next(x for x in row['lexicalEquivalences'] if x['id']==a['acceptance']['proofId']);need(p['rule']['id']==entry['ruleId'],'Selected rule changed');original=p['originalASR']
  else:original=a;p=make_proof(u,c,a,row['repair'],entry['ruleId'])
  cache=read(work/'tmp/bank-asr'/(original['fingerprint']+'.json'));g=original['recognitionGeneration']
  need(cache.get('sha256')==c['sha256'] and cache.get('generation')==g and cache.get('recognized')==original['recognized'] and cache.get('segments')==original['segments'] and cache.get('method') in [None,'individual-beam5'] and not cache.get('error') and all(cache.get(k) is None for k in ['prompt','hotwords','initialPrompt','initial_prompt']),'Actual ASR cache differs')
  history=row.setdefault('lexicalEquivalences',[]);matches=[x for x in history if x.get('id')==p['id']];need(len(matches)<=1 and (not matches or matches[0]==p),'Immutable proof changed')
  if not matches:history.append(copy.deepcopy(p))
  chosen.append((u,c,a,p,accepted_record(p)))
 return source,index,quality,packs,audits,chosen

def finalize(root,work,plan,apply=False,bank_loader=None):
 root=Path(root).resolve();work=Path(work).resolve();need(work!=root and root not in work.parents,'Author caches must be external')
 with ExitStack() as stack:
  if apply:
   work.mkdir(parents=True,exist_ok=True)
   for name in ['bank-retry.lock','bank-generate.lock','bank-audit.lock']:
    lock=stack.enter_context((work/name).open('a'));fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  source,index,quality,packs,audits,chosen=prepare(root,work,plan)
  summary={'method':METHOD,'selected':len(chosen),'newAcceptances':sum(a.get('status')!='accepted' for _,_,a,_,_ in chosen),'uniqueMedia':len({c['sha256'] for _,c,_,_,_ in chosen}),'recognitionCalls':0,'mediaChanged':0,'dryRun':not apply}
  if not apply:return summary
  bank=bank_loader() if bank_loader else load('lexical_bank',root/'scripts/generate-bank-audio.py')
  for u,c,a,p,accepted in chosen:need(bank.valid_published_asr(u,c,accepted,quality['records'],set()),'Install dedicated published proof gate before applying')
  for u,c,a,p,accepted in chosen:audits[(u['language'],u['bank'])]['records'][u['key']]=accepted
  current=[]
  for u in source['units']:
   pair=(u['language'],u['bank']);c=packs.get(pair,{}).get('clips',{}).get(u['key']);a=audits.get(pair,{}).get('records',{}).get(u['key'])
   if c and a and a.get('acceptance',{}).get('method')==METHOD and valid_lexical_record(u,c,a,quality['records'].get(token(u),{})):current.append((u,c))
  quality['stages']['postRepairLexicalEquivalence']={'method':METHOD,'currentAccepted':len(current),'uniqueMedia':len({c['sha256'] for _,c in current}),'newRecognitionCalls':0,'mediaChanged':0,'originalIndividualASRMatched':False,'rulesSha256':sha(canonical(list(RULES.values())))}
  # Ledger first makes interruption recoverable without overwriting raw repair
  # snapshots, baseline comparison, original candidate ASR, or retry history.
  out=root/'data/audio';atomic(out/'quality-review.json',quality)
  for pair in {(u['language'],u['bank']) for u,*_ in chosen}:atomic(out/'audit'/pair[0]/(pair[1]+'.json'),audits[pair])
  bank.flush(source,index['sourceSha256'],index['generation'],packs)
  return summary

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--repo',type=Path,default=HERE.parent);p.add_argument('--workdir',type=Path,default=Path.home()/'.local/share/toeic-kokoro');p.add_argument('--plan',type=Path,required=True);p.add_argument('--apply',action='store_true');a=p.parse_args()
 print(json.dumps(finalize(a.repo,a.workdir,read(a.plan),a.apply),ensure_ascii=False))
if __name__=='__main__':main()
