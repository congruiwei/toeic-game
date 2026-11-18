import {createHash} from 'node:crypto';
const VOICES=new Set(['af_heart','am_puck','af_bella']);
const hash=x=>createHash('sha256').update(x).digest('hex');
const canon=x=>Array.isArray(x)?`[${x.map(canon).join(',')}]`:x&&typeof x==='object'?`{${Object.keys(x).sort().map(k=>`${JSON.stringify(k)}:${canon(x[k])}`).join(',')}}`:JSON.stringify(x);
const same=(a,b)=>canon(a)===canon(b);
export const sourceVoice=c=>c&&Object.hasOwn(c,'sourceVoiceId')?c.sourceVoiceId:c?.voiceId;
export const eligibleVoiceOverride=u=>Boolean(u?.language==='en'&&u.bank==='vocab'&&u.key?.endsWith('/meaning')&&(u.kind??'meaning')==='meaning'&&(Object.hasOwn(u,'required')?u.required:true)&&!u.speaker&&/^[A-Za-z]+(?:[-'][A-Za-z]+)*$/.test(u.text??'')&&VOICES.has(u.voiceId));
export function selectedVoice(u,o={}){
 o??={};const v=Object.hasOwn(o,'voiceId')?o.voiceId:u.voiceId;
 if(Object.hasOwn(o,'voiceId')&&(!eligibleVoiceOverride(u)||!VOICES.has(v)||typeof o.phonemes!=='string'||!o.phonemes.trim()))throw Error('Unapproved voice override');
 return v;
}
export function voiceMatchesSource(u,c){
 if(!c||['text','language'].some(k=>u[k]!==c[k])||sourceVoice(c)!==u.voiceId)return false;
 return c.voiceId===u.voiceId||eligibleVoiceOverride(u)&&VOICES.has(c.voiceId)&&c.sourceVoiceId===u.voiceId;
}
export function voiceMatchesSelection(u,c,o){try{return voiceMatchesSource(u,c)&&c.voiceId===selectedVoice(u,o);}catch{return false;}}
export function validEntryVoices(e){
 const versions=[e?.initial,...(e?.priorRetries??[]),e?.retry],first=versions[0]?.clip;
 if(!first)return false;
 const u={text:first.text,language:first.language,voiceId:sourceVoice(first),bank:e.bank,key:e.key,kind:'meaning',required:first.required??true};
 return voiceMatchesSelection(u,first,e.baseOverride)&&versions.slice(1).every(v=>voiceMatchesSelection(u,v?.clip,e.retryOverride));
}
export function validateVoiceSelection(u,c,o={},generation){
 const errors=[];o??={};
 if(!voiceMatchesSelection(u,c,o))return ['Recording/source voice selection mismatch'];
 if(c.voiceId===u.voiceId){if(c.voiceOverrideInput!==undefined)errors.push('Unexpected alternate voice recipe');return errors;}
 try{
  if(!generation||typeof c.voiceOverrideInput!=='string'||hash(c.voiceOverrideInput)!==c.inputSha256)throw Error();
  const parsed=JSON.parse(c.voiceOverrideInput),synthesis=Object.fromEntries(['recipe','modelSha256','voicesSha256','packages'].map(k=>[k,generation[k]]));
  const speed=Number(o.speed??1),expected=[synthesis,generation.encoding,c.voiceId,o.spoken??u.text,o.phonemes];
  if(speed!==1)expected.push({speed});
  if(!Number.isFinite(speed)||speed<.75||speed>1.2||!same(parsed,expected)||c.spoken!==(o.spoken??u.text)||c.phonemeSha256!==hash(o.phonemes)||(c.synthesisSpeed??1)!==speed)throw Error();
 }catch{errors.push('Alternate voice lacks its exact synthesis recipe');}
 return errors;
}
const STRONG_MODELS={'whisper-large-v3-turbo':'e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da','whisper-large-v3':'69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1'};
export function validateVoiceRecognition(u,c,r,repair){
 if(c.voiceId===u.voiceId)return [];
 const model=repair?.proposal?.asrModel??'whisper-large-v3-turbo';
 const bound=x=>Object.fromEntries(Object.entries(x??{}).filter(([key])=>key!=='asrStatus'));
 return repair?.complete===true&&repair.proposal?.token===`${u.language}:${u.bank}:${u.key}`&&repair.proposal.sourceText===u.text&&
  r?.comparison?.provenance?.articlePolicyEnabled===false&&Object.hasOwn(STRONG_MODELS,model)&&r?.recognitionGeneration?.model===model&&r.recognitionGeneration.modelSha256===STRONG_MODELS[model]&&
  same(bound(repair.candidate?.clip),bound(c))&&same(repair.candidate?.asr,r)?[]:['Alternate voice lacks the planned actual strong recognition and repair snapshot'];
}
