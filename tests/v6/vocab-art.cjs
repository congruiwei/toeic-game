const assert=require('node:assert/strict');
module.exports=async({page,act,nav,state,store,width})=>{
  const artRequests=[];
  page.on('request',r=>{if(/\/assets\/vocab\/|\/vocab-art\.json/.test(r.url()))artRequests.push(r.url());});
  const session=(id,mode='vocab')=>({mode,title:'图片回归',items:[{id,mode,...(mode==='vocab'?{format:'cloze'}:{})}],index:0,right:0,gain:0,selected:null,elapsed:0,timed:false,intro:false});
  const decoded=async image=>{await image.waitFor();await image.scrollIntoViewIfNeeded();await image.evaluate(e=>e.decode());assert(await image.evaluate(e=>e.naturalWidth>0));};
  const expressions=async()=>{await nav('learn');await act('expression-open');};
  const personal=async()=>{await nav('learn');await act('personal-open');};
  const expressionEntry=key=>page.locator('.expression-entry').filter({has:page.locator('button[data-act=expression-speak][data-key="'+key+'"]')});
  const collectSentence=async key=>{
    const button=page.locator('[data-act=collect-expression][data-key="'+key+'"]');
    await button.waitFor();await button.click();
    await page.waitForFunction(k=>JSON.parse(localStorage.getItem('sprout-isle.save')).expressions.items.some(i=>i.key===k),key);
  };
  const progress=await state(),id='v-forklift',wordKey=id+'/example/0';
  progress.session=session(id);
  await store(progress);await act('resume');
  assert.equal(await page.locator('.vocab-art img').count(),0);
  assert.equal(artRequests.length,0,'no pictures or picture index before answering');
  await act('unknown');
  const img=page.locator('.lesson-word-note [data-vocab-art="v-forklift"] img');
  await decoded(img);assert.match(await img.getAttribute('alt'),/货叉|叉车/);
  await page.locator('.option-detail .vocab-art-small img').first().waitFor();

  // Collect the actual displayed example and the sense-linked option, rather
  // than fabricating bookmark data. Both books must resolve the same artwork.
  await act('translate');await collectSentence(wordKey);
  const forkOption=page.locator('.option-lexeme-actions').filter({has:page.locator('[data-vocab-art="v-forklift"]')});
  await forkOption.locator('[data-act=option-collect]').click();
  assert.equal((await state()).personalVocab.items.find(i=>i.wordId===id).source.id,id);
  assert.equal((await state()).expressions.items.find(i=>i.key===wordKey).sourceId,id);
  await expressions();await decoded(expressionEntry(wordKey).locator('[data-vocab-art="v-forklift"] img'));
  await page.locator('[data-act=expression-start][data-direction=ja-en]').click();
  assert.equal(await page.locator('.vocab-art').count(),0,'expression recall front cannot reveal a picture');
  await act('expression-flip');await decoded(expressionEntry(wordKey).locator('img'));
  await personal();await decoded(page.locator('[data-personal-key="v-forklift"] img'));
  await page.locator('[data-act=personal-start][data-direction=ja-en]').click();
  assert.equal(await page.locator('.vocab-art').count(),0,'personal word recall front cannot reveal a picture');
  await act('personal-flip');await decoded(page.locator('[data-personal-key="v-forklift"] img'));

  // Incorrect duel answers collect the target automatically; an expression
  // keeps the duel source ID and resolves through its exact authored sense.
  for(const duel of ['cf-available','cf-valuable','cf-curry']){
    const s=await state();s.session=session(duel,'confusable');await store(s);await act('resume');
    assert.equal(await page.locator('.vocab-art img').count(),0,'duel pictures stay hidden before answering');
    await act('unknown');await page.locator('.confusable-card').first().waitFor();
    await act('translate');await collectSentence(duel+'/sentence/0');
  }
  const saved=await state();
  assert(saved.personalVocab.items.some(i=>i.wordId==='v-available'));
  assert(saved.personalVocab.items.some(i=>i.wordId==='v-valuable'));
  assert.equal(saved.personalVocab.items.find(i=>i.key==='personal-lex-conf-curry').wordId,null);
  assert.equal(saved.expressions.items.find(i=>i.key==='cf-available/sentence/0').bank,'confusables');
  await expressions();
  const duelImg=expressionEntry('cf-available/sentence/0').locator('img');await decoded(duelImg);
  assert.match(await duelImg.getAttribute('src'),/\/v-available\.svg\?v=[a-f0-9]{12}$/,'duel must use the canonical sense image, not a spelling guess');
  assert.equal(await expressionEntry('cf-valuable/sentence/0').locator('img').count(),0,'C class has no expression illustration');
  assert.equal(await expressionEntry('cf-curry/sentence/0').locator('img').count(),0,'lightweight duel word cannot borrow a canonical illustration');
  await personal();
  await decoded(page.locator('[data-personal-key="v-available"] img'));
  assert.equal(await page.locator('[data-personal-key="v-valuable"] img').count(),0);
  assert.equal(await page.locator('[data-personal-key="personal-lex-conf-curry"] .vocab-art').count(),0);
  assert(!artRequests.some(u=>/\/assets\/vocab\/(?:v-valuable|cf-|lex-conf-|personal-)/.test(u)),'C, lightweight, and alias IDs never request their own SVG');

  // Turning pictures off removes them from either book, persists through a
  // reopen, and still permits pictures to return without altering collections.
  const beforeBooks={expressions:(await state()).expressions.items,personalVocab:(await state()).personalVocab.items};
  await act('settings');const preference=page.locator('[data-pref=vocabPictures]');
  assert(await preference.isChecked());await preference.uncheck();
  assert.equal(await page.locator('.vocab-art img').count(),0);await act('close');
  await expressions();assert.equal(await page.locator('.vocab-art img').count(),0);
  await page.reload();await page.locator('.habitat').waitFor();await personal();
  assert.equal(await page.locator('.vocab-art img').count(),0);
  await act('settings');assert.equal(await preference.isChecked(),false);await preference.check();await act('close');
  await decoded(page.locator('[data-personal-key="v-forklift"] img'));
  await expressions();await decoded(expressionEntry('cf-available/sentence/0').locator('img'));
  const afterBooks=await state();assert.deepEqual(afterBooks.expressions.items,beforeBooks.expressions);assert.deepEqual(afterBooks.personalVocab.items,beforeBooks.personalVocab);
  assert.equal(await page.evaluate(()=>matchMedia('(prefers-color-scheme: dark)').matches),width===390);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));

  const screen=await state();
  screen.screening={marks:{},run:{ids:[id,'v-crate'],index:0,claims:0,known:0,unknown:0,checks:0,correct:0,pending:false}};
  await store(screen);await nav('learn');await act('screen-open');
  assert.equal(await page.locator('.vocab-art img').count(),0);
  await act('screen-no');await act('screen-last-word');
  await decoded(page.locator('dialog [data-vocab-art="v-forklift"] img'));
  assert.equal(await page.locator('[data-vocab-art="v-crate"] img').count(),0);
  await act('close');
};
