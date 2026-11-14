const assert=require('node:assert/strict');
const prompts={
  correct:'请用中文解释这道题的考点，确认我的理解是否正确。',
  wrong:'请用中文解释为什么选这个答案，以及我错在哪里。',
  unknown:'请用中文解释为什么选这个答案，以及我错在哪里。',
};

module.exports=async ({page,quiz,act,nav,state,store})=>{
  const installClipboard=()=>page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>{window.copied=t;}}}));
  const inspect=async(result,heading,button)=>{
    await page.evaluate(()=>{window.copied='';});
    if(button)await button.click();else await act('copy-claude');
    const text=await page.evaluate(()=>window.copied);
    for(const field of ['题目 ID','题干',heading,'我的答案','正确答案','现有解析'])assert(text.includes(field));
    assert.equal(text.split('\n\n').at(-1),prompts[result]);
    return text;
  };
  await installClipboard();
  for(const [mode,filter,heading,result] of [
    ['dialogue','3','听力原文','unknown'],['reading','7','阅读材料','wrong'],['part1','','插画说明','unknown'],
    ['vocab','','搭配','correct'],['dictation','','听力原文','correct'],['dictation','','听力原文','wrong']
  ]){
    await quiz(mode,filter);
    if(result==='unknown')await act('unknown');
    else {
      const q=await page.evaluate(async()=>{
        const run=JSON.parse(localStorage.getItem('sprout-isle.save')).session;
        return (await import('./js/bank.js')).question(run.items[run.index]);
      });
      if(mode==='dictation'){
        await page.fill('#dict-input',result==='correct'?'  '+q.answer.toUpperCase()+'  ':'an incorrect transcription');
        await act('submit-dict');
      }else{
        const i=q.options.findIndex(o=>(o===q.answer)===(result==='correct'));
        await page.locator('[data-act=answer][data-i="'+i+'"]').click();
      }
    }
    const text=await inspect(result,heading);
    if(mode!=='dictation')assert.match(text,/选项\nA\. [^\n]+\nB\. /);
    assert.match(await page.locator('#toast').innerText(),/已复制/);
  }
  await nav('learn');await act('screen-open');
  for (const result of ['correct','wrong','unknown']){
    for(let k=0;k<3;k++)await act('screen-yes');
    if(result==='unknown')await act('screen-unknown');
    else {
      const i=await page.evaluate(async result=>{
        const run=JSON.parse(localStorage.getItem('sprout-isle.save')).screening.run;
        const q=(await import('./js/bank.js')).question({id:run.ids[run.index],mode:'vocab',format:'meaning'});
        return q.options.findIndex(o=>(o===q.answer)===(result==='correct'));
      },result);
      await page.locator('[data-act=screen-check][data-i="'+i+'"]').click();
    }
    await inspect(result,'搭配');await act('screen-next');
  }
  await nav('home');await act('diag-open');await act('diag-unknown');
  assert((await inspect('unknown','现有解析')).includes('我的答案　不知道'));
  await act('diag-dismiss');await act('diag-leave');

  // Model a completed form whose archived answer differs from today's bank, alongside a genuinely unanswered item.
  const s=await state();
  s.exam=await page.evaluate(async()=>{
    const {bank,catalog,loadBank}=await import('./js/bank.js');
    await loadBank(['part1','part2','grammar','listening','reading','vocab']);
    const {buildExam,examIds}=await import('./js/exam.js');
    const exam=buildExam(bank,{seen:{}},'half','copy-verdict');
    exam.phase='done';exam.finishedAt=Date.now();exam.keys={};
    const ids=examIds(exam);for(const id of ids)exam.keys[id]=catalog.get(id).data.answer;
    for(const id of ids.slice(0,2)){
      const q=catalog.get(id).data;
      exam.keys[id]=q.options.find(opt=>opt!==q.answer);
      exam.answers[id]=id===ids[0]?exam.keys[id]:q.answer;
    }
    return exam;
  });
  await store(s);await installClipboard();await nav('learn');await act('exam-lobby');await act('exam-result');
  await page.getByText('逐题用时与作答',{exact:true}).click();
  let lastButton;
  for(const [i,result] of ['correct','wrong','unknown'].entries()){
    const entry=page.locator('.exam-item-review').nth(i);await entry.locator(':scope > summary').click();
    lastButton=entry.locator('[data-act=copy-claude]');const text=await inspect(result,'插画说明',lastButton);
    if(i===2)assert(text.includes('我的答案　未作答'));
    else assert(text.includes(s.exam.keys[Object.keys(s.exam.keys)[i]]));
  }
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:undefined}));
  await lastButton.click();const box=page.locator('#copy-fallback');
  assert(await box.evaluate(e=>e.selectionStart===0&&e.selectionEnd===e.value.length));
  assert((await box.inputValue()).endsWith(prompts.unknown));
};
