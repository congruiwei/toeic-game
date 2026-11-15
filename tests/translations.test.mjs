import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {questionUnits} from '../js/translations.js';

test('review translations include the current question and its material, without neighbouring answers',()=>{
 const set=JSON.parse(fs.readFileSync(new URL('../data/listening.json',import.meta.url)))[0];
 const q={...set.questions[0],set};const units=questionUnits({id:q.id,mode:'dialogue'},q);
 assert(units.some(u=>u.key.includes('/turns/')));assert(units.some(u=>u.key.includes('/prompt/')));
 assert(units.some(u=>u.key.includes('/options/')));assert(!units.some(u=>u.id===set.questions[1].id));
 const dict=questionUnits({id:set.dictation.id,mode:'dictation'},{...set.dictation,set});
 assert.equal(dict.length,1);assert.equal(dict[0].text,set.dictation.text);
});

test('downloaded translations survive a cold module reload offline, including first visit without a worker',async()=>{
 const oldFetch=globalThis.fetch,oldCaches=globalThis.caches,stored=new Map();let calls=0;
 globalThis.caches={open:async()=>({put:async(url,r)=>stored.set(url,r.clone()),match:async url=>stored.get(url)?.clone()})};
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({version:1,entries:{'test/key':'译文'}}));};
 try {
  const online=await import('../js/translations.js?online');await online.loadLanguage('part1','zh');
  await online.loadLanguage('part1','zh');assert.equal(calls,1,'in-memory requests coalesce');
  globalThis.fetch=async()=>{throw Error('offline');};
  const offline=await import('../js/translations.js?offline');await offline.loadLanguage('part1','zh');
  assert.equal(offline.translated('part1','test/key','zh'),'译文');
  await assert.rejects(()=>offline.loadLanguage('part2','zh'),/尚未下载/);
 } finally {globalThis.fetch=oldFetch;if(oldCaches===undefined)delete globalThis.caches;else globalThis.caches=oldCaches;}
});
