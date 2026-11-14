const assert=require('node:assert/strict');
module.exports=async({page,act,nav,state,reset,store})=>{
  await reset();await nav('report');
  await page.locator('#prediction').waitFor();
  assert.match(await page.locator('#prediction').innerText(),/仅供参考/);
  assert.equal(await page.locator('.prediction-empty').count(),1);
  await nav('home');await page.locator('[data-act="start"][data-mode="vocab"]:visible').first().click();
  await page.locator('[data-act="answer"]').first().click();
  const vocabulary=await state();assert.equal(vocabulary.prediction,undefined);
  assert(Object.keys(vocabulary.words).length>0);
  await nav('report');
  assert.match(await page.locator('.report-rows').first().innerText(),/词汇/);
  assert.equal(await page.locator('.prediction-empty').count(),1);
  await nav('home');await page.locator('[data-act="start"][data-mode="part2"]:visible').first().click();
  if(await page.locator('[data-act=replace]').isVisible())await act('replace');
  if(await page.locator('[data-method-card]').isVisible())await act('method-skip');
  await act('answer');
  const s=await state();assert.ok(s.prediction.L.evidence>0);assert.equal(s.prediction.R.evidence,0);
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
  const dates=await page.evaluate(()=>{
    const f=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
    return [-9,-8,-6,0].map(offset=>{const d=new Date();d.setDate(d.getDate()+offset);return f(d);});
  });
  s.prediction.days=Object.fromEntries(dates.map((day,i)=>[day,[180+30*i,220,400+30*i]]));
  s.prediction.L.rating=540;
  s.prediction.R.rating=440;
  await store(s);await nav('report');
  assert.match(await page.locator('#prediction').innerText(),/总估分 490/);
  await page.locator('[data-act=pred-range][data-range="7"]').click();
  assert.deepEqual(await chart.locator('circle title').allTextContents(),[dates[2]+' · 平滑估分 440 分',dates[3]+' · 平滑估分 470 分']);
  await page.locator('[data-act=pred-range][data-range="all"]').click();
  assert.equal(await chart.locator('circle title').last().textContent(),dates[3]+' · 平滑估分 470 分');
  await reset();
};
