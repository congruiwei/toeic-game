import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateConfusableFiles,validateConfusables} from '../scripts/validate-confusables.mjs';
import {installConfusables,installConfusableCandidates,confusableCandidates,confusableQuestion,comparisonsForAnswer,confusableOptionDetails} from '../js/confusables.js';
import {fresh,reward,decode} from '../js/state.js';
import {bank,catalog,loadBank,question,vocabularyOptions,select} from '../js/bank.js';
import {recordStudy,validReport} from '../js/report.js';
import {answerPartsView} from '../js/morphemes.js';
import {comparisonCard,standaloneTrap} from '../js/confusable-ui.js';
const read=p=>JSON.parse(fs.readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const data=read('data/confusables.json'),vocab=read('data/vocab.json'),projection=read('data/confusable-candidates.json');
globalThis.fetch=async url=>Response.json(read(String(url).replace(/^\.\//,'')));
await loadBank(['vocab','confusables']);
const ref=id=>({id,mode:'confusable'});
test('all curated senses, source keys, original choices, translations and projection are aligned',()=>{
 assert.deepEqual(validateConfusableFiles().errors,[]);
 for(const row of data.questions){const r=ref(row.id),q=question(r),details=confusableOptionDetails(r,q);assert.equal(details.options.length,q.options.length);assert.equal(details.options.filter(o=>o.correct).length,1);for(const o of details.options){assert(o.zh&&o.ja&&o.pos&&o.reasonZh);assert.equal(o.lexemes.length,1);assert.equal(o.lexemes[0].word,o.text);}}
});
test('canonical POS/sense drift and stale English projection are rejected',()=>{
 const d=structuredClone(data);d.words['v-access'].pos='v.';d.words['v-effective'].zh='有效果的';
 const errors=validateConfusables(d,vocab,{version:1,entries:{}},{zh:read('data/i18n/zh/confusables.json'),ja:read('data/i18n/ja/confusables.json')},read('data/part2.json'));
 for(const semanticAvoid of [{},[['assess']],[['assess','assess']],[[null,'access']]])assert.throws(()=>installConfusableCandidates({...projection,semanticAvoid}),/语义排除/);
 assert(confusableCandidates('v-access').includes('assess'),'invalid update preserves last usable projection');
 installConfusableCandidates({version:1,entries:projection.entries});installConfusableCandidates(projection);
 assert(errors.some(e=>e.id==='v-access'));assert(errors.some(e=>e.id==='v-effective'));assert(errors.some(e=>e.id==='projection'));
});
test('ordinary questions ignore retired family arrays and use only the English curated projection',()=>{
 assert(confusableCandidates('v-access').includes('assess'));
 assert.deepEqual(confusableCandidates('v-interview'),[]);
 const w=vocab.find(w=>w.id==='v-interview');
 assert.deepEqual(vocabularyOptions({...w,confusables:['imaginary-unsafe']},'english',vocab),vocabularyOptions({...w,confusables:[]},'english',vocab));
 for(const g of data.groups)if(g.type==='sound')for(const id of g.members){const w=vocab.find(w=>w.id===id);if(!w)continue;const opts=vocabularyOptions(w,'sound',vocab);if(['stationary','stationery','complement','compliment','principal','principle','stairs','route','sensor','waive'].includes(w.word))for(const other of g.members.filter(x=>x!==id))assert(!opts.includes(data.words[other].word),id);}
});
test('access and effective duels use exact existing noun and in-force adjective senses',()=>{
 for(const [id,wordId,zh]of [['cf-access','v-access','访问权限'],['cf-effective','v-effective','正式生效']]){const q=question(ref(id)),d=confusableOptionDetails(ref(id),q);const correct=d.options.find(o=>o.correct);assert.equal(q.wordId,wordId);assert.equal(correct.lexemes[0].wordId,wordId);assert(correct.zh.includes(zh));}
 assert(!data.questions.some(q=>['cf-ensure','cf-alternatively','cf-receipt','cf-shareholder'].includes(q.id)),'overlapping readings do not become forced duels');
 const shareholder=vocab.find(w=>w.id==='v-shareholder');assert(!vocabularyOptions(shareholder,'english',vocab).includes('stakeholder'));
});
test('wrong duel adds only the exact target to personal FSRS, gives one XP verdict, and returns after two correct reviews',()=>{
 const s=fresh(),r=ref('cf-access'),q=question(r),now=Date.now();
 reward(s,q,r,false,now,{activeMs:3000});recordStudy(s,r,q,false,now);
 assert.equal(s.xp,4);assert.equal(s.words['v-access'].tries,1);assert.equal(s.words['v-access'].right,0);assert(!s.words[q.id]);assert(!s.words['v-access-use']);
 assert.equal(s.personalVocab.items[0].wordId,'v-access');assert.equal(s.personalVocab.items[0].fsrs.lastRating,1);assert(s.errors[q.id]);assert.equal(s.report.parts.vocab.total,1);assert(validReport(s.report));
 reward(s,q,r,true,now+600000,{activeMs:9000});assert(s.errors[q.id]);assert.equal(s.words['v-access'].fsrs.lastRating,2);
 reward(s,q,r,true,now+1200000,{activeMs:3000});assert(!s.errors[q.id]);assert.equal(s.words['v-access'].fsrs.lastRating,3);
 assert.equal(s.prediction?.reading?.exposure||0,0);
});
test('lightweight duel retains its own snapshot and survives save import without inventing a canonical word',()=>{
 const s=fresh(),r=ref('cf-curry'),q=question(r);reward(s,q,r,false,Date.now()-600000);
 const item=s.personalVocab.items[0];assert.equal(item.wordId,null);assert.equal(item.key,'personal-lex-conf-curry');assert.equal(item.source.context,q.sentence);assert.equal(Object.keys(s.words).length,0);
 const restored=decode(JSON.stringify(s),catalog);assert.equal(restored.personalVocab.items[0].word,'curry');assert(restored.errors[q.id]);
 assert(select(restored,'errors',5).some(r=>r.id===q.id));
});
test('answer comparisons identify the selected twin and authored sound traps without adding family groups',()=>{
 const r=ref('cf-access'),q=question(r),d=confusableOptionDetails(r,q);const matches=comparisonsForAnswer(r,q,'assess',d);
 const html=comparisonCard(matches[0],{id:q.id});assert(html.includes('你选了'));assert(html.includes('重音在前'));assert(html.includes('data-word="v-access"'));assert(!html.includes('data-word="v-access-use"'));
 assert(standaloneTrap('p2-026','The project starts in March.').includes('你选中了这一项'));
 assert(!data.groups.some(g=>g.members.includes('v-interviewer')));
});

test('combined morphology review uses exact curated senses for both chosen and correct homographs',()=>{
 const r=ref('cf-import'),q=question(r);
 const html=answerPartsView(r,q,'export',q.answer,vocab,read('data/morphemes.json'));
 assert(html.includes('data-morph-word="v-import"'));assert(html.includes('data-morph-word="v-export"'));
 assert(!html.includes('data-morph-word="v-import-goods"'));assert(!html.includes('data-morph-word="v-export-goods"'));
});

test('the small projection identifies exact senses and Part 2 traps without full explanations',async()=>{
 const small=await import('../js/confusables.js?projection-only');small.installConfusableCandidates(projection);
 assert(small.mayHaveWordComparison('v-access'));assert(!small.mayHaveWordComparison('v-access-use'));
 assert(!small.mayHaveWordComparison('v-itinerary'));assert.equal(small.confusableData(),null);
 const details={options:[{correct:true,text:'a',lexemes:[{wordId:'v-itinerary'}]},{correct:false,text:'b',lexemes:[{wordId:'v-access'}]}]};
 assert(!small.mayHaveAnswerComparison({mode:'vocab',id:'v-itinerary'},{},'a',details));
 assert(small.mayHaveAnswerComparison({mode:'vocab',id:'v-itinerary'},{},'b',details));
 assert(small.mayHaveAnswerComparison({mode:'part2',id:'p2-026'},{},null,{options:[]}));
 assert(!small.mayHaveAnswerComparison({mode:'part2',id:'p2-001'},{},null,{options:[]}));
 for(const part2TrapIds of [{},['bad'],['p2-026','p2-026']])assert.throws(()=>small.installConfusableCandidates({...projection,part2TrapIds}),/听力索引/);
 assert(!small.mayHaveAnswerComparison({mode:'part2',id:'p2-001'},{},null,{options:[]}),'invalid update does not erase the known index');
 small.installConfusableCandidates({version:1,entries:projection.entries});
 assert(small.mayHaveAnswerComparison({mode:'part2',id:'p2-001'},{},null,{options:[]}),'old projection without trap metadata conservatively loads Part 2');
});

test('first-visit malformed packets preserve a working sense index and an existing candidate list', async () => {
  const runtime = await import('../js/confusables.js?first-visit-fallback');
  runtime.installConfusables(data);
  runtime.installConfusableCandidates(projection);
  const previous = runtime.groupsForWord('v-access');
  for (const patch of [{groups: [...data.groups, {id:'broken', members:['v-access','missing']}]},
      {questions:[{...data.questions[0],groupId:'unknown'}]}, {part2Traps:null}]) {
    assert.throws(() => runtime.installConfusables({...data, ...patch}), /格式/);
    assert.equal(runtime.confusableData(), data);
    assert.equal(runtime.groupsForWord('v-access'), previous);
  }
  for (const entries of [{}, 42, {unknown:[]}]) {
    assert.throws(() => runtime.installConfusableCandidates({version:1,entries}), /候选索引/);
    assert(runtime.confusableCandidates('v-access').includes('assess'));
  }
});
