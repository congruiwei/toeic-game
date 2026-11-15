const assert=require('node:assert/strict');
const meanings=require('../../data/i18n/ja/vocab-meanings.json').entries;

module.exports=async({page,quiz,act,nav,state,store,reset})=>{
  const requests=[];
  page.on('request',request=>{if(request.url().includes('/data/i18n/'))requests.push(new URL(request.url()).pathname);});
  const current=async()=>{
    await page.locator('.lesson-question').waitFor();
    return page.evaluate(async()=>{
    const s=JSON.parse(localStorage.getItem('sprout-isle.save')),ref=s.session.items[s.session.index];
    return {ref,q:(await import('./js/bank.js')).question(ref)};
    });
  };
  const preference=async language=>{
    await act('settings');await page.locator('[data-pref=vocabLanguage]').selectOption(language);await act('close');
    assert.equal((await state()).settings.vocabLanguage,language);
  };
  const noFullPack=()=>{
    assert(!requests.some(url=>/\/data\/i18n\/(zh|ja)\/vocab\.json$/.test(url)),
      'semantic cards and their details must not download the large example-translation pack');
  };
  const noExampleTranslations=async()=>{
    assert.equal(await page.locator('.translation-content [lang=zh-CN], .translation-content [lang=ja]').count(),0,
      'translated example sentences remain unavailable before answering');
    noFullPack();
  };
  const choose=async correct=>{
    const {q}=await current(),index=q.options.findIndex(option=>(option===q.answer)===correct);
    await page.locator(`[data-act=answer][data-i="${index}"]`).click();
    await page.locator('.lesson-feedback').waitFor();
  };
  const expectJapaneseCard=async(format)=>{
    const {ref,q}=await current();assert.equal(ref.format,format);
    assert.equal(q.options.length,4);assert.equal(new Set(q.options).size,4);
    assert.equal(q.options.filter(option=>option===q.answer).length,1);
    const prompt=page.locator('.lesson-question h2');
    if(format==='english-ja'){
      assert.equal(await prompt.innerText(),meanings[`${ref.id}/meaning`]);
      assert.equal(await prompt.evaluate(el=>el.closest('[lang]')?.lang),'ja');
      assert.equal(q.answer,q.word);
    }else{
      assert.equal(await prompt.innerText(),q.word);
      assert.equal(q.answer,meanings[`${ref.id}/meaning`]);
      const buttons=page.locator('[data-act=answer]');assert.equal(await buttons.count(),4);
      for(const button of await buttons.all()){
        assert(await button.evaluate(el=>el.closest('[lang]')?.lang==='ja'||!!el.querySelector('[lang=ja]')),
          'Japanese meaning choices declare lang=ja');
      }
    }
    await noExampleTranslations();return {ref,q};
  };
  const replaceIfNeeded=async()=>{
    if(await page.locator('[data-act=replace]:visible').count())await act('replace');
    await page.locator('.lesson-question').waitFor();
  };

  assert.equal((await state()).settings.vocabLanguage,'both','fresh saves default to a bilingual rotation');
  await quiz('vocab');
  const first=await current();assert.equal(first.ref.format,'meaning');
  assert.equal(first.q.answer,first.q.zh);
  await noExampleTranslations();
  await choose(true);
  const firstJa=page.locator(`.lesson-word-note [data-vocab-ja="${first.ref.id}"]`);
  await firstJa.waitFor();await page.waitForFunction(({id,meaning})=>document.querySelector(`[data-vocab-ja="${id}"]`)?.textContent.includes(meaning),{id:first.ref.id,meaning:meanings[`${first.ref.id}/meaning`]});
  assert((await firstJa.innerText()).includes(meanings[`${first.ref.id}/meaning`]));
  assert((await page.locator('.lesson-word-note').innerText()).includes(first.q.zh));
  assert.equal((await state()).words[first.ref.id].right,1);noFullPack();

  await act('next');const second=await expectJapaneseCard('english-ja');
  const originalOptions=second.q.options;
  await page.reload();await act('resume');
  const resumed=await expectJapaneseCard('english-ja');
  assert.deepEqual(resumed.ref,second.ref);assert.deepEqual(resumed.q.options,originalOptions);
  await act('unknown');
  let s=await state();assert.equal(s.errors[second.ref.id].ref.format,'english-ja');
  assert.equal(s.words[second.ref.id].right,0);assert.equal(s.words[second.ref.id].fsrs.lastRating,1);

  // Saved error formats do not change merely because the global preference changes.
  await preference('zh');await nav('library');
  await page.locator('[data-act=library-tab][data-tab=errors]').click();
  await page.locator(`[data-act=review-one][data-id="${second.ref.id}"]`).click();await replaceIfNeeded();
  await expectJapaneseCard('english-ja');await choose(true);
  assert.equal((await state()).errors[second.ref.id],undefined);

  // Explicit formats work even when the global preference is Chinese.
  await quiz('vocab','','meaning-ja');const japaneseMeaning=await expectJapaneseCard('meaning-ja');
  await choose(false);
  assert.equal((await state()).errors[japaneseMeaning.ref.id].ref.format,'meaning-ja');
  assert.equal((await state()).words[japaneseMeaning.ref.id].fsrs.lastRating,1);
  await quiz('vocab','','english-ja');await expectJapaneseCard('english-ja');await choose(true);noFullPack();

  // A cold page loads only the small definitions when the collected card is opened.
  await page.reload();const beforeLibrary=requests.length;
  await nav('library');await page.locator('[data-act=library-tab][data-tab=words]').click();
  const card=page.locator('.lib-card').filter({has:page.locator(`[data-vocab-ja="${first.ref.id}"]`)});
  await card.waitFor({state:'attached'});
  if(!(await card.evaluate(el=>el.open)))await card.locator(':scope > summary').click();
  const libraryJa=card.locator(`[data-vocab-ja="${first.ref.id}"]`);
  await page.waitForFunction(({id,meaning})=>document.querySelector(`[data-vocab-ja="${id}"]`)?.textContent.includes(meaning),{id:first.ref.id,meaning:meanings[`${first.ref.id}/meaning`]});
  assert((await libraryJa.innerText()).includes(meanings[`${first.ref.id}/meaning`]));
  assert((await card.innerText()).includes(first.q.zh));
  assert(requests.slice(beforeLibrary).some(url=>url.endsWith('/ja/vocab-meanings.json')),
    'opening the cold library obtains the standalone Japanese meanings');
  noFullPack();

  // Exercise the saved setting independently from the explicit-format override.
  await reset();s=await state();s.settings.methodHints=false;await store(s);
  await preference('ja');await quiz('vocab');
  assert.deepEqual((await state()).session.items.map(ref=>ref.format),['meaning-ja','english-ja','sound','cloze','match']);
  await expectJapaneseCard('meaning-ja');
  const savedJa=(await state()).session.items[0];
  await preference('zh');await page.reload();await act('resume');
  assert.deepEqual((await current()).ref,savedJa,'an in-progress Japanese card stays Japanese after a preference change');
  await expectJapaneseCard('meaning-ja');

  // Import/migrate an old Chinese session with no language preference.
  const legacy=await state();legacy.version=3;delete legacy.settings.vocabLanguage;
  legacy.session={mode:'vocab',title:'旧词卡练习',items:[{id:'v-available',mode:'vocab',format:'meaning'}],
    index:0,right:0,gain:0,selected:null,elapsed:0,timed:false,intro:false};
  await store(legacy);
  assert.equal((await state()).settings.vocabLanguage,'both');
  await act('resume');let old=await current();assert.equal(old.ref.format,'meaning');assert.equal(old.q.answer,old.q.zh);
  await preference('ja');await page.reload();await act('resume');old=await current();
  assert.equal(old.ref.format,'meaning','legacy refs retain their original Chinese format');
  assert.equal(old.q.answer,old.q.zh);await noExampleTranslations();
  noFullPack();
};
