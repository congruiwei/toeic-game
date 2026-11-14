import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildExam, examIds, examScores, examValid, listeningScript, passagePools } from '../js/exam.js';
import { recordStudy, reportView, validReport } from '../js/report.js';

const bank = {};
for (const key of ['part1','part2','listening','grammar','reading','vocab']) {
  bank[key] = JSON.parse(await readFile(new URL('../data/'+key+'.json',import.meta.url),'utf8'));
}
const catalog = new Map();
function register(mode,data) {
  catalog.set(data.id,{ref:{mode,id:data.id},data});
}
for (const q of bank.part1) register('part1',q);
for (const q of bank.part2) register('part2',q);
for (const t of bank.grammar) for (const q of t.questions) register('grammar',{...q,topic:t});
for (const g of bank.listening) {
  for (const q of g.questions) register('dialogue',{...q,set:g});
  if (g.dictation) register('dictation',{...g.dictation,set:g});
}
for (const g of bank.reading) for (const q of g.questions) register('reading',{...q,set:g});

function state() { return {seen:{},words:{},history:[],examForms:[0,0,0,0]}; }
function seededNumber(key) {
  let n=2166136261;
  for (const c of key) n=Math.imul(n^c.charCodeAt(0),16777619);
  return n>>>0;
}

test('four full exams stay disjoint when ordinary practice changes question exposure between exams',()=>{
  const s=state(), used=new Set(), groups=new Set();
  for (const id of catalog.keys()) s.seen[id]=seededNumber('initial/'+id)%14;
  for(let i=0;i<4;i++){
    const e=buildExam(bank,s,'full','experienced-'+i);
    assert.ok(examValid(e,catalog));
    const thisForm=new Set();
    for(const id of examIds(e)){
      assert.ok(!used.has(id),'reused question '+id);used.add(id);
      const source=catalog.get(id).data.set;
      if(source)thisForm.add(source.id);
      s.seen[id]++;
    }
    for(const group of thisForm){assert.ok(!groups.has(group),'reused source '+group);groups.add(group);}
    s.examForms[e.form]++;
    // Returning learners may practise a high number of unseen exam items in between forms.
    for(const id of catalog.keys())if(!used.has(id))s.seen[id]+=seededNumber(i+'/'+id)%27;
  }
  assert.equal(used.size,800);
});

