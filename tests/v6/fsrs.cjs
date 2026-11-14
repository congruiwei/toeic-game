const assert=require('node:assert/strict');
module.exports=async ({page,act,nav,state,store})=>{
 await act('settings');await page.locator('[data-pref=retention]').selectOption('0.95');await act('close');
 assert.equal((await state()).settings.retention,.95);
 const s=await state(),ref={id:'v-available',mode:'vocab',format:'meaning'};
 s.words[ref.id]={box:3,due:Date.now()-3000,right:4,tries:5};
 s.session={mode:'vocab',title:'单词复习',items:[ref],index:0,right:0,gain:0,selected:null,elapsed:0,timed:false,intro:false};
 await store(s);await act('resume');
 let w=(await state()).words[ref.id];assert.equal(w.fsrs.reps,5);assert.equal(w.right,4);
 await page.clock.install();await page.clock.runFor(3000);
 await act('settings');await page.clock.runFor(15000);await act('close');
 // Explicit background/foreground lifecycle transitions, with a simulated fifteen seconds hidden.
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 await page.clock.runFor(15000);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
 const correct=await page.evaluate(async id=>(await import('./js/bank.js')).catalog.get(id).data.zh,ref.id);
 await page.getByRole('button',{name:new RegExp(correct)}).click();
 w=(await state()).words[ref.id];assert.equal(w.fsrs.lastRating,3);assert.equal(w.tries,6);
 // A delayed answer is Hard and a completed choice never accumulates another review.
 await page.clock.runFor(12000);assert.equal((await state()).words[ref.id].fsrs.reps,6);
 const active=await state();active.session.selected=null;active.session.answerMs=8500;await store(active);
 await act('resume');await page.getByRole('button',{name:new RegExp(correct)}).click();
 const h=(await state()).words[ref.id];assert.equal(h.fsrs.lastRating,2);assert.equal(h.fsrs.reps,7);
 const current=await state();
 const gid=await page.evaluate(async()=>{const {catalog}=await import('./js/bank.js');return [...catalog.values()].find(x=>x.ref.mode==='grammar').ref.id;});
 current.session=null;current.errors[gid]={at:Date.now()-60000,misses:1,ref:{id:gid,mode:'grammar'}};
 await store(current);await nav('library');await page.locator('[data-act=library-tab][data-tab=errors]').click();
 for(let i=0;i<2;i++){
   await page.locator('[data-act=review-one][data-id="'+gid+'"]').click();
   if(await page.locator('[data-act=replace]:visible').count())await act('replace');
   if(await page.locator('[data-act=begin]:visible').count())await act('begin');
   const idx=await page.evaluate(async gid=>{const {catalog}=await import('./js/bank.js');const q=catalog.get(gid).data;return q.options.indexOf(q.answer)},gid);
   await page.locator('[data-act=answer][data-i="'+idx+'"]').click();
   if(i===0){assert.equal((await state()).errors[gid].correctStreak,1);await nav('library');}
 }
 assert(!(await state()).errors[gid]);
};
