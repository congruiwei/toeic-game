import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildExam,examIds,fullCounts,halfCounts,examValid} from '../js/exam.js';
const bank={};
for(const key of ['part1','part2','listening','grammar','reading'])bank[key]=JSON.parse(await readFile(new URL('../data/'+key+'.json',import.meta.url)));
const state={seen:{},examForms:[0,0,0,0]},all=new Set(),materials=new Set();
for(let i=0;i<4;i++){
 const e=buildExam(bank,state,'full','form-'+i);
 assert(examValid(e));
 assert.deepEqual(fullCounts.map((_,i)=>e.units.filter(u=>u.part===i+1).flatMap(u=>u.ids).length),fullCounts);
 const ids=examIds(e);
 for(const id of ids){assert(!all.has(id),'Repeated '+id);all.add(id);state.seen[id]=1;}
 for(const g of [...bank.listening,...bank.reading]){
   if(g.questions.some(q=>ids.includes(q.id))){assert(!materials.has(g.id),'Repeated passage '+g.id);materials.add(g.id);}
 }
 const ls=bank.listening.filter(g=>g.questions.some(q=>ids.includes(q.id)));
 const counts=[ls.filter(g=>g.graphic).length,ls.filter(g=>new Set(g.turns.map(t=>t.speaker)).size>=3).length,ls.filter(g=>g.questions.some(q=>q.type==='intent')).length];
 assert(counts[0]>=3&&counts[1]>=2&&counts[2]>=1,'Insufficient listening coverage '+counts);
 console.log('Full form '+(i+1)+': '+ids.length+' unique questions, graphics / three-voice / intent groups '+counts.join('/'));
 state.examForms[e.form]++;
}
assert.equal(all.size,800);
for(let i=0;i<24;i++){const e=buildExam(bank,state,'half','half-'+i);assert(examValid(e));assert.deepEqual(halfCounts.map((_,i)=>e.units.filter(u=>u.part===i+1).flatMap(u=>u.ids).length),halfCounts);}
console.log('PASS 4 disjoint full forms (800 questions, no shared passages); 24 half forms meet 50+50 quotas');
