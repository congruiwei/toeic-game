import test from 'node:test';import assert from 'node:assert/strict';
import {fresh} from '../js/state.js';
import {collectExpression,beginExpressions,rateExpression,migrateExpressions,expressionStats} from '../js/expressions.js';
const unit={key:'p2-010/options/1/0',id:'p2-010',bank:'part2',text:"I'll get back to you."};
test('collected sentence is a portable trilingual snapshot with duplicate protection',()=>{
 const s=fresh();assert(collectExpression(s,unit,'我会再联系您。','折り返しご連絡いたします。',100));
 assert(!collectExpression(s,unit,'我会再联系您。','折り返しご連絡いたします。',200));
 const restored=JSON.parse(JSON.stringify(s));migrateExpressions(restored);assert.equal(restored.expressions.items.length,1);
 assert.equal(restored.expressions.items[0].ja,'折り返しご連絡いたします。');
});
test('both directions preserve progress; ratings require flipping and use FSRS',()=>{
 for(const direction of ['ja-en','en-ja'])for(const grade of [1,2,3,4]){
  const s=fresh();collectExpression(s,unit,'我会再联系您。','折り返しご連絡いたします。',100);
  assert(beginExpressions(s,direction,100));assert(!rateExpression(s,grade,100));
  s.expressions.run.flipped=true;assert(rateExpression(s,grade,100));assert(!rateExpression(s,grade,100));
  const card=s.expressions.items[0].fsrs;assert.equal(card.lastRating,grade);assert(card.due>100);
  migrateExpressions(s);assert.equal(expressionStats(s).total,1);
 }
});
test('malformed expression backups are rejected without discarding the good cards',()=>{
 const s=fresh();collectExpression(s,unit,'再联系。','ご連絡します。',100);const copy=structuredClone(s);
 copy.expressions.items[0].fsrs={due:NaN};assert.throws(()=>migrateExpressions(copy));
 assert.equal(s.expressions.items[0].fsrs,undefined);
});

test('old backups receive an empty collection once; present invalid data is rejected without replacement',()=>{
 const legacy=fresh();delete legacy.expressions;migrateExpressions(legacy);
 assert.deepEqual(legacy.expressions,{version:1,items:[],run:null});
 const copy=structuredClone(legacy);migrateExpressions(legacy);assert.deepEqual(legacy,copy);
 for(const bad of [null,false,0,[],{version:2,items:[],run:null}]){
  const s=fresh();s.expressions=bad;assert.throws(()=>migrateExpressions(s),/表达本/);assert.equal(s.expressions,bad);
 }
});

test('malformed memory and run references cannot erase review history or duplicate a practice card',()=>{
 const s=fresh();collectExpression(s,unit,'再联系。','ご連絡します。',100);beginExpressions(s,'ja-en',100);
 const variants=[
  x=>x.items[0].fsrs=false,x=>x.items[0].fsrs=null,x=>x.items[0].fsrs=0,
  x=>x.items[0].fsrs='',x=>x.items.push(null),x=>x.items[0].addedAt=Number.MAX_SAFE_INTEGER,
  x=>x.items[0].key='different/source',x=>x.run.keys.push(x.run.keys[0]),
  x=>x.run.keys[0]='retired-but-not-collected/source',x=>x.run.index=-1,
  x=>{x.run.index=x.run.keys.length;x.run.flipped=true;},
 ];
 for(const edit of variants){const c=structuredClone(s);edit(c.expressions);assert.throws(()=>migrateExpressions(c),/表达本/);}
 assert.equal(s.expressions.items.length,1);assert.equal(s.expressions.run.index,0);
});

test('collection validates the source and capacity before inserting anything',()=>{
 const s=fresh();migrateExpressions(s);
 for(const edit of [u=>u.text='',u=>u.id='__proto__',u=>u.bank='unknown',u=>u.key='other/example/0',u=>u.key='constructor/example/0']){
  const bad={...unit};edit(bad);assert.throws(()=>collectExpression(s,bad,'中文','日本語',100));assert.equal(s.expressions.items.length,0);
 }
 assert.throws(()=>collectExpression(s,unit,'中文','日本語',NaN));
 assert.throws(()=>collectExpression(s,unit,'中文','',100));
 s.expressions.items=Array.from({length:10000},(_,i)=>({key:`old-${i}/text/0`,sourceId:`old-${i}`,bank:'part2',en:'Hello.',zh:'您好。',ja:'こんにちは。',addedAt:100}));
 assert.throws(()=>collectExpression(s,unit,'中文','日本語',100),/10000/);
 assert.equal(s.expressions.items.length,10000);
});

