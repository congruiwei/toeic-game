#!/usr/bin/env python3
"""Preview or transactionally publish a complete actual hand-kana Japanese batch.

No synthesis or recognition. Every input media/checkpoint is checked before any
public write. English packs/audits and every prior repair/retry remain untouched.
"""
import argparse,copy,fcntl,hashlib,importlib.util,inspect,json,os,re,shutil,tempfile
from contextlib import ExitStack
from pathlib import Path

def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
proof=load(Path(__file__).with_name('audio-manual-kana.py'),'manual_kana_proof')
sha=proof.sha
def parse_json(data):
    def unique(pairs):
        result={}
        for key,value in pairs:
            proof.need(key not in result,'Duplicate JSON key: '+key);result[key]=value
        return result
    return json.loads(data,object_pairs_hook=unique)

def read(path):return parse_json(Path(path).read_bytes())
def body(value,compact=False):
    options={'separators':(',',':')} if compact else {'indent':2}
    return (json.dumps(value,ensure_ascii=False,**options)+'\n').encode()

def atomic_bytes(path,data):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent,prefix=path.name+'.',suffix='.tmp',delete=False) as f:
        tmp=Path(f.name)
        try:f.write(data);f.flush();os.fsync(f.fileno());tmp.replace(path)
        finally:tmp.unlink(missing_ok=True)

def exact_file(path,digest,size=None):
    p=Path(path);proof.need(p.is_file() and not p.is_symlink(),'Missing/unsafe input file: '+p.name)
    data=p.read_bytes();proof.need(sha(data)==digest and (size is None or len(data)==size),'Input file changed: '+p.name);return data

def strict_asr(raw,clip):
    g=raw.get('generation',{})
    proof.need(g.get('model')==proof.MODEL and g.get('modelSha256')==proof.MODEL_SHA,'Wrong recognition model')
    fingerprint=json.dumps([g,clip['sha256'],'ja'],sort_keys=True)
    proof.need(raw.get('fingerprint')==sha(fingerprint),'Actual checkpoint fingerprint differs')
    return fingerprint

def make_attempt(u,bundle,raw,reading,readings_sha,generation,renderer_sha,before,row,compare,bank):
    c=copy.deepcopy(bundle['clip']);override=copy.deepcopy(bundle['override'])
    comparison=copy.deepcopy(compare(reading,raw['recognized'],u['text']));comparison['audioSha256']=c['sha256']
    if not raw['recognized'].strip():proof.need(comparison.get('equivalent') is False,'Empty actual transcription cannot be equivalent')
    status='matched' if comparison.get('equivalent') else ('review' if raw['recognized'].strip() else 'error')
    c['asrStatus']=status
    record=dict(key=u['key'],src=c['src'],sha256=c['sha256'],voiceId=c['voiceId'],expected=u['text'],spoken=reading,
        recognized=raw['recognized'],segments=copy.deepcopy(raw['segments']),recognitionGeneration=copy.deepcopy(raw['generation']),
        fingerprint=raw['fingerprint'],recognitionMethod='individual-beam5',singleFileVerification=True,status=status,
        comparison=comparison,recognitionAttempts=1)
    a=dict(version=1,method=proof.METHOD,token=proof.token(u),source={k:u[k] for k in ('language','bank','key','text','voiceId','required','speaker') if k in u},
        reading=reading,readingsSha256=readings_sha,rendererSha256=renderer_sha,synthesisGeneration=copy.deepcopy(generation),
        override=override,inputFingerprintInput=json.dumps(bank.input_payload(generation,u,override)[1],sort_keys=True),
        asrFingerprintInput=strict_asr(raw,c),rawASR=copy.deepcopy(raw),candidate={'clip':c,'asr':record},before=copy.deepcopy(before),
        disposition='recorded-matched' if status=='matched' else 'system-fallback',recognitionAttempted=True,originalAudioReplaced=status=='matched')
    a['proofCanonical']=proof.canonical(a);a['id']=sha(a['proofCanonical'])
    proof.validate_attempt(u,a,row,bank.evidence.valid_asr)
    return a

