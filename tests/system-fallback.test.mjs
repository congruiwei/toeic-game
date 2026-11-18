import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,goodBytes,oldBytes,goodSrc,oldSrc,badKey,otherKey,firstKey,lastKey,text} from './system-fallback-fixtures.mjs';
import * as a from '../js/recorded-audio.js';
import * as d from '../js/audio-downloads.js';
const data=fixture(),storage=new Map(),requests=[];
const cache={async match(key){return storage.get(String(key))?.clone();},async put(key,response){storage.set(String(key),response.clone());},async delete(key){return storage.delete(String(key));},async keys(){return [...storage.keys()].map(url=>new Request(url));}};
globalThis.caches={open:async()=>cache,delete:async()=>{storage.clear();return true;}};
globalThis.fetch=async url=>{requests.push(String(url));if(String(url).endsWith('manifest.json'))return Response.json(data.index);if(String(url).includes('/data/audio/'))return Response.json(data.packs.find(p=>String(url).endsWith('/'+p.bank+'.json')));return new Response(goodBytes,{headers:{'content-type':'audio/mp4'}});};
test('fallback schema is optional, strictly Japanese and cannot overlap clips',()=>{
 assert(a.validAudioPack(fixture(1).reading,'reading','ja'));assert(a.validAudioPack(data.reading,'reading','ja'));assert(a.validAudioIndex(data.index));
 const mutate=fn=>{const p=structuredClone(data.reading);fn(p);return a.validAudioPack(p,'reading','ja');};
 for(const [key,value]of [['language','en'],['playback','recorded'],['auditedSha256','bad'],['text',' '],['reason','unknown'],['src',oldSrc]])assert.equal(mutate(p=>p.fallbacks[badKey][key]=value),false,key);
 assert.equal(mutate(p=>p.clips[badKey]=p.clips[otherKey]),false);
 assert.equal(mutate(p=>p.fallbackCount=2),false);
 const en=structuredClone(data.reading);en.language='en';assert.equal(a.validAudioPack(en,'reading','en'),false);
 const index=structuredClone(data.index);index.packs[0].fallbackCount=-1;assert.equal(a.validAudioIndex(index),false);
});
test('explicit fallback keys never borrow an identical valid clip, head, or cached media',async()=>{
 await a.loadAudioPack('reading','ja');await cache.put(a.audioURL(oldSrc),new Response(oldBytes));
 assert.equal(a.getAudioClip(badKey,{language:'ja'}),null);assert.equal(a.getAudioFallback(badKey,{language:'ja'}).playback,'system');
 const forced=a.resolveAudioPieces([{text,key:badKey,bank:'reading'}],{language:'ja'});assert.equal(forced[0].src,undefined);assert.equal(forced[0].playback,'system');assert.equal(forced[0].key,badKey);
 const correct=a.resolveAudioPieces([{text,key:otherKey,bank:'reading'}],{language:'ja'});assert.equal(correct[0].src,goodSrc);
 const changed=a.resolveAudioPieces([{text:'表示テキストが更新されました。',key:badKey,bank:'reading'}],{language:'ja'});assert.equal(changed[0].src,undefined);assert.equal(changed[0].text,'表示テキストが更新されました。');
 const keyless=a.resolveAudioPieces([{text}],{language:'ja',bank:'reading',seed:'read-demo'});assert.equal(keyless[0].playback,'system');
 assert.equal(requests.filter(url=>url.includes('/audio/generated/')).length,0);
});
test('keyed and keyless multi-sentence groups preserve a recorded/system/recorded sequence',()=>{
 const whole='受付は午前九時です。 返金は明日です。 領収書をお持ちください。';
 for(const turn of [{text:whole,keys:[firstKey,badKey,lastKey]},{text:whole}]){
  const p=a.resolveAudioPieces([turn],{language:'ja',bank:'reading',seed:'read-demo'});
  assert.deepEqual(p.map(item=>item.key),[firstKey,badKey,lastKey]);assert.deepEqual(p.map(item=>Boolean(item.src)),[true,false,true]);
 }
});
test('downloads and exact-key precache only fetch declared recordings, never retired system sources',async()=>{
 const before=requests.length,events=[];const result=await d.downloadAudioPack('reading','ja',{onProgress:p=>events.push(p)});
 assert.equal(result.total,1);assert.equal(result.systemFallbacks,1);assert.equal(events.at(-1).status,'complete');
 assert.deepEqual(requests.slice(before).filter(url=>url.includes('/audio/generated/')),[a.audioURL(goodSrc)]);
 const specific=await d.precacheAudio([{key:badKey,language:'ja'},{key:firstKey,language:'ja'}]);assert.equal(specific.total,1);assert.equal(specific.systemFallbacks,1);
 assert(storage.has(a.audioURL(oldSrc)),'old bytes remain inert until a deliberate cache deletion');
});
