const assert=require('node:assert/strict');
module.exports=async ({page,act,nav,state,quiz})=>{
  await quiz('vocab','','cloze');
  await act('unknown');
  const first=await state(), id=first.session.items[0].id;
  assert.equal(first.xp,4);assert.equal(first.errors[id].misses,1);assert.equal(first.words[id].right,0);
  assert.equal(first.report.parts.vocab.unknown,1);assert.equal(first.report.parts.vocab.right,0);
  await page.reload();await act('resume');
  assert.match(await page.locator('.lesson-feedback').innerText(),/不知道.*已加入复习/);
  assert.equal((await state()).xp,4);
  await nav('library');await page.locator('[data-tab=errors]').click();await act('review-one');await act('replace');
  await act('unknown');assert.equal((await state()).errors[id].misses,2);
  await nav('report');assert.match(await page.locator('.report-rows').first().innerText(),/答错 0 · 不知道 2/);
  for(const [mode,filter,format] of [['vocab','','meaning'],['vocab','','english'],['vocab','','sound'],['vocab','','match'],['part1'],['part2'],['dialogue','3'],['dialogue','4'],['grammar'],['reading','6'],['reading','7']]){
    await quiz(mode,filter,format);await act('unknown');await page.locator('.lesson-option.is-correct').waitFor();
  }
  await nav('learn');await act('exam-lobby');
  await page.locator('[data-act=exam-start][data-size=half]').click();await page.locator('#exam-audio-status').waitFor();
  assert.equal(await page.locator('[data-act=unknown]').count(),0);
};
