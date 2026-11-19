// Human listening decisions are separate from actual ASR and bound to a media SHA.
const digest=/^[a-f0-9]{64}$/;
const token=/^(en|ja):(vocab|part1|part2|listening|reading|grammar|methods|terms|labels):.+$/;
const text=x=>typeof x==='string'&&x.trim().length>0;
export function validateHumanReview(doc){
 if(doc==null)return [];
 const errors=[],expect=(x,m)=>{if(!x)errors.push(m);};
 expect(doc.version===1&&Array.isArray(doc.feedback)&&Array.isArray(doc.requests)&&Array.isArray(doc.batches),'Invalid human-review document');
 if(errors.length)return errors;
 const batches=new Map(),seen=new Set();
 for(const b of doc.batches){expect(text(b.id)&&!batches.has(b.id)&&text(b.source)&&digest.test(b.queueSha256)&&Number.isInteger(b.count)&&b.count>0,'Invalid human-review batch');batches.set(b.id,b);}
 for(const f of doc.feedback){const id=`${f.batchId}:${f.token}:${f.sha256}`;expect(token.test(f.token)&&digest.test(f.sha256)&&text(f.text)&&['ok','problem','unsure'].includes(f.label)&&batches.has(f.batchId)&&!seen.has(id),'Invalid/duplicate human feedback');seen.add(id);}
 for(const b of batches.values())expect(doc.feedback.filter(x=>x.batchId===b.id).length===b.count,'Human feedback batch count mismatch');
 seen.clear();
 for(const r of doc.requests){const id=`${r.token}:${r.sha256}`;expect(token.test(r.token)&&digest.test(r.sha256)&&text(r.text)&&text(r.reason)&&text(r.origin)&&!seen.has(id),'Invalid/duplicate human-review request');seen.add(id);}
 return errors;
}
export function humanReviewState(doc,unit,clip){
 if(!doc||!unit||!clip)return null;
 const id=`${unit.language}:${unit.bank}:${unit.key}`;
 const feedback=doc.feedback.filter(x=>x.token===id).at(-1);
 const request=doc.requests.filter(x=>x.token===id).at(-1);
 if(feedback?.text!==undefined&&feedback.text!==unit.text)throw Error(`Human-review source text changed: ${id}`);
 if(request?.text!==undefined&&request.text!==unit.text)throw Error(`Human-review request source changed: ${id}`);
 if(feedback?.sha256===clip.sha256&&feedback.label==='ok')return {status:'approved',sha256:clip.sha256,batchId:feedback.batchId,actualASRUnchanged:true};
 if(feedback||request)return {status:'required',sha256:clip.sha256,previousReviewedSha256:feedback?.sha256,previousVerdict:feedback?.label,reason:request?.reason??(feedback.sha256!==clip.sha256?'新录音尚未人工复听；旧判断只适用于旧音频。':feedback.label==='problem'?'人工标记有问题，需要修复后重新复听。':'人工暂时听不清，需要重新复听。')};
 return null;
}