def reconcile(source,index,packs,audits,quality,overrides,human_doc,bank,original,first_ids):
    """Rebuild exact index counts; never rewrite an English pack or audit."""
    units={(u['language'],u['bank'],u['key']):u for u in source['units'] if not u.get('nonSpoken')}
    expected={};required={}
    for (language,name,key),u in units.items():
        pair=(language,name);expected[pair]=expected.get(pair,0)+1
        if u.get('required',True):required.setdefault(pair,set()).add(key)
    generation=copy.deepcopy(index['generation']);generation['overridesSha256']=sha(json.dumps(overrides['entries'],sort_keys=True))
    outputs={};metas=[];all_files={};audited_total=0;human_approved=0;human_required=0
    proof.need(not bank.human_review.validate_human_review(human_doc),'Invalid human-review history')
    totals=dict(count=0,expected=sum(expected.values()),sourceUnits=len(source['units']),nonSpoken=sum(bool(u.get('nonSpoken')) for u in source['units']),requiredExpected=sum(map(len,required.values())),requiredCount=0,requiredAudited=0,systemFallbackCount=0,requiredFallbackCount=0,audioBytes=0,duration=0)
    for meta in index['packs']:
        pair=(meta['language'],meta['bank']);pack=packs[pair];clips=pack['clips'];fallbacks=pack.get('fallbacks',{});actual=0
        for key,c in clips.items():
            u=units[(*pair,key)];r=audits[pair]['records'].get(key);row=quality['records'].get(proof.token(u),{})
            if c.get('manualKanaId'):
                ok=proof.valid_record(u,c,r,row,bank.evidence.valid_asr)
                # Fail closed if the installed ordinary completion gate does
                # not actually demand this new method-specific proof.
                proof.need(bank.valid_published_asr(u,c,r,quality['records'],first_ids) and not bank.valid_published_asr(u,c,r,{},first_ids),'Install the manual-kana completion gate before publication')
            else:ok=bank.valid_published_asr(u,c,r,quality['records'],first_ids)
            proof.need(ok,'An existing published recording lacks actual evidence: '+proof.token(u));actual+=1
            human=bank.human_review.human_review_state(human_doc,u,c)
            human_approved+=bool(human and human['status']=='approved');human_required+=bool(human and human['status']=='required')
        rc=len(set(clips)&required.get(pair,set()));rf=len(set(fallbacks)&required.get(pair,set()));re=len(required.get(pair,set()))
        if pair[0]=='ja':
            pack.update(sourceSha256=index['sourceSha256'],generation=generation,complete=len(clips)==expected[pair],requiredComplete=rc==re,
                fallbackCount=len(fallbacks),requiredFallbackCount=rf,requiredPlaybackComplete=rc+rf==re,recordedAuditComplete=actual==len(clips))
            relative=f'data/audio/{pair[0]}/{pair[1]}.json';payload=body(pack);outputs[relative]=payload
            m=dict(bank=pair[1],language=pair[0],src='./'+relative,count=len(clips),expected=expected[pair],requiredCount=rc,requiredExpected=re,requiredComplete=rc==re,fallbackCount=len(fallbacks),requiredFallbackCount=rf,requiredPlaybackComplete=rc+rf==re,recordedAuditComplete=actual==len(clips),bytes=len(payload),sha256=sha(payload),duration=round(sum(c['duration'] for c in {c['src']:c for c in clips.values()}.values()),3),audioBytes=sum(c['bytes'] for c in {c['src']:c for c in clips.values()}.values()),complete=len(clips)==expected[pair])
            metas.append(m)
        else:metas.append(copy.deepcopy(meta))
        all_files.update({c['src']:c for c in clips.values()});audited_total+=actual
        totals['count']+=len(clips);totals['requiredCount']+=rc;totals['requiredAudited']+=rc;totals['systemFallbackCount']+=len(fallbacks);totals['requiredFallbackCount']+=rf
    totals.update(humanApprovedCount=human_approved,forcedHumanReviewCount=human_required,files=len(all_files),audioBytes=sum(c['bytes'] for c in all_files.values()),duration=round(sum(c['duration'] for c in all_files.values()),3),asrReviewed=audited_total)
    new=copy.deepcopy(index);new.update(generation=generation,packs=metas,totals=totals,complete=totals['count']==totals['expected'],requiredComplete=totals['requiredCount']==totals['requiredExpected'],requiredAuditComplete=totals['requiredAudited']==totals['requiredExpected'],requiredPlaybackComplete=totals['requiredCount']+totals['requiredFallbackCount']==totals['requiredExpected'],recordedAuditComplete=audited_total==totals['count'],auditComplete=audited_total==totals['expected'])
    outputs['data/audio/manifest.json']=body(new);return outputs

