const assert=require('node:assert/strict');
module.exports=async({page,act,nav,state,store})=>{
  const key='sprout-isle.save';let candidateRequests=0,blockCandidates=true,blockFull=false;
  await page.route('**/data/confusable-candidates.json',async route=>{
    candidateRequests++;if(blockCandidates)await route.fulfill({status:503,body:'not yet available'});else await route.continue();
  });
  await page.route('**/data/confusables.json',async route=>{
    if(blockFull)await route.fulfill({status:503,body:'not yet available'});else await route.continue();
  });
  const old=await state();old.xp=84;old.stats.vocab=84;old.words['v-available']={box:1,due:Date.now()+86400000,right:2,tries:2};
  await store(old);assert.equal(candidateRequests,0,'boot restores canonical IDs without the optional packet');
  assert.equal((await state()).xp,84);assert.equal((await state()).words['v-available'].right,2);

  // Importing and receiving another tab's save have the same catalog-only requirement.
  await act('settings');const imported={...await state(),xp:88};
  await page.locator('#import-file').setInputFiles({name:'old.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(imported))});
  await act('restore');assert.equal((await state()).xp,88);assert.equal(candidateRequests,0);
  await page.evaluate(key=>{
    const previous=localStorage.getItem(key),next=JSON.parse(previous);next.xp=92;
    const raw=JSON.stringify(next);localStorage.setItem(key,raw);
    window.dispatchEvent(new StorageEvent('storage',{key,oldValue:previous,newValue:raw,storageArea:localStorage}));
  },key);
  await page.waitForFunction(()=>document.querySelector('.xp b')?.textContent.startsWith('92 /'));
  assert.equal(candidateRequests,0,'storage reconciliation does not need optional candidates');
  await nav('learn');await page.locator('[data-act=configure][data-mode=vocab]').click();
  await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('题库未能打开'));
  assert(candidateRequests>0,'a new vocabulary exercise still requires curated candidates');
  assert.equal((await state()).xp,92);
  blockCandidates=false;await page.locator('[data-act=configure][data-mode=vocab]').click();
  await page.locator('#vocab-format').waitFor();await act('close');

  // A saved duel must not be decoded against an incomplete catalog or overwritten as fresh.
  blockFull=true;
  const withDuel=await state();withDuel.session={mode:'confusable',title:'恢复易混词',items:[{id:'cf-available',mode:'confusable'}],index:0,right:0,gain:0,selected:null,elapsed:0,timed:false,intro:false};
  const raw=JSON.stringify(withDuel);await page.evaluate(({key,raw})=>localStorage.setItem(key,raw),{key,raw});
  await page.reload();await page.locator('[data-act=retry-restore]').waitFor();
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),raw,'missing required duel data leaves the exact saved bytes intact');
  await page.evaluate(()=>{
    window.dispatchEvent(new Event('pagehide'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),raw,'lifecycle events cannot save a fresh island over the waiting backup');
  assert(await page.locator('[data-act=retry-restore]').isVisible(),'returning to the tab keeps the recovery action available');
  blockFull=false;await act('retry-restore');await page.locator('.habitat').waitFor();
  const restored=await state();assert.equal(restored.xp,withDuel.xp);assert.equal(restored.stage,withDuel.stage);assert.deepEqual(restored.session,withDuel.session);
  await act('resume');await page.locator('.lesson-question').waitFor();
  assert.equal((await state()).session.items[0].id,'cf-available');
};
