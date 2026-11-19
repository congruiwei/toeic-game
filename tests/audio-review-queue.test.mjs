import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {makeReviewQueue,buildReviewQueue} from '../scripts/build-review-queue.mjs';

function fixture(){
 const keys=[['ja','reading','j/text/0'],['en','reading','r/text/0'],['en','vocab','v/example/0'],['en','grammar','g/sentence/0'],['en','listening','d-d/text/0'],['en','part2','p2/options/0/0'],['en','part1','p1/options/0/0'],['en','part1','priority:sub/options/0/0']];
 const packs=new Map(),audits=new Map(),unresolvedItems=[];
 for(const [language,bank,key] of keys){const src=`./audio/generated/${language}/${language==='en'?'af_heart':'jf_alpha'}/${'a'.repeat(32)}.m4a`,text=`Original ${key}`,spoken=text;
  const id=`${language}:${bank}`;if(!packs.has(id))packs.set(id,{clips:{}});packs.get(id).clips[key]={language,text,spoken,src,sha256:'b'.repeat(64),voiceId:language==='en'?'af_heart':'jf_alpha',inputSha256:'d'.repeat(64),phonemeSha256:'e'.repeat(64)};
  if(!audits.has(id))audits.set(id,{records:{}});audits.get(id).records[key]={key,src,sha256:'b'.repeat(64),voiceId:language==='en'?'af_heart':'jf_alpha',expected:text,spoken,recognized:`Actual ${key}`,recognitionGeneration:{model:'whisper-large-v3-turbo',modelSha256:'e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da'}};
  unresolvedItems.push({token:`${id}:${key}`,text,spoken,src,recognized:`Actual ${key}`,triage:{category:'meaning-tense-or-omission'}});
 }
 return {result:{ok:true,unresolved:keys.length,unresolvedItems,systemFallbackCount:2,systemFallbackItems:[{token:'ja:reading:handled-1'},{token:'ja:vocab:handled-2'}]},ledger:{focus:{namedWords:['en:part1:priority:sub/options/0/0']}},packs,audits,sourceSha256:'c'.repeat(64)};
}
test('playable unresolved rows are complete, priority sorted and fallback counts stay separate',()=>{
 const f=fixture(),q=makeReviewQueue(f);assert.equal(q.entries.length,8);assert.equal(q.systemFallbackCount,2);
 assert.equal(q.entries[0].token,'en:part1:priority:sub/options/0/0');assert.equal(q.entries[0].key,'priority:sub/options/0/0');
 assert.deepEqual(q.entries.map(r=>r.bank),['part1','part1','part2','listening','grammar','vocab','reading','reading']);assert.equal(q.entries.at(-1).language,'ja');
 assert(q.entries.every(r=>r.src&&r.sha256&&!r.systemFallback));assert(q.entries.every(r=>r.recognized.startsWith('Actual ')));assert.equal(q.sourceSha256,f.sourceSha256);
});
function attachFull(f){
 const row=f.result.unresolvedItems.find(r=>r.token.startsWith('en:reading:')),clip=f.packs.get('en:reading').clips['r/text/0'];
 const full={key:'r/text/0',src:clip.src,sha256:clip.sha256,voiceId:clip.voiceId,expected:clip.text,spoken:clip.spoken,recognized:'A different full-model transcript.',segments:[{text:'A different full-model transcript.'}],recognitionMethod:'individual-beam5',singleFileVerification:true,recognitionGeneration:{model:'whisper-large-v3',modelSha256:'69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1',beamSize:5,prompt:null,hotwords:null,conditionOnPreviousText:false,vadFilter:false}};
 const proof={method:'same-media-full-model-crosscheck-v1',token:row.token,sourceAudioSha256:clip.sha256,sourceClip:structuredClone(clip),originalASR:{sha256:clip.sha256,expected:clip.text,spoken:clip.spoken,recognized:row.recognized},fullASR:full};
 f.ledger.records={[row.token]:{crossModelChecks:[proof]}};return {row,clip,proof,full};
}
test('different actual full-model text is kept alongside Turbo only for the current media',()=>{
 const f=fixture(),{row,proof,full}=attachFull(f);let entry=makeReviewQueue(f).entries.find(r=>r.token===row.token);
 assert.equal(entry.recognized,row.recognized);assert.deepEqual(entry.fullRecognition,{model:'whisper-large-v3',recognized:full.recognized});
 full.recognized=row.recognized;full.segments=[{text:full.recognized}];entry=makeReviewQueue(f).entries.find(r=>r.token===row.token);assert.equal(entry.fullRecognition,undefined,'identical raw text is not duplicated');
 proof.sourceAudioSha256='f'.repeat(64);assert.equal(makeReviewQueue(f).entries.find(r=>r.token===row.token).fullRecognition,undefined,'old-media checks must not leak into the new recording');
});
test('a current-media full-model entry fails closed when its source, model or actual transcript is stale',()=>{
 for(const mutate of [x=>x.proof.sourceClip.phonemeSha256='f'.repeat(64),x=>x.full.key='other/key',x=>x.full.sha256='f'.repeat(64),x=>x.proof.originalASR.recognized='another Turbo result',x=>x.full.recognitionGeneration.model='another-model',x=>x.full.recognitionGeneration.prompt='target words',x=>x.full.recognized='',x=>x.full.segments=[]]){
  const f=fixture(),x=attachFull(f);mutate(x);assert.throws(()=>makeReviewQueue(f),undefined,mutate.toString());
 }
});
test('failed coverage, stale bindings, duplicates and a fallback masquerading as a clip fail closed',()=>{
 for(const change of [f=>f.result.ok=false,f=>f.result.unresolved++,f=>f.result.unresolvedItems.push(f.result.unresolvedItems[0]),
  f=>f.result.unresolvedItems[0].text='old text',f=>f.result.unresolvedItems[0].spoken='old spoken',f=>f.result.unresolvedItems[0].recognized='',
  f=>f.packs.get('ja:reading').clips['j/text/0'].sha256='bad',f=>f.packs.get('ja:reading').fallbacks={'j/text/0':{playback:'system'}},
  f=>f.result.systemFallbackCount=3,f=>f.sourceSha256='bad']){
  const f=fixture();change(f);assert.throws(()=>makeReviewQueue(f),undefined,change.toString());
 }
});
test('empty playable queue is valid when all remaining JA items have been handled as fallbacks',()=>{
 const f=fixture();f.result.unresolved=0;f.result.unresolvedItems=[];const q=makeReviewQueue(f);assert.deepEqual(q.entries,[]);assert.equal(q.systemFallbackCount,2);
});
test('write/check mode is deterministic and refuses invalid evidence before touching output',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-queue-'));try{
  const f=fixture();const write=async(file,value)=>{const p=path.join(root,file);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,JSON.stringify(value));};
  const metas=[];for(const [id,pack]of f.packs){const [language,bank]=id.split(':');const src=`./data/audio/${language}/${bank}.json`;metas.push({language,bank,src});await write(src,pack);await write(`data/audio/audit/${language}/${bank}.json`,f.audits.get(id));}
  await write('data/audio/manifest.json',{sourceSha256:f.sourceSha256,packs:metas});await write('data/audio/quality-review.json',f.ledger);
  const validate=async()=>f.result,q=await buildReviewQueue({root,validate});assert.deepEqual(q,makeReviewQueue(f));
  await buildReviewQueue({root,validate,check:true});const target=path.join(root,'data/audio/review-queue.json'),before=await fs.readFile(target,'utf8');
  f.result.ok=false;f.result.errors=['incomplete'];await assert.rejects(buildReviewQueue({root,validate}),/incomplete/);assert.equal(await fs.readFile(target,'utf8'),before);
  f.result.ok=true;f.result.unresolvedItems[0].recognized='A new actual transcript';f.audits.get('ja:reading').records['j/text/0'].recognized='A new actual transcript';await write('data/audio/audit/ja/reading.json',f.audits.get('ja:reading'));await assert.rejects(buildReviewQueue({root,validate,check:true}),/differs/);assert.equal(await fs.readFile(target,'utf8'),before);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('current primary full ASR is labeled accurately and does not inherit old Turbo checks',()=>{
 const f=fixture(),{row,proof}=attachFull(f),a=f.audits.get('en:reading').records['r/text/0'];
 a.recognitionGeneration={model:'whisper-large-v3',modelSha256:'69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1'};
 proof.sourceAudioSha256='f'.repeat(64);const entry=makeReviewQueue(f).entries.find(x=>x.token===row.token);
 assert.equal(entry.recognitionModel,'whisper-large-v3');assert.equal(entry.fullRecognition,undefined);assert.equal(entry.recognized,a.recognized);
 a.sha256='f'.repeat(64);assert.throws(()=>makeReviewQueue(f),/Current ASR binding/);
});
test('a newly recorded matched item stays in the exact-SHA human listening queue',()=>{
 const f=fixture(),row=f.result.unresolvedItems[0];row.humanReview={status:'required',reason:'新录音尚未复听'};row.asrStatus='matched';f.audits.get('ja:reading').records['j/text/0'].status='matched';
 const out=makeReviewQueue(f).entries.find(x=>x.token===row.token);assert.equal(out.reviewStatus,'pending-human-review');assert.equal(out.asrStatus,'matched');assert.equal(out.reason,'新录音尚未复听');assert.equal(out.sha256,f.packs.get('ja:reading').clips['j/text/0'].sha256);
});
test('morpheme review explains the bound letter spelling without changing its ASR verdict',()=>{
 const f=fixture(),before=makeReviewQueue(f),row=f.result.unresolvedItems.find(r=>r.token==='en:vocab:v/example/0');
 const key='morph-pre-re/forms/0',pack=f.packs.get('en:vocab'),audit=f.audits.get('en:vocab');
 const clip=pack.clips['v/example/0'],actual=audit.records['v/example/0'];delete pack.clips['v/example/0'];delete audit.records['v/example/0'];
 Object.assign(row,{token:`en:vocab:${key}`,text:'re-',spoken:'R. E.',recognized:'RE',asrStatus:'review'});
 Object.assign(clip,{text:row.text,spoken:row.spoken});Object.assign(actual,{key,expected:row.text,spoken:row.spoken,recognized:row.recognized,status:'review'});
 pack.clips[key]=clip;audit.records[key]=actual;
 const output=makeReviewQueue(f),entry=output.entries.find(r=>r.token===row.token);
 assert.match(entry.reason,/字母拼写「R\. E\.」/);assert.match(entry.reason,/不是词缀在单词中的读音/);
 assert.equal(entry.text,'re-');assert.equal(entry.recognized,'RE');assert.equal(entry.asrStatus,'review');assert.equal(entry.sha256,clip.sha256);
 assert.deepEqual(output.entries.filter(r=>r.token!==row.token),before.entries.filter(r=>r.token!=='en:vocab:v/example/0'));
});
