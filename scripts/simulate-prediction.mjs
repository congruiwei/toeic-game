// Paired, seeded simulation of the production prediction API. No user save or network access.
// node scripts/simulate-prediction.mjs --help
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../',import.meta.url));
const usage = `node scripts/simulate-prediction.mjs [options]
  --baseline REF      Git revision containing the historical JS and difficulty distribution (a3d60cb)
  --model FILE        Candidate prediction.js module (working tree js/prediction.js)
  --seed N            First unsigned 32-bit seed (1729)
  --seeds N           Independent paired trajectories (128, at least 2)
  --slope N           Base-10 ability-response slope in difficulty points (300)
  --json              Machine-readable output, including assumptions and paired differences
Fixed protocol: 200 formal answers, then 300 more for SD; five formal answers per local day.
A no-word control and both 95%/30% word-accuracy stress arms share the same formal answers.
Unscored "know/don't know" declarations do not enter the prediction API.`;
if(process.argv.includes('--help')){console.log(usage);process.exit(0);}
function parseArgs(args){
  const cfg={baseline:'a3d60cb',model:resolve(root,'js/prediction.js'),seed:1729,seeds:128,
    burn:200,measure:300,perDay:5,slope:300,familiar:.95,unfamiliar:.30,json:false};
  const flags={'--baseline':'baseline','--model':'model','--seed':'seed','--seeds':'seeds','--slope':'slope'};
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(arg==='--json'){cfg.json=true;continue;}
    const field=flags[arg],v=args[++i];
    if(!field||v==null||v==='')throw Error('Invalid or missing option: '+arg+' (see --help)');
    cfg[field]=['baseline','model'].includes(field)?v:Number(v);
  }
  for(const [k,min,max] of [['seed',0,0xffffffff],['seeds',2,10000]]){
    if(!Number.isInteger(cfg[k])||cfg[k]<min||cfg[k]>max)throw Error('Invalid '+k);
  }
  if(!Number.isFinite(cfg.slope)||cfg.slope<=0)throw Error('Invalid slope');
  return cfg;
}
const cfg=parseArgs(process.argv.slice(2));
function git(args){
  return execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});
}
const revision=git(['rev-parse','--verify','--end-of-options',cfg.baseline+'^{commit}']).trim();
const atRevision=path=>git(['show',revision+':'+path]);
const historicalText=atRevision('js/prediction.js');
const oldModel=await import('data:text/javascript;base64,'+Buffer.from(historicalText).toString('base64'));
const candidateFile=resolve(cfg.model),candidateText=await readFile(candidateFile);
const candidate=await import(pathToFileURL(candidateFile));
const digest=s=>createHash('sha256').update(s).digest('hex').slice(0,16);
const models=[oldModel,candidate];
for(const m of models)if(typeof m.predictAnswer!=='function'||typeof m.predictionSummary!=='function')
  throw Error('Model must export predictAnswer and predictionSummary.');

const histBank=Object.fromEntries(['part1','part2','listening','grammar','reading','vocab']
  .map(key=>[key,JSON.parse(atRevision('data/'+key+'.json'))]));
const mode=['vocab','part1','part2','dialogue','dialogue','grammar','reading','reading'];
const ratio=[6,25,39,30,30,16,54];
const partTemplate=ratio.flatMap((n,i)=>Array(n).fill(i+1));
const difficultyRows=[
  histBank.vocab,histBank.part1,histBank.part2.filter(q=>q.type==='response'),
  ...[3,4].map(part=>histBank.listening.filter(g=>g.part===part).flatMap(g=>g.questions.map(()=>g))),
  histBank.grammar.flatMap(g=>g.questions),
  ...[6,7].map(part=>histBank.reading.filter(g=>g.part===part).flatMap(g=>g.questions.map(()=>g)))
].map(arr=>arr.map(q=>q.level));
const optionSets={3:['a','b','c'],4:['a','b','c','d']};
function prng(seed){
  let a=seed>>>0;
  return ()=>{a=(a+0x6D2B79F5)>>>0;let z=Math.imul(a^a>>>15,1|a);
    z=z+Math.imul(z^z>>>7,61|z)^z;return ((z^z>>>14)>>>0)/4294967296;};
}
function shuffled(input,r){
  const a=input.slice();
  for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}
