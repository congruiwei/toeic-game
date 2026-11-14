const assert=require('node:assert/strict');
module.exports=async ({page,quiz,act})=>{
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>{window.copied=t;}}}));
  for(const [mode,flt,heading] of [['dialogue','3','听力原文'],['reading','7','阅读材料'],['part1','','插画说明'],['vocab','','搭配'],['dictation','','听力原文']]){
    await quiz(mode,flt);
    if(mode==='dictation'){await page.fill('#dict-input','unknown');await act('submit-dict');}
    else await act('unknown');
    await act('copy-claude');
    const text=await page.evaluate(()=>window.copied);
    for(const word of ['题目 ID','题干',heading,'我的答案','正确答案','现有解析'])assert(text.includes(word));
    if(mode!=='dictation')assert.match(text,/选项\nA\. [^\n]+\nB\. /);
    assert(text.endsWith('请用中文解释为什么选这个答案，以及我错在哪里。'));
    assert.match(await page.locator('#toast').innerText(),/已复制/);
  }
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:undefined}));
  await act('copy-claude');const box=page.locator('#copy-fallback');
  assert(await box.evaluate(e=>e.selectionStart===0&&e.selectionEnd===e.value.length));
};
