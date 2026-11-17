import test from 'node:test';
import assert from 'node:assert/strict';
import {advance,validCard} from '../js/review-scheduler.js';
import {migratePersonalVocab,collectPersonalWord,syncPersonalVocab,personalVocabStats,beginPersonalVocab,
  flipPersonalWord,ratePersonalWord,removePersonalWord,personalVocabView} from '../js/personal-vocab.js';
const NOW=1800000000000;
const state=()=>({settings:{retention:.9},words:{},errors:{},xp:79,stats:{vocab:9},history:[{ok:true}]});
const lemma=(n=0)=>({id:`lex-term-${n}`,word:`term ${n}`,pos:'n.',zh:`释义${n}`,ja:`意味${n}`});
const options={ref:{mode:'grammar',id:'gram-test'},option:'term',context:'The source sentence.',now:NOW};

test('collection creates an ungraded FSRS New card without awarding mastery, XP, or a correct answer',()=>{
  const s=state(),w={...lemma(),id:'v-invoice',word:'invoice',wordId:'v-invoice'};
  const result=collectPersonalWord(s,w,options);
  assert.equal(result.added,true);assert.equal(result.item.wordId,'v-invoice');assert(validCard(result.item.fsrs));
  assert.equal(result.item.fsrs.state,0);assert.equal(result.item.fsrs.reps,0);assert.equal(result.item.fsrs.lastRating,null);
  assert.deepEqual([s.words['v-invoice'].tries,s.words['v-invoice'].right,s.xp],[0,0,79]);
  assert.equal(s.words['v-invoice'].due,NOW);assert.deepEqual(s.stats,{vocab:9});assert.equal(s.history.length,1);
  assert.deepEqual(personalVocabStats(s,NOW),{total:1,linked:1,due:1,mastered:0});
});

test('a known word keeps its shared schedule and prior statistics; duplicate collection is idempotent',()=>{
  const s=state(),fsrs=advance(undefined,3,NOW-86400000,.9);
  s.words['v-note']={box:1,due:fsrs.due,right:8,tries:10,fsrs};
  const before=structuredClone(s.words['v-note']),w={...lemma(),id:'v-note',wordId:'v-note'};
  const first=collectPersonalWord(s,w,options);assert.deepEqual(s.words['v-note'],before);
  assert.deepEqual(first.item.fsrs,fsrs);assert.notStrictEqual(first.item.fsrs,fsrs);
  assert.equal(collectPersonalWord(s,w,{...options,now:NOW+10}).added,false);
  assert.equal(s.personalVocab.items.length,1);assert.equal(s.personalVocab.items[0].addedAt,NOW);
  beginPersonalVocab(s,'en-zh',NOW);flipPersonalWord(s);ratePersonalWord(s,4,NOW);
  assert.equal(s.words['v-note'].tries,10);assert.equal(s.words['v-note'].right,8);assert.equal(s.words['v-note'].fsrs.lastRating,4);
});

test('only a genuinely absent collection is migrated; malformed present imports are rejected without clearing them',()=>{
  const s=state();migratePersonalVocab(s);assert.deepEqual(s.personalVocab,{version:1,items:[],run:null});
  for(const bad of [null,false,[],{version:2,items:[],run:null},{version:1,items:[],run:false}]){
    const x=state();x.personalVocab=bad;assert.throws(()=>migratePersonalVocab(x),/我的单词/);assert.strictEqual(x.personalVocab,bad);
  }
  collectPersonalWord(s,lemma(),options);
  const duplicate=structuredClone(s);duplicate.personalVocab.items.push(structuredClone(duplicate.personalVocab.items[0]));
  assert.throws(()=>migratePersonalVocab(duplicate),/我的单词/);
  for(const field of ['fsrs','zh','ja','source']){const invalid=structuredClone(s);invalid.personalVocab.items[0][field]=null;assert.throws(()=>migratePersonalVocab(invalid),/我的单词/);}
});