const start=new Date(2025,0,6,12);
function day(i){const d=new Date(start);d.setDate(d.getDate()+Math.floor(i/cfg.perDay));return +d;}
function dayKey(ms){
  const d=new Date(ms);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function item(part,level,id){
  return {ref:{id,mode:mode[part]},data:{id,part,level,options:optionSets[part===2?3:4],
    ...(part===2?{type:'response'}:{}),...([3,4,6,7].includes(part)?{set:{part}}:{})}};
}
function draw(seed){
  const random=prng(seed),words=prng(seed^0xa4694d31);
  const n=cfg.burn+cfg.measure;
  let mix=[];
  return Array.from({length:n},(_,i)=>{
    if(i%200===0)mix=shuffled(partTemplate,random);
    const part=mix[i%200],pool=difficultyRows[part];
    const level=pool[Math.floor(random()*pool.length)];
    const gradedWords=i<cfg.burn?Array.from({length:10},(_,j)=>{
      const pool=difficultyRows[0],level=pool[Math.floor(words()*pool.length)];
      return {...item(0,level,'w-'+i+'-'+j),u:words()};
    }):[];
    return {...item(part,level,'q-'+i),u:random(),time:day(i),words:gradedWords};
  });
}
function formalOK(e,truth){
  const chance=1/e.data.options.length;
  return e.u<chance+(1-chance)/(1+10**((e.data.level-truth)/cfg.slope));
}
function state(){return {history:[],seen:{},words:{},errors:{}};}
const score=(m,s)=>m.predictionSummary(s);
const mean=a=>a.reduce((sum,x)=>sum+x,0)/a.length;
const sd=a=>{
  if(a.length<2)throw Error('Insufficient samples to calculate a sample SD');
  const m=mean(a);return Math.sqrt(a.reduce((sum,x)=>sum+(x-m)**2,0)/(a.length-1));
};
function dailySeries(m,s){
  if(typeof m.smoothedTrend==='function')return m.smoothedTrend(s.prediction.days,'total');
  return Object.entries(s.prediction.days).sort(([a],[b])=>a.localeCompare(b))
    .map(([date,p])=>({date,score:p[2]??p[0]+p[1]}));
}
function feed(m,s,e,ok,time){
  m.predictAnswer(s,e.ref,e.data,ok,time,{sourceType:'practice',previouslySeen:s.seen[e.ref.id]||0});
  s.seen[e.ref.id]=(s.seen[e.ref.id]||0)+1;
}
function run(m,events,truth,arm='control'){
  const s=state(),raw=[];
  const stable=truth===600,until=stable?events.length:cfg.burn;
  let baseline;
  for(let i=0;i<until;i++){
    const e=events[i];feed(m,s,e,formalOK(e,truth),e.time);
    if(arm!=='control'){
      for(const word of e.words)feed(m,s,word,word.u<cfg[arm],e.time);
    }
    if(i===cfg.burn-1)baseline=score(m,s);
    if(stable&&i>=cfg.burn)raw.push(score(m,s).total);
  }
  const result={total:baseline.total,reading:baseline.R.score};
  if(stable){
    // Exclude the date straddling the end of the warmup when burn isn't a multiple of perDay.
    const first=dayKey(day(Math.ceil(cfg.burn/cfg.perDay)*cfg.perDay));
    const keys=Object.keys(s.prediction.days).filter(k=>k>=first).sort();
    result.rawSd=sd(raw);
    result.dailyRawSd=sd(keys.map(k=>{const p=s.prediction.days[k];return p[2]??p[0]+p[1];}));
    const shown=dailySeries(m,s).filter(p=>p.date>=first);
    if(shown.some(p=>!Number.isFinite(p.score)))throw Error('Invalid curve score');
    result.dailyCurveSd=sd(shown.map(p=>p.score));
  }
  return result;
}
const truths=[400,500,650,800], conditions=[...truths.map(t=>[t,'control']),[600,'control'],[450,'control'],[450,'familiar'],[450,'unfamiliar']];
const all=Object.fromEntries(conditions.map(([t,a])=>[t+'-'+a,[]]));
for(let i=0;i<cfg.seeds;i++){
  const events=draw((cfg.seed+i)>>>0);
  for(const [truth,arm] of conditions){
    all[truth+'-'+arm].push(models.map(m=>run(m,events,truth,arm)));
  }
}
const round=x=>Math.round(x*100)/100;
function compare(pairs,field){
  const a=pairs.map(p=>p[0][field]),b=pairs.map(p=>p[1][field]),d=b.map((x,i)=>x-a[i]);
  return {old:round(mean(a)),new:round(mean(b)),pairedDelta:round(mean(d)),pairedSE:round(sd(d)/Math.sqrt(d.length))};
}
const endpointSD=field=>{
  const cohort=all['600-control'];
  const old=sd(cohort.map(p=>p[0][field])),next=sd(cohort.map(p=>p[1][field]));
  return {old:round(old),new:round(next),delta:round(next-old)};
};
const result={
  setup:{baseline:revision,oldModelHash:digest(historicalText),newModelHash:digest(candidateText),seed:cfg.seed,seeds:cfg.seeds,
    formalWarmup:cfg.burn,formalFollowup:cfg.measure,answersPerDay:cfg.perDay,responseSlope:cfg.slope,
    familiarCorrect:cfg.familiar,unfamiliarCorrect:cfg.unfamiliar,formalPartCounts:ratio,
    oldCurve:typeof oldModel.smoothedTrend==='function'?'production smoothing':'raw dated totals',
    newCurve:typeof candidate.smoothedTrend==='function'?'production smoothing':'raw dated totals',
    explanation:'Equal L/R true abilities. Fresh unique synthetic item IDs. Each shuffled 200-answer block preserves the full-test Part ratio. Levels sampled with replacement from the historical bank by part. P(correct)=1/n+(1-1/n)/(1+10^((level-truth)/slope)). Word drill levels sampled from that revision’s vocabulary; outcomes use a separate common random stream. Formal and graded word events use practice weights. No previous personal save or diagnostic. Same stimuli and local study dates for both models.'},
  calibration:truths.map(truth=>{
    const pairs=all[truth+'-control'],total=compare(pairs,'total');
    const bias=pair=>pair.total-truth;
    return {truth,atAnswers:cfg.burn,total,
      meanBias:{old:round(mean(pairs.map(p=>bias(p[0])))),new:round(mean(pairs.map(p=>bias(p[1]))))},
      rootMeanSquaredError:{old:round(Math.sqrt(mean(pairs.map(p=>bias(p[0])**2)))),new:round(Math.sqrt(mean(pairs.map(p=>bias(p[1])**2))))}};
  }),
  stable600:{betweenLearnerSDAtWarmup:endpointSD('total'),rawScoreSD:compare(all['600-control'],'rawSd'),rawDailySD:compare(all['600-control'],'dailyRawSd'),
    displayedDailySD:compare(all['600-control'],'dailyCurveSd'),
    estimator:'betweenLearnerSDAtWarmup uses one score per seed at the warmup boundary. The other three statistics average within-learner sample SDs over the following answers or dates (N−1).',},
  stress450:['control','familiar','unfamiliar'].map(arm=>({arm,wordDrills:arm==='control'?0:cfg.burn*10,
    reading:compare(all['450-'+arm],'reading'),relativeToControl:{
      old:round(mean(all['450-'+arm].map((p,i)=>p[0].reading-all['450-control'][i][0].reading))),
      new:round(mean(all['450-'+arm].map((p,i)=>p[1].reading-all['450-control'][i][1].reading)))
    }})),

};
if(cfg.json)console.log(JSON.stringify(result,null,2));
else{
  console.log('旧版 '+revision.slice(0,7)+'  '+result.setup.oldModelHash+'    候选 '+result.setup.newModelHash);
  console.log('种子 '+cfg.seed+' 起共 '+cfg.seeds+' 条轨迹；'+cfg.burn+' 道正式题后比较校准，再观察 '+cfg.measure+' 题波动。每日 '+cfg.perDay+' 道正式题。');
  console.log('两版共享难度、题序、日期和答题随机数。L/R 设为对称能力，难度按旧题库各 Part 抽取；选择题含随机猜中下限，logistic 分母 '+cfg.slope+'。');
  console.table(result.calibration.map(({truth,total})=>({真值:truth,旧总分:total.old,新总分:total.new,差:total.pairedDelta,配对标准误:total.pairedSE})));
  console.table(Object.entries(result.stable600).filter(([,v])=>typeof v==='object').map(([metric,v])=>({指标:metric,旧:v.old,新:v.new,差:v.pairedDelta??v.delta})));
  console.table(result.stress450.map(({arm,wordDrills,reading,relativeToControl})=>({条件:arm,已评分词汇题:wordDrills,旧阅读:reading.old,新阅读:reading.new,相对无词旧:relativeToControl.old,相对无词新:relativeToControl.new})));
  console.log('词汇已评分正确率 '+cfg.familiar+'/'+cfg.unfamiliar+'；纯自评不写入估分。曲线：旧='+result.setup.oldCurve+'，新='+result.setup.newCurve+'。');
}