def prepare(root,render,readings_path,work,bank,compare,renderer):
    root=Path(root).resolve();render=Path(render).resolve();readings_path=Path(readings_path).resolve();work=Path(work).resolve()
    proof.need(not render.is_relative_to(root) and not work.is_relative_to(root),'Keep authoring and checkpoints outside repository')
    source_path=root/'data/audio/source.json';source_bytes=source_path.read_bytes();source=parse_json(source_bytes)
    readings_bytes=readings_path.read_bytes();readings=parse_json(readings_bytes);readings_sha=sha(readings_bytes)
    original={};inputs={str(source_path):sha(source_bytes),str(readings_path):readings_sha}
    def document(relative,default=None):
        p=root/relative;raw=p.read_bytes() if p.exists() else None;original[relative]=raw;return parse_json(raw) if raw is not None else copy.deepcopy(default)
    index=document('data/audio/manifest.json');quality=document('data/audio/quality-review.json');overrides=document('data/audio/overrides.json',{'version':1,'entries':{}});normalization=document('data/audio/normalization-review.json',{'version':1})
    proof.need(index['sourceSha256']==sha(source_bytes),'Current source/index differ')
    human_doc=document('data/audio/human-review.json',{'version':1,'feedback':[],'requests':[],'batches':[]})
    units={proof.token(u):u for u in source['units']};expected=sorted(t for t,row in quality['records'].items() if units.get(t,{}).get('language')=='ja' and units[t].get('required') and row.get('repair',{}).get('complete') is True and row['repair'].get('disposition')=='system-fallback')
    proof.need(isinstance(readings,dict) and sorted(readings)==expected and expected,'Manual readings must cover exactly the original Japanese fallback set')
    packs={};audits={}
    for meta in index['packs']:
        pair=(meta['language'],meta['bank']);packs[pair]=document(f'data/audio/{pair[0]}/{pair[1]}.json');audits[pair]=document(f'data/audio/audit/{pair[0]}/{pair[1]}.json')
    raw_by_sha={}
    for path in sorted((render/'asr').glob('*.json')):
        raw=read(path);raw_by_sha.setdefault(raw.get('sha256'),[]).append((path,raw))
    report=dict(version=1,method=proof.METHOD,complete=True,sourceSha256=sha(source_bytes),readingsSha256=readings_sha,total=len(expected),matched=0,failed=0,empty=0,entries={},failures=[])
    copies=[];deliveries={d['token']:d for d in normalization.get('confirmedInputCorrections',[])}
    renderer_sha=sha(Path(renderer.__file__).read_bytes())
    code_paths=[Path(__file__),Path(proof.__file__),Path(renderer.__file__)]
    compare_path=inspect.getsourcefile(compare)
    if compare_path and Path(compare_path).is_file():code_paths.append(Path(compare_path))
    code_inputs={str(p.resolve()):sha(p.read_bytes()) for p in code_paths}
    for t in expected:
        u=units[t];reading=readings[t];pair=(u['language'],u['bank']);pack=packs[pair];row=quality['records'][t]
        proof.need(proof.valid_reading(reading),'Reading is not hand-authored kana: '+t)
        proof.need(u['key'] not in pack['clips'] and u['key'] in pack.get('fallbacks',{}),'Manual publication requires the original system route: '+t)
        old_audit=audits[pair]['records'][u['key']];old_fallback=pack['fallbacks'][u['key']]
        proof.need(bank.valid_system_fallback(u,old_fallback,row,old_audit),'Original fallback evidence invalid: '+t)
        bundle_path=render/'clips'/(sha(t)+'.json');bundle=read(bundle_path);inputs[str(bundle_path)]=sha(bundle_path.read_bytes())
        proof.need(bundle.get('token')==t,'Checkpoint token changed');c=bundle['clip'];o=bundle['override']
        phones=renderer.render_phones(reading)
        proof.need(o.get('spoken')==reading and o.get('phonemes')==phones,'Hand reading differs from actual rendered input: '+t)
        spoken,input_sha=bank.input_fingerprint(index['generation'],u,o)
        proof.need(c.get('spoken')==spoken and c.get('inputSha256')==input_sha and c.get('phonemeSha256')==sha(phones),'Rendered input fingerprint changed: '+t)
        proof.need(re.fullmatch(r'\./audio/generated/ja/jf_alpha/[a-f0-9]{32}\.m4a',c.get('src','')),'Unsafe candidate path')
        media=(render/c['src']).resolve();proof.need(media.is_relative_to(render),'Candidate path escape');data=exact_file(media,c['sha256'],c['bytes']);proof.need(data[4:8]==b'ftyp','Candidate is not M4A')
        found=raw_by_sha.get(c['sha256'],[]);proof.need(len(found)==1,'Missing or ambiguous actual ASR checkpoint: '+t)
        raw_path,raw=found[0];proof.need(raw_path.stem==raw.get('fingerprint'),'ASR checkpoint filename changed');inputs[str(raw_path)]=sha(raw_path.read_bytes())
        before=dict(fallback=copy.deepcopy(old_fallback),audit=copy.deepcopy(old_audit),repairCanonical=proof.canonical(proof.history(row['repair'])),repairSha256=proof.historical_sha(row['repair']))
        a=make_attempt(u,bundle,raw,reading,readings_sha,index['generation'],renderer_sha,before,row,compare,bank)
        proof.need(not row.get('manualKanaAttempts'),'Use the existing transaction to resume; do not replace manual history')
        row.setdefault('manualKanaAttempts',[]).append(a);report['entries'][t]=a['id']
        if a['disposition']=='recorded-matched':
            newclip={**copy.deepcopy(a['candidate']['clip']),'manualKanaId':a['id']};newrecord={**copy.deepcopy(a['candidate']['asr']),'manualKanaId':a['id']}
            pack['clips'][u['key']]=newclip;del pack['fallbacks'][u['key']];audits[pair]['records'][u['key']]=newrecord;overrides['entries'][t]=copy.deepcopy(a['override']);report['matched']+=1
            if t in deliveries:
                d=deliveries[t];proof.need('manualKanaSupersession' not in d,'Existing manual supersession differs')
                d['manualKanaSupersession']=dict(method=proof.METHOD,attemptId=a['id'],priorDeliveryCanonical=proof.canonical(d),priorDeliverySha256=proof.delivery_sha(d))
            destination=root/c['src']
        else:
            report['failed']+=1;empty=not raw['recognized'].strip();report['empty']+=empty
            report['failures'].append(dict(token=t,attemptId=a['id'],text=u['text'],spoken=reading,recognized=raw['recognized'],sha256=c['sha256'],status=a['candidate']['asr']['status'],reason='no-speech-recognized' if empty else 'not-equivalent'))
            destination=work/'tmp/manual-kana-history'/(c['sha256']+'.m4a')
            a['archive']=dict(published=False,sha256=c['sha256'],bytes=c['bytes'],copyVerified=True)
        copies.append(dict(source=str(media),destination=str(destination),sha256=c['sha256'],bytes=c['bytes']))
    quality.setdefault('stages',{})['manualKana']=dict(method=proof.METHOD,total=report['total'],matched=report['matched'],failed=report['failed'],empty=report['empty'],readingsSha256=readings_sha,recognitionModel=proof.MODEL,recognitionModelSha256=proof.MODEL_SHA,originalHistoryPreserved=True)
    outputs={p:body(v,compact=p=='data/audio/quality-review.json') for p,v in [('data/audio/quality-review.json',quality),('data/audio/overrides.json',overrides),('data/audio/normalization-review.json',normalization),('data/audio/manual-kana-review.json',report)]}
    for pair,audit in audits.items():
        if pair[0]=='ja':outputs[f'data/audio/audit/{pair[0]}/{pair[1]}.json']=body(audit)
    first_ids={q['id'] for q in document('data/part2.json',[]) if q.get('type')=='first'}
    outputs.update(reconcile(source,index,packs,audits,quality,overrides,human_doc,bank,original,first_ids))
    writes=[]
    for relative,after in outputs.items():
        before=original.get(relative)
        if before is None and relative not in original:
            p=root/relative;before=p.read_bytes() if p.exists() else None
        if before!=after:writes.append(dict(path=relative,beforeSha256=sha(before) if before is not None else None,afterSha256=sha(after),compact=relative=='data/audio/quality-review.json',json=json.loads(after)))
    # Publish proof/history first, index last. Any interruption resumes against
    # exact before/after byte hashes instead of guessing which files changed.
    writes.sort(key=lambda x:(x['path']=='data/audio/manifest.json',x['path']!='data/audio/quality-review.json',x['path']))
    written={item['path'] for item in writes}
    readonly={str(root/name):sha(raw) for name,raw in original.items() if name not in written and raw is not None}
    inputs.update(readonly)
    return dict(version=1,method=proof.METHOD,root=str(root),readingsSha256=readings_sha,sourceSha256=sha(source_bytes),state='prepared',inputs=inputs,codeInputs=code_inputs,copies=copies,writes=writes,summary={k:report[k] for k in ('total','matched','failed','empty')})

