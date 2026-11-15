const assert=require('node:assert/strict');
const fs=require('node:fs/promises');

module.exports=async({page,quiz,act,nav,state,store,reset})=>{
  const open=async()=>{await nav('learn');await act('expression-open');await page.getByRole('heading',{name:'职场三语表达本',exact:true}).waitFor();};
  const expectSnapshot=async item=>{
    const entry=page.locator('.expression-entry').filter({has:page.locator('[lang=en]',{hasText:item.en})}).first();
    await entry.waitFor();
    assert.equal(await entry.locator('[lang=en]').innerText(),item.en);
    assert.equal(await entry.locator('[lang=zh-CN]').innerText(),item.zh);
    assert.equal(await entry.locator('[lang=ja]').innerText(),item.ja);
    assert.equal(await entry.locator('[data-act=expression-speak][data-language=en]').count(),1);
    assert.equal(await entry.locator('[data-act=expression-speak][data-language=ja]').count(),1);
    return entry;
  };
  const forgeCollection=async ({key,bank,id})=>{
    // A UI gate must also protect the delegated handler when cached translations
    // already exist; hiding the normal button alone does not enforce the rule.
    await page.evaluate(({key,bank,id})=>{
      const host=document.createElement('div');host.className='lesson-feedback';host.dataset.expressionTestHost='';
      const panel=document.createElement('section');panel.className='translations';panel.dataset.translationId=id;
      const line=document.createElement('div');line.className='translation-line';
      line.dataset.translationKey=key;line.dataset.translationBank=bank;
      const button=document.createElement('button');button.dataset.act='collect-expression';
      button.dataset.key=key;button.dataset.bank=bank;button.dataset.expressionProbe='';button.textContent='收藏测试';
      line.append(button);panel.append(line);host.append(panel);document.querySelector('#app').append(host);
    },{key,bank,id});
    await page.locator('[data-expression-probe]').click();
    await page.waitForTimeout(80);
    await page.evaluate(()=>document.querySelector('[data-expression-test-host]')?.remove());
  };

  await quiz('part2','response');
  assert.equal(await page.locator('[data-act=collect-expression]').count(),0,'no collection before answering');
  await act('unknown');await act('translate');
  const panel=page.locator('.lesson-feedback > .translations');
  await panel.locator('[data-act=collect-expression]').first().waitFor();
  const snapshots=[];
  for(let i=0;i<2;i++){
    const button=panel.locator('[data-act=collect-expression]').nth(i);
    const snapshot=await button.evaluate(el=>{
      const line=el.closest('.translation-line'),host=el.closest('[data-translation-id]');
      return {key:el.dataset.key,bank:el.dataset.bank,id:host.dataset.translationId,
        en:line.querySelector('[lang=en]').textContent,zh:line.querySelector('[lang=zh-CN]').textContent,ja:line.querySelector('[lang=ja]').textContent};
    });
    assert(snapshot.key&&snapshot.bank&&snapshot.id,'collection is tied to the actual translation unit');
    await button.click();snapshots.push(snapshot);
    await page.waitForFunction(n=>JSON.parse(localStorage.getItem('sprout-isle.save')).expressions.items.length===n,i+1);
    const saved=(await state()).expressions.items[i];
    for(const field of ['key','bank','en','zh','ja'])assert.equal(saved[field],snapshot[field]);
    assert.equal(saved.sourceId,snapshot.id);
    // Disabled already-collected buttons are safe, and the model also rejects duplicates.
    await panel.locator('[data-act=collect-expression]').nth(i).evaluate(el=>el.click());
    assert.equal((await state()).expressions.items.length,i+1);
  }

  await quiz('part2','response');
  const liveUnit=await page.evaluate(async()=>{
    const s=JSON.parse(localStorage.getItem('sprout-isle.save')),ref=s.session.items[s.session.index];
    const {catalog}=await import('./js/bank.js');const {sourceUnits}=await import('./js/translation-source.js');
    return sourceUnits('part2',[catalog.get(ref.id).data]).find(u=>!s.expressions.items.some(i=>i.key===u.key));
  });
  assert(liveUnit);await forgeCollection(liveUnit);
  assert.equal((await state()).expressions.items.length,2,'cached translations still cannot be collected before answering');

  await open();assert.equal(await page.locator('.expression-list .expression-entry').count(),2);
  const firstEntry=await expectSnapshot(snapshots[0]);await expectSnapshot(snapshots[1]);
  await page.evaluate(()=>{window.played=[];});
  await firstEntry.locator('[data-act=expression-speak][data-language=en]').click();
  await page.waitForFunction(text=>window.played.includes(text),snapshots[0].en);

  await page.locator('[data-act=expression-start][data-direction=ja-en]').click();
  let progress=(await state()).expressions;
  assert.equal(progress.run.direction,'ja-en');assert.equal(progress.run.index,0);
  const first=progress.items.find(i=>i.key===progress.run.keys[0]);
  assert.equal(await page.locator('.expression-prompt[lang=ja]').innerText(),first.ja);
  assert.equal(await page.locator('.expression-entry [lang=en]').count(),0,'the English answer is hidden');
  assert.equal(await page.locator('.expression-entry [lang=zh-CN]').count(),0);
  assert.equal(await page.locator('[data-act=expression-rate]').count(),0);
  await act('expression-flip');await expectSnapshot(first);
  assert.equal(await page.locator('[data-act=expression-rate]').count(),4);

  await page.reload();await open();await act('expression-resume');
  assert.equal((await state()).expressions.run.flipped,true,'flipped face survives refresh');
  await expectSnapshot(first);
  await page.locator('[data-act=expression-rate][data-grade="1"]').click();
  progress=(await state()).expressions;
  assert.equal(progress.run.index,1);assert.equal(progress.run.flipped,false);
  assert.equal(progress.items.find(i=>i.key===first.key).fsrs.lastRating,1);
  assert.equal(progress.items.find(i=>i.key===first.key).fsrs.reps,1);
  await act('expression-flip');await act('expression-open');

  // Real exported JSON includes the collection, FSRS memory, direction, index and face.
  await act('settings');
  const downloadPromise=page.waitForEvent('download');await act('export');
  const download=await downloadPromise,backup=JSON.parse(await fs.readFile(await download.path(),'utf8'));
  assert.deepEqual(backup.expressions,(await state()).expressions);
  assert.equal(backup.expressions.run.index,1);assert.equal(backup.expressions.run.flipped,true);
  await act('close');await act('expression-resume');
  await page.locator('[data-act=expression-rate][data-grade="3"]').click();
  assert.match(await page.locator('#app').innerText(),/本轮表达复习完成/);
  await act('expression-open');
  await page.locator('[data-act=expression-start][data-direction=en-ja]').click();
  progress=(await state()).expressions;
  const reverse=progress.items.find(i=>i.key===progress.run.keys[0]);
  assert.equal(progress.run.direction,'en-ja');
  assert.equal(await page.locator('.expression-prompt[lang=en]').innerText(),reverse.en);
  assert.equal(await page.locator('.expression-entry [lang=ja]').count(),0,'the Japanese answer is hidden');
  await act('expression-flip');await expectSnapshot(reverse);
  await page.locator('[data-act=expression-rate][data-grade="4"]').click();
  assert.equal((await state()).expressions.items.find(i=>i.key===reverse.key).fsrs.lastRating,4);
  await nav('report');
  const report=page.locator('.report-section').filter({has:page.getByRole('heading',{name:'三语表达',exact:true})});
  assert.match(await report.innerText(),/收藏 2/);

  await reset();await act('settings');
  await page.locator('#import-file').setInputFiles({name:'expressions.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
  await act('restore');
  assert.deepEqual((await state()).expressions,backup.expressions,'real file import restores the exact snapshot and run');
  await open();await act('expression-resume');await expectSnapshot(backup.expressions.items[1]);

  // Retiring the original item from the bank must not delete a collected snapshot.
  const retired=await state(),oldKey=retired.expressions.items[0].key,newKey='retired-expression/text/0';
  retired.expressions.items[0].sourceId='retired-expression';retired.expressions.items[0].key=newKey;
  retired.expressions.run.keys=retired.expressions.run.keys.map(k=>k===oldKey?newKey:k);
  await store(retired);await open();await expectSnapshot(retired.expressions.items[0]);
  assert.equal((await state()).expressions.items[0].key,newKey);
  assert.equal(await page.evaluate(async()=> (await import('./js/bank.js')).catalog.has('retired-expression')),false);

  // A genuine old-version JSON without this field migrates without touching study progress.
  const legacy=structuredClone(backup);legacy.version=3;delete legacy.expressions;
  await store(legacy);const migrated=await state();
  assert.deepEqual(migrated.expressions,{version:1,items:[],run:null});
  assert.equal(migrated.xp,legacy.xp);assert.deepEqual(migrated.history,legacy.history);
  assert.deepEqual(migrated.words,legacy.words);

  // A live exam is protected even if the old ordinary session had already been answered.
  const mock=structuredClone(backup);
  mock.exam=await page.evaluate(async()=>{
    const {bank,loadBank}=await import('./js/bank.js');await loadBank(['part1','part2','grammar','listening','reading']);
    return (await import('./js/exam.js')).buildExam(bank,{seen:{}},'half','expression-live-gate');
  });
  mock.session.selected=await page.evaluate(async ref=>(await import('./js/bank.js')).question(ref).answer,
    mock.session.items[mock.session.index]);
  await store(mock);await nav('learn');await act('exam-lobby');await act('exam-resume');
  assert.equal(await page.locator('[data-act=collect-expression]').count(),0);
  await forgeCollection(liveUnit);
  assert.equal((await state()).expressions.items.length,2,'a live exam rejects collection even with cached translated source');
};
