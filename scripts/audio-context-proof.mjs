/** Public integrity gate for independently verified, unchanged-PCM word probes.
 * This verifies recorded evidence, never pretends to re-run ASR or decode PCM.
 * Python contextual-audio-probe.py recomputes the strict lexical comparator.
 */
import { createHash } from 'node:crypto';
const METHOD='unchanged-original-pcm-context-v1';
const MODEL='whisper-large-v3-turbo';
const MODEL_SHA='e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da';
const hash=x=>createHash('sha256').update(x).digest('hex');
const canonical=x=>Array.isArray(x)?`[${x.map(canonical).join(',')}]`:x&&typeof x==='object'?`{${Object.keys(x).sort().map(k=>`${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`:JSON.stringify(x);
const equal=(a,b)=>canonical(a)===canonical(b);
const sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const words=text=>[...String(text??'').matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?/gu)].map(x=>x[0].replaceAll('’',"'"));
const positive=n=>Number.isInteger(n)&&n>0;
const own=(x,k)=>Object.hasOwn(x,k);
function eligible(u,firstWordIds){
 if(u?.language!=='en'||u.required!==true||u.nonSpoken)return false;
 const text=u.text?.trim(),key=u.key;
 if(u.bank==='labels')return /^labels\/(af_heart|am_puck|af_bella)\/[A-D]$/.test(key)&&/^[A-D]\.$/.test(text);
 if(typeof text!=='string'||text.length>40||!/^\p{L}+(?:['’\-]\p{L}+)*$/u.test(text))return false;
 return u.bank==='vocab'&&/^v-[^/]+\/meaning$/.test(key)||u.bank==='part2'&&firstWordIds.has(u.group)&&key.includes('/options/');
}
function actualStrong(c,a){
 const g=a?.recognitionGeneration;
 return !!g&&a.sha256===c.sha256&&a.expected===c.text&&a.spoken===c.spoken&&a.status==='review'&&typeof a.recognized==='string'&&!!a.recognized.trim()&&a.recognitionMethod==='individual-beam5'&&a.singleFileVerification===true&&g.model===MODEL&&g.modelSha256===MODEL_SHA&&g.device==='cpu'&&g.computeType==='int8'&&g.beamSize===5&&own(g,'prompt')&&g.prompt===null&&g.conditionOnPreviousText===false&&g.vadFilter===false;
}
export function validateContextAcceptance(unit,clip,record,row,{firstWordIds=new Set(),validateOriginal}={}){
 try{
  if(!eligible(unit,firstWordIds)||record?.status!=='accepted')return false;
  const admission=record.acceptance;
  if(admission?.method!==METHOD||admission.sourceAudioSha256!==clip.sha256||admission.originalIndividualStatus!=='review')return false;
  const all=row?.contextProbes;
  if(!Array.isArray(all))return false;
  const found=all.filter(p=>p.id===admission.proofId);if(found.length!==1)return false;
  const p=found[0],assessment=p.assessmentVersion??1,c=p.sourceClip,o=p.originalASR,a=p.asr,m=p.pcm,carrier=p.carrier,comparison=p.comparison;
  if(![1,2].includes(assessment)||p.version!==1||p.method!==METHOD||p.status!=='accepted'||p.token!==`${unit.language}:${unit.bank}:${unit.key}`||p.sourceAudioSha256!==clip.sha256||p.originalAudioResynthesized!==false||p.originalIndividualASRMatched!==false)return false;
  if(!['text','language','voiceId','required'].every(k=>clip[k]===unit[k]))return false;
  if(!['src','sha256','bytes','text','spoken','language','voiceId','inputSha256','phonemeSha256'].every(k=>equal(c[k],clip[k])))return false;
  if(!actualStrong(c,o)||(validateOriginal&&!validateOriginal(c,o)))return false;
  if(o.comparison){const oc=o.comparison;if(oc.ruleVersion!=='strict-audio-equivalence-1'||oc.audioSha256!==c.sha256||oc.expectedSpoken!==c.spoken||oc.recognized!==o.recognized||oc.language!==c.language||oc.equivalent!==false||oc.provenance?.sourceTextSha256!==hash(c.text)||!sha(oc.provenance?.ruleFileSha256)||!sha(oc.provenance?.normalizerFileSha256))return false;}
  if(!equal(record,{...o,status:'accepted',acceptance:{method:METHOD,proofId:p.id,sourceAudioSha256:clip.sha256,originalIndividualStatus:'review'}}))return false;
  if(carrier?.sampleRate!==16000||carrier?.synthesis?.targetTextUsed!==false||carrier?.text!=='The word is'||!['af_heart','am_puck','af_bella'].includes(carrier.voiceId)||!sha(carrier.audioSha256)||carrier.pcmSha256!==m.carrierPCMSha256||carrier.frames!==m.carrierFrames)return false;
  if(m.sampleRate!==16000||m.format!=='float32-le-mono'||m.gapFrames!==3200||!positive(m.carrierFrames)||!positive(m.spanFrames)||m.spanStartFrame!==m.carrierFrames+3200||m.totalFrames!==m.spanStartFrame+m.spanFrames||m.targetPCMUnchanged!==true||m.targetSpanSha256!==m.sourcePCMSha256||![m.sourcePCMSha256,m.carrierPCMSha256,m.probePCMSha256].every(sha))return false;
  const g=a?.recognitionGeneration;
  if(!g||g.model!==MODEL||g.modelSha256!==MODEL_SHA||g.device!=='cpu'||g.computeType!=='int8'||g.beamSize!==5||!own(g,'prompt')||g.prompt!==null||!own(g,'hotwords')||g.hotwords!==null||g.conditionOnPreviousText!==false||g.vadFilter!==false||g.temperature!==0||g.wordTimestamps!==true||a.recognitionMethod!=='context-individual-beam5'||a.probePCMSha256!==m.probePCMSha256)return false;
  if(!Array.isArray(a.segments)||!a.segments.length||a.segments.map(s=>s.text.trim()).join(' ').trim()!==a.recognized||!Array.isArray(a.words))return false;
  const tokens=words(a.recognized);if(tokens.length<=3||!equal(tokens.slice(0,3).map(s=>s.toLowerCase()),['the','word','is']))return false;
  const timed=[];
  for(const w of a.words){if(!Number.isFinite(w.start)||!Number.isFinite(w.end)||w.start<0||w.end<=w.start||w.end>m.totalFrames/16000+.08)return false;for(const t of words(w.word))timed.push({t,start:w.start,end:w.end});}
  if(timed.some((w,i)=>i>0&&(w.start<timed[i-1].start||w.end<timed[i-1].end)))return false;
  if(!equal(timed.map(w=>w.t.toLowerCase()),tokens.map(t=>t.toLowerCase())))return false;
  const start=m.spanStartFrame/16000,end=m.totalFrames/16000;
  if(timed.slice(0,3).some(w=>w.end>start+.08))return false;
  if(assessment===1){if(timed.slice(3).some(w=>w.start<start-.08||w.end>end+.08))return false;}
  else{
   const activity=m.sourceActivity;
   if(activity?.method!=='rms-10ms-threshold-0.001-v1'||activity.windowFrames!==160||activity.rmsThreshold!==.001||!Number.isInteger(activity.startFrame)||!Number.isInteger(activity.endFrame)||activity.startFrame<0||activity.endFrame<=activity.startFrame||activity.endFrame>m.spanFrames)return false;
   const audibleStart=start+activity.startFrame/16000,audibleEnd=start+activity.endFrame/16000;
   if(timed.slice(3).some(w=>w.start<m.carrierFrames/16000||w.end<=audibleStart||w.start>=audibleEnd||w.end>end+.08))return false;
  }
  const tail=tokens.slice(3).join(' ');if(p.recognizedTail!==tail)return false;
  if(comparison?.ruleVersion!=='strict-audio-equivalence-1'||comparison.language!=='en'||comparison.expectedSpoken!==c.spoken||comparison.recognized!==tail||comparison.equivalent!==true||typeof comparison.proofExpected!=='string'||!comparison.proofExpected.trim()||comparison.proofExpected!==comparison.proofRecognized||!Array.isArray(comparison.reasons)||!comparison.reasons.length)return false;
  const cp=comparison.provenance;
  if(cp?.articlePolicyEnabled!==false||cp.sourceTextSha256!==hash(c.text)||!sha(cp.ruleFileSha256)||!sha(cp.normalizerFileSha256))return false;
  const identity={token:p.token,sourceAudioSha256:clip.sha256,carrierPCMSha256:carrier.pcmSha256,probePCMSha256:m.probePCMSha256,modelSha256:MODEL_SHA,method:METHOD};
  if(assessment===2)identity.assessmentVersion=2;
  return p.id===hash(canonical(identity));
 }catch{return false;}
}
