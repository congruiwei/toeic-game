const assert=require('node:assert/strict');
module.exports=async({page,act,nav,store,state,reset})=>{
  await reset();await nav('learn');await act('method-list');
  const cards=page.locator('[data-act=method-open]');
  await cards.first().waitFor();
  const ids=await cards.evaluateAll(nodes=>nodes.map(n=>n.dataset.method));
  assert(ids.includes('first-word')&&ids.includes('p7-multi')&&ids.length===22);
  for(const id of ids){
    await page.locator('[data-act=method-open][data-method="'+id+'"]').click();
    await page.locator('.method-diagram [lang=en]').first().waitFor();
    const unfinished=(await state()).session;
    await act('method-try');
    if(unfinished && unfinished.index<unfinished.items.length) await act('replace');
    await page.locator('.lesson-header').waitFor();
    assert.equal(await page.locator('dialog[open] .method-card').count(),0,id);
    const s=await state(), r=s.session.items[0];assert.equal(s.session.items.length,1);
    const valid=await page.evaluate(async({id,r})=>{const {catalog}=await import('./js/bank.js');const {relevantMethods}=await import('./js/methods.js');return relevantMethods(r,catalog.get(r.id).data).includes(id);},{id,r});
    assert(valid,id);await nav('learn');await act('method-list');
  }
  const freshRun=await state();freshRun.session=null;freshRun.methodsSeen=[];freshRun.settings.methodHints=true;await store(freshRun);
  await nav('learn');await page.locator('[data-act=configure][data-mode=part2]').click();
  await page.selectOption('#mode-filter','first');await act('configured');
  await page.locator('[data-method-card=first-word][data-auto=true]').waitFor();
  assert.equal(await page.locator('dialog[open] .method-diagram li').count(),2);
  await act('method-skip');
  const original=(await state()).session.items[0].id;
  await page.reload();await page.locator('.habitat').waitFor();await act('resume');
  await page.locator('[data-act=answer]').first().waitFor();
  assert.equal((await state()).session.items[0].id,original);
  assert.equal(await page.locator('dialog[open] .method-card').count(),0);
  await act('answer');await act('next');
  assert(!await page.locator('dialog[open] .method-card').count());assert((await state()).methodsSeen.includes('first-word'));
  // Verify map filters route to their own teaching card, not just the first grammar topic.
  for (const [filter,id] of [['gram-word-form','word-form'],['gram-time','tense'],['gram-conjunction','link'],['gram-lexis','lexis']]){
    await nav('learn');await page.locator('[data-act=configure][data-mode=grammar]').click();
    await page.selectOption('#mode-filter',filter);await act('configured');if(await page.locator('[data-act=replace]:visible').count())await act('replace');
    await page.locator('[data-method-card="'+id+'"][data-auto=true]').waitFor();await act('method-skip');
    assert((await state()).session.items.every(r=>r.id.startsWith(filter+'-')));
  }
  await nav('home');const seen=(await state()).methodsSeen.slice().sort();
  await act('diag-open');await page.locator('[data-act=diag-answer]').first().waitFor();
  assert.equal(await page.locator('dialog[open] .method-card').count(),0);
  await act('diag-leave');await nav('learn');await act('screen-open');await page.locator('.screen-card').waitFor();
  await nav('report');assert.equal(await page.locator('dialog[open] .method-card').count(),0);
  assert.deepEqual((await state()).methodsSeen.slice().sort(),seen);
  await nav('home');await act('settings');await page.locator('[data-pref=methodHints]').uncheck();await act('close');
  const s=await state();s.session=null;await store(s);await nav('learn');
  await page.locator('[data-act=configure][data-mode=dialogue]').click();await act('configured');
  await page.locator('[data-act=answer]').first().waitFor();assert.equal(await page.locator('dialog[open] .method-card').count(),0);
  await nav('learn');await act('method-list');await page.locator('[data-act=method-open][data-method=graphic]').click();
  assert(await page.locator('[data-method-card=graphic]').isVisible());
};
