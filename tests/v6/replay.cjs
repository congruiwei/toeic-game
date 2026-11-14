const assert=require('node:assert/strict');
module.exports=async({page,act,nav,state,store})=>{
  const ref=(id,mode)=>({id,mode});
  const cases=[ref('p1-001','part1'),ref('p2-008','part2'),ref('p3-g17-q1','dialogue'),ref('p4-g01-q1','dialogue'),ref('p3-g17-d','dictation')];
  const s=await state();
  s.settings.rate=.8;s.settings.accent='en-GB';s.settings.voiceSlots={A:'ava',B:'daniel',C:'karen'};
  // Single-step the speech engine callbacks to test interleaving, interruption and looping deterministically.
  async function spy(){
    await page.evaluate(()=>{
      const list=[['ava','Ava','en-US'],['daniel','Daniel','en-GB'],['karen','Karen','en-AU']].map(([voiceURI,name,lang])=>({voiceURI,name,lang}));
      window.replayLog=[];window.replayCancelled=0;
      Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>list,cancel:()=>window.replayCancelled++,speak:u=>{window.replayLog.push(u);u.onstart?.();}}});
      Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:class{constructor(text){this.text=text;}}});
    });
  }
  for(const r of cases){
    s.session={mode:r.mode,title:'重听测试',items:[r],index:0,right:0,gain:0,selected:null,elapsed:0,timed:false,intro:false};
    await store(s);await spy();await act('resume');
    if(await page.locator('[data-act=method-skip]:visible').count())await act('method-skip');
    assert.equal(await page.locator('.sentence-panel').count(),0);
    if(r.mode==='dictation'){await page.locator('#dict-input').fill('seal');await act('submit-dict');}
    else await act('answer');
    const panel=page.locator('.sentence-panel');await panel.locator('summary').click();
    const buttons=panel.locator('.sentence-row');
    assert(await buttons.count()>=(r.id.startsWith('p4')?5:r.mode==='dictation'?1:4));
    const first=(r.id==='p3-g17-q1'?buttons.filter({has:page.locator('.sentence-speaker',{hasText:'C'})}):buttons).first();
    await panel.locator('[data-replay-loop]').check();await first.click();
    assert.equal(await first.getAttribute('aria-pressed'),'true');
    const info=await page.evaluate(()=>{const u=window.replayLog.at(-1);return [u.text,u.rate,u.voice?.voiceURI]});
    assert.equal(info[1],.8);
    assert.equal(info[2],r.id==='p3-g17-q1'?'karen':'ava');
    await page.evaluate(()=>window.replayLog.at(-1).onend());
    assert.equal(await page.evaluate(()=>window.replayLog.length),2);
    await first.click();assert.equal(await first.getAttribute('aria-pressed'),'false');
    await page.evaluate(()=>window.replayLog.at(-1).onend());assert.equal(await page.evaluate(()=>window.replayLog.length),2);
    await first.click();await nav('home');
    await page.evaluate(()=>window.replayLog.at(-1).onend());assert.equal(await page.evaluate(()=>window.replayLog.length),3);
  }
  await nav('learn');await act('exam-lobby');
  // Obtain a real valid form, then model the reviewed state of a submitted paper.
  const e=await page.evaluate(async()=>{
    const {bank,loadBank}=await import('./js/bank.js');await loadBank(['vocab','part1','part2','grammar','listening','reading']);
    const {buildExam}=await import('./js/exam.js');return buildExam(bank,{seen:{}},'half','sentence-review');
  });
  s.session=null;s.exam=e;await store(s);await nav('learn');await act('exam-lobby');await act('exam-resume');
  assert.equal(await page.locator('.sentence-panel').count(),0);await act('exam-leave');
  e.phase='done';e.finishedAt=Date.now();e.keys={};for(const unit of e.units)for(const id of unit.ids)e.keys[id]=await page.evaluate(async id=>(await import('./js/bank.js')).catalog.get(id).data.answer,id);
  s.exam=e;await store(s);await spy();await nav('learn');await act('exam-lobby');await act('exam-result');
  await page.getByText('逐题用时与作答',{exact:true}).click();const review=page.locator('.exam-item-review').first();
  await review.locator(':scope > summary').click();await review.locator('.sentence-panel summary').click();await review.locator('.sentence-row').first().click();
  assert.equal(await page.evaluate(()=>window.replayLog.length),1);
};
