const assert=require('node:assert/strict');
module.exports=async({page,act,nav,state,store,quiz})=>{
  async function clickAndCheck(selector){
    const button=page.locator(selector).first();
    const text=await button.getAttribute('data-text');
    await button.click();
    await page.waitForFunction(expected=>window.played.at(-1)===expected,text.replace(/\[[1-4]\]/g,'').trim());
    assert.equal(await button.getAttribute('data-text'),text,'speech normalization leaves displayed/source text unchanged');
    return text;
  }
  await quiz('vocab','','cloze');
  assert.equal(await page.locator('[data-act=read-aloud]').count(),0,'no reading aids before an answer');
  await act('unknown');
  const example=await clickAndCheck('.lesson-word-note blockquote [data-act=read-aloud]');
  assert(!example.includes('_____'));
  await clickAndCheck('.lesson-terms [data-act=read-aloud]');
  await act('leave');
  await quiz('grammar');await act('unknown');
  const complete=await clickAndCheck('.lesson-complete-sentence [data-act=read-aloud]');
  assert(!complete.includes('_____'),'Part 5 speaks the completed sentence');
  await act('leave');
  await quiz('reading','7');
  assert.equal(await page.locator('[data-act=read-aloud]').count(),0);
  await act('unknown');await clickAndCheck('.lesson-source-text [data-act=read-aloud]');
  await clickAndCheck('.option-read [data-act=read-aloud]');
  await act('leave');
  await nav('library');await clickAndCheck('.lib-card [data-act=read-aloud]');
  await nav('learn');await act('method-list');await act('method-open');
  await clickAndCheck('.method-card [data-act=read-aloud]');await act('close');

  // Reading a filled Part 6 passage must not disclose another upcoming blank.
  let s=await state();s.session={mode:'reading',title:'短文填空',items:['read-badge-02','read-badge-03','read-badge-01','read-badge-04'].map(id=>({mode:'reading',id})),index:0,right:0,gain:0,elapsed:0,selected:null,intro:false,timed:false};
  await store(s);await act('resume');await act('unknown');
  assert.equal(await page.locator('.lesson-source-text [data-act=read-aloud]').count(),0);
  for(let i=0;i<3;i++){await act('next');await act('unknown');}
  assert(await page.locator('.lesson-source-text [data-act=read-aloud]').count()>0);
  assert(!/\[[1-4]\]/.test(await page.locator('.lesson-source-text').innerText()));
  await act('leave');await nav('learn');await act('exam-lobby');
  // System mode avoids downloading a full exam in this reading-visibility suite.
  await page.locator('[data-act=exam-start][data-size=half]').click();
  assert.equal(await page.locator('[data-act=read-aloud]').count(),0,'no tap-to-read during a mock exam');
  await act('exam-leave');
  s=await state();s.exam.phase='reading';s.exam.unit=s.exam.units.findIndex(u=>u.part===5);s.exam.cursor=0;s.exam.remaining=100000;s.exam.deadline=0;
  await store(s);await nav('learn');await act('exam-lobby');await act('exam-resume');
  assert.equal(await page.locator('[data-act=read-aloud]').count(),0);
  await act('exam-submit');await act('exam-confirm');
  const review=page.locator('.exam-item-review').filter({has:page.locator('.lesson-source-text')}).last();
  await review.locator('summary').click();
  const button=review.locator('[data-act=read-aloud]').first();
  await button.click();
  const sourceText=await button.getAttribute('data-text');
  await page.waitForFunction(expected=>window.played.at(-1)===expected,sourceText.replace(/\[[1-4]\]/g,'').trim());
};