test('custom cards retain source and three-language snapshots and work without a catalog or a fetch',()=>{
  const s=state(),w={...lemma(),example:'Please confirm the appointment.'};
  const {item}=collectPersonalWord(s,w,options);assert.equal(item.wordId,null);assert.deepEqual(s.words,{});
  const imported=JSON.parse(JSON.stringify(s));migratePersonalVocab(imported);
  assert.equal(imported.personalVocab.items[0].example,w.example);assert.deepEqual(imported.personalVocab.items[0].source,{id:'gram-test',mode:'grammar',context:options.context,option:options.option});
  assert(beginPersonalVocab(imported,'ja-en',NOW));assert(flipPersonalWord(imported));assert(ratePersonalWord(imported,3,NOW));
  assert.equal(imported.personalVocab.items[0].fsrs.lastRating,3);assert.deepEqual(imported.words,{});
});

test('sync captures later canonical reviews before an old source ID retires',()=>{
  const s=state(),w={...lemma(),id:'v-old',wordId:'v-old'};
  const {item}=collectPersonalWord(s,w,options);
  const later=advance(item.fsrs,4,NOW+10000,.9);
  s.words['v-old'].fsrs=later;s.words['v-old'].due=later.due;
  syncPersonalVocab(s);assert.deepEqual(item.fsrs,later);
  delete s.words['v-old'];migratePersonalVocab(s);
  assert(beginPersonalVocab(s,'en-zh',NOW+20000));assert(flipPersonalWord(s));assert(ratePersonalWord(s,1,NOW+20000));
  assert.equal(item.fsrs.lastRating,1);assert.equal(s.words['v-old'],undefined,'retired IDs are not resurrected in the canonical word map');
});

test('grading requires a revealed card and updates canonical FSRS without double counting rewards',()=>{
  const s=state(),w={...lemma(),id:'v-active',wordId:'v-active'};collectPersonalWord(s,w,options);
  assert(beginPersonalVocab(s,'zh-en',NOW));assert.equal(ratePersonalWord(s,4,NOW),false);
  assert(flipPersonalWord(s));assert.equal(ratePersonalWord(s,0,NOW),false);assert.equal(ratePersonalWord(s,3,NaN),false);
  assert(ratePersonalWord(s,3,NOW));assert.equal(ratePersonalWord(s,3,NOW+1),false);
  assert.equal(s.words['v-active'].tries,0);assert.equal(s.words['v-active'].right,0);assert.equal(s.xp,79);
  assert.deepEqual(s.words['v-active'].fsrs,s.personalVocab.items[0].fsrs);
  assert.equal(s.words['v-active'].due,s.words['v-active'].fsrs.due);
});

test('due items take priority, a revealed run survives JSON backup, and removing prior cards preserves the current reveal',()=>{
  const s=state();for(let i=0;i<3;i++)collectPersonalWord(s,lemma(i),{...options,now:NOW+i});
  s.personalVocab.items[0].fsrs.due=NOW+5000;
  assert(beginPersonalVocab(s,'en-ja',NOW+2));assert.equal(s.personalVocab.run.keys.length,2);
  assert.equal(s.personalVocab.run.keys[0],'personal-lex-term-1');
  flipPersonalWord(s);ratePersonalWord(s,3,NOW+3);flipPersonalWord(s);
  const restored=JSON.parse(JSON.stringify(s));migratePersonalVocab(restored);assert.equal(restored.personalVocab.run.flipped,true);
  removePersonalWord(restored,'personal-lex-term-1');assert.equal(restored.personalVocab.run.index,0);assert.equal(restored.personalVocab.run.flipped,true);
  removePersonalWord(restored,'personal-lex-term-2');assert.equal(restored.personalVocab.run,null);
});

test('removing a canonical bookmark preserves normal vocabulary progress and HTML escapes source text',()=>{
  const s=state(),w={...lemma(),id:'v-safe',wordId:'v-safe',word:'<img src=x onerror=alert(1)>'};collectPersonalWord(s,w,options);
  const html=personalVocabView(s);assert(!html.includes('<img'));assert(html.includes('&lt;img'));
  const saved=structuredClone(s.words['v-safe']);assert(removePersonalWord(s,'v-safe'));assert.deepEqual(s.words['v-safe'],saved);
  assert.equal(removePersonalWord(s,'v-safe'),false);
  assert.throws(()=>collectPersonalWord(s,{...lemma(),collectible:false},options),/无法收藏/);
});
