import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {validateSystemFallback,validateAudio,pendingInputCorrections,STRONG_FALLBACK_MODEL,STRONG_FALLBACK_SHA256} from '../scripts/validate-bank-audio.mjs';
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const key='read-test/documents/0/text/0',id='ja:reading:'+key,goodKey='read-test/documents/0/text/1';
const unit={language:'ja',bank:'reading',key,text:'領収書です。',voiceId:'jf_alpha',required:true};
const generation={model:STRONG_FALLBACK_MODEL,modelSha256:STRONG_FALLBACK_SHA256,device:'cpu',computeType:'int8',beamSize:5,conditionOnPreviousText:false,vadFilter:false,prompt:null};
const actual=c=>({sha256:c.sha256,expected:c.text,spoken:c.spoken,recognized:'別の認識です。',status:c.asrStatus,recognitionMethod:'individual-beam5',singleFileVerification:true,recognitionGeneration:structuredClone(generation)});
function version(char){
 const clip={...unit,spoken:unit.text,sha256:char.repeat(64),inputSha256:sha(char+'input'),phonemeSha256:sha('reviewed phones'),src:'./audio/generated/ja/jf_alpha/'+char.repeat(32)+'.m4a',bytes:100,duration:1.234,decodedPeak:.5,asrStatus:'review'};
 return {clip,asr:actual(clip),archive:{published:false,copyVerified:true,sha256:clip.sha256,bytes:clip.bytes}};
}
function fixture(){
 const original=version('a'),candidate=version('b'),fallback={playback:'system',language:'ja',text:unit.text,voiceId:unit.voiceId,reason:'unresolved-after-strong-asr-retry',auditedSha256:candidate.clip.sha256};
 const row={token:id,repair:{method:'reviewed-pace-change',original,candidate,disposition:'system-fallback',complete:true,baseOverride:{phonemes:'reviewed phones'},appliedOverride:{phonemes:'reviewed phones',speed:.9}}};
 return {original,candidate,fallback,row,record:structuredClone(candidate.asr)};
}
test('strict fallback declaration binds both actual versions and exact reviewed strong model',()=>{
 const f=fixture();assert.deepEqual(validateSystemFallback(unit,f.fallback,f.row,f.record),[]);
 const changes=[f=>f.fallback.language='en',f=>f.fallback.src=f.candidate.clip.src,f=>f.fallback.auditedSha256='c'.repeat(64),f=>f.row.repair.complete=false,f=>f.row.repair.disposition='recorded-review',f=>f.row.token='ja:reading:wrong',f=>f.candidate.clip.sha256=f.original.clip.sha256,
  f=>f.candidate.clip.text='古い原文',f=>f.candidate.clip.voiceId='af_heart',f=>f.candidate.clip.required=false,f=>delete f.original.asr.recognitionGeneration,f=>f.candidate.asr.recognized='',f=>f.candidate.asr.sha256='f'.repeat(64),f=>f.candidate.asr.status='matched',f=>f.candidate.asr.recognitionGeneration.model='whisper-medium',f=>f.candidate.asr.recognitionGeneration.modelSha256='f'.repeat(64),f=>f.candidate.asr.recognitionGeneration.prompt=unit.text,f=>f.candidate.asr.recognitionMethod='batch-beam1',f=>f.record.sha256=f.original.clip.sha256,f=>f.record.recognized='違う最新の認識'];
 for(const change of changes){const x=fixture();change(x);assert(validateSystemFallback(unit,x.fallback,x.row,x.record).length,change.toString());}
 assert(validateSystemFallback({...unit,required:false},f.fallback,f.row,f.record).length);
});
test('known corrections may route to validated system evidence without hiding stale target or retry evidence',()=>{
 const f=fixture(),previous=version('d');
 const retry={token:id,kind:'confirmed-input-correction',complete:true,selectedSha256:f.candidate.clip.sha256,synthesisAttemptCount:3,asrAttemptCount:3,initial:previous,priorRetries:[f.original],retry:f.candidate};
 const review={confirmedInputCorrections:[{token:id,sourceBinding:{text:unit.text,spoken:unit.text,voiceId:unit.voiceId,language:'ja'},appliedOverride:{phonemes:'reviewed phones'},delivery:'regenerated-with-both-ASR-versions'}]};
 const packs=new Map([['ja:reading',{pack:{clips:{},fallbacks:{[key]:f.fallback}},audit:{records:{[key]:f.record}}}]]),quality={records:{[id]:f.row}},units=new Map([[id,unit]]);
 assert.deepEqual(pendingInputCorrections(review,packs,{records:{[id]:retry}},quality,units),[]);
 f.candidate.clip.phonemeSha256=sha('old wrong phones');assert.match(pendingInputCorrections(review,packs,{records:{[id]:retry}},quality,units)[0].reason,/target input/);f.candidate.clip.phonemeSha256=sha('reviewed phones');
 retry.initial.asr.recognized='';assert.match(pendingInputCorrections(review,packs,{records:{[id]:retry}},quality,units)[0].reason,/before\/after/);
});
const atom=(name,data)=>{const b=Buffer.alloc(8+data.length);b.writeUInt32BE(b.length);b.write(name,4);data.copy(b,8);return b;};
function media(){const mv=Buffer.alloc(20);mv.writeUInt32BE(1000,12);mv.writeUInt32BE(1234,16);const sample=Buffer.alloc(28);sample.writeUInt16BE(1,16);sample.writeUInt32BE(24000*65536,24);return Buffer.concat([atom('ftyp',Buffer.from('M4A ')),atom('moov',Buffer.concat([atom('mvhd',mv),atom('stsd',Buffer.concat([Buffer.alloc(8),atom('mp4a',sample)]))])),atom('mdat',Buffer.from([1]))]);}
async function fixtureRoot(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'audio-fallback-validator-')),f=fixture(),bytes=media(),digest=sha(bytes);
 const goodUnit={...unit,key:goodKey,text:'請求書です。'},good={...goodUnit,spoken:goodUnit.text,src:'./audio/generated/ja/jf_alpha/'+digest.slice(0,32)+'.m4a',sha256:digest,inputSha256:'e'.repeat(64),bytes:bytes.length,duration:1.234,decodedPeak:.5,asrStatus:'matched'};
 const source={version:1,units:[unit,goodUnit]},sourceBody=JSON.stringify(source),pack={version:1,bank:'reading',language:'ja',sourceSha256:sha(sourceBody),complete:false,requiredComplete:false,requiredPlaybackComplete:true,recordedAuditComplete:true,fallbackCount:1,requiredFallbackCount:1,clips:{[goodKey]:good},fallbacks:{[key]:f.fallback}};
 const packBody=JSON.stringify(pack),index={version:1,sourceSha256:sha(sourceBody),complete:false,requiredComplete:false,requiredAuditComplete:false,requiredPlaybackComplete:true,recordedAuditComplete:true,packs:[{bank:'reading',language:'ja',src:'./data/audio/ja/reading.json',count:1,bytes:Buffer.byteLength(packBody),sha256:sha(packBody),fallbackCount:1,requiredFallbackCount:1,requiredPlaybackComplete:true,recordedAuditComplete:true}],totals:{requiredExpected:2,requiredCount:1,requiredAudited:1,systemFallbackCount:1,requiredFallbackCount:1,files:1,audioBytes:bytes.length}};
 async function write(name,value){const file=path.join(root,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));}
 await write('data/audio/source.json',sourceBody);await write('data/audio/manifest.json',index);await write('data/audio/ja/reading.json',packBody);await write('data/audio/audit/ja/reading.json',{records:{[key]:f.record,[goodKey]:actual(good)}});await write('data/audio/quality-review.json',{version:1,records:{[id]:f.row}});await write(good.src,bytes);
 for(const bank of ['part1','part2','listening','vocab','reading','grammar','methods']){await write('data/'+bank+'.json',[]);await write('data/i18n/ja/'+bank+'.json',{entries:bank==='reading'?{[key]:unit.text,[goodKey]:goodUnit.text}:{}});}
 await write('data/i18n/ja/terms.json',{entries:{}});
 return {root,f,index,pack,write,good,source};
}
test('full validator accepts archived fallback evidence and separates recorded coverage from system coverage',async()=>{
 const f=await fixtureRoot();try{
  const r=await validateAudio({root:f.root});assert.equal(r.ok,true,r.errors.join('\n'));assert.equal(r.generated,1);assert.equal(r.audited,1);assert.equal(r.systemFallbackCount,1);assert.equal(r.unresolved,0);assert.equal(r.systemFallbackItems[0].systemVoiceAudited,false);assert.equal(r.historicalFiles,2);
  const strict=await validateAudio({root:f.root,strictQuality:true});assert.equal(strict.ok,true,strict.errors.join('\n'));
 }finally{await fs.rm(f.root,{recursive:true,force:true});}
});
test('full validator rejects counter lies, missing repair evidence and clip/fallback overlap',async()=>{
 const f=await fixtureRoot();try{
  f.index.requiredComplete=true;await f.write('data/audio/manifest.json',f.index);assert((await validateAudio({root:f.root})).errors.some(e=>e.includes('requiredComplete')));f.index.requiredComplete=false;
  f.index.totals.requiredAudited=2;await f.write('data/audio/manifest.json',f.index);assert((await validateAudio({root:f.root})).errors.some(e=>e.includes('ASR count')));f.index.totals.requiredAudited=1;
  f.index.packs[0].fallbackCount=0;await f.write('data/audio/manifest.json',f.index);assert((await validateAudio({root:f.root})).errors.some(e=>e.includes('fallbackCount')));f.index.packs[0].fallbackCount=1;
  f.index.requiredPlaybackComplete=false;await f.write('data/audio/manifest.json',f.index);assert((await validateAudio({root:f.root})).errors.some(e=>e.includes('playback')));f.index.requiredPlaybackComplete=true;await f.write('data/audio/manifest.json',f.index);
  const savedPack=structuredClone(f.pack);f.pack.clips[key]={...f.good,text:unit.text,spoken:unit.text,key};
  let body=JSON.stringify(f.pack);f.index.packs[0].count=2;f.index.packs[0].bytes=Buffer.byteLength(body);f.index.packs[0].sha256=sha(body);await f.write('data/audio/ja/reading.json',body);await f.write('data/audio/manifest.json',f.index);assert((await validateAudio({root:f.root})).errors.some(e=>e.includes('overlap')));
  body=JSON.stringify(savedPack);f.index.packs[0].count=1;f.index.packs[0].bytes=Buffer.byteLength(body);f.index.packs[0].sha256=sha(body);await f.write('data/audio/ja/reading.json',body);await f.write('data/audio/manifest.json',f.index);
  delete f.f.row.repair;await f.write('data/audio/quality-review.json',{records:{[id]:f.f.row}});assert((await validateAudio({root:f.root})).errors.some(e=>e.includes('fallback repair')));
 }finally{await fs.rm(f.root,{recursive:true,force:true});}
});

