import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadBank,catalog} from '../../js/bank.js';
import {loadMethods,relevantMethods,newMethod,methodExample} from '../../js/methods.js';
import {fresh,decode} from '../../js/state.js';
globalThis.fetch=async url=>({ok:true,json:async()=>JSON.parse(await readFile(new URL('../../'+url,import.meta.url),'utf8'))});
await loadMethods();await loadBank(['part1','part2','grammar','listening','reading']);
const data=await (await fetch('./data/methods.json')).json();
for(const card of data){
  const pool=[...catalog.values()].filter(({ref,data})=>relevantMethods(ref,data).includes(card.id));
  assert(pool.length>0,card.id);
  const s=fresh(),r=methodExample(card.id,catalog,s);
  assert(pool.some(o=>o.ref.id===r.id),card.id);
}
const r=catalog.get('p2-001');let s=fresh();s.session={selected:null};
assert.equal(newMethod(s,r.ref,r.data).id,'first-word');s.methodsSeen.push('first-word');assert(!newMethod(s,r.ref,r.data));
s.methodsSeen=[];s.settings.methodHints=false;assert(!newMethod(s,r.ref,r.data));s.settings.methodHints=true;s.session.mode='diagnostic';assert(!newMethod(s,r.ref,r.data));
s=fresh();delete s.methodsSeen;delete s.settings.methodHints;
const revived=decode(JSON.stringify(s));assert.deepEqual(revived.methodsSeen,[]);assert.equal(revived.settings.methodHints,true);
console.log(data.length,'method cards all resolve to a real matching question; legacy saves, once-only, disabled and diagnostic passed.');
// Independent answer-shape checks; the implementation's catalogue matcher is deliberately not reused here.
const sourceIds = new Set(data.map(c=>c.id));
for(const id of ['photo','photo-state','first-word','indirect','sounds','echo','preview','keywords','graphic','intent','p5-choice','word-form','tense','link','lexis','p6-insert','p6-context','p7-not','p7-syn','p7-position','p7-multi','p7-detail'])assert(sourceIds.has(id));
const crossProof={
  'read-plants-01':['Four standard pots','$8'],'read-staging-01':['allocates','delivered'],'read-proof-01':['printer','terms'],'read-proof-02':['policy','email'],
  'read-oven-02':['model','stand'],'read-seats-01':['deposit','fee'],'read-seats-02':['request','days'],'read-hours-01':['equipment','writing'],'read-hours-02':['travel','time'],
  'read-rent-credit-01':['record','rule'],'read-rent-credit-02':['two','hours'],'read-film-vote-01':['email','exception'],'read-film-vote-02':['start','minutes'],
  'read-paper-grades-01':['color','weight'],'read-paper-grades-02':['sheets','packs'],'read-donor-match-01':['statement','window'],'read-donor-match-02':['receipts','cap']
};
const examples={
 photo: ref=>ref.mode==='part1', 'photo-state':(_,q)=>/(?:is|are) being |(?:has|have) been /i.test(q.answer),
 'first-word':(_,q)=>q.type==='first',indirect:(r,q)=>q.indirect===true||new Set(['p2-020','p2-024','p2-026','p2-027','p2-028','p2-030','p2-031','p2-032','p2-034','p2-035','p2-036','p2-038','p2-039','p2-040','p2-042','p2-043','p2-045','p2-046','p2-047','p2-048','p2-050','p2-051']).has(r.id),
 sounds:(_,q)=>q.options.some(o=>/curry|project starts|waved to/i.test(o)),
 echo:(_,q)=>{const terms=new Set(q.audio.toLowerCase().match(/[a-z]{4,}/g));return q.options.some(o=>o!==q.answer&&(o.toLowerCase().match(/[a-z]{4,}/g)||[]).some(k=>terms.has(k)))},
 preview:r=>r.mode==='dialogue',keywords:r=>r.mode==='dialogue',graphic:(_,q)=>q.set?.graphic&&/graphic/i.test(q.prompt),intent:(r,q)=>q.type==='intent'||r.id==='p3-g04-q2',
 'p5-choice':r=>r.mode==='grammar','word-form':(_,q)=>['gram-word-form','gram-modifiers'].includes(q.topic?.id),tense:(_,q)=>['gram-time','gram-sequence'].includes(q.topic?.id),link:(_,q)=>['gram-preposition','gram-conjunction','gram-linkers'].includes(q.topic?.id),lexis:(_,q)=>q.topic?.id==='gram-lexis',
 'p6-insert':(_,q)=>q.set.part===6&&q.kind==='sentence','p6-context':(_,q)=>q.set.part===6&&q.kind!=='sentence',
 'p7-not':(_,q)=>q.kind==='negative','p7-syn':(_,q)=>q.kind==='vocabulary','p7-position':(_,q)=>q.kind==='insertion',
 'p7-multi':(r,q)=>q.set.documents.length>=2&&Object.hasOwn(crossProof,r.id),'p7-detail':(_,q)=>q.set.part===7&&!['negative','vocabulary','insertion'].includes(q.kind)
};
for(const [id,pass] of Object.entries(examples)){
  for(const {ref,data:q} of catalog.values()){
    if(!relevantMethods(ref,q).includes(id)||(id==='first-word'&&q.type!=='first'))continue;
    assert(pass(ref,q),id+' misclassified '+ref.id);
  }
}
for(const mode of ['diagnosis','diagnostic','exam','screen']){
 const item=catalog.get('p2-001'),s=fresh();s.session={mode,selected:null};
 assert.equal(newMethod(s,item.ref,item.data),undefined,mode);
}
