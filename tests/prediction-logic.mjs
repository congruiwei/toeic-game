import assert from 'node:assert/strict';
import {fresh,reward,estimate} from '../js/state.js';
import {predictAnswer,predictionSummary,predictionView,validPrediction} from '../js/prediction.js';
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
assert.equal(demo.stage,5);console.log('evolution transitions',JSON.stringify(transitions));

assert.deepEqual(checkpoints,[[32,500,520,1],[96,705,720,3],[160,900,925,5],[240,900,970,5]]);
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
