import assert from 'node:assert/strict';
import {fresh,decode} from '../js/state.js';
const ref=id=>({id,mode:'vocab',format:'meaning'});
const keep=ref('v-available'),gone=ref('v-retired');
const catalog=new Map([[keep.id,{ref:keep,data:{}}]]);
for(const [items,index,right,selected] of [[[gone,keep],0,1,'earlier'],[[gone,keep],1,1,null],[[keep,gone],1,1,null],[[keep,gone],2,2,null],[[gone],0,0,null]]){
 const s=fresh();s.xp=100;
 s.session={mode:'vocab',title:'旧练习',items,index,right,gain:12*right,selected,elapsed:0,timed:false,intro:false};
 s.errors[gone.id]={ref:gone,misses:1,at:0};s.words[gone.id]={box:1,due:0,right:1,tries:1};
 const migrated=decode(JSON.stringify(s),catalog);
 assert.equal(migrated.xp,100);assert(!migrated.errors[gone.id]);assert(!migrated.words[gone.id]);
 if(migrated.session)assert(migrated.session.items.every(q=>q.id===keep.id));
 assert.deepEqual(decode(JSON.stringify(migrated),catalog),migrated);
}
console.log('PASS old saves with retired current, prior, later, completed and all-retired questions');