def compact_completed_ledger(transaction):
    # Layout-only migration for an already completed pre-compact transaction.
    # Preserve both exact serialized hashes so a crash before/after the rewrite
    # resumes safely without rerunning or changing any audio decision.
    changed=False
    if transaction.get('state')!='complete':return changed
    for item in transaction['writes']:
        if item['path']!='data/audio/quality-review.json' or item.get('compact'):continue
        proof.need(item['afterSha256']==sha(body(item['json'])),'Legacy ledger layout fingerprint changed')
        item['previousSerializationSha256']=item['afterSha256'];item['compact']=True
        item['afterSha256']=sha(body(item['json'],compact=True));changed=True
    return changed

def verify_transaction(transaction,root):
    proof.need(transaction.get('version')==1 and transaction.get('method')==proof.METHOD and transaction.get('root')==str(root),'Publication transaction identity changed')
    if transaction.get('state')!='complete':
        proof.need(bool(transaction.get('codeInputs')),'Publication decision code fingerprint missing')
        for filename,digest in transaction['codeInputs'].items():exact_file(filename,digest)
    for filename,digest in transaction['inputs'].items():exact_file(filename,digest)
    for item in transaction['writes']:
        path=root/item['path'];proof.need(path.resolve().is_relative_to(root),'Unsafe publication path')
        current=sha(path.read_bytes()) if path.exists() else None
        allowed=[item['beforeSha256'],item['afterSha256']]
        if item.get('previousSerializationSha256'):
            proof.need(item['path']=='data/audio/quality-review.json' and item.get('compact') is True and item['previousSerializationSha256']==sha(body(item['json'])),'Invalid ledger layout migration')
            allowed.append(item['previousSerializationSha256'])
        proof.need(current in allowed,'Concurrent author changed '+item['path'])
        proof.need(sha(body(item['json'],compact=item.get('compact',False)))==item['afterSha256'],'Transaction payload changed')
    for item in transaction['copies']:exact_file(item['source'],item['sha256'],item['bytes'])

