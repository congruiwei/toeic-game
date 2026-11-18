/** Pure admission for additional actual same-file full large-v3 ASR evidence. */
import {createHash} from 'node:crypto';
export const METHOD='same-media-full-model-crosscheck-v1';
const MODEL='whisper-large-v3',MODEL_SHA='69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1',REPO='Systran/faster-whisper-large-v3',REVISION='edaa852ec7e145841d8ffdb056a99866b5f0a478';
const TURBO='whisper-large-v3-turbo',TURBO_SHA='e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da';
const sha=x=>createHash('sha256').update(x).digest('hex');
const canonical=x=>Array.isArray(x)?`[${x.map(canonical).join(',')}]`:x&&typeof x==='object'?`{${Object.keys(x).sort().map(k=>`${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`:JSON.stringify(x);
const same=(a,b)=>canonical(a)===canonical(b),digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),need=x=>{if(!x)throw Error('Invalid cross-model evidence');};
const media=c=>Object.fromEntries(Object.entries(c||{}).filter(([k])=>k!=='asrStatus'));
const allowArticles=u=>[...u.text.matchAll(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)].length>1;
function actual(c,a,model,modelSha,input,validateOriginal){
 need(typeof validateOriginal==='function'&&validateOriginal(c,a));
 const g=a.recognitionGeneration;
 need(a.recognitionMethod==='individual-beam5'&&a.singleFileVerification===true&&g.model===model&&g.modelSha256===modelSha&&g.beamSize===5&&g.device==='cpu'&&g.computeType==='int8');
 need(g.conditionOnPreviousText===false&&g.vadFilter===false&&Object.hasOwn(g,'prompt')&&g.prompt===null&&[g,a].every(x=>['prompt','hotwords','initialPrompt','initial_prompt'].every(k=>x[k]==null)));
 need(['src','sha256','voiceId'].every(k=>a[k]===c[k])&&a.expected===c.text&&a.spoken===c.spoken&&typeof a.recognized==='string'&&a.recognized.trim());
 need(Array.isArray(a.segments)&&a.segments.length&&a.segments.map(s=>s.text.trim()).join(' ').trim()===a.recognized&&a.segments.every(s=>Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.start>=0&&s.end>=s.start));
 need(typeof input==='string'&&sha(input)===a.fingerprint&&same(JSON.parse(input),[g,c.sha256,'en']));
 if(model===MODEL)need(g.modelRepository===REPO&&g.modelRevision===REVISION&&g.temperature===0&&g.wordTimestamps===false&&Object.hasOwn(g,'hotwords')&&g.hotwords===null&&g.audioInput==='unchanged-delivered-m4a'&&g.task==='transcribe');
}
export function validateCrossModelAcceptance(unit,clip,record,row,{validateOriginal}={}){
 try{
  need(unit?.language==='en'&&unit.required===true&&!unit.nonSpoken&&record?.status==='accepted'&&record.acceptance?.method===METHOD);
  need(['text','language','voiceId','required'].every(k=>clip[k]===unit[k])&&['sha256','inputSha256','phonemeSha256'].every(k=>digest(clip[k])));
  const found=row?.crossModelChecks?.filter(p=>p.id===record.acceptance.proofId);need(found?.length===1);const p=found[0],o=p.originalASR,f=p.fullASR,r=row.repair;
  need(p.version===1&&p.method===METHOD&&p.token===`${unit.language}:${unit.bank}:${unit.key}`&&p.sourceAudioSha256===clip.sha256&&same(p.sourceClip,media(clip))&&p.status==='accepted'&&p.originalIndividualASRMatched===false&&p.originalAudioResynthesized===false&&p.audioInput==='unchanged-delivered-m4a'&&p.reason==='strict-same-media-full-model-equivalence');
  need(r?.complete===true&&r.disposition==='recorded-review'&&same(media(r.candidate?.clip),media(clip))&&same(r.candidate?.asr,o));
  need(o.key===unit.key&&o.status==='review'&&!Object.hasOwn(o,'acceptance')&&f.key===unit.key&&f.status==='matched'&&!Object.hasOwn(f,'acceptance'));
  actual(clip,o,TURBO,TURBO_SHA,p.originalFingerprintInput,validateOriginal);actual(clip,f,MODEL,MODEL_SHA,p.fullFingerprintInput,validateOriginal);
  const c=f.comparison;need(c?.equivalent===true&&c.ruleVersion==='strict-audio-equivalence-1'&&c.audioSha256===clip.sha256&&c.expectedSpoken===clip.spoken&&c.recognized===f.recognized&&c.language==='en'&&typeof c.proofExpected==='string'&&c.proofExpected.trim()&&c.proofExpected===c.proofRecognized);
  need(c.provenance?.sourceTextSha256===sha(clip.text)&&['ruleFileSha256','normalizerFileSha256'].every(k=>digest(c.provenance[k]))&&c.provenance.articlePolicyEnabled===allowArticles(unit)&&p.articlePolicyEnabled===allowArticles(unit)&&c.provenance.phonemeOverride===Boolean(r.appliedOverride?.phonemes));
  need(typeof p.originalASRCanonical==='string'&&typeof p.fullASRCanonical==='string'&&same(JSON.parse(p.originalASRCanonical),o)&&same(JSON.parse(p.fullASRCanonical),f));
  const identity={method:METHOD,token:p.token,sourceAudioSha256:clip.sha256,sourceInputSha256:clip.inputSha256,originalASRSha256:sha(p.originalASRCanonical),fullASRSha256:sha(p.fullASRCanonical)};
  const admission={method:METHOD,proofId:p.id,sourceAudioSha256:clip.sha256,originalIndividualStatus:'review'};
  return p.id===sha(canonical(identity))&&same(record.acceptance,admission)&&same(record,{...o,status:'accepted',acceptance:admission});
 }catch{return false;}
}
