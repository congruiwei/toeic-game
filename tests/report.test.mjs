import test from 'node:test';
import assert from 'node:assert/strict';
import {recordStudy, reportView, validReport} from '../js/report.js';

const bank={
  part1:[{id:'ph'}], part2:[{id:'qq'}],
  grammar:[{id:'tense',title:'时态',questions:[{id:'past'}]}],
  reading:[{id:'msg',part:7,questions:[{id:'mail'}]}],
  listening:[{id:'talk',part:3,questions:[{id:'listener'}],dictation:{id:'spell'}}],
  vocab:[{id:'word',level:400},{id:'word2',level:500}]
};
const base=()=>({seen:{},words:{},history:[]});
const stamp=(y,m,d,h=12)=>new Date(y,m-1,d,h).getTime();
const mark=(s, mode, id, data, ok, ms)=>{
  const skill=mode==='grammar'?'grammar':mode==='reading'?'reading':mode==='vocab'?'vocab':'listening';
  s.seen[id]=(s.seen[id]||0)+1;s.history.push({skill,level:400,ok});
  if(mode==='vocab'){
    const w=s.words[id]??={box:0,right:0,tries:0};w.tries++;w.right+=Number(ok);w.box=ok?Math.min(5,w.box+1):0;
  }
  recordStudy(s,{mode,id},data,ok,ms);
};
test('v1 report is optional; rejects malformed restored counters and calendar dates',()=>{
  assert.ok(validReport(undefined));assert.equal(validReport(null),false);
  const s=base();recordStudy(s,{mode:'grammar',id:'past'},{topic:{id:'tense'}},true,stamp(2025,2,28));
  assert.ok(validReport(s.report));const s2=structuredClone(s.report);s2.topics.tense.right=2;
  assert.equal(validReport(s2),false);
  const s3=structuredClone(s.report);s3.days={'2025-02-30':1};assert.equal(validReport(s3),false);
  assert.equal(validReport({...s.report,parts:{'8':{total:1,right:1}}}),false);
  assert.equal(validReport({...s.report,days:{'2025-02-27':5}}),false);
});
test('practice and exam share counters; SRS vocabulary mastery uses the current box',()=>{
  const s=base();const time=stamp(2026,11,17);
  for (const [mode,id,data,ok] of [
    ['part1','ph',{},true],['part2','qq',{},true],['dialogue','listener',{set:{part:3}},true],
    ['reading','mail',{part:7},true],['grammar','past',{topic:{id:'tense'}},false],
    ['dictation','spell',{set:{part:3}},true],...Array.from({length:3},()=>['vocab','word',{},true])
  ]) mark(s,mode,id,data,ok,time);
  assert.ok(validReport(s.report));const view=reportView(s,bank,time);
  assert.match(view, /data-mode="grammar" data-filter="tense"/);
  assert.match(view, /400 级<\/b><span>1 \/ 1 词/);
  assert.equal(s.report.days['2026-11-17'],9);assert.equal(s.report.parts.dictation.total,1);
  mark(s,'vocab','word',{},false,time);
  assert.match(reportView(s,bank,time), /400 级<\/b><span>0 \/ 1 词/);
});
test('local 7/30 day windows include today, exclude tomorrow and do not invent dates for legacy answers',()=>{
  const s=base(),today=stamp(2026,3,2);
  s.seen={past:2,qq:6};s.history=[{skill:'grammar',ok:false},{skill:'grammar',ok:true}];
  let v=reportView(s,bank,today);assert.match(v,/0<\/strong><span>近 7 天/);
  assert.match(v,/时态<\/b><small>1 对 \/ 2 题次/);assert.match(v,/旧记录没有作答日期/);
  for(const [m,d] of [[1,31],[2,1],[2,22],[2,24],[3,2],[3,3]])
    mark(s,'reading','mail',{set:{part:7}},true,stamp(2026,m,d));
  v=reportView(s,bank,today);assert.match(v,/2<\/strong><span>近 7 天/);
  assert.match(v,/4<\/strong><span>近 30 天/);
  assert.match(v,/有判定 0\/0 · 共 6 题次/);
});
test('long-term counters survive day pruning and serialization',()=>{
  const s=base();mark(s,'grammar','past',{topic:{id:'tense'}},false,stamp(2022,1,1));
  mark(s,'grammar','past',{topic:{id:'tense'}},true,stamp(2026,10,25));
  assert.deepEqual(s.report.topics.tense,{right:1,total:2});
  assert.deepEqual(Object.keys(s.report.days),['2026-10-25']);
  assert.ok(validReport(JSON.parse(JSON.stringify(s.report))));
});
