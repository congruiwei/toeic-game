const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const meanings=require('../../data/i18n/ja/vocab-meanings.json').entries;
const part2Japanese=require('../../data/i18n/ja/part2.json').entries;

module.exports=async({page,act,nav,state,quiz})=>{
  const kyoko='com.apple.voice.enhanced.ja-JP.Kyoko';
  const otoya='com.apple.voice.premium.ja-JP.Otoya';
  const rate=.85;
  const reveal=async locator=>{
    const parent=locator.locator('xpath=ancestor::details[1]');
    if(await parent.count() && !await parent.evaluate(el=>el.open))await parent.locator(':scope > summary').click();
  };
  const hear=async(locator,{text,voice='Kyoko Enhanced',lang='ja-JP',speed=rate}={})=>{
    await page.evaluate(()=>{window.played=[];window.spoken=[];window.speechGestures=[];});
    await reveal(locator);await locator.click();
    await page.waitForFunction(()=>window.spoken.length>0);
    const {spoken,gestures,played}=await page.evaluate(()=>({spoken:window.spoken,gestures:window.speechGestures,played:window.played}));
    assert.equal(spoken.length,1,'one user action creates exactly one utterance');
    assert.equal(spoken[0].lang,lang);assert.equal(spoken[0].voice,voice);assert.equal(spoken[0].rate,speed);
    if(text!==undefined)assert.equal(spoken[0].text,text);
    assert.deepEqual(played,[spoken[0].text],'existing played assertions remain compatible');
    assert.equal(gestures[0].type,'click','native speak runs before the initiating click callback returns');
    assert.equal(gestures[0].trusted,true,'speech comes from a real browser click');
    assert.equal(gestures[0].active,true,'the click retains browser user activation');
    return spoken[0];
  };
  const current=()=>page.evaluate(async()=>{
    const s=JSON.parse(localStorage.getItem('sprout-isle.save')),ref=s.session.items[s.session.index];
    return {ref,q:(await import('./js/bank.js')).question(ref)};
  });

  await act('settings');
  const selection=page.locator('[data-pref=japaneseVoice]');
  await selection.waitFor();
  const choices=await selection.locator('option').evaluateAll(options=>options.map(option=>({value:option.value,text:option.textContent})));
  assert.equal(choices.length,3,'automatic plus the two safe Japanese voices');
  assert.equal(choices[0].value,'');
  assert.deepEqual(choices.slice(1).map(choice=>choice.value),[otoya,kyoko],'premium automatic candidate precedes enhanced');
  assert(!choices.some(choice=>/Bad News|Ava|Daniel|Karen|Claire/.test(choice.text)));
  for(const slot of await page.locator('[data-voice-slot]').all()){
    const values=await slot.locator('option').allTextContents();
    assert(!values.some(text=>/Kyoko|Otoya|Bad News/.test(text)),'English casting only lists English voices');
  }
  await selection.selectOption(kyoko);
  await page.locator('[data-pref=accent]').selectOption('en-GB');
  await page.locator('[data-voice-slot=A]').selectOption('en-GB');
  await page.locator('[data-pref=rate]').evaluate((input,value)=>{
    input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
  },rate);
  assert.equal((await state()).settings.japaneseVoice,kyoko);
  assert.equal((await state()).settings.rate,rate);
  await hear(page.locator(`[data-act=preview-japanese][data-voice="${kyoko}"]`));
  await hear(page.locator(`[data-act=preview-japanese][data-voice="${otoya}"]`),{voice:'Otoya Premium'});
  assert.equal((await state()).settings.japaneseVoice,kyoko,'previewing a voice does not overwrite the selected voice');
  await hear(page.locator('[data-act=preview-voice][data-voice=en-GB]'),{voice:'Daniel Enhanced',lang:'en-GB'});
  await act('close');

  await quiz('part2','response');
  assert.equal(await page.locator('[data-act=translation-ja]').count(),0,'live questions expose no Japanese translation speech');
  await act('unknown');await act('translate');
  const panel=page.locator('.lesson-feedback > .translations');
  const japanese=panel.locator('[lang=ja][data-act=translation-ja]').first();
  await japanese.waitFor();
  const source=await japanese.evaluate(el=>({key:el.dataset.key,bank:el.dataset.bank}));
  assert(source.key);assert.equal(source.bank,'part2');
  assert.equal(await japanese.getAttribute('role'),'button');
  assert.equal(await japanese.getAttribute('tabindex'),'0');
  await hear(japanese,{text:part2Japanese[source.key]});
  await panel.locator('[data-act=collect-expression]').first().click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('sprout-isle.save')).expressions.items.length===1);
  const expression=(await state()).expressions.items[0];
  await nav('learn');await act('expression-open');
  await hear(page.locator('p[lang=ja][data-act=expression-speak]').first(),{text:expression.ja});
  await hear(page.locator('button[data-act=expression-speak][data-language=ja]').first(),{text:expression.ja});
  await hear(page.locator('[data-act=expression-speak][data-language=en]').first(),{text:expression.en,voice:'Daniel Enhanced',lang:'en-GB'});

  await quiz('vocab','','meaning');
  const {ref,q}=await current();
  await page.locator(`[data-act=answer][data-i="${q.options.indexOf(q.answer)}"]`).click();
  const wordMeaning=page.locator(`.lesson-word-note [data-vocab-ja="${ref.id}"][data-act=meaning-ja-speak]`);
  await wordMeaning.waitFor();
  await hear(wordMeaning,{text:meanings[`${ref.id}/meaning`]});
  await nav('library');
  await page.locator('[data-act=library-tab][data-tab=words]').click();
  const libraryMeaning=page.locator(`.lib-card [data-vocab-ja="${ref.id}"][data-act=meaning-ja-speak]`);
  await libraryMeaning.waitFor({state:'attached'});await reveal(libraryMeaning);
  await hear(libraryMeaning,{text:meanings[`${ref.id}/meaning`]});

  await page.reload();await page.locator('.habitat').waitFor();
  assert.equal((await state()).settings.japaneseVoice,kyoko,'the explicit Japanese voice survives a fresh page');
  assert.equal((await state()).settings.voiceSlots.A,'en-GB','English voice preference stays separate');
  await act('settings');
  assert.equal(await page.locator('[data-pref=japaneseVoice]').inputValue(),kyoko);
  await hear(page.locator(`[data-act=preview-japanese][data-voice="${kyoko}"]`));
  const downloadPromise=page.waitForEvent('download');await act('export');
  const download=await downloadPromise,backup=JSON.parse(await fs.readFile(await download.path(),'utf8'));
  assert.equal(backup.settings.japaneseVoice,kyoko);assert.equal(backup.settings.rate,rate);
  assert.equal(backup.settings.voiceSlots.A,'en-GB');
  await act('close');
};
