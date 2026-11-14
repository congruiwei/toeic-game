import test from 'node:test';
import assert from 'node:assert/strict';
import {beginScreen,selfAssess,markSpotCheck,screenedQueue,validateScreen} from '../js/screening.js';
const bank=Array.from({length:50},(_,i)=>({id:'v-'+i,word:'unit '+Math.floor(i/2),level:i<24?500:400}));
test('20 unique headwords, ordered by difficulty; claims never count as answers and verified cards stay out of queue',()=>{
 const s={seen:{'v-1':1},words:{'v-2':{tries:1}}},r=beginScreen(s,bank,()=>0);
 assert.equal(r.ids.length,20);assert(!r.ids.includes('v-2'));assert(!r.ids.includes('v-1'));
 const words=r.ids.map(id=>bank.find(w=>w.id===id));
 assert.equal(new Set(words.map(w=>w.word)).size,20);
 assert.deepEqual(words.map(w=>w.level),words.map(w=>w.level).sort());
 for(let i=0;i<20;i++) {const id=r.ids[i];assert(selfAssess(s,id,i>=2));if(r.pending)assert(markSpotCheck(s,id,r.checks!==0));}
 assert.equal(r.checks,6);assert.equal(r.correct,5);assert.equal(r.known,17);assert.equal(r.unknown,3);
 assert.equal(screenedQueue(s).length,15);assert.equal(Object.keys(s.seen).length,1);validateScreen(s);
 assert(beginScreen(s,bank,()=>0).ids.every(id=>!r.ids.includes(id)));
});
test('pending spot check resumes exactly and a stale gesture cannot double-count',()=>{
 const s={seen:{},words:{}}, r=beginScreen(s,bank,()=>0);
 for(let i=0;i<3;i++)selfAssess(s,r.ids[r.index],true);
 const copy=JSON.parse(JSON.stringify(s));validateScreen(copy);
 assert.equal(beginScreen(copy,bank).pending,true);
 assert(!selfAssess(copy,r.ids[0],false));assert(markSpotCheck(copy,r.ids[2],false));
 assert(!markSpotCheck(copy,r.ids[2],true));
 assert(screenedQueue(copy).includes(r.ids[2]));
});