test('full legacy packs without fallback fields keep the original coverage contract',async()=>{
 const f=await fixtureRoot();try{
  f.source.units=f.source.units.filter(u=>u.key===goodKey);const sourceBody=JSON.stringify(f.source);await f.write('data/audio/source.json',sourceBody);await f.write('data/i18n/ja/reading.json',{entries:{[goodKey]:f.good.text}});
  delete f.pack.fallbacks;f.pack.sourceSha256=sha(sourceBody);f.pack.complete=true;f.pack.requiredComplete=true;
  for(const value of [f.pack,f.index,f.index.packs[0]])for(const name of ['requiredPlaybackComplete','recordedAuditComplete','fallbackCount','requiredFallbackCount'])delete value[name];
  delete f.index.totals.systemFallbackCount;delete f.index.totals.requiredFallbackCount;f.index.totals.requiredExpected=1;
  f.index.sourceSha256=sha(sourceBody);f.index.requiredComplete=true;f.index.requiredAuditComplete=true;
  const body=JSON.stringify(f.pack);f.index.packs[0].bytes=Buffer.byteLength(body);f.index.packs[0].sha256=sha(body);await f.write('data/audio/ja/reading.json',body);await f.write('data/audio/manifest.json',f.index);
  const r=await validateAudio({root:f.root});assert.equal(r.ok,true,r.errors.join('\n'));assert.equal(r.systemFallbackCount,0);
 }finally{await fs.rm(f.root,{recursive:true,force:true});}
});
