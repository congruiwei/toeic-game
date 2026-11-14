const assert=require('node:assert/strict');
module.exports=async({page,act,nav,state,reset,store})=>{
  await reset();await nav('report');
  await page.locator('#prediction').waitFor();
  assert.match(await page.locator('#prediction').innerText(),/仅供参考/);
  assert.equal(await page.locator('.prediction-empty').count(),1);
  await nav('home');await page.locator('[data-act="start"][data-mode="vocab"]:visible').first().click();
  await page.locator('[data-act="answer"]').first().click();
  let s=await state();assert.ok(s.prediction.R.evidence>0);assert.equal(s.prediction.L.evidence,0);
  assert.equal(Object.keys(s.prediction.days).length,1);
  await nav('report');const chart=page.locator('[data-pred-chart]');await chart.waitFor();
  assert.equal(await chart.locator('circle').count(),1);
  for(const period of ['7','30','all']){
    const button=page.locator('[data-act="pred-range"][data-range="'+period+'"]');await button.click();
    assert.equal(await button.getAttribute('aria-pressed'),'true');
    assert.equal(await chart.locator('circle').count(),1);
    assert.ok(await chart.evaluate(e=>e.getBoundingClientRect().width<=innerWidth));
  }
  for(const [key,label] of [['L','听力'],['R','阅读'],['total','总']]){
    await page.locator('[data-act=pred-series][data-series="'+key+'"]').click();
    assert((await chart.getAttribute('aria-label')).startsWith(label));
  }
  await reset();
};
