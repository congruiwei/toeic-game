// Independent, model-free validation of manually authored Japanese delivery.
import {createHash} from 'node:crypto';
export const MANUAL_KANA_METHOD='manually-authored-japanese-kana-v1';
const MODEL='whisper-large-v3',MODEL_SHA='69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1';
const hash=x=>createHash('sha256').update(x).digest('hex');
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const canonical=x=>Array.isArray(x)?`[${x.map(canonical).join(',')}]`:x&&typeof x==='object'?`{${Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')}}`:JSON.stringify(x);
const same=(a,b)=>canonical(a)===canonical(b);
const omit=(o,keys)=>Object.fromEntries(Object.entries(o??{}).filter(([k])=>!keys.includes(k)));
const need=(ok,message)=>{if(!ok)throw Error(message);};
const token=u=>`${u.language}:${u.bank}:${u.key}`;
const history=x=>Array.isArray(x)?x.map(history):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).filter(([k])=>k!=='archive').map(([k,v])=>[k,history(v)])):x;
const fields=['src','sha256','bytes','duration','decodedPeak','headroomDb','language','voiceId','text','spoken','inputSha256','required','synthesisSpeed','phonemeSha256','speaker'];
const binding=c=>Object.fromEntries(fields.filter(k=>Object.hasOwn(c,k)).map(k=>[k,c[k]]));
const parsedEquals=(raw,value)=>typeof raw==='string'&&same(JSON.parse(raw),value);
export function validateManualKanaAttempt(u,a,row,{validateOriginal}={}){
 try{
  need(u?.language==='ja'&&u.voiceId==='jf_alpha'&&u.required===true&&!u.nonSpoken,'Invalid manual-kana source');
  need(a?.version===1&&a.method===MANUAL_KANA_METHOD&&a.token===token(u),'Manual-kana identity changed');
  need(parsedEquals(a.proofCanonical,omit(a,['id','archive','proofCanonical']))&&hash(a.proofCanonical)===a.id,'Manual-kana proof digest changed');
  const source=Object.fromEntries(['language','bank','key','text','voiceId','required','speaker'].filter(k=>Object.hasOwn(u,k)).map(k=>[k,u[k]]));
  need(same(a.source,source)&&typeof a.reading==='string'&&a.reading.trim()&&!/[^\u3041-\u3096ー— 、。，？！；：・「」『』（）、…,.!?:;“”()\n\t　]/u.test(a.reading),'Manual reading/source binding changed');
  const old=a.before??{},repair=row?.repair;
  need(repair?.complete===true&&repair.disposition==='system-fallback'&&parsedEquals(old.repairCanonical,history(repair))&&hash(old.repairCanonical)===old.repairSha256,'Original fallback repair changed');
  const f=old.fallback,previous=repair.candidate;
  need(f?.playback==='system'&&f.language==='ja'&&f.text===u.text&&f.voiceId===u.voiceId&&f.reason==='unresolved-after-strong-asr-retry'&&f.auditedSha256===previous?.clip?.sha256,'Original fallback binding changed');
  need(typeof validateOriginal==='function'&&[repair.original,previous].every(v=>validateOriginal(v?.clip,v?.asr)),'Original actual fallback evidence missing');
  need(same(old.audit,previous.asr),'Original fallback transcript changed');
  const c=a.candidate?.clip,r=a.candidate?.asr,o=a.override;
  need(c&&r&&o&&['language','text','voiceId','required','speaker'].every(k=>c[k]===u[k])&&!Object.hasOwn(c,'sourceVoiceId')&&!Object.hasOwn(c,'voiceOverrideInput'),'New media source/casting changed');
  need(digest(c.sha256)&&c.sha256!==previous.clip.sha256&&/^\.\/audio\/generated\/ja\/jf_alpha\/[a-f0-9]{32}\.m4a$/.test(c.src),'New media path/SHA invalid');
  need(Number.isSafeInteger(c.bytes)&&c.bytes>0&&Number.isFinite(c.duration)&&c.duration>0&&Number.isFinite(c.decodedPeak)&&c.decodedPeak>.005&&c.decodedPeak<=.95,'New media metadata invalid');
  need(c.spoken===a.reading&&o.spoken===a.reading&&typeof o.phonemes==='string'&&o.phonemes&&c.phonemeSha256===hash(o.phonemes)&&c.synthesisSpeed===1&&(o.speed??1)===1&&!Object.keys(o).some(k=>!['spoken','phonemes','reason','speed'].includes(k)),'Manual kana/phoneme binding changed');
  const g0=a.synthesisGeneration??{},synthesis=Object.fromEntries(['recipe','modelSha256','voicesSha256','packages'].map(k=>[k,g0[k]]));
  need(parsedEquals(a.inputFingerprintInput,[synthesis,g0.encoding,'jf_alpha',a.reading,o.phonemes])&&hash(a.inputFingerprintInput)===c.inputSha256,'Manual synthesis fingerprint changed');
  need(digest(a.rendererSha256)&&digest(a.readingsSha256),'Manual author/renderer provenance missing');
  const raw=a.rawASR??{},g=raw.generation??{};
  need(g.model===MODEL&&g.modelSha256===MODEL_SHA&&g.device==='cpu'&&g.computeType==='int8'&&g.beamSize===5&&g.conditionOnPreviousText===false&&Object.hasOwn(g,'prompt')&&g.prompt===null&&(g.hotwords??null)===null&&g.vadFilter===false,'Actual full-model identity missing');
  need(raw.sha256===c.sha256&&typeof raw.recognized==='string'&&!raw.error&&parsedEquals(a.asrFingerprintInput,[g,c.sha256,'ja'])&&hash(a.asrFingerprintInput)===raw.fingerprint,'Actual recognition fingerprint changed');
  const segments=raw.segments;need(Array.isArray(segments)&&segments.every(s=>typeof s?.text==='string'&&Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.start>=0&&s.end>=s.start)&&segments.map(s=>s.text.trim()).join(' ').trim()===raw.recognized,'Actual recognition segments/transcript differ');
  need(r.key===u.key&&['src','sha256','voiceId','spoken'].every(k=>r[k]===c[k])&&r.expected===c.text&&r.recognized===raw.recognized&&same(r.segments,segments)&&same(r.recognitionGeneration,g)&&r.fingerprint===raw.fingerprint&&r.recognitionMethod==='individual-beam5'&&r.singleFileVerification===true,'Published check differs from actual ASR');
  const cmp=r.comparison??{},p=cmp.provenance??{};
  need(cmp.ruleVersion==='strict-audio-equivalence-1'&&cmp.audioSha256===c.sha256&&cmp.expectedSpoken===c.spoken&&cmp.recognized===r.recognized&&cmp.language==='ja'&&typeof cmp.equivalent==='boolean'&&Array.isArray(cmp.reasons)&&cmp.reasons.length&&cmp.reasons.every(x=>typeof x==='string'&&x)&&p.sourceTextSha256===hash(c.text)&&['ruleFileSha256','normalizerFileSha256'].every(k=>digest(p[k]))&&p.ruleFileSha256===p.normalizerFileSha256&&p.comparison==='manual-kana-asr-only-1'&&p.normalizer==='manual-kana-asr-only-1'&&p.phonemeOverride===true&&p.articlePolicyEnabled===false&&(!cmp.equivalent||(same(cmp.readingTrace?.expected,[])&&Array.isArray(cmp.readingTrace?.recognized))),'Manual comparison binding invalid');
  if(cmp.equivalent)need(raw.recognized.trim()&&typeof cmp.proofExpected==='string'&&cmp.proofExpected.trim()&&cmp.proofExpected===cmp.proofRecognized,'Empty/unproven recognition cannot pass');
  const status=cmp.equivalent?'matched':raw.recognized.trim()?'review':'error';
  need(r.status===status&&c.asrStatus===status&&a.disposition===(cmp.equivalent?'recorded-matched':'system-fallback')&&a.recognitionAttempted===true&&a.originalAudioReplaced===cmp.equivalent,'Manual decision differs from actual comparison');
  return [];
 }catch(e){return [e.message];}
}
export function validateManualKanaRecord(u,c,r,row,options){
 if(!digest(c?.manualKanaId)||r?.manualKanaId!==c.manualKanaId)return false;
 const found=(row?.manualKanaAttempts??[]).filter(a=>a.id===c.manualKanaId);if(found.length!==1)return false;
 const a=found[0];return !validateManualKanaAttempt(u,a,row,options).length&&a.disposition==='recorded-matched'&&same(omit(c,['manualKanaId']),a.candidate.clip)&&c.asrStatus==='matched'&&same(omit(r,['manualKanaId']),a.candidate.asr);
}
export function validManualKanaSupersession(u,c,r,row,delivery,options){
 try{
  const s=delivery?.manualKanaSupersession;
  return s?.method===MANUAL_KANA_METHOD&&s.attemptId===c?.manualKanaId&&parsedEquals(s.priorDeliveryCanonical,omit(delivery,['manualKanaSupersession']))&&hash(s.priorDeliveryCanonical)===s.priorDeliverySha256&&validateManualKanaRecord(u,c,r,row,options);
 }catch{return false;}
}
export function validateManualKanaReport(source,report,quality,packs,overrides,normalization,humanDoc,options){
 const errors=[];if(!report){
  if(Object.values(quality?.records??{}).some(r=>r.manualKanaAttempts?.length))errors.push('Missing manual kana report');return errors;
 }
 try{
  need(report.version===1&&report.method===MANUAL_KANA_METHOD&&report.complete===true&&digest(report.readingsSha256),'Invalid manual kana report');
  const units=new Map(source.units.map(u=>[token(u),u])),rows=quality.records??{},expected=Object.keys(rows).filter(t=>units.get(t)?.language==='ja'&&units.get(t)?.required&&rows[t].repair?.disposition==='system-fallback'&&rows[t].repair.complete).sort();
  need(same(Object.keys(report.entries??{}).sort(),expected),'Manual kana report omits original fallback keys');
  const failures=[];let matched=0,empty=0;
  for(const t of expected){
   const u=units.get(t),row=rows[t],id=report.entries[t],attempts=(row.manualKanaAttempts??[]).filter(a=>a.id===id);need(attempts.length===1,'Manual attempt missing/duplicated '+t);
   const a=attempts[0];need(!validateManualKanaAttempt(u,a,row,options).length&&a.readingsSha256===report.readingsSha256,'Invalid manual evidence '+t);
   const loaded=packs.get(`${u.language}:${u.bank}`),c=loaded?.pack?.clips?.[u.key],r=loaded?.audit?.records?.[u.key],fallback=loaded?.pack?.fallbacks?.[u.key];
   if(a.disposition==='recorded-matched'){
    need(!fallback&&validateManualKanaRecord(u,c,r,row,options)&&same(overrides?.entries?.[t],a.override),'Manual recorded route differs '+t);matched++;
    const delivery=(normalization?.confirmedInputCorrections??[]).find(d=>d.token===t);
    if(delivery)need(validManualKanaSupersession(u,c,r,row,delivery,options),'Manual correction supersession missing '+t);
   }else{
    need(!c&&same(fallback,a.before.fallback)&&same(r,a.before.audit),'Failed manual check changed system route '+t);
    need(a.archive?.published===false&&a.archive.copyVerified===true&&a.archive.sha256===a.candidate.clip.sha256&&a.archive.bytes===a.candidate.clip.bytes,'Failed manual media has no verified archive '+t);
    failures.push({token:t,attemptId:id,text:u.text,spoken:a.reading,recognized:a.rawASR.recognized,sha256:a.candidate.clip.sha256,status:a.candidate.asr.status,reason:a.rawASR.recognized.trim()?'not-equivalent':'no-speech-recognized'});if(!a.rawASR.recognized.trim())empty++;
   }
  }
  need(same(report.failures,failures)&&report.total===expected.length&&report.matched===matched&&report.failed===failures.length&&report.empty===empty,'Manual kana failure list/count differs');
 }catch(e){errors.push(e.message);}return errors;
}
