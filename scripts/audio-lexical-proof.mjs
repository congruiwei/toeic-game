/** Finite post-repair lexical evidence. Does not infer sound from spelling. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const rules=new Map(JSON.parse(readFileSync(new URL('./audio-lexical-rules.json',import.meta.url),'utf8')).rules.map(r=>[r.id,r]));
const METHOD='selected-recipe-lexical-equivalence-v1',MODEL='whisper-large-v3-turbo',MODEL_SHA='e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da';
const MODELS=new Map([[MODEL,MODEL_SHA],['whisper-large-v3','69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1']]);
const BIND=['src','sha256','bytes','duration','text','spoken','language','voiceId','inputSha256','phonemeSha256','required','synthesisSpeed'];
const hash=x=>createHash('sha256').update(x).digest('hex');
const canonical=x=>Array.isArray(x)?`[${x.map(canonical).join(',')}]`:x&&typeof x==='object'?`{${Object.keys(x).sort().map(k=>`${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`:JSON.stringify(x);
const same=(a,b)=>canonical(a)===canonical(b),sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const binding=c=>Object.fromEntries(BIND.map(k=>[k,c[k]??null]));
const words=s=>[...s.replaceAll('’',"'").matchAll(/[\p{L}\p{N}]+(?:['\-][\p{L}\p{N}]+)*|[^\s]/gu)].map(x=>x[0]).filter(w=>!'.,;:!?"“”()'.includes(w)).map(w=>w.toLowerCase());
function need(ok){if(!ok)throw Error('Invalid lexical proof');}
function align(c,a,rule,phones){
 need(rule.approvedInputs?.some(x=>x.sourceText===c.text&&x.spoken===c.spoken&&x.phonemes===phones&&x.phonemeSha256===hash(phones)));
 const expectedTokens=words(c.spoken),recognizedTokens=words(a.recognized),source=words(c.text),sourceWord=rule.sourceWord.toLowerCase(),recognizedWord=rule.recognizedWord.toLowerCase();
 need(expectedTokens.length===recognizedTokens.length);
 const diff=expectedTokens.flatMap((w,i)=>w===recognizedTokens[i]?[]:[i]);need(diff.length===1);const differenceIndex=diff[0];
 need(expectedTokens[differenceIndex]===sourceWord&&recognizedTokens[differenceIndex]===recognizedWord&&source.filter(w=>w===sourceWord).length===1&&expectedTokens.filter(w=>w===sourceWord).length===1);
 need(phones.split(/\s+/).map(p=>p.replace(/^[.,;:!?]+|[.,;:!?]+$/g,'')).filter(p=>p===rule.phoneToken).length===1);
 return {expectedTokens,recognizedTokens,differenceIndex,sourceWord,recognizedWord,phoneToken:rule.phoneToken};
}
function strong(c,a,key,validateOriginal){
 const g=a.recognitionGeneration,p=a.comparison,pr=p?.provenance;
 need(a.status==='review'&&!a.acceptance&&!a.error&&a.key===key&&['src','sha256','voiceId'].every(k=>a[k]===c[k])&&a.expected===c.text&&a.spoken===c.spoken&&typeof a.recognized==='string'&&a.recognized.trim());
 need(g&&a.recognitionMethod==='individual-beam5'&&a.singleFileVerification===true&&MODELS.has(g.model)&&g.modelSha256===MODELS.get(g.model)&&g.device==='cpu'&&g.computeType==='int8'&&g.beamSize===5&&Object.hasOwn(g,'prompt')&&g.prompt===null&&g.conditionOnPreviousText===false&&g.vadFilter===false);
 need([a,g].every(x=>['prompt','hotwords','initialPrompt','initial_prompt'].every(k=>x[k]==null)));
 need(Array.isArray(a.segments)&&a.segments.length&&a.segments.map(s=>s.text.trim()).join(' ').trim()===a.recognized&&a.segments.every(s=>Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.start>=0&&s.end>=s.start));
 need(p?.equivalent===false&&p.ruleVersion==='strict-audio-equivalence-1'&&p.audioSha256===c.sha256&&p.expectedSpoken===c.spoken&&p.recognized===a.recognized&&p.language==='en'&&pr?.sourceTextSha256===hash(c.text)&&['ruleFileSha256','normalizerFileSha256'].every(k=>sha(pr[k]))&&sha(a.fingerprint));
 if(validateOriginal)need(validateOriginal(c,a));
}
export function validateLexicalAcceptance(unit,clip,record,row,{validateOriginal}={}){
 try{
  need(unit?.language==='en'&&unit.required===true&&!unit.nonSpoken&&unit.bank!=='labels'&&record?.status==='accepted'&&record.acceptance?.method===METHOD);
  const ad=record.acceptance,found=row?.lexicalEquivalences?.filter(p=>p.id===ad.proofId);need(found?.length===1);const p=found[0],rule=rules.get(p.rule?.id),c=p.sourceClip,o=p.originalASR,repair=row.repair;
  need(rule&&same(p.rule,rule)&&p.ruleSha256===hash(canonical(rule))&&p.version===1&&p.method===METHOD&&p.token===`${unit.language}:${unit.bank}:${unit.key}`&&p.sourceAudioSha256===clip.sha256&&p.status==='accepted'&&p.originalAudioResynthesized===false&&p.newRecognitionCalls===0&&p.originalIndividualASRMatched===false);
  need(['sha256','phonemeSha256','inputSha256'].every(k=>sha(clip[k]))&&/^\.\/audio\/generated\/en\/[a-z_]+\/[a-f0-9]{32}\.m4a$/.test(clip.src));
  need(['text','language','voiceId','required'].every(k=>clip[k]===unit[k])&&same(c,binding(clip)));
  need(repair?.complete===true&&repair.disposition==='recorded-review'&&same(binding(repair.candidate?.clip||{}),binding(clip))&&same(repair.candidate?.asr,o));
  const old=repair.original?.clip;need(sha(old?.sha256)&&old.sha256!==clip.sha256&&['text','language','voiceId'].every(k=>old[k]===clip[k]));
  strong(clip,o,unit.key,validateOriginal);
  need(typeof p.actualAsrFingerprintInput==='string'&&hash(p.actualAsrFingerprintInput)===o.fingerprint&&same(JSON.parse(p.actualAsrFingerprintInput),[o.recognitionGeneration,clip.sha256,'en']));
  const override=repair.appliedOverride,phones=override?.phonemes;need(typeof phones==='string'&&phones.trim()&&hash(phones)===clip.phonemeSha256&&(override.spoken??clip.spoken)===clip.spoken&&(override.speed??1)===(clip.synthesisSpeed??1));
  need(rule.approvedInputs?.some(x=>x.tokens.includes(p.token)&&x.voiceId===clip.voiceId&&x.sourceText===clip.text&&x.spoken===clip.spoken&&x.phonemes===phones));
  need(same(p.input,{phonemes:phones,phonemeSha256:clip.phonemeSha256,spoken:clip.spoken,voiceId:clip.voiceId,synthesisSpeed:clip.synthesisSpeed??1})&&same(p.decision,align(clip,o,rule,phones)));
  const id={method:METHOD,token:p.token,audioSha256:clip.sha256,phonemeSha256:clip.phonemeSha256,inputSha256:clip.inputSha256,ruleId:rule.id,ruleSha256:p.ruleSha256,actualAsrFingerprint:o.fingerprint,recognizedSha256:hash(o.recognized)};
  const acceptance={method:METHOD,proofId:p.id,sourceAudioSha256:clip.sha256,originalIndividualStatus:'review'};
  return p.id===hash(canonical(id))&&same(ad,acceptance)&&same(record,{...o,status:'accepted',acceptance});
 }catch{return false;}
}
