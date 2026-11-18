#!/usr/bin/env python3
"""Default preview; explicitly publish independently validated full-model proofs.
Raw Turbo, repair, retries, source, overrides and media are never rewritten.
"""
import argparse,copy,fcntl,importlib.util,json
from contextlib import ExitStack
from pathlib import Path
HERE=Path(__file__).resolve().parent

def load(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
proof=load('publish_full_proof',HERE/'audio-cross-model.py')
runner=load('publish_full_runner',HERE/'crosscheck-final-english.py')
need=proof.need

def prepare(root,work,report,comparison,normalizer,evidence):
 out=root/'data/audio';source_bytes=(out/'source.json').read_bytes();source=json.loads(source_bytes);index=runner.read(out/'manifest.json');quality=runner.read(out/'quality-review.json');plan=report.get('plan',{})
 need(report.get('complete') is True and report.get('method')==proof.METHOD and report.get('originalTurboChanged') is False and report.get('publicWrites')==0,'Only a complete independent same-media report may publish')
 need(plan.get('sourceSha256')==proof.sha(source_bytes)==index.get('sourceSha256') and plan.get('kind')==proof.METHOD and plan.get('modelSha256')==proof.MODEL_SHA and plan.get('modelRevision')==proof.REVISION and plan.get('modelRepository')==proof.REPOSITORY,'Stale report source/fixed model')
 entries=plan.get('entries',[]);need(entries and len({e['token'] for e in entries})==len(entries) and set(report.get('records',{}))=={e['token'] for e in entries},'Incomplete or duplicate report selection')
 units={proof.token(u):u for u in source['units']};packs={};audits={};changed=set();accepted=[];reviewed=0
 for meta in index['packs']:
  pair=(meta['language'],meta['bank']);need(pair not in packs and meta['src']==f'./data/audio/{pair[0]}/{pair[1]}.json','Invalid pack index')
  packs[pair]=runner.read(root/meta['src']);audits[pair]=runner.read(out/'audit'/pair[0]/(pair[1]+'.json'))
 for entry in entries:
  token=entry['token'];unit=units.get(token);need(unit,'Unknown source key');pair=(unit['language'],unit['bank']);clip=packs[pair].get('clips',{}).get(unit['key']);current=audits[pair].get('records',{}).get(unit['key']);row=quality.get('records',{}).get(token)
  need(clip and current and row and evidence.media_integrity(root,clip)['ok'],'Current media missing or changed')
  result=report['records'][token];p=result.get('proof');raw=result.get('rawASR')
  if not p:
   # Retain actual failed/empty attempts as immutable diagnostics, never admission.
   need(result.get('status')=='review' and result.get('sourceAudioSha256')==clip['sha256'] and runner.binding(unit,clip,result.get('originalASR'),row)==entry and result.get('originalASR')==current,'Invalid failed attempt/current binding')
   proof.current_original(unit,clip,current,row,evidence)
   need(isinstance(raw,dict) and raw.get('sha256')==clip['sha256'] and raw.get('generation',{}).get('model')==proof.MODEL and raw['generation'].get('modelSha256')==proof.MODEL_SHA,'Missing actual full-model failed attempt')
   failed_cache=work/'tmp/bank-asr'/(proof.fingerprint(raw['generation'],clip)+'.json')
   need(failed_cache.exists() and runner.read(failed_cache)==raw,'Failed attempt must preserve its actual external ASR cache')
   attempts=row.setdefault('crossModelFailedAttempts',[]);attempt={'reportEntry':copy.deepcopy(result),'reportSourceSha256':plan['sourceSha256']}
   if attempt not in attempts:attempts.append(attempt)
   reviewed+=1;continue
  need(runner.binding(unit,clip,p.get('originalASR'),row)==entry,'Final media/repair/original Turbo differs from report')
  expected=proof.assess(unit,clip,p['originalASR'],row,p['fullASR'],comparison,normalizer,evidence);need(expected==p,'Full proof cannot be reproduced')
  full=p['fullASR'];cachepath=work/'tmp/bank-asr'/(full['fingerprint']+'.json');need(cachepath.exists() and runner.read(cachepath)==raw,'Actual full-model cache missing or different')
  need(raw.get('sha256')==clip['sha256'] and raw.get('generation')==full['recognitionGeneration'] and raw.get('recognized')==full['recognized'] and raw.get('segments')==full['segments'] and raw.get('method')=='individual-beam5' and all(raw.get(k) is None for k in ['prompt','hotwords','initialPrompt','initial_prompt']),'Actual report ASR/cache identity changed')
  if current.get('status')=='accepted':need(proof.valid_record(unit,clip,current,row,comparison,normalizer,evidence),'Existing current acceptance differs or is invalid')
  else:need(current==p['originalASR'],'Current raw Turbo was rewritten')
  history=row.setdefault('crossModelChecks',[]);same=[x for x in history if x.get('id')==p['id']];need(len(same)<=1 and (not same or same[0]==p),'Immutable full-model proof changed')
  if not same:history.append(copy.deepcopy(p))
  if p['status']=='accepted':
   new=proof.accepted_record(p);need(proof.valid_record(unit,clip,new,row,comparison,normalizer,evidence),'Full-model admission is invalid')
   audits[pair]['records'][unit['key']]=new;changed.add(pair);accepted.append((unit,clip,new))
  else:reviewed+=1
 return source,index,quality,packs,audits,changed,accepted,reviewed

def publish(root,work,report,apply=False,bank_loader=None):
 root=Path(root).resolve();work=Path(work).resolve();need(work!=root and root not in work.parents,'Keep author caches outside the repository')
 with ExitStack() as stack:
  if apply:
   for name in ['bank-retry.lock','bank-generate.lock','bank-audit.lock']:
    f=stack.enter_context((work/name).open('a'));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  bank=bank_loader() if bank_loader else load('publish_cross_bank',root/'scripts/generate-bank-audio.py');comparison=load('publish_cross_comparison',root/'scripts/audio-compare.py')
  source,index,quality,packs,audits,changed,accepted,reviewed=prepare(root,work,report,comparison,bank.normalize,bank.evidence)
  summary={'method':proof.METHOD,'selected':len(report['plan']['entries']),'additionalProofAccepted':len(accepted),'stillReview':reviewed,'dryRun':not apply,'originalTurboRewritten':False,'mediaChanged':False}
  if not apply:return summary
  for u,c,a in accepted:need(bank.valid_published_asr(u,c,a,quality['records'],set()),'Install dedicated cross-model gate before any public write')
  counts=0
  for u in source['units']:
   pair=(u['language'],u['bank']);c=packs.get(pair,{}).get('clips',{}).get(u['key']);a=audits.get(pair,{}).get('records',{}).get(u['key'])
   if c and a and a.get('acceptance',{}).get('method')==proof.METHOD and proof.valid_record(u,c,a,quality['records'].get(proof.token(u),{}),comparison,bank.normalize,bank.evidence):counts+=1
  quality.setdefault('stages',{})['fullModelCrosscheck']={'method':proof.METHOD,'model':proof.MODEL,'modelSha256':proof.MODEL_SHA,'modelRepository':proof.REPOSITORY,'modelRevision':proof.REVISION,'currentAccepted':counts,'reportSha256':proof.sha(proof.canonical(report)),'selectedActualReviews':len(report['plan']['entries']),'originalIndividualASRMatched':False,'originalMediaUnchanged':True}
  out=root/'data/audio';bank.atomic(out/'quality-review.json',quality)
  for pair in changed:bank.atomic(out/'audit'/pair[0]/(pair[1]+'.json'),audits[pair])
  bank.flush(source,index['sourceSha256'],index['generation'],packs)
  return summary

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--repo',type=Path,required=True);p.add_argument('--workdir',type=Path,required=True);p.add_argument('--report',type=Path,required=True);p.add_argument('--apply',action='store_true');args=p.parse_args()
 print(json.dumps(publish(args.repo,args.workdir,runner.read(args.report),args.apply)))
if __name__=='__main__':main()
