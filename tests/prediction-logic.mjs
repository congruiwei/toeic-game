import assert from 'node:assert/strict';
import {fresh,reward,estimate} from '../js/state.js';
import {predictAnswer,predictionSummary,predictionView,validPrediction,snapshotOnVisit,smoothedTrend} from '../js/prediction.js';
const epoch=new Date(2026,5,1,12).getTime(),s=fresh();
function add(st,mode,id,level,ok,date,extra={}){
 const ref={id,mode},data={id,level,options:['A','B','C','D'],...extra};
 predictAnswer(st,ref,data,ok,date);
}
for(let i=0;i<16;i++)add(s,'part2','p'+i,500,true,epoch,{type:'response'});
assert.equal(s.prediction.R.evidence,0);
const ref=fresh();for(let i=0;i<16;i++)add(ref,'part2','repeat',500,true,epoch,{type:'response'});
assert.ok(predictionSummary(s).L.score>predictionSummary(ref).L.score);
assert.ok(predictionSummary(s).L.high-predictionSummary(s).L.low<predictionSummary(ref).L.high-predictionSummary(ref).L.low);
add(s,'reading','r2',700,true,epoch+86400000*10,{set:{part:7}});
assert.equal(Object.keys(s.prediction.days).length,2);assert.ok(validPrediction(s.prediction));
assert.ok(predictionView(s,'7',epoch+86400000*10).includes('1 个学习日'));assert.ok(predictionView(s,'all',epoch+86400000*10).includes('2 个学习日'));
assert.ok(!validPrediction({...s.prediction,days:{'2026-02-30':[200,200]}}));
const legacy={...fresh(),stage:4,history:[{skill:'listening',ok:true,level:600}]};
const p={id:'legacy-new',skill:'grammar',level:400,options:['a','b','c','d']};
reward(legacy,p,{id:p.id,mode:'grammar'},false,epoch);
assert.equal(Object.keys(legacy.prediction.days).length,1);assert.equal(legacy.stage,4);
function oldScore(history){
 const part=history.slice(-32);if(!part.length)return 400;
 let sum=0,n=0;part.forEach((h,i)=>{sum+=(i+1)*(h.level+(h.ok?145:-175));n+=i+1;});
 return Math.max(400,Math.min(900,5*Math.round((400+(sum/n-400)*Math.min(1,part.length/8))/5)));
}
const demo=fresh(),transitions=[];let oldStage=0,oldModelStage=0;const oldTransitions=[],checkpoints=[];
for(let i=0;i<240;i++){
 const skill=['vocab','grammar','listening','reading'][i%4],mode=['vocab','grammar','part2','reading'][i%4];
 const level=Math.min(900,400+100*Math.floor(i/32));const ok=i%9!==4;
 const id='fixed-'+i;const q={id,skill,level,type:'response',set:{part:7},options:['a','b','c','d']};
 reward(demo,q,{id,mode},ok,epoch+i*1000);
 if(oldModelStage<5&&oldScore(demo.history)>=500+oldModelStage*100&&Object.values(demo.stats).every(x=>x>=[0,36,90,165,260,380][oldModelStage+1])){oldModelStage++;oldTransitions.push(i+1);}
 if([31,95,159,239].includes(i))checkpoints.push([i+1,oldScore(demo.history),estimate(demo),demo.stage]);
 if(demo.stage>oldStage){transitions.push([demo.stage,i+1]);oldStage=demo.stage;}
}
assert.equal(demo.stage,5);
assert.deepEqual(transitions.map(([,n])=>n),[13,42,76,112,151]);
console.log('evolution transitions',JSON.stringify(transitions));

assert.deepEqual(checkpoints,[[32,500,520,1],[96,705,730,3],[160,900,920,5],[240,900,975,5]]);
console.log('fixed answer counts and old/new scores',JSON.stringify(checkpoints),'old evolution attempts',oldTransitions);
const diagnostic=fresh(),sample=[
 {id:'dgL',part:2,level:500,ok:true},{id:'dgR',part:7,level:500,ok:true}
],cat=new Map(sample.map(r=>[r.id,{ref:{id:r.id,mode:r.part===2?'part2':'reading'},data:{part:r.part,level:r.level,options:['A','B','C'],type:'response'}}]));
for(const row of sample){
 const {ref,data}=cat.get(row.id);reward(diagnostic,{...data,id:row.id,skill:row.part===2?'listening':'reading'},ref,row.ok,epoch,{sourceType:'diagnosis'});
}
assert.deepEqual(diagnostic.prediction.exposure,{dgL:1,dgR:1});
assert.equal(Object.keys(diagnostic.prediction.days).length,1);
const failed=fresh();
predictAnswer(failed,{mode:'part2',id:'unknown'},{level:500,type:'response',options:['A','B','C']},false,epoch,{outcome:'unknown'});
assert.ok(failed.prediction.L.rating<400);