test('a half exam repairs low-capacity single-text selection while keeping whole passage sources',()=>{
  const singles=bank.reading.filter(g=>g.part===7&&g.documents.length===1);
  const pools=passagePools(singles);
  let changedCase=false;
  for(let form=0;form<4;form++){
    const s=state();s.examForms=[1,1,1,1];s.examForms[form]=0;
    const ordered=[...pools[form]].sort((a,b)=>a.questions.length-b.questions.length);
    const initial=ordered.slice(0,5);
    if(initial.reduce((n,g)=>n+g.questions.length,0)>=14)continue;
    changedCase=true;
    for(const g of singles)for(const q of g.questions)s.seen[q.id]=initial.includes(g)?0:90;
    const e=buildExam(bank,s,'half','boundary'+form);
    const selections=e.units.filter(u=>u.part===7).map(u=>({u,g:catalog.get(u.ids[0]).data.set}));
    assert.equal(e.form,form);assert.ok(examValid(e,catalog));
    const single=selections.filter(x=>x.g.documents.length===1);
    assert.equal(single.length,5);
    assert.equal(single.reduce((n,{u})=>n+u.ids.length,0),14);
    assert.ok(single.some(({g})=>!initial.includes(g)),'original five could not hold 14 questions');
    assert.deepEqual(selections.filter(x=>x.g.documents.length===2).map(x=>x.u.ids.length),[5]);
    assert.deepEqual(selections.filter(x=>x.g.documents.length===3).map(x=>x.u.ids.length),[4,4]);
    for(const {u,g} of selections)assert.ok(u.ids.every(id=>catalog.get(id).data.set.id===g.id));
  }
  assert.ok(changedCase,'the real corpus should include a low-capacity candidate set');
});
test('malformed imports are rejected without relying solely on part totals',()=>{
  const original=buildExam(bank,state(),'half','invalid-input');assert.ok(examValid(original,catalog));
  const mutations=[
    e=>{const [a,b]=e.units.filter(u=>u.part===3);[a.ids[0],b.ids[0]]=[b.ids[0],a.ids[0]];},
    e=>{e.units.find(u=>u.part===2).ids[0]=bank.part2.find(q=>q.type==='first').id;},
    e=>{const u=e.units.find(u=>u.part===3);u.ids[0]=catalog.get(u.ids[0]).data.set.dictation.id;},
    e=>{e.step=listeningScript(e.units[0],catalog).length+1;},
    e=>{e.answeredAt={'unknown-question':0};},
    e=>{e.times[e.units[0].ids[0]]=-1;},
    e=>{e.phase='done';e.keys={};}
  ];
  for(const mutate of mutations){const e=structuredClone(original);mutate(e);assert.equal(examValid(e,catalog),false);}
});
test('completed scores use stored answer keys after a question changes or disappears',()=>{
  const e=buildExam(bank,state(),'half','frozen-result'), ids=examIds(e);
  e.keys=Object.fromEntries(ids.map(id=>[id,catalog.get(id).data.answer]));
  for(let i=0;i<ids.length;i+=2)e.answers[ids[i]]=e.keys[ids[i]];
  e.phase='done';e.finishedAt=e.startedAt+1000;
  const result=examScores(e,catalog);
  assert.equal(result.parts.reduce((n,p)=>n+p.correct,0),50);
  assert.deepEqual(examScores(e,new Map()),result);
  const changed=new Map([...catalog].map(([id,original])=>[id,{...original,data:{...original.data,answer:'revised key'}}]));
  assert.deepEqual(examScores(e,changed),result);
});
test('a migrated report never attributes mixed legacy reading outcomes to one part',()=>{
  const s=state(),g6=bank.reading.find(g=>g.part===6),g7=bank.reading.find(g=>g.part===7);
  const [id6,id7]=[g6,g7].map(g=>g.questions[0].id);
  s.seen={[id6]:1,[id7]:1};s.history=[{skill:'reading',level:g6.level,ok:true},{skill:'reading',level:g7.level,ok:false}];
  const now=new Date(2026,4,13,12).getTime();
  let html=reportView(s,bank,now);
  assert.match(html,/旧记录没有作答日期/);
  assert.match(html,/Part 6 · 短文填空<\/b><small>有判定 0\/0 · 共 1 题次/);
  assert.match(html,/Part 7 · 阅读理解<\/b><small>有判定 0\/0 · 共 1 题次/);
  s.seen[id6]++;recordStudy(s,{mode:'reading',id:id6},{set:g6},true,now);
  html=reportView(s,bank,now);
  assert.match(html,/Part 6 · 短文填空<\/b><small>有判定 1\/1 · 共 2 题次/);
  assert.ok(validReport(s.report));
});
test('a report recommendation routes to the exact weaker real grammar topic',()=>{
  const s=state(),t1=bank.grammar[0],t2=bank.grammar[1],now=new Date(2026,4,13,12).getTime();
  for(const [topic,results] of [[t1,[true,true,true]],[t2,[true,false,false]]]){
    for(const [i,ok] of results.entries()){
      const q=topic.questions[i],ref={mode:'grammar',id:q.id};s.seen[q.id]=1;
      s.history.push({skill:'grammar',level:q.level,ok});
      recordStudy(s,ref,{...q,topic},ok,now);
    }
  }
  const html=reportView(s,bank,now);
  assert.ok(html.includes('data-act="start" data-mode="grammar" data-filter="'+t2.id+'"'));
  assert.ok(html.includes(t2.title+' · 正确率 33%'));
});
test('the real Part 6 corpus gives every score band a complete four-gap reading',()=>{
  const groups=bank.reading.filter(g=>g.part===6);
  assert.deepEqual([...new Set(groups.map(g=>g.level))].sort(),[400,500,600,700,800,900]);
  for(const g of groups){
    const markers=g.documents.map(d=>d.text).join('\n').match(/\[[1-4]\]/g);
    assert.deepEqual(markers,['[1]','[2]','[3]','[4]'],g.id);
    assert.equal(g.questions.length,4,g.id);
    assert.equal(g.questions.filter(q=>q.kind==='sentence').length,1,g.id);
  }
});
