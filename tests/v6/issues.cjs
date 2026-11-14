const assert=require('node:assert/strict');
module.exports=async ({page,quiz,act,state})=>{
  await quiz('reading','7');await act('unknown');
  const id=(await state()).session.items[0].id;
  await act('report-issue');await page.selectOption('#issue-reason','有两个答案都对');
  await page.fill('#issue-note','<article> 复核原文');await act('save-issue');
  const [report]=(await state()).issues;
  assert.equal(report.id,id);assert.equal(report.note,'<article> 复核原文');assert.match(report.text,/阅读材料/);assert.match(report.text,/我的答案　不知道/);
  await page.reload();await act('settings');
  assert.match(await page.locator('dialog').innerText(),/问题报告（1）/);
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied');}}}));
  await act('copy-issues');const box=page.locator('#copy-fallback');
  const [start,end,value]=await box.evaluate(e=>[e.selectionStart,e.selectionEnd,e.value]);
  assert.equal(start,0);assert.equal(end,value.length);assert(value.includes(report.text));assert(value.includes(report.note));
  await act('close');await act('settings');await act('clear-issues');await act('confirm-clear-issues');assert.deepEqual((await state()).issues,[]);
};
