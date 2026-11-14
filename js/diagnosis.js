export const abilities = ['vocab','grammar','listening','reading'];
export const abilityNames = {vocab:'单词',grammar:'语法',listening:'听力',reading:'阅读'};
const rounds = [0,1,5,6,2,0,5,7,3,0,5,6,4,0,5,7,1,0,5,6,2,0,5,7,3,0,5,6,4,7];
export const diagnosisCount = rounds.length;
const skillOf = part => part === 0 ? 'vocab' : part === 5 ? 'grammar' : part >= 6 ? 'reading' : 'listening';
const modeOf = part => ['vocab','part1','part2','dialogue','dialogue','grammar','reading','reading'][part];
const levels = [400,500,600,700,800,900];
const clamp = value => Math.max(400,Math.min(900,value));
const band = value => clamp(Math.round(value / 100) * 100);
const initial = () => Object.fromEntries(abilities.map(skill=>[skill,500]));
const empty = () => ({skipped:false,active:null,results:[],since:null});
const count = v => Number.isSafeInteger(v) && v >= 0;
const record = v => v && typeof v==='object' && !Array.isArray(v);
const safeId = v => typeof v==='string' && /^[\w-]{1,100}$/.test(v);
function hash(s) {
  let n=2166136261;
  for(const c of s) n=Math.imul(n ^ c.charCodeAt(0),16777619);
  return n>>>0;
}
function partOf(ref,data) {
  return ({vocab:0,part1:1,part2:2,grammar:5})[ref.mode] ?? data.set?.part;
}
export function startDiagnosis(state,catalog,now=Date.now()) {
  const d=state.diagnosis ??= empty();
  if(!d.active){
    d.active={started:now,items:[],current:null};
    selectNext(state,catalog);
  }
  return d.active;
}
export function skipDiagnosis(state) {
  (state.diagnosis ??= empty()).skipped=true;
}
export function nextDiagnosisTarget(items){
  return items.reduce((target,row)=>clamp(target+(row.ok?100:-100)),500);
}
export function diagnosisLevels(items){
  const values=initial();
  for(const row of items) {
    const skill=skillOf(row.part);
    const expected=1/(1+10**((row.level-values[skill])/340));
    values[skill]=clamp(values[skill]+135*(Number(row.ok)-expected));
  }
  return Object.fromEntries(abilities.map(s=>[s,band(values[s])]));
}
function selectNext(state,catalog){
  const d=state.diagnosis, a=d.active, part=rounds[a.items.length],skill=skillOf(part);
  const wanted=nextDiagnosisTarget(a.items);
  const known=new Set(a.items.map(row=>row.id));
  const sources=new Set(a.items.map(row=>row.group).filter(Boolean));
  const recent=new Set(d.results.slice(-3).flatMap(r=>r.items.map(q=>q.id)));
  let best=null, bestCost=Infinity;
  for(const {ref,data} of catalog.values()){
    if(ref.mode!==modeOf(part)||partOf(ref,data)!==part||known.has(ref.id))continue;
    if(part===2 && data.type!=='response')continue;
    const repeats = Math.min(3, state.seen[ref.id]||0) + Number(recent.has(ref.id));
    const cost=Math.abs(wanted-data.level)*1000+Number(sources.has(data.set?.id))*100+
      repeats*30 + hash(a.started+':'+a.items.length+':'+ref.id)/2**32;
    if(cost<bestCost){best={...ref,part,target:wanted,level:data.level,...(data.set?{group:data.set.id}:{})};bestCost=cost;}
  }
  if(!best) throw Error('诊断题库未就绪，请重新载入。');
  if(part===0)best.format=['meaning','english','cloze','match'][a.items.filter(x=>x.part===0).length%4];
  a.current=best;
}
export function answerDiagnosis(state,id,ok,catalog,now=Date.now(),unknown=false){
  const d=state.diagnosis,a=d?.active;
  if(!a||a.current?.id!==id||typeof ok!=='boolean')return null;
  const ref=a.current;
  a.items.push({id,part:ref.part,level:ref.level,ok,...(unknown?{unknown:true}:{}),...(ref.group?{group:ref.group}:{})});
  if(a.items.length<diagnosisCount){selectNext(state,catalog);return null;}
  const levels=diagnosisLevels(a.items);
  const result={at:now,items:a.items,levels,ranges:diagnosisRanges(levels,a.items)};
  d.results.push(result);
  d.active=null;d.skipped=false;
  d.since=Object.fromEntries(abilities.map(skill=>[skill,0]));
  return result;
}
// Placement bands use the evidence in this diagnostic only. The ongoing prediction
// combines this evidence with later independent practice and simulated exams.
export function diagnosisRanges(levels,items){
  function range(center,n){
    const uncertainty=35+95/Math.sqrt(1+n/3);
    return [Math.max(5,5*Math.round((center-uncertainty)/5)),Math.min(495,5*Math.round((center+uncertainty)/5))];
  }
  const reading=levels.reading*.64+levels.grammar*.26+levels.vocab*.10;
  return {L:range(levels.listening/2,items.filter(r=>skillOf(r.part)==='listening').length),
    R:range(reading/2,items.filter(r=>skillOf(r.part)!=='listening').length)};
}
export function diagnosisPractice(state,skill){
  if(state.diagnosis?.since && abilities.includes(skill)) {
    state.diagnosis.since[skill]=Math.min(12,1+state.diagnosis.since[skill]);
  }
}
export function diagnosedDifficulty(state,skill,recent){
  const diag=state.diagnosis,last=diag?.results.at(-1);
  if(!last||!diag.since)return null;
  const n=diag.since[skill];
  if(n>=12)return null;
  const post=n?recent.slice(-n):[];
  if(post.length<4)return last.levels[skill];
  const weight=12-post.length;
  const avg=(post.reduce((sum,h)=>sum+h.level,0)+weight*last.levels[skill])/12;
  const pct=post.filter(h=>h.ok).length/post.length;
  return band(avg)+(pct>=.75&&band(avg)<900?100:pct<.45&&band(avg)>400?-100:0);
}
function validItems(items,complete){
  if(!Array.isArray(items)||(complete?items.length!==rounds.length:items.length>=rounds.length))return false;
  const seen=new Set();
  return items.every((q,i)=>{
    if(!record(q)||!safeId(q.id)||seen.has(q.id)||rounds[i]!==q.part||!levels.includes(q.level)||
       typeof q.ok!=='boolean'||(q.unknown!==undefined&&(q.unknown!==true||q.ok))||(q.group!==undefined&&!safeId(q.group)))return false;
    seen.add(q.id);return true;
  });
}
export function validDiagnosis(d){
  if(d===undefined)return true;
  if(!record(d)||typeof d.skipped!=='boolean'||!Array.isArray(d.results))return false;
  if(!d.results.every(r=>record(r)&&count(r.at)&&validItems(r.items,true)&&record(r.levels)&&
    abilities.every(s=>r.levels[s]===diagnosisLevels(r.items)[s])&&(!r.ranges||['L','R'].every(k=>Array.isArray(r.ranges[k])&&r.ranges[k].length===2&&r.ranges[k].every((x,i)=>x===diagnosisRanges(r.levels,r.items)[k][i])))))return false;
  if(d.results.length){if(!record(d.since)||!abilities.every(s=>count(d.since[s])&&d.since[s]<=12))return false;}
  else if(d.since!==null)return false;
  if(d.active===null)return true;
  const a=d.active,c=a?.current;
  return record(a)&&count(a.answerMs??0)&&count(a.started)&&validItems(a.items,false)&&record(c)&&safeId(c.id)&&
    (c.target===undefined||c.target===nextDiagnosisTarget(a.items))&&c.part===rounds[a.items.length]&&c.mode===modeOf(c.part)&&levels.includes(c.level)&&
    (c.part!==0||['meaning','english','cloze','match'].includes(c.format))&&!a.items.some(row=>row.id===c.id);
}
export function reconcileDiagnosis(state,catalog){
  const run=state.diagnosis?.active,ref=run?.current;
  if(!run)return;
  const item=catalog.get(ref.id);
  if(!item||item.ref.mode!==ref.mode||partOf(item.ref,item.data)!==ref.part||item.data.level!==ref.level)
    selectNext(state,catalog);
}
