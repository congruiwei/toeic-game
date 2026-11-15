import {advance,validCard} from './review-scheduler.js';
const directions=['ja-en','en-ja'];
const banks=['vocab','part1','part2','listening','grammar','reading','methods'];
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const keyOK=x=>typeof x==='string'&&/^[\w/-]{1,180}$/.test(x)&&!x.split('/').some(s=>['__proto__','constructor','prototype'].includes(s));
const textOK=x=>typeof x==='string'&&x.trim().length>0&&x.length<20000;
const timeOK=x=>Number.isSafeInteger(x)&&x>=0&&x<=8640000000000000;
const itemOK=i=>record(i)&&keyOK(i.key)&&keyOK(i.sourceId)&&i.key.startsWith(i.sourceId+'/')&&
  banks.includes(i.bank)&&['en','zh','ja'].every(k=>textOK(i[k]))&&timeOK(i.addedAt)&&
  (i.fsrs===undefined||(record(i.fsrs)&&validCard(i.fsrs)));

export function migrateExpressions(s) {
  // Only an absent field denotes an older backup. Invalid present data must not
  // be replaced by an empty collection, or an import could silently lose cards.
  if(s.expressions===undefined)s.expressions={version:1,items:[],run:null};
  const x=s.expressions;
  if(!record(x)||x.version!==1||!Array.isArray(x.items)||x.items.length>10000||
    !x.items.every(itemOK)||new Set(x.items.map(i=>i.key)).size!==x.items.length)throw Error('表达本记录有误');
  const r=x.run;
  if(r!==null&&(!record(r)||!directions.includes(r.direction)||!Array.isArray(r.keys)||
    !r.keys.length||r.keys.length>20||new Set(r.keys).size!==r.keys.length||
    !r.keys.every(k=>x.items.some(i=>i.key===k))||!Number.isInteger(r.index)||
    r.index<0||r.index>r.keys.length||typeof r.flipped!=='boolean'||
    (r.index===r.keys.length&&r.flipped)))throw Error('表达本练习记录有误');
}
export function collectExpression(s,unit,zh,ja,now=Date.now()) {
  migrateExpressions(s);
  if(!record(unit)||!textOK(zh)||!textOK(ja))throw Error('请先下载本句的中日译文');
  const item={key:unit.key,sourceId:unit.id,bank:unit.bank,en:unit.text,zh,ja,addedAt:now};
  if(!itemOK(item))throw Error('无法收藏这条表达：来源或原文有误');
  if(s.expressions.items.some(i=>i.key===unit.key))return false;
  if(s.expressions.items.length>=10000)throw Error('表达本已达到 10000 条上限');
  s.expressions.items.push(item);
  return true;
}
export function beginExpressions(s,direction,now=Date.now()) {
  migrateExpressions(s);if(!directions.includes(direction))return false;
  const items=[...s.expressions.items].sort((a,b)=>(a.fsrs?.due||0)-(b.fsrs?.due||0));
  const due=items.filter(i=>!i.fsrs||i.fsrs.due<=now);
  const keys=(due.length?due:items).slice(0,20).map(i=>i.key);
  if(!keys.length)return false;
  s.expressions.run={direction,keys,index:0,flipped:false};return true;
}
export function rateExpression(s,grade,now=Date.now()) {
  const r=s.expressions?.run;if(!r?.flipped||![1,2,3,4].includes(grade)||!timeOK(now))return false;
  const item=s.expressions.items.find(i=>i.key===r.keys[r.index]);if(!item)return false;
  item.fsrs=advance(item.fsrs,grade,now,s.settings?.retention);r.index++;r.flipped=false;return true;
}
export const expressionStats=(s,now=Date.now())=>{
  const items=s.expressions?.items||[];
  return {total:items.length,mastered:items.filter(i=>i.fsrs?.state===2&&i.fsrs.stability>=7).length,due:items.filter(i=>!i.fsrs||i.fsrs.due<=now).length};
};
