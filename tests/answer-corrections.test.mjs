import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {reviewAnswer, answerText, claudeText} from '../js/question-tools.js';
import {sourceUnits} from '../js/translation-source.js';
import {buildExam, examIds, examScores, examValid} from '../js/exam.js';
import {fresh, decode} from '../js/state.js';

const bank = {};
for (const name of ['vocab','part1','part2','grammar','listening','reading']) {
  bank[name] = JSON.parse(await readFile(new URL(`../data/${name}.json`,import.meta.url),'utf8'));
}
const catalog = new Map();
const put = (mode,data) => catalog.set(data.id,{ref:{id:data.id,mode},data});
for (const mode of ['vocab','part1','part2']) for (const row of bank[mode]) put(mode,row);
for (const topic of bank.grammar) for (const row of topic.questions) put('grammar',{...row,topic});
for (const mode of ['listening','reading']) for (const set of bank[mode]) {
  for (const row of set.questions) put(mode==='reading'?'reading':'dialogue',{...row,level:set.level,set});
  if (set.dictation) put('dictation',{...set.dictation,level:set.level,set});
}
const target = 'read-bikes-01';
const {ref,data} = catalog.get(target);
const question = {...data,instruction:'Part 6 · 阅读理解',skill:'reading'};
const correctRequest = '请用中文解释这道题的考点，确认我的理解是否正确。';
const wrongRequest = '请用中文解释为什么选这个答案，以及我错在哪里。';

function finishedExam() {
  for (let form=0; form<4; form++) {
    const usage = [1,1,1,1]; usage[form]=0;
    const exam = buildExam(bank,{seen:{},examForms:usage},'full','answer-correction');
    if (!examIds(exam).includes(target)) continue;
    exam.keys = Object.fromEntries(examIds(exam).map(id=>[id,catalog.get(id).data.answer]));
    exam.keys[target] = 'precisely';
    exam.answers = {...exam.keys};
    exam.phase='done'; exam.finishedAt=exam.startedAt+1000;
    return exam;
  }
  throw Error('No complete form contains the corrected question');
}

test('the corrected Part 6 key and completed translation source use the adjective', async () => {
  assert.equal(data.answer,'precise');
  assert.equal(data.correctedFrom,'precisely');
  assert.deepEqual(data.options,['precisely','preciseness','precision','precise']);
  const line=sourceUnits('reading',[data.set]).find(unit=>unit.key==='read-bikes/documents/0/text/3');
  assert.equal(line.text,'When you describe the problem, be as precise as possible.');
  assert(data.set.documents.some(doc=>doc.text.includes(data.evidence)));
  assert.match(data.en,/linking verb be/);
  assert.match(data.zh,/形容词.*选 precise/);
  assert.match(data.paraphrase,/be as precise as possible/);
  for (const language of ['zh','ja']) {
    const pack=JSON.parse(await readFile(new URL(`../data/i18n/${language}/reading.json`,import.meta.url),'utf8'));
    assert.equal(typeof pack.entries[line.key],'string');
    assert(pack.entries[line.key].trim());
  }
});

test('only an explicitly identified erroneous archived key is replaced', () => {
  assert.equal(reviewAnswer(question),'precise');
  assert.equal(reviewAnswer(question,'precisely'),'precise');
  assert.equal(reviewAnswer(question,'precise'),'precise');
  assert.equal(reviewAnswer(question,'precision'),'precision', 'an unrelated archive value is not rewritten');
  const unmarked={answer:'current answer'};
  assert.equal(reviewAnswer(unmarked,'archived answer'),'archived answer');
  assert.equal(reviewAnswer(unmarked),'current answer');
  assert.equal(reviewAnswer({...unmarked,correctedFrom:'a different value'},'archived answer'),'archived answer');
});

test('copy and issue content use the corrected key without treating the former answer as correct', () => {
  const oldKey='precisely', correct=reviewAnswer(question,oldKey);
  const copied=claudeText(ref,question,'precisely',correct);
  assert.match(copied,/我的答案　A\. precisely/);
  assert.match(copied,/正确答案　D\. precise(?:\n|$)/);
  assert(copied.endsWith(wrongRequest));
  assert(claudeText(ref,question,'precise',correct).endsWith(correctRequest));
  assert.match(answerText(ref,question,'precisely',correct),/正确答案　D\. precise(?:\n|$)/);
  assert.equal(oldKey,'precisely');
});

test('unmarked questions retain the archived-answer contract for external review', () => {
  const unmarked={...question}; delete unmarked.correctedFrom;
  const correct=reviewAnswer(unmarked,'precisely');
  assert.equal(correct,'precisely');
  const copied=claudeText(ref,unmarked,'precisely',correct);
  assert.match(copied,/正确答案　A\. precisely(?:\n|$)/);
  assert(copied.endsWith(correctRequest));
});

test('a legacy answered practice remains readable without reversing earned progress', () => {
  const old=fresh(); old.version=3; old.xp=12; old.stats.reading=12;
  old.history=[{skill:'reading',level:data.level,ok:true}]; old.seen[target]=1;
  old.session={mode:'reading',title:'旧阅读练习',items:[ref],index:0,right:1,gain:12,
    selected:'precisely',elapsed:1000,timed:false,intro:false};
  const restored=decode(JSON.stringify(old),catalog);
  assert.deepEqual(restored.session,old.session);
  assert.equal(restored.xp,12);
  assert.deepEqual(restored.stats,old.stats);
  assert.deepEqual(restored.history,old.history);
  assert.equal(restored.session.selected,'precisely');
  assert.equal(reviewAnswer(question),'precise');
});

test('a corrected review leaves a completed exam key and its original score immutable', () => {
  const exam=finishedExam();
  assert(examValid(exam,catalog));
  const old=fresh(); old.xp=120; old.stats.reading=120; old.exam=exam;
  old.words['v-available']={box:2,due:1000,right:2,tries:3};
  const restored=decode(JSON.stringify(old),catalog);
  const before=structuredClone(restored), scores=examScores(restored.exam,catalog);
  assert.equal(scores.listening+scores.reading,990);
  assert.equal(restored.exam.answers[target],'precisely');
  assert.equal(reviewAnswer(question,restored.exam.keys[target]),'precise');
  assert(claudeText(ref,question,restored.exam.answers[target],reviewAnswer(question,restored.exam.keys[target])).endsWith(wrongRequest));
  assert.deepEqual(examScores(restored.exam,catalog),scores);
  assert.deepEqual(restored,before,'reviewing does not mutate keys, XP, SRS or other stored progress');
  assert.equal(restored.exam.keys[target],'precisely');
});
