import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fresh,decode,difficulty,reward} from '../js/state.js';
import {startDiagnosis,answerDiagnosis,validDiagnosis,diagnosisCount,nextDiagnosisTarget} from '../js/diagnosis.js';
import {loadBank,catalog} from '../js/bank.js';
globalThis.fetch=async f=>({ok:true,json:async()=>JSON.parse(await readFile(new URL('../'+f,import.meta.url),'utf8'))});
await loadBank(['vocab','part1','part2','listening','grammar','reading']);
const s=fresh();s.history=Array.from({length:12},()=>({skill:'vocab',ok:false,level:400}));
startDiagnosis(s,catalog,100);let ids=new Set(),parts=new Set();
for(let i=0;i<diagnosisCount;i++){
  const r=s.diagnosis.active.current;assert.ok(!ids.has(r.id));ids.add(r.id);parts.add(r.part);
  if(!i)assert.equal(r.level,500);
  const ok=r.part===0||r.part===5;answerDiagnosis(s,r.id,ok,catalog,200);
  assert.ok(validDiagnosis(s.diagnosis));assert.ok(validDiagnosis(decode(JSON.stringify(s),catalog).diagnosis));
}
assert.equal(parts.size,8);assert.equal(s.diagnosis.results.length,1);assert.equal(s.diagnosis.active,null);
assert.ok(difficulty(s,'vocab')>difficulty(s,'listening'));
const placement=difficulty(s,'vocab');
const r={id:'v-available',mode:'vocab'};reward(s,{...catalog.get(r.id).data,skill:'vocab'},r,true);
assert.equal(difficulty(s,'vocab'),placement);assert.equal(s.diagnosis.since.vocab,1);
assert.equal(answerDiagnosis(s,[...ids].at(-1),true,catalog),null);
startDiagnosis(s,catalog,300);assert.equal(s.diagnosis.results.length,1);
const bad=structuredClone(s);bad.diagnosis.results[0].levels.vocab=0;
assert.throws(()=>decode(JSON.stringify(bad),catalog));console.log('Diagnosis: adaptive coverage, restore, stale clicks, per-skill start OK');

assert.equal(nextDiagnosisTarget([]),500);
assert.equal(nextDiagnosisTarget([{ok:true}]),600);
assert.equal(nextDiagnosisTarget([{ok:false},{ok:false}]),400);
assert.equal(nextDiagnosisTarget(Array.from({length:8},()=>({ok:true}))),900);
assert.equal(nextDiagnosisTarget([{ok:true},{ok:false}]),500);
const spare=fresh();startDiagnosis(spare,catalog,456);
const only=new Map([...catalog].filter(([,o])=>o.ref.mode==='part1'&&o.data.level!==600));
const chosen=spare.diagnosis.active.current;
answerDiagnosis(spare,chosen.id,true,only);
const available=[...only.values()].map(o=>Math.abs(o.data.level-600));
assert.equal(spare.diagnosis.active.current.target,600);
assert.equal(Math.abs(spare.diagnosis.active.current.level-600),Math.min(...available));
const result=s.diagnosis.results[0];assert.ok(result.ranges.L[0]<result.ranges.L[1]&&result.ranges.R[0]<result.ranges.R[1]);
