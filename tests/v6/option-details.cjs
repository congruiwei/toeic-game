const assert=require('node:assert/strict');
module.exports=async({page,context,act,nav,state,store,quiz})=>{
  const calls=[];page.on('request',r=>{if(r.url().includes('/data/options/'))calls.push(r.url());});
  const progress=await state();progress.session={mode:'vocab',title:'选项释义',items:[{id:'v-available',mode:'vocab',format:'cloze'}],index:0,right:0,gain:0,elapsed:0,selected:null,intro:false,timed:false};
  await store(progress);await act('resume');
  assert.equal(await page.locator('.lesson-header').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),3,'ordinary question headers retain their three columns');
  assert.equal(await page.locator('[data-options-id]').count(),0);assert.equal(calls.length,0,'do not fetch option meanings before an answer');
  await act('unknown');
  await page.locator('.option-details').waitFor();assert.equal(await page.locator('.option-detail[open]').count(),4);
  for(const entry of await page.locator('.option-detail').all()){
    assert((await entry.locator('p[lang=zh-CN]').textContent()).trim());
    assert((await entry.locator('p[lang=ja]').textContent()).trim());
    assert((await entry.locator('.option-pos').textContent()).trim());
    assert((await entry.locator('.option-reason').textContent()).includes('为什么'));
  }
  const before=await state();
  const outside=page.locator('.option-detail').filter({has:page.locator('summary',{hasText:'inaccessible'})});
  await outside.locator('[data-act=option-collect]').first().click();
  const canonical=page.locator('.option-detail').filter({has:page.locator('.option-result.is-correct')});
  await canonical.locator('[data-act=option-word]').first().click();
  await page.locator('#modal [data-option-word-study="v-available"]').waitFor();
  assert(await page.locator('#modal .lib-card [data-act=read-aloud]').count()>0);
  await page.locator('#modal .lib-card [data-act=read-aloud]').first().click();
  await page.waitForFunction(()=>window.played.at(-1)==='available');await act('close');
  await canonical.locator('[data-act=option-collect]').first().click();
  let s=await state();assert.equal(s.personalVocab.items.length,2);assert.equal(s.xp,before.xp);assert.equal(s.stage,before.stage);
  const custom=s.personalVocab.items.find(x=>!x.wordId);assert.equal(custom.word,'inaccessible');assert(custom.source.context.includes('available'));
  assert.equal(s.words['v-available'].tries,before.words['v-available'].tries);
  await act('leave');await nav('learn');await act('personal-open');
  assert.match(await page.locator('#app').innerText(),/收藏 2/);
  assert(await page.locator('[data-field=context]').count()>0);
  await page.locator('[data-act=personal-start][data-direction=ja-en]').click();
  const header=await page.locator('.personal-review-header').evaluate(el=>{const title=el.querySelector('h1'),button=el.querySelector('button');return{columns:getComputedStyle(el).gridTemplateColumns.split(' ').length,titleHeight:title.getBoundingClientRect().height,lineHeight:parseFloat(getComputedStyle(title).lineHeight),buttonHeight:button.getBoundingClientRect().height};});
  assert.equal(header.columns,2,'personal review uses its own two-column header');
  assert(header.titleHeight<=header.lineHeight+1,'personal review title must fit on one mobile line');
  assert(header.buttonHeight>=44,'save-and-leave keeps a touch-sized button');
  assert.equal(await page.locator('.personal-word [lang=en]').count(),0,'English back is hidden in Japanese-front review');
  await act('personal-flip');await page.locator('.personal-word h2[lang=en]').waitFor();
  const openRun=await state();await page.reload();await page.locator('.habitat').waitFor();await nav('learn');await act('personal-open');await act('personal-resume');
  assert.equal((await state()).personalVocab.run.index,openRun.personalVocab.run.index);assert((await state()).personalVocab.run.flipped);
  await page.locator('[data-act=personal-rate][data-grade="4"]').click();
  s=await state();assert(s.personalVocab.items.some(item=>item.fsrs.lastRating===4));
  assert.equal(s.words['v-available'].tries,before.words['v-available'].tries,'self-rating does not inflate quiz statistics');
  await nav('report');assert.match(await page.locator('#app').innerText(),/我的单词本/);
  await act('settings');const snapshot=await state();
  await page.locator('#import-file').setInputFiles({name:'personal-progress.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(snapshot))});await act('restore');
  assert.deepEqual((await state()).personalVocab,snapshot.personalVocab);

  // Chinese option labels must speak the associated English headword.
  s=await state();s.session={...progress.session,items:[{id:'v-available',mode:'vocab',format:'meaning'}]};
  await store(s);await act('resume');await act('unknown');await page.locator('.option-details').waitFor();
  const right=page.locator('.option-detail').filter({has:page.locator('.option-result.is-correct')});
  await right.locator('[data-act=option-en]').click();await page.waitForFunction(()=>window.played.at(-1)==='available');
  await right.locator('[data-act=option-ja]').click();await page.waitForFunction(()=>window.spoken.at(-1)?.lang==='ja-JP');
  await act('leave');
  for(const [mode,filter]of [['part1',''],['part2','response'],['dialogue','3'],['grammar',''],['reading','6'],['reading','7']]){
    await quiz(mode,filter);assert.equal(await page.locator('[data-options-id]').count(),0);
    await act('unknown');await page.locator('.option-details').waitFor();
    const q=await page.evaluate(async()=>{const run=JSON.parse(localStorage.getItem('sprout-isle.save')).session;return (await import('./js/bank.js')).question(run.items[run.index]);});
    assert.equal(await page.locator('.option-detail').count(),q.options.length);
    await act('leave');
  }
  await context.setOffline(true);await nav('learn');await act('personal-open');await act('personal-start');await act('personal-flip');await act('personal-rate');
  assert((await state()).personalVocab.items.length===2,'personal review is local');await context.setOffline(false);

  // A longer collection stays complete in storage while the view grows in batches.
  const large=await page.evaluate(async()=>{
    const s=JSON.parse(localStorage.getItem('sprout-isle.save'));
    const {bank,loadBank,ensureVocabMeanings,japaneseMeaning}=await import('./js/bank.js');
    const {collectPersonalWord}=await import('./js/personal-vocab.js');
    await loadBank(['vocab']);await ensureVocabMeanings();s.personalVocab={version:1,items:[],run:null};
    for(const word of bank.vocab.slice(0,121))collectPersonalWord(s,{...word,wordId:word.id,ja:japaneseMeaning(word.id)},
      {ref:{id:word.id,mode:'vocab'},context:word.example,option:word.word});
    return s;
  });
  await store(large);const largeSaved=await state();await nav('learn');await act('personal-open');await page.locator('.personal-word-list').waitFor();
  const cards=page.locator('.personal-word-list .personal-word');
  assert.equal(await cards.count(),50);assert.match(await page.locator('#app').innerText(),/收藏 121/);
  const more=page.locator('[data-act=personal-more]');assert(await more.evaluate(el=>el.getBoundingClientRect().height)>=44);
  await more.evaluate(el=>el.scrollIntoView({block:'center'}));const scrollBefore=await page.evaluate(()=>scrollY);
  await more.click();assert.equal(await cards.count(),100);assert(Math.abs(await page.evaluate(()=>scrollY)-scrollBefore)<=1,'showing more keeps the current scroll position');
  await act('personal-more');assert.equal(await cards.count(),121);assert.equal(await more.count(),0);
  await nav('home');await nav('learn');await act('personal-open');await page.locator('.personal-word-list').waitFor();assert.equal(await cards.count(),50,'reopening resets the display limit');
  const distant=large.personalVocab.items[120];await page.locator('#personal-vocab-filter').fill(distant.word);
  assert.equal(await page.locator(`[data-personal-key="${distant.key}"]`).count(),1,'search includes entries beyond the first displayed batch');
  await page.locator('#personal-vocab-filter').fill('');assert.equal(await cards.count(),50,'search resets the display limit');
  await act('personal-more');assert.equal(await cards.count(),100);
  const composition=await page.evaluate(()=>{
    const input=document.querySelector('#personal-vocab-filter');input.focus();
    const count=()=>document.querySelectorAll('.personal-word-list .personal-word').length;
    input.dispatchEvent(new CompositionEvent('compositionstart',{data:'',bubbles:true}));
    input.value='請';input.dispatchEvent(new InputEvent('input',{bubbles:true,data:'請',inputType:'insertCompositionText',isComposing:true}));
    const first={same:document.querySelector('#personal-vocab-filter')===input,connected:input.isConnected,focused:document.activeElement===input,cards:count()};
    input.value='請求';input.dispatchEvent(new InputEvent('input',{bubbles:true,data:'求',inputType:'insertCompositionText',isComposing:true}));
    const second={same:document.querySelector('#personal-vocab-filter')===input,cards:count()};
    input.dispatchEvent(new CompositionEvent('compositionend',{data:'請求',bubbles:true}));
    const committed=document.querySelector('#personal-vocab-filter'),after={value:committed.value,focused:document.activeElement===committed,cards:count()};
    committed.dispatchEvent(new InputEvent('input',{bubbles:true,data:'請求',inputType:'insertText',isComposing:false}));
    return{first,second,after,trailingSame:document.querySelector('#personal-vocab-filter')===committed};
  });
  assert.deepEqual(composition.first,{same:true,connected:true,focused:true,cards:100});
  assert.deepEqual(composition.second,{same:true,cards:100});
  const matches=large.personalVocab.items.filter(item=>[item.word,item.zh,item.ja,item.pos].some(text=>text.toLowerCase().includes('請求')));
  assert.deepEqual(composition.after,{value:'請求',focused:true,cards:Math.min(50,matches.length)});assert(composition.trailingSame,'the trailing input event must not redraw the committed composition again');
  const unchanged=await state();assert.deepEqual(unchanged.personalVocab,largeSaved.personalVocab);assert.deepEqual(unchanged.words,largeSaved.words);assert.equal(unchanged.xp,largeSaved.xp);assert.equal(unchanged.stage,largeSaved.stage);
};
