// Ratings live on the question difficulty scale. They are converted to each simulated
// L/R subscore only for display. One dated point is the end-of-day estimate.
const parts=['L','R'];
const bound=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const initial=()=>({rating:400,evidence:0});
const empty=()=>({version:1,L:initial(),R:initial(),days:{},exposure:{}});
const count=x=>Number.isSafeInteger(x)&&x>=0;
const safeId=s=>typeof s==='string'&&/^[\w-]{1,100}$/.test(s)&&!Object.hasOwn(Object.prototype,s)&&s!=='prototype';
const finite=(x,lo,hi)=>Number.isFinite(x)&&x>=lo&&x<=hi;
function dateKey(value){
  const d=new Date(value);
  return String(d.getFullYear()).padStart(4,'0')+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
const validDay=k=>/^\d{4}-\d{2}-\d{2}$/.test(k)&&dateKey(k+'T12:00:00')===k;
export function validPrediction(p){
  if(p===undefined)return true;
  if(!p||p.version!==1||!p.exposure||typeof p.exposure!=='object'||Array.isArray(p.exposure)
    ||!p.days||typeof p.days!=='object'||Array.isArray(p.days))return false;
  return parts.every(k=>p[k]&&finite(p[k].rating,10,990)&&finite(p[k].evidence,0,Number.MAX_SAFE_INTEGER))
    &&Object.entries(p.exposure).every(([k,v])=>safeId(k)&&count(v)&&v>0)
    &&Object.entries(p.days).every(([k,point])=>validDay(k)&&Array.isArray(point)&&point.length===2&&point.every(x=>Number.isInteger(x)&&finite(x,5,495)&&x%5===0));
}
function source(ref,data){
  const mode=ref.mode,part=({part1:1,part2:2,grammar:5})[mode]??data.set?.part??data.part??ref.part;
  if(mode==='vocab')return {key:'R',weight:.28};
  if(mode==='dictation')return {key:'L',weight:.35};
  if(mode==='part2'&&data.type==='first')return {key:'L',weight:.4};
  if(part>=1&&part<=4)return {key:'L',weight:1};
  if(part>=5&&part<=7)return {key:'R',weight:part===5?.78:1};
  return null;
}
function update(p,key,level,ok,weight,choiceCount) {
  const b=p[key];
  // Reduce guessing credit on multiple-choice items; free recall uses no guessing floor.
  const guess=choiceCount>=2?1/choiceCount:0;
  const expected=guess+(1-guess)/(1+10**((level-b.rating)/310));
  const sensitivity=42+62/Math.sqrt(1+b.evidence/6);
  b.rating=bound(b.rating+sensitivity*weight*(Number(ok)-expected),10,990);
  b.evidence+=weight;
}
const subscore=rating=>bound(5*Math.round(rating/10),5,495);
function snapshot(p,now){
  p.days[dateKey(now)]=parts.map(k=>subscore(p[k].rating));
}
// Initialize from the evidence actually present, before the current verdict enters
// history. Legacy skill-only history is weaker than identified independent items.
export function ensurePrediction(s){
  if(s.prediction)return s.prediction;
  const p=empty();
  for(const h of s.history||[]){
    const key=h.skill==='listening'?'L':'R';
    update(p,key,h.level,h.ok,h.skill==='vocab'?.15:.45,4);
  }
  // Legacy history has no dates. It deliberately creates no synthetic chart points.
  s.prediction=p;return p;
}
function apply(s,ref,data,ok,{sourceType='practice',outcome,previouslySeen=0}={}){
  const p=ensurePrediction(s),spec=source(ref,data);
  if(!spec||typeof ok!=='boolean'||!finite(data.level??ref.level,400,900))return false;
  const id=ref.id;if(!safeId(id))return false;
  const exposures=Math.max(previouslySeen||0,p.exposure[id]||0);
  // A previously revealed answer is less independent evidence. This reduction applies
  // to mocks and diagnosis as well as drills, including repeats from an older save.
  const repetition=exposures?1/(4*Math.sqrt(exposures)):1;
  const method=sourceType==='exam'?1.1:sourceType==='diagnosis'?1:.82;
  const count=ref.mode==='dictation'?0:Math.max(2,Math.min(6,data.options?.length||4));
  update(p,spec.key,data.level??ref.level,ok,spec.weight*method*repetition,count);
  p.exposure[id]=exposures+1;
  return true;
}
export function predictAnswer(s,ref,data,ok,now=Date.now(),meta={}){
  if(!apply(s,ref,data,ok,meta))return;
  snapshot(s.prediction,now);
}
export function predictionSummary(s){
  // Read-only rendering also handles an untouched legacy profile before the first new answer.
  const p=s.prediction||ensurePrediction({history:s.history});
  const a={};
  for(const k of parts){
    const b=p[k],confidence=b.evidence/(b.evidence+12),estimate=subscore(b.rating);
    const spread=5*Math.round((25+85*(1-confidence))/5);
    a[k]={score:estimate,low:Math.max(5,estimate-spread),high:Math.min(495,estimate+spread),evidence:b.evidence};
  }
  return {...a,total:a.L.score+a.R.score,low:a.L.low+a.R.low,high:a.L.high+a.R.high};
}
function chart(days,range,now,series){
  const section=series==='L'||series==='R',label=({L:'听力',R:'阅读'})[series]||'总';
  const end=dateKey(now),begin=new Date(now);
  begin.setDate(begin.getDate()-(range==='7'?6:29));
  const keys=Object.keys(days).filter(k=>k<=end&&(range==='all'||k>=dateKey(begin))).sort();
  if(!keys.length)return '<p class="prediction-empty">这段时间还没有已记录的估分。完成练习后会留下当天的一个点。</p>';
  const span=range==='all'?keys[0]:dateKey(begin);
  const utc=k=>Date.parse(k+'T00:00:00Z');
  const start=utc(span),stop=utc(end);const results=keys.map(k=>({k,total:section?days[k][series==='L'?0:1]:days[k][0]+days[k][1]}));
  const x=k=>start===stop?150:32+244*(utc(k)-start)/(stop-start);
  const y=n=>105-86*(n-(section?5:10))/(section?490:980);
  const path=results.map((v,i)=>(i?'L':'M')+x(v.k).toFixed(1)+' '+y(v.total).toFixed(1)).join(' ');
  const startLabel=span.slice(5),endLabel=end.slice(5);
  return '<svg data-pred-chart role="img" aria-label="'+label+'估分趋势，'+results.length+' 个学习日" viewBox="0 0 300 130" style="width:100%;height:auto">'+
    (section?[5,250,495]:[10,500,990]).map(n=>'<line x1="30" x2="280" y1="'+y(n)+'" y2="'+y(n)+'" stroke="var(--border)"/><text x="1" y="'+(y(n)+3)+'" font-size="9" fill="currentColor">'+n+'</text>').join('')+
    '<path d="'+path+'" fill="none" stroke="var(--accent)" stroke-width="2.5"/>'+
    results.map(({k,total})=>'<circle cx="'+x(k)+'" cy="'+y(total)+'" r="3" fill="var(--accent)"><title>'+k+' · '+total+' 分</title></circle>').join('')+
    '<text x="32" y="123" font-size="10" fill="currentColor">'+startLabel+'</text><text x="276" y="123" text-anchor="end" font-size="10" fill="currentColor">'+endLabel+'</text></svg>';
}
export function predictionView(s,range='30',now=Date.now(),series='total'){
  const valid=['7','30','all'].includes(range)?range:'30',v=predictionSummary(s);
  return '<section class="panel prediction-pane" id="prediction"><h2>分科估分 <small>仅供参考</small></h2><div class="diag-levels">'+parts.map(k=>
    '<div><b>'+(k==='L'?'听力':'阅读')+'</b><strong>'+v[k].score+' / 495</strong></div>').join('')+'</div>'+
    '<p>总估分 <b>'+v.total+'</b> / 990 · 参考范围 '+v.low+'–'+v.high+' 分</p>'+
    '<p>听力 '+v.L.low+'–'+v.L.high+' 分，阅读 '+v.R.low+'–'+v.R.high+' 分。新题样本少时，参考范围较宽。</p>'+
    '<div class="prediction-range" aria-label="查看估分时段">'+[['7','7 天'],['30','30 天'],['all','全部']].map(([k,t])=>
      '<button class="secondary" data-act="pred-range" data-range="'+k+'" aria-pressed="'+(k===valid)+'">'+t+'</button>').join('')+'</div>'+
    '<div class="prediction-range" aria-label="曲线科目">'+[['total','总分'],['L','听力'],['R','阅读']].map(([k,t])=>
      '<button class="secondary" data-act="pred-series" data-series="'+k+'" aria-pressed="'+(k===series)+'">'+t+'</button>').join('')+'</div>'+
    chart(s.prediction?.days||{},valid,now,series)+'</section>';
}
