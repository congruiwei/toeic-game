import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export const hash=body=>createHash('sha256').update(body).digest('hex');
const root=new URL('../',import.meta.url);
const audition=JSON.parse(await readFile(new URL('data/audio-audition-manifest.json',root),'utf8'));
const sample=voice=>Object.values(audition.clips[voice])[0].src;
export const goodBytes=await readFile(new URL(sample('jf_alpha'),root));
export const oldBytes=await readFile(new URL(sample('af_heart'),root));
const goodHash=hash(goodBytes),oldHash=hash(oldBytes);
export const badKey='read-demo/documents/0/text/1',otherKey='read-other/documents/0/text/0';
export const firstKey='read-demo/documents/0/text/0',lastKey='read-demo/documents/0/text/2';
export const sourceSha256='1'.repeat(64),text='返金は明日です。';
export const goodSrc='./audio/generated/ja/jf_alpha/'+goodHash.slice(0,32)+'.m4a';
export const oldSrc='./audio/generated/ja/jf_alpha/'+oldHash.slice(0,32)+'.m4a';
const clip=(text,old=false)=>({text,language:'ja',voiceId:'jf_alpha',src:old?oldSrc:goodSrc,duration:1,bytes:(old?oldBytes:goodBytes).length,sha256:old?oldHash:goodHash});
export function fixture(revision=2){
 const fallbacks=revision===1?{}:{[badKey]:{playback:'system',language:'ja',text,voiceId:'jf_alpha',reason:'unresolved-after-strong-asr-retry',auditedSha256:oldHash}};
 const reading={version:1,bank:'reading',language:'ja',sourceSha256,complete:revision===1,requiredComplete:revision===1,requiredPlaybackComplete:true,recordedAuditComplete:true,fallbackCount:Object.keys(fallbacks).length,requiredFallbackCount:Object.keys(fallbacks).length,clips:{[firstKey]:clip('受付は午前九時です。'),[otherKey]:clip(text),[lastKey]:clip('領収書をお持ちください。'),...(revision===1?{[badKey]:clip(text,true)}:{})},fallbacks};
 const packs=['part1','part2','listening','vocab','grammar','reading','methods','terms'].map(bank=>bank==='reading'?reading:{version:1,bank,language:'ja',sourceSha256,complete:true,requiredComplete:true,requiredPlaybackComplete:true,fallbackCount:0,requiredFallbackCount:0,clips:{}});
 const index={version:1,sourceSha256,complete:revision===1,requiredPlaybackComplete:true,packs:packs.map(p=>({bank:p.bank,language:p.language,src:`./data/audio/ja/${p.bank}.json`,count:Object.keys(p.clips).length,fallbackCount:p.fallbackCount,requiredFallbackCount:p.requiredFallbackCount,requiredPlaybackComplete:true,complete:p.complete,requiredComplete:p.requiredComplete,bytes:Buffer.byteLength(JSON.stringify(p)),sha256:hash(JSON.stringify(p)),audioBytes:Object.keys(p.clips).length?goodBytes.length+(revision===1?oldBytes.length:0):0}))};
 return {reading,packs,index};
}
