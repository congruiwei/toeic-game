const assert=require('node:assert/strict');
module.exports=async({page,state,store,act,width})=>{
  const key='v-available/example/0',humorKey='v-available/humor/0';
  let release,requested;
  const waiting=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{requested=resolve;});
  const route=async request=>{requested();await waiting;await request.continue();};
  await page.route('**/data/vocab-humor.json',route);
  try{
    const progress=await state();progress.settings.methodHints=false;
    progress.session={mode:'vocab',title:'词卡练习',items:[{id:'v-available',mode:'vocab',format:'cloze'}],index:0,right:0,gain:0,selected:null,elapsed:0,timed:false,intro:false};
    await store(progress);await act('resume');await act('unknown');await started;
    const business=page.locator(`.lesson-word-note [data-act=read-aloud][data-key="${key}"]`);
    const text=await business.getAttribute('data-text');
    const formerSelector=page.locator('.lesson-word-note blockquote [data-act=read-aloud]').first();
    assert.equal(await formerSelector.getAttribute('data-text'),text,'before hydration the old ambiguous selector points to business');
    await business.evaluate(element=>element.scrollIntoView({block:'center',behavior:'instant'}));
    await page.evaluate(()=>{
      window.businessPressTrace=[];
      for(const type of ['pointerdown','pointerup','click'])document.addEventListener(type,event=>{
        const button=event.target.closest('[data-act=read-aloud]');
        window.businessPressTrace.push({type,key:button?.dataset.key||null,x:event.clientX,y:event.clientY});
      },true);
    });
    const before=await business.boundingBox();
    await page.mouse.move(before.x+before.width/2,before.y+before.height/2);await page.mouse.down();
    const pressed=await business.boundingBox();
    const received=page.waitForResponse(response=>response.url().endsWith('/data/vocab-humor.json'));
    release();await (await received).finished();
    // Let the genuine fetch and pending paint finish while the finger stays down.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const during=await business.boundingBox();
    await page.mouse.up();
    const trace=await page.evaluate(()=>window.businessPressTrace);
    console.log('BUSINESS_PRESS '+JSON.stringify({width,before,pressed,during,trace,played:await page.evaluate(()=>window.played)}));
    assert(Math.abs(during.y-pressed.y)<1,'late humor must not move a pressed business-sentence button');
    await page.waitForFunction(expected=>window.played.at(-1)===expected,text);
    assert.equal(trace.filter(event=>event.type==='click'&&event.key===key).length,1,'one physical press produces one business playback click');
    assert.deepEqual(await page.evaluate(()=>({type:window.speechGestures.at(-1).type,trusted:window.speechGestures.at(-1).trusted})),{type:'click',trusted:true},'playback keeps the original user gesture');
    const humor=page.locator(`.lesson-word-note [data-act=read-aloud][data-key="${humorKey}"]`);
    await humor.waitFor();
    const joke=await humor.getAttribute('data-text');assert.notEqual(joke,text);
    assert.equal(await formerSelector.getAttribute('data-text'),joke,'after hydration the same old selector resolves to humor');
    console.log('SELECTOR_CHANGE '+JSON.stringify({width,businessKey:key,afterHydrationKey:await formerSelector.getAttribute('data-key')}));
    await humor.click();await page.waitForFunction(expected=>window.played.at(-1)===expected,joke);
    assert((await humor.boundingBox()).y<(await business.boundingBox()).y,'humor stays before the business example');

    let releaseTranslations;
    const translationsWait=new Promise(resolve=>{releaseTranslations=resolve;});
    const translationRoute=async request=>{await translationsWait;await request.continue();};
    await page.route('**/data/i18n/{zh,ja}/vocab-humor.json',translationRoute);
    try{
      await page.locator('.humor-reveal > summary').click();await business.evaluate(element=>element.scrollIntoView({block:'center',behavior:'instant'}));
      assert(await business.evaluate(element=>{const r=element.getBoundingClientRect();return element.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'business button is not behind the fixed navigation');
      const box=await business.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
      const held=await business.boundingBox();
      const responses=['zh','ja'].map(lang=>page.waitForResponse(response=>response.url().endsWith(`/data/i18n/${lang}/vocab-humor.json`)));
      releaseTranslations();await Promise.all((await Promise.all(responses)).map(response=>response.finished()));
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const loaded=await business.boundingBox();
      console.log('TRANSLATION_HELD '+JSON.stringify({width,held,loaded,trace:await page.evaluate(()=>window.businessPressTrace),lines:await page.locator('.humor-lines').innerHTML()}));
      assert(Math.abs(loaded.y-held.y)<1,'late translations must not move a pressed business button');
      const count=await page.evaluate(()=>window.played.length);await page.mouse.up();
      await page.waitForFunction(({count,text})=>window.played.length===count+1&&window.played.at(-1)===text,{count,text});
      await page.locator('.humor-lines [data-act=humor-ja]').waitFor();
      console.log('TRANSLATION_PRESS '+JSON.stringify({width,held,loaded}));
    }finally{releaseTranslations();await page.unroute('**/data/i18n/{zh,ja}/vocab-humor.json',translationRoute);}
  }finally{release();await page.unroute('**/data/vocab-humor.json',route);}

  // Cancellation, leaving the window and removal of a pressed control must
  // release the deferred render. Plain text/swipe starts never acquire it.
  for(const outcome of ['pointercancel','blur','removed','text']){
    let releasePack,requestStarted;
    const wait=new Promise(resolve=>{releasePack=resolve;}),start=new Promise(resolve=>{requestStarted=resolve;});
    const delayed=async request=>{requestStarted();await wait;await request.continue();};
    await page.route('**/data/vocab-humor.json',delayed);
    try{
      const progress=await state();progress.session.selected=null;progress.session.index=0;
      await store(progress);await act('resume');await act('unknown');await start;
      const target=page.locator(outcome==='text'?'.lesson-word-note .lesson-ipa':`.lesson-word-note [data-key="${key}"]`);
      await target.evaluate(element=>element.scrollIntoView({block:'center',behavior:'instant'}));const box=await target.boundingBox();
      await page.evaluate(()=>document.addEventListener('pointerdown',e=>window.heldPointerId=e.pointerId,{once:true,capture:true}));
      await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
      releasePack();
      if(outcome==='pointercancel')await page.evaluate(()=>document.dispatchEvent(new PointerEvent('pointercancel',{pointerId:window.heldPointerId,bubbles:true})));
      if(outcome==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
      if(outcome==='removed')await target.evaluate(element=>element.remove());
      await page.locator('.word-humor [data-key$="/humor/0"]').waitFor();
      await page.mouse.up();console.log('HUMOR_CLEANUP '+JSON.stringify({width,outcome}));
    }finally{releasePack();await page.mouse.up();await page.unroute('**/data/vocab-humor.json',delayed);}
  }
};