// Import the same version-one save into the new schema, with IDs that exist in the live bank.
const {readFileSync}=await import('node:fs');
const read=name=>JSON.parse(readFileSync(new URL('../data/'+name+'.json',import.meta.url)));
const pool=[
 read('vocab'),read('grammar').flatMap(t=>t.questions),
 read('part2').filter(q=>q.type==='response'),read('reading').flatMap(g=>g.questions.map(q=>({...q,level:g.level})))
];
const old={version:1,xp:0,stage:0,branch:'vocab',stats:{vocab:0,grammar:0,listening:0,reading:0},
 history:[],words:{},errors:{},seen:{},lastVisit:0,session:null,
 settings:{theme:'auto',sound:true,motion:true,timed:false,rate:1,accent:'auto'}};
const registry=new Map();
for(let i=0;i<96;i++){
 const slot=i%4, skill=Object.keys(old.stats)[slot],mode=['vocab','grammar','part2','reading'][slot];
 const level=400+100*Math.floor(i/32),ok=i%9!==4;
 const q=pool[slot].find(q=>q.level===level&&!old.seen[q.id]);assert(q,'enough independent fixture items');
 const {id}=q,ref={id,mode};registry.set(id,{data:q,ref});old.seen[id]=1;
 old.history.push({skill,level,ok});const gain=ok?12:4;old.xp+=gain;old.stats[skill]+=gain;
 if(!ok)old.errors[id]={ref,at:epoch+i*1000,misses:1};
 if(slot===0)old.words[id]={box:ok?1:0,tries:1,right:Number(ok),due:epoch+i*1000+(ok?86400000:120000)};
 if(old.stage<5 && oldScore(old.history)>=500+old.stage*100 &&
    Object.values(old.stats).every(x=>x>=[0,36,90,165,260,380][old.stage+1]))old.stage++;
}
const {decode}=await import('../js/state.js'),restored=decode(JSON.stringify(old),registry),estimateV6=predictionSummary(restored);
assert.deepEqual([oldScore(old.history),estimateV6.total,estimateV6.low,estimateV6.high],[705,690,565,815]);
assert.deepEqual([estimateV6.L.score,estimateV6.R.score],[320,370]);
assert.deepEqual([restored.stage,restored.xp],[3,1064]);
assert.equal(Object.keys(restored.seen).length,96);
console.log('Same 96-answer v1 save: 705 → 690 [565–815]; L 320 [250–390], R 370 [315–425]; XP 1064, form 4 preserved.');

const visited=structuredClone(s);
snapshotOnVisit(visited,epoch+12*86400000);
snapshotOnVisit(visited,epoch+12*86400000);
assert.equal(Object.keys(visited.prediction.days).length,3);
for(const [l,r,total] of Object.values(visited.prediction.days))assert.equal(l+r,total);
assert.ok(validPrediction({...visited.prediction,days:{'2025-01-01':[200,220]}}));
assert.ok(!validPrediction({...visited.prediction,days:{'2025-01-01':[200,220,500]}}));


const control=fresh(), withWords=fresh();
for(let i=0;i<15;i++){
 for(const state of [control,withWords])add(state,'reading','reading-'+i,500,i%4!==1,epoch+i,{part:7});
 for(let j=0;j<10;j++){
  const id='screen-'+i+'-'+j, ref={mode:'vocab',id,format:'meaning'};
  reward(withWords,{id,skill:'vocab',level:900},ref,j%3!==0,epoch+i,{screenCheck:true});
 }
}
assert.deepEqual(withWords.prediction,control.prediction);
assert.deepEqual(predictionSummary(withWords),predictionSummary(control));
assert.equal(Object.keys(withWords.words).length,150);
const onlyListening=fresh();
add(onlyListening,'dictation','heard',500,true,epoch,{options:undefined});
assert.equal(onlyListening.prediction.L.evidence,.35*.82);
assert.equal(onlyListening.prediction.R.evidence,0);

const days={'2026-06-04':[190,210,400],'2026-06-11':[130,300,430],'2026-06-02':[100,210]};
const before=structuredClone(days), expectedTotal=[310,(2*310+3*400)/5,(310+2*400+3*430)/6];
assert.deepEqual(smoothedTrend(days).map(x=>x.score),expectedTotal);
for(const [index,point] of smoothedTrend(days).entries()){
 const sum=smoothedTrend(days,'L')[index].score+smoothedTrend(days,'R')[index].score;
 assert(Math.abs(point.score-sum)<1e-9);
}
assert.deepEqual(days,before);
console.log('PASS independent word and spot-check evidence, dictation weight, three-day weighted charts and raw snapshots');
