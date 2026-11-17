import test from 'node:test';
import assert from 'node:assert/strict';
import {fresh,decode,VERSION} from '../js/state.js';
import {collectPersonalWord,beginPersonalVocab,flipPersonalWord,ratePersonalWord,syncPersonalVocab} from '../js/personal-vocab.js';

const lemma={id:'v-example',wordId:'v-example',word:'example',pos:'n.',zh:'例子',ja:'例',example:'This example shows how the new filter works.'};
const source={ref:{id:'gram-example-01',mode:'grammar'},context:'Please add an example.',option:'example',now:1700000000000};
test('old backup versions acquire an empty personal book without changing progress or forms',()=>{
  for(const version of [1,2,3,4,5]){
    const s=fresh();delete s.personalVocab;s.version=version;s.stage=5;s.xp=1200;
    const restored=decode(JSON.stringify(s));assert.equal(restored.version,VERSION);assert.equal(restored.stage,5);assert.equal(restored.xp,1200);
    assert.deepEqual(restored.personalVocab,{version:1,items:[],run:null});
  }
});
test('backups preserve a personal card even when its canonical word retires',()=>{
  const s=fresh();collectPersonalWord(s,lemma,source);
  beginPersonalVocab(s,'en-ja',source.now);flipPersonalWord(s);ratePersonalWord(s,4,source.now+1000);syncPersonalVocab(s);
  const memory=structuredClone(s.words[lemma.id].fsrs),restored=decode(JSON.stringify(s),new Map());
  assert.equal(restored.words[lemma.id],undefined);
  assert.deepEqual(restored.personalVocab.items[0].fsrs,JSON.parse(JSON.stringify(memory)));
  assert.equal(restored.personalVocab.items[0].source.context,source.context);
  assert(beginPersonalVocab(restored,'ja-en',source.now+2000));flipPersonalWord(restored);assert(ratePersonalWord(restored,3,source.now+3000));
});
test('malformed personal data is rejected, never replaced by an empty book',()=>{
  const s=fresh();collectPersonalWord(s,lemma,source);s.personalVocab.items[0].ja='';
  assert.throws(()=>decode(JSON.stringify(s)),/我的单词本/);
});
