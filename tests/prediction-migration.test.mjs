import test from 'node:test';
import assert from 'node:assert/strict';
import {decode,fresh} from '../js/state.js';
import {predictionSummary} from '../js/prediction.js';

const catalog = new Map([['word','vocab'],['question','reading'],['verb','grammar'],['audio','dictation']]
  .map(([id,mode]) => [id,{ref:{id,mode},data:{}}]));
const word = {skill:'vocab',level:900,ok:true};
const reading = {skill:'reading',level:700,ok:true};
const listening = {skill:'listening',level:500,ok:false};
const encoded = (s,idx=catalog) => decode(JSON.stringify(s),idx);

function oldCache() {
  return {version:1,L:{rating:520,evidence:7},R:{rating:658,evidence:12},
    days:{'2026-11-13':[260,330,590],'2026-11-12':[255,325]},exposure:{word:100,audio:16}};
}
function oldState() {
  const state = fresh();
  state.history = Array.from({length:120},()=>({...word}));
  state.xp=1290; state.stage=4; state.stats.vocab=950; state.stats.listening=340;
  state.words.word={tries:100,right:99,box:4,due:1900000000000};
  state.seen={word:100,audio:16};
  state.prediction=oldCache();
  return state;
}
test('demonstrably word-only R resets without touching audio, XP, attained form, cards or dated results',()=>{
 const before=oldState(),after=encoded(before);
 assert.equal(after.prediction.version,2);
 assert.deepEqual(after.prediction.R,{rating:400,evidence:0});
 assert.deepEqual(after.prediction.L,before.prediction.L);
 assert.deepEqual(after.prediction.days,before.prediction.days);
 assert.deepEqual(after.seen,before.seen);assert.equal(after.stage,4);assert.equal(after.xp,1290);
 assert.equal(after.words.word.tries,100);assert.equal(after.words.word.due,before.words.word.due);
 assert.deepEqual(encoded(after),after);
});
test('a mixed prior survives a truncated word-only history, unknown IDs, and exam-only evidence',()=>{
 for(const alter of [
   s=>s.stats.grammar=4,
   s=>s.history[0]=reading,
   s=>s.prediction.exposure.question=1,
   s=>s.seen.verb=2,
   s=>s.prediction.exposure.retired=1,
   s=>s.seen.retired=1,
   s=>s.report={version:1,parts:{7:{total:2,right:1}},topics:{},days:{}},
 ]){
   const before=oldState();alter(before);
   const after=encoded(before);
   assert.deepEqual(after.prediction,{...before.prediction,version:2});
   assert.deepEqual(encoded(after),after);
 }
});
test('uncatalogued decode defers the v1 decision; a partial lookup cannot turn unresolved evidence into words',()=>{
 const before=oldState();
 const deferred=decode(JSON.stringify(before));assert.equal(deferred.prediction.version,1);
 assert.deepEqual(encoded(deferred).prediction.R,{rating:400,evidence:0});
 const partial=new Map([['word',catalog.get('word')]]);
 assert.deepEqual(decode(JSON.stringify(before),partial).prediction.R,before.prediction.R);
});
test('old uncached history seeds once from recoverable L/R only; later vocabulary cannot evict the model',()=>{
 const state=fresh();state.version=1;state.history=[reading,word,listening,word];
 const recovered=encoded(state);
 assert.equal(recovered.prediction.version,2);assert.deepEqual(recovered.prediction.days,{});
 const withoutWords=fresh();withoutWords.history=[reading,listening];
 assert.deepEqual(recovered.prediction,encoded(withoutWords).prediction);
 const summary=predictionSummary(recovered);
 recovered.history=Array.from({length:120},()=>({...word}));
 const restored=encoded(recovered);
 assert.deepEqual(predictionSummary(restored),summary);
});
test('word-only uncached backup leaves prediction absent and corrupted version-one cache is rejected',()=>{
 const state=fresh();state.history=[word];state.stats.vocab=12;state.xp=12;
 const after=encoded(state);assert.equal(after.prediction,undefined);
 assert.equal(predictionSummary(after).total,400);assert.equal(after.prediction,undefined);
 state.prediction=oldCache();state.prediction.days['2026-02-31']=[5,495,500];
 assert.throws(()=>encoded(state));
});
