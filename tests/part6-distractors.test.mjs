import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fresh,decode,reward,VERSION} from '../js/state.js';
import {bank,catalog,loadBank,question,select} from '../js/bank.js';
import {practiceView} from '../js/practice.js';
import {sourceUnits} from '../js/translation-source.js';

const reading=JSON.parse(await readFile(new URL('../data/reading.json',import.meta.url),'utf8'));
globalThis.fetch=async file=>({ok:true,json:async()=>{
  assert.equal(file,'./data/reading.json');return structuredClone(reading);
}});
await loadBank(['reading']);
const cases=[
 {id:'read-samples-01',group:'read-samples',old:'since',replacement:'during',index:0,
  options:['during','before','unless','whereas'],answer:'before',prompt:'Which word best completes [1]?',
  evidence:'Everything should be in place when the first customers walk in.',
  completed:'Please set them on the tasting table before the shop opens at nine.',
  accepted:['before'],
  // Authored grammatical/semantic contracts, not a claim that a parser proves English uniqueness.
  rejection:{during:'preposition cannot directly take the finite clause the shop opens at nine',unless:'conditional exception does not express setup preceding opening',whereas:'contrast does not express setup preceding opening'}},
 {id:'read-badge-01',group:'read-badge',old:'collect',replacement:'arrive',index:2,
  options:['wear','give','arrive','borrow'],answer:'give',prompt:'Which word best completes [3]?',
  evidence:'each guest a blue badge at the front desk',
  completed:'A member of the reception team will give each guest a blue badge at the front desk.',
  accepted:['give'],
  rejection:{wear:'wearing clothing is not issuing a badge and does not take this recipient-plus-item pattern',arrive:'intransitive verb cannot take a guest and a badge as two direct objects',borrow:'receiving an item temporarily is not issuing it to a visitor'}}
];

test('both revised Part 6 sets contain four distinct options, one unchanged key, and explicit distinctions for all three distractors',()=>{
 for(const c of cases){const q=catalog.get(c.id).data;
  assert.equal(q.id,c.id);assert.equal(q.prompt,c.prompt);assert.equal(q.answer,c.answer);assert.equal(q.evidence,c.evidence);
  assert.deepEqual(q.options,c.options);assert.equal(new Set(q.options).size,4);assert(!q.options.includes(c.old));
  assert.deepEqual(q.options.filter(option=>c.accepted.includes(option)),[c.answer]);
  assert.deepEqual(q.options.filter(option=>option!==c.answer).sort(),Object.keys(c.rejection).sort());
  assert(Object.values(c.rejection).every(reason=>reason.length>30));
  if(c.id==='read-samples-01'){assert.match(q.en,/During is a preposition.*cannot directly introduce the finite clause/);assert.match(q.zh,/during 是介词.*不能直接接/);assert.match(q.en,/unless.*whereas/);}
  else{assert.match(q.en,/Arrive is intransitive.*cannot take/);assert.match(q.zh,/arrive 是不及物动词.*不能直接接/);assert.match(q.en,/Wear.*borrow/);}
 }
});

test('completed English units and their existing Chinese/Japanese translations are unaffected by distractor-only edits',async()=>{
 const before=structuredClone(reading);
 for(const c of cases){const q=before.flatMap(set=>set.questions).find(q=>q.id===c.id);q.options[c.index]=c.old;}
 assert.deepEqual(sourceUnits('reading',reading),sourceUnits('reading',before));
 for(const c of cases){const group=reading.find(set=>set.id===c.group);const units=sourceUnits('reading',[group]);
  assert(units.some(u=>u.text===c.completed),c.id+' correct completed sentence remains unchanged');
  for(const lang of ['zh','ja']){
   const pack=JSON.parse(await readFile(new URL(`../data/i18n/${lang}/reading.json`,import.meta.url),'utf8'));
   for(const unit of units)assert.equal(typeof pack.entries[unit.key],'string',lang+' '+unit.key);
   const key=units.find(u=>u.text===c.completed).key;assert(pack.entries[key].trim());
  }
 }
});

function backup(c,version){
 const state=fresh(),ref={id:c.id,mode:'reading'},q=question(ref),now=1_770_000_000_000;
 state.xp=777;state.stage=3;state.branch='listening';state.stats={vocab:200,grammar:180,listening:200,reading:197};
 // The old selected distractor was already scored as incorrect before export.
 const earned=reward(state,q,ref,false,now,{activeMs:5000});assert.equal(earned.xp,4);
 const next=q.set.questions.find(other=>other.id!==c.id);
 state.session={mode:'reading',title:'旧阅读进度',items:[ref,{id:next.id,mode:'reading'}],index:0,
  right:0,gain:4,elapsed:1234,selected:c.old,intro:false,timed:false,answerMs:5000};
 state.version=version;
 if(version<6)delete state.personalVocab;
 if(version<5)delete state.expressions;
 if(version<3)delete state.prediction;
 return state;
}
const progress=s=>({xp:s.xp,stage:s.stage,branch:s.branch,stats:structuredClone(s.stats),history:structuredClone(s.history),seen:structuredClone(s.seen),right:s.session.right,gain:s.session.gain});

test('old since/collect selections import as already answered errors without adding or removing XP, form, or verdicts',()=>{
 for(const version of [1,2,3,4,5,6])for(const c of cases){
  const old=backup(c,version),before=progress(old),restored=decode(JSON.stringify(old),catalog);
  assert.equal(restored.version,VERSION);assert.equal(restored.session.selected,c.old);
  assert.deepEqual(progress(restored),before);assert.equal(restored.errors[c.id].misses,old.errors[c.id].misses);
  const current=question(restored.session.items[0]);assert(!current.options.includes(c.old));assert.equal(current.answer,c.answer);
  const html=practiceView(restored);assert.match(html,/再记一次/);assert.match(html,/data-act="next"/);assert(!html.includes('答对了'));
  assert.deepEqual(progress(restored),before,'rendering an old answer must not score it again');
  const again=decode(JSON.stringify(restored),catalog);assert.equal(again.session.selected,c.old);assert.deepEqual(progress(again),before);
 }
});

test('an imported answered card can proceed to the next current question, and its wrong-question entry uses the new choices',()=>{
 for(const c of cases){
  const restored=decode(JSON.stringify(backup(c,5)),catalog),before=progress(restored);
  const due=select(restored,'errors',20);assert(due.some(ref=>ref.id===c.id));
  const errorQuestion=question(due.find(ref=>ref.id===c.id));assert(errorQuestion.options.includes(c.replacement));assert(!errorQuestion.options.includes(c.old));
  // App's Next action clears the selection and advances; browser click coverage is separate.
  restored.session.index++;restored.session.selected=null;restored.session.answerMs=0;restored.session.intro=false;
  const nextRef=restored.session.items[restored.session.index],next=question(nextRef);assert(next&&next.options.includes(next.answer));
  assert.match(practiceView(restored),/data-act="answer"/);assert(!practiceView(restored).includes('data-act="next"'));
  assert.deepEqual(progress(restored),before,'advancing an already scored card cannot alter rewards or form');
  const earned=reward(restored,next,nextRef,true,1_770_000_010_000,{activeMs:4000});
  assert.equal(earned.xp,12);assert.equal(restored.xp,before.xp+12,'only the new answer grants the ordinary XP');assert.equal(restored.stage,before.stage);
  assert.equal(restored.history.length,before.history.length+1);
 }
});
