const assert=require('node:assert/strict');
module.exports=async({page,act,nav,state,reset,store})=>{
  await reset();
  await act('diag-skip');assert.equal((await state()).diagnosis.skipped,true);
  await page.reload();await act('diag-open');
  const original=(await state()).diagnosis.active.current.id;
  await act('diag-leave');await act('diag-open');
  assert.equal((await state()).diagnosis.active.current.id,original);
  const parts=new Set();
  for(let index=0;index<30;index++){
    const q=page.locator('#diagnosis-question');await q.waitFor();parts.add(Number(await q.getAttribute('data-part')));
    if(!index)assert.equal(Number(await q.getAttribute('data-level')),500);
    const button=q.locator('[data-act="diag-answer"]').first();
    if(index===0){await act('diag-unknown');await page.getByRole('heading',{name:'这道题的解析'}).waitFor();await act('diag-dismiss');}else await button.click();
    await page.waitForFunction(i=>{const d=JSON.parse(localStorage.getItem('sprout-isle.save')).diagnosis;return !d.active||d.active.items.length===i+1;},index);
  }
  assert.equal(parts.size,8);const s=await state();assert.equal(s.diagnosis.results.length,1);assert.equal(s.diagnosis.active,null);
  assert.equal(Object.keys(s.diagnosis.results[0].levels).length,4);
  assert.equal(s.diagnosis.results[0].items[0].unknown,true);
  await page.getByText(/本次诊断的参考区间/).waitFor();
  await nav('report');await page.getByRole('heading',{name:'水平诊断记录'}).waitFor();
  await nav('home');await act('diag-open');assert.equal((await state()).diagnosis.active.items.length,0);
  await act('diag-leave');await reset();
};