def publish(root,render,readings,work,apply=False,*,bank=None,compare=None,renderer=None,after_write=None):
    root=Path(root).resolve();work=Path(work).resolve();render=Path(render).resolve();readings=Path(readings).resolve()
    proof.need(not work.is_relative_to(root) and not render.is_relative_to(root),'Keep author checkpoints external')
    readings_sha=sha(readings.read_bytes());journal=work/'tmp/manual-kana-publication'/(readings_sha+'.json')
    bank=bank or load(root/'scripts/generate-bank-audio.py','manual_publication_bank')
    compare=compare or load(root/'scripts/compare-manual-kana.py','manual_publication_compare').compare
    renderer=renderer or load(root/'scripts/render-kana-audio.py','manual_publication_renderer')
    work.mkdir(parents=True,exist_ok=True)
    with ExitStack() as locks:
        for name in ('bank-retry.lock','bank-generate.lock','bank-audit.lock'):
            lock=locks.enter_context((work/name).open('a'));fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        transaction=read(journal) if journal.exists() else prepare(root,render,readings,work,bank,compare,renderer)
        layout_updated=compact_completed_ledger(transaction)
        verify_transaction(transaction,root)
        if not apply:return {**transaction['summary'],'dryRun':True,'publicWrites':0,'state':transaction['state']}
        if not journal.exists() or layout_updated:atomic_bytes(journal,body(transaction))
        for item in transaction['copies']:
            destination=Path(item['destination'])
            if destination.exists():exact_file(destination,item['sha256'],item['bytes'])
            else:atomic_bytes(destination,exact_file(item['source'],item['sha256'],item['bytes']));exact_file(destination,item['sha256'],item['bytes'])
        written=0
        for item in transaction['writes']:
            path=root/item['path']
            if not path.exists() or sha(path.read_bytes())!=item['afterSha256']:
                atomic_bytes(path,body(item['json'],compact=item.get('compact',False)));written+=1
                if after_write:after_write(item['path'])
        transaction['state']='complete';atomic_bytes(journal,body(transaction))
        return {**transaction['summary'],'dryRun':False,'state':'complete','publicWrites':written}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--repo',type=Path,default=Path(__file__).resolve().parents[1]);p.add_argument('--render-dir',type=Path,required=True);p.add_argument('--readings',type=Path,required=True);p.add_argument('--workdir',type=Path,default=Path.home()/'.local/share/toeic-kokoro');p.add_argument('--apply',action='store_true');a=p.parse_args()
    print(json.dumps(publish(a.repo,a.render_dir,a.readings,a.workdir,a.apply),ensure_ascii=False,indent=2))
if __name__=='__main__':main()
