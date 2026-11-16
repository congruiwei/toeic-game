const assert = require('node:assert/strict');
const zh = require('../../data/i18n/zh/reading.json').entries;
const ja = require('../../data/i18n/ja/reading.json').entries;
const target = 'read-bikes-01';
const ref = {id:target,mode:'reading'};
const sentenceKey = 'read-bikes/documents/0/text/3';
const session = (selected=null) => ({mode:'reading',title:'答案修订回归',items:[ref],index:0,
  right:selected?1:0,gain:selected?12:0,selected,elapsed:1000,timed:false,intro:false});

module.exports = async ({page,act,nav,state,store,reset}) => {
  const completedSentence = async panel => {
    await panel.locator('[data-act=translate]').click();
    const line=panel.locator(`[data-translation-key="${sentenceKey}"]`);
    await line.locator('[lang=ja]').waitFor();
    assert.equal(await line.locator('[lang=en]').textContent(),'When you describe the problem, be as precise as possible.');
    assert.equal(await line.locator('[lang=zh-CN]').textContent(),zh[sentenceKey]);
    assert.equal(await line.locator('[lang=ja]').textContent(),ja[sentenceKey]);
  };

  // Fresh answers use the corrected key, including XP, error bookkeeping and the completed source.
  for (const [answer,correct] of [['precise',true],['precisely',false]]) {
    await reset();
    const fresh=await state(); fresh.settings.methodHints=false; fresh.session=session();
    await store(fresh); await act('resume');
    assert.equal(await page.locator('.translations').count(),0,'no completed sentence before answering');
    const button=page.locator(`[data-act=answer][data-i="${correct?3:0}"]`);
    assert.equal((await button.locator('span[lang=en]').textContent()).trim(),answer);
    await button.click();
    await page.locator('.lesson-feedback').waitFor();
    assert.equal(await page.locator('.lesson-feedback.is-right').count(),Number(correct));
    assert.equal(await page.locator('.lesson-feedback.is-miss').count(),Number(!correct));
    assert.equal(await page.locator('.lesson-feedback > p > span').textContent(),'precise');
    const progress=await state();
    assert.equal(progress.session.right,Number(correct));
    assert.equal(progress.session.selected,answer);
    assert.equal(progress.history.at(-1).ok,correct);
    assert.equal(progress.xp-fresh.xp,correct?12:4);
    assert.equal(Boolean(progress.errors[target]),!correct);
    await completedSentence(page.locator('.lesson-feedback > .translations'));
  }

  // Restore a real old-version backup whose former key was awarded credit.
  await reset();
  const legacy=await state(); legacy.version=3; legacy.xp=72; legacy.stats.reading=72;
  legacy.history=[{skill:'reading',level:600,ok:true}]; legacy.seen[target]=1;
  legacy.session=session('precisely');
  await act('settings');
  const choosing=page.waitForEvent('filechooser');await act('import');
  await (await choosing).setFiles({name:'old-precisely-save.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacy))});
  await act('restore'); await act('resume');
  await page.locator('.lesson-feedback.is-miss').waitFor();
  assert.equal(await page.locator('.lesson-feedback > p > span').textContent(),'precise');
  const imported=await state();
  for (const field of ['xp','stats','history','words','errors']) assert.deepEqual(imported[field],legacy[field]);
  assert.equal(imported.session.selected,'precisely');
  assert.equal(imported.session.right,1,'already awarded practice credit is not reversed');
  await completedSentence(page.locator('.lesson-feedback > .translations'));

  // Build a valid complete historical form containing bikes. All archived responses were correct.
  const fixture=await page.evaluate(async target => {
    const {bank,catalog,loadBank}=await import('./js/bank.js');
    const {buildExam,examIds,examScores,examValid}=await import('./js/exam.js');
    await loadBank(['vocab','part1','part2','grammar','listening','reading']);
    for(let form=0;form<4;form++) {
      const examForms=[1,1,1,1];examForms[form]=0;
      const exam=buildExam(bank,{seen:{},examForms},'full','correction-browser');
      if(!examIds(exam).includes(target))continue;
      exam.keys=Object.fromEntries(examIds(exam).map(id=>[id,catalog.get(id).data.answer]));
      exam.keys[target]='precisely';
      // A separate, unmarked archive difference must retain its original semantics.
      const unmarked=exam.units[0].ids[0], q=catalog.get(unmarked).data;
      exam.keys[unmarked]=q.options.find(option=>option!==q.answer);
      exam.answers={...exam.keys};exam.phase='done';exam.finishedAt=Date.now();
      if(!examValid(exam,catalog))throw Error('invalid completed correction fixture');
      return {exam,unmarked,scores:examScores(exam,catalog)};
    }
    throw Error('corrected question absent from all four full forms');
  },target);
  const oldExam=await state(); oldExam.session=null; oldExam.exam=fixture.exam;
  oldExam.words['v-available']={box:2,due:Date.now()+86400000,right:2,tries:3};
  await store(oldExam);
  const beforeReview=await state();
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copied=text;}}}));
  await nav('learn');await act('exam-lobby');await act('exam-result');
  assert.match(await page.locator('.lesson-panel').first().innerText(),/990/);
  const mistakes=page.locator('.lesson-panel').filter({has:page.getByRole('heading',{name:'错题与未答题',exact:true})});
  assert.equal(await mistakes.locator('.exam-item-review').count(),1,'the former answer now appears in corrected review mistakes');
  const entry=mistakes.locator('.exam-item-review');await entry.locator(':scope > summary').click();
  assert.match(await entry.locator(':scope > summary').textContent(),new RegExp(target+'.*错误'));
  assert.equal(await entry.getByText('正确答案　precise',{exact:true}).count(),1);
  assert.equal(await entry.getByText('此题答案已更正；本次模考原成绩保留。',{exact:true}).count(),1);
  await completedSentence(entry.locator(':scope > .translations'));
  await entry.locator('[data-act=copy-claude]').click();
  await page.waitForFunction(()=>!!window.copied);
  const copied=await page.evaluate(()=>window.copied);
  assert.match(copied,/我的答案　A\. precisely/);
  assert.match(copied,/正确答案　D\. precise(?:\n|$)/);
  assert(copied.endsWith('请用中文解释为什么选这个答案，以及我错在哪里。'));
  await entry.locator('[data-act=report-issue]').click();
  await page.selectOption('#issue-reason','解析不对');
  await page.fill('#issue-note','旧答案修订回归');await act('save-issue');
  const issue=(await state()).issues.at(-1);
  assert.equal(issue.id,target);assert.match(issue.text,/正确答案　D\. precise(?:\n|$)/);
  assert.match(issue.text,/我的答案　A\. precisely/);

  // The unmarked question remains correct against its stored key, including copied review text.
  await page.getByText('逐题用时与作答',{exact:true}).click();
  const unmarked=page.locator('.exam-item-review').filter({has:page.locator(`[data-act=copy-claude][data-id="${fixture.unmarked}"]`)}).first();
  await unmarked.locator(':scope > summary').click();
  assert.match(await unmarked.locator(':scope > summary').textContent(),/正确$/);
  assert.equal(await unmarked.getByText('此题答案已更正；本次模考原成绩保留。',{exact:true}).count(),0);
  await page.evaluate(()=>{window.copied='';});await unmarked.locator('[data-act=copy-claude]').click();
  await page.waitForFunction(()=>!!window.copied);
  const archivedCopy=await page.evaluate(()=>window.copied);
  assert(archivedCopy.includes(fixture.exam.keys[fixture.unmarked]));
  assert(archivedCopy.endsWith('请用中文解释这道题的考点，确认我的理解是否正确。'));

  const after=await state();
  for(const field of ['xp','stats','history','words','errors','seen'])assert.deepEqual(after[field],beforeReview[field],field+' must not be regraded');
  assert.deepEqual(after.exam.keys,fixture.exam.keys);
  assert.deepEqual(after.exam.answers,fixture.exam.answers);
  const scores=await page.evaluate(async()=>{
    const {examScores}=await import('./js/exam.js');const {catalog}=await import('./js/bank.js');
    return examScores(JSON.parse(localStorage.getItem('sprout-isle.save')).exam,catalog);
  });
  assert.deepEqual(scores,fixture.scores);
};