test('snapshots and flipped direction survive JSON backup even after source IDs retire',()=>{
 const s=fresh();collectExpression(s,unit,'我会再联系您。','折り返しご連絡いたします。',100);
 beginExpressions(s,'en-ja',100);s.expressions.run.flipped=true;
 const saved=JSON.stringify(s),restored=JSON.parse(saved);migrateExpressions(restored);
 assert.deepEqual(restored,s);
 // There is no catalog lookup: a retired source remains a complete study card.
 assert.equal(restored.expressions.items[0].en,unit.text);assert.equal(restored.expressions.run.direction,'en-ja');
 assert(rateExpression(restored,3,200));assert.equal(restored.expressions.items[0].fsrs.reps,1);
});

test('only due/new cards enter a due batch; early practice is available when every card is in the future',()=>{
 const s=fresh();
 for(const [n,time] of [['new',100],['future',200],['due',300]])collectExpression(s,{...unit,id:n,key:n+'/text/0'},'中文','日本語',time);
 beginExpressions(s,'en-ja',1000);s.expressions.run.flipped=true;rateExpression(s,4,1000);
 // Assign independently created valid schedules to isolate ordering from card insertion.
 const template=s.expressions.items[0].fsrs;
 delete s.expressions.items[0].fsrs;
 s.expressions.items[1].fsrs={...template,due:9000};s.expressions.items[2].fsrs={...template,due:1500};
 assert(beginExpressions(s,'ja-en',2000));assert.deepEqual(s.expressions.run.keys,['new/text/0','due/text/0']);
 assert.deepEqual(expressionStats(s,2000),{total:3,mastered:2,due:2});
 s.expressions.items[0].fsrs={...template,due:5000};s.expressions.items[2].fsrs.due=7000;
 beginExpressions(s,'en-ja',2000);assert.deepEqual(s.expressions.run.keys,['new/text/0','due/text/0','future/text/0']);
});

test('FSRS uses the requested retention and never scores invalid grades or a repeated tap',()=>{
 const due=[];
 for(const retention of [.85,.95]){
  const s=fresh();s.settings.retention=retention;collectExpression(s,unit,'中文','日本語',100);
  beginExpressions(s,'ja-en',1000);s.expressions.run.flipped=true;
  assert(!rateExpression(s,0,1000));assert(!rateExpression(s,'3',1000));assert(!rateExpression(s,3,NaN));
  assert(rateExpression(s,4,1000));assert(!rateExpression(s,4,1000));
  assert.equal(s.expressions.items[0].fsrs.reps,1);due.push(s.expressions.items[0].fsrs.due);
  beginExpressions(s,'en-ja',500);s.expressions.run.flipped=true;rateExpression(s,1,500);
  assert.equal(s.expressions.items[0].fsrs.last_review,1000,'backwards clock stays monotonic');
  assert.equal(expressionStats(s,1000).mastered,0);
 }
 assert(due[1]<due[0],'higher desired retention schedules sooner');
});

test('both front faces hide the other two languages; flipped views escape all snapshot text',async()=>{
 const {expressionView,expressionReport}=await import('../js/expression-ui.js');
 const s=fresh();const u={...unit,text:'Please <send> the invoice.'};
 collectExpression(s,u,'请发来<发票>。','<請求書>を送ってください。',100);
 for(const direction of ['ja-en','en-ja']){
  beginExpressions(s,direction,100);
  const front=expressionView(s,true);
  assert(front.includes(direction==='ja-en'?'&lt;請求書&gt;を送ってください。':'Please &lt;send&gt; the invoice.'));
  assert(!front.includes(direction==='ja-en'?'Please &lt;send&gt;':'&lt;請求書&gt;'));
  assert(!front.includes('请发来'));assert(!front.includes('data-act="expression-rate"'));
  s.expressions.run.flipped=true;const back=expressionView(s,true);
  assert(back.includes('lang="en"'));assert(back.includes('lang="zh-CN"'));assert(back.includes('lang="ja"'));
  assert(!back.includes('<send>'));assert(!back.includes('<請求書>'));assert.equal((back.match(/data-act="expression-rate"/g)||[]).length,4);
 }
 assert.match(expressionReport(s),/收藏 1 · 已掌握 0/);
});
