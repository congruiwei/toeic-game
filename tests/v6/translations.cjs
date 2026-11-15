const assert=require('node:assert/strict');
module.exports=async({page,quiz,act,nav,state,store})=>{
  const requests=[];page.on('request',r=>{if(r.url().includes('/data/i18n/'))requests.push(r.url());});
  await quiz('part1');
  assert.equal(await page.locator('.translations').count(),0,'no answer translations in a live question');
  assert.equal(requests.length,0,'no translation download before opting in');
  await act('unknown');
  await act('translate');
  const panel=page.locator('.lesson-feedback > .translations');
  await panel.locator('.translation-line [lang=ja]').first().waitFor();
  assert.equal(await panel.locator('.translation-line').count(),4);
  assert.equal(requests.length,2);
  await panel.locator('[data-language=ja]').click();
  assert.equal(await panel.locator('[lang=zh-CN]:visible').count(),0);
  assert.equal(await panel.locator('[lang=ja]:visible').count(),4);
  await panel.locator('[data-language=zh]').click();
  assert.equal(await panel.locator('[lang=ja]:visible').count(),0);
  await panel.locator('[data-language=both]').click();
  assert.equal((await state()).settings.translationLanguage,'both');
  await page.locator('.sentence-panel > summary').click();
  const single=page.locator('.sentence-panel .translations').first();
  await single.locator('[data-act=translate]').click();
  assert.equal(await single.locator('.translation-line').count(),1);
  for(const [mode,filter] of [['part2','response'],['dialogue','3'],['dialogue','4'],['grammar',''],['reading','6'],['reading','7'],['vocab',''],['dictation','']]){
    await quiz(mode,filter);
    assert.equal(await page.locator('.translations').count(),0,mode+' pre-answer');
    if(mode==='dictation'){await page.fill('#dict-input','wrong');await act('submit-dict');}else await act('unknown');
    if(mode==='reading'&&filter==='6'){
      await act('translate');await page.locator('.translation-wait').waitFor();
      const run=(await state()).session;
      for(let index=run.index+1;index<run.items.length;index++){await act('next');await act('unknown');}
    }
    await act('translate');
    const view=page.locator('.lesson-feedback > .translations');
    await view.locator('[lang=ja]').first().waitFor();
    assert((await view.locator('[lang=zh-CN]').allTextContents()).every(Boolean));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  await act('settings');
  await page.locator('[data-pref=translationExpanded]').check();
  await page.locator('[data-pref=translationLanguage]').selectOption('ja');
  await act('close');
  await quiz('part1');await act('unknown');
  await page.locator('.lesson-feedback > .translations [lang=ja]').first().waitFor();
  assert.equal(await page.locator('.lesson-feedback > .translations [lang=zh-CN]:visible').count(),0);
  const s=await state();
  s.exam=await page.evaluate(async()=>{
    const {bank,loadBank}=await import('./js/bank.js');await loadBank(['part1','part2','grammar','listening','reading']);
    return (await import('./js/exam.js')).buildExam(bank,{seen:{}},'half','translation-gate');
  });
  await store(s);await nav('learn');await act('exam-lobby');await act('exam-resume');
  assert.equal(await page.locator('.translations').count(),0,'exam has no translation entry or data');
};
