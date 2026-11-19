"""Human listening judgments stay independent of the immutable actual ASR."""
import re
DIGEST=re.compile(r'[a-f0-9]{64}\Z')
TOKEN=re.compile(r'(en|ja):(vocab|part1|part2|listening|reading|grammar|methods|terms|labels):.+\Z')
def text(v):return isinstance(v,str) and bool(v.strip())
def validate_human_review(doc):
    if doc is None:return []
    if not isinstance(doc,dict) or doc.get('version')!=1 or not all(isinstance(doc.get(k),list) for k in ['feedback','requests','batches']):return ['Invalid human-review document']
    errors=[];batches={};seen=set()
    for b in doc['batches']:
        if not isinstance(b,dict) or not text(b.get('id')) or b.get('id') in batches or not text(b.get('source')) or not DIGEST.fullmatch(b.get('queueSha256','')) or not isinstance(b.get('count'),int) or b['count']<=0:errors.append('Invalid human-review batch')
        if isinstance(b,dict):batches[b.get('id')]=b
    for f in doc['feedback']:
        if not isinstance(f,dict):errors.append('Invalid human feedback');continue
        identity=(f.get('batchId'),f.get('token'),f.get('sha256'))
        if not TOKEN.fullmatch(f.get('token','')) or not DIGEST.fullmatch(f.get('sha256','')) or not text(f.get('text')) or f.get('label') not in ['ok','problem','unsure'] or f.get('batchId') not in batches or identity in seen:errors.append('Invalid/duplicate human feedback')
        seen.add(identity)
    for b in batches.values():
        if sum(f.get('batchId')==b.get('id') for f in doc['feedback'] if isinstance(f,dict))!=b.get('count'):errors.append('Human feedback batch count mismatch')
    seen=set()
    for r in doc['requests']:
        if not isinstance(r,dict):errors.append('Invalid human-review request');continue
        identity=(r.get('token'),r.get('sha256'))
        if not TOKEN.fullmatch(r.get('token','')) or not DIGEST.fullmatch(r.get('sha256','')) or not all(text(r.get(k)) for k in ['text','reason','origin']) or identity in seen:errors.append('Invalid/duplicate human-review request')
        seen.add(identity)
    return errors

def human_review_state(doc,unit,clip):
    if not doc or not unit or not clip:return None
    token=f"{unit['language']}:{unit['bank']}:{unit['key']}"
    feedback=next((x for x in reversed(doc['feedback']) if x['token']==token),None)
    request=next((x for x in reversed(doc['requests']) if x['token']==token),None)
    if feedback and feedback['text']!=unit['text']:raise ValueError('Human-review source text changed: '+token)
    if request and request['text']!=unit['text']:raise ValueError('Human-review request source changed: '+token)
    if feedback and feedback['sha256']==clip['sha256'] and feedback['label']=='ok':return {'status':'approved','sha256':clip['sha256'],'batchId':feedback['batchId'],'actualASRUnchanged':True}
    if feedback or request:return {'status':'required','sha256':clip['sha256'],'previousReviewedSha256':feedback['sha256'] if feedback else None,'previousVerdict':feedback['label'] if feedback else None,'reason':request['reason'] if request else 'New or unresolved recording requires human listening'}
    return None
