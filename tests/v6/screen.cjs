const assert=require('node:assert/strict');
module.exports=async ({page,act,nav,state})=>{
 await nav('learn');await act('screen-open');await page.locator('.screen-card').waitFor();
 const first=(await state()).screening.run;
 assert.equal(first.ids.length,20);
 // Synthesize Chromium touchscreen input through the compositor, including pointer capture.
 const touch=await page.context().newCDPSession(page);
 const box=await page.locator('.screen-card').boundingBox(),x=Math.round(box.x+box.width*.7),y=Math.round(box.y+box.height*.5);
 await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-90,y}]});
 await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('sprout-isle.save')).screening.run.index===1);
 assert.equal((await state()).screening.marks[first.ids[0]],'learn');
 await act('screen-yes');await act('screen-yes');await act('screen-yes');
 assert((await state()).screening.run.pending);await page.reload();
 await nav('learn');await act('screen-open');await page.locator('.screen-card').waitFor();
 assert((await state()).screening.run.pending);
 const choice=page.locator('[data-act=screen-check]');
 const answers=await page.evaluate(async()=>{const s=JSON.parse(localStorage.getItem('sprout-isle.save')),r=s.screening.run;const {question}=await import('./js/bank.js');return question({id:r.ids[r.index],mode:'vocab',format:'meaning'});});
 await choice.filter({hasText:answers.options.find(t=>t!==answers.answer)}).click();
 assert.equal((await state()).screening.marks[first.ids[3]],'learn');await act('screen-next');
 // Additional known claims produce correct live verifications.
 while((await state()).screening.run.index<20){
   await act('screen-yes');
   if((await state()).screening.run.pending){
    const text=await page.evaluate(async()=>{const r=JSON.parse(localStorage.getItem('sprout-isle.save')).screening.run;return (await import('./js/bank.js')).catalog.get(r.ids[r.index]).data.zh;});
    await page.getByRole('button',{name:text,exact:true}).click();await act('screen-next');
   }
 }
 assert.match(await page.locator('#app').innerText(),/抽查正确率/);
 const end=await state();assert.equal(end.screening.run.unknown,2);assert.equal(end.screening.run.checks,6);
 await act('screen-learn');await page.locator('.lesson-question').waitFor();
 assert(['learn','unconfirmed'].includes((await state()).screening.marks[(await state()).session.items[0].id]));
};
