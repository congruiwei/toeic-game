const assert=require('node:assert/strict');
module.exports=async({page,context,width,act,nav,state,store,reset,quiz})=>{
 const session=(id,mode='confusable',format)=>({mode,title:'易混词对决',items:[{id,mode,...(format?{format}:{})}],index:0,right:0,gain:0,elapsed:0,selected:null,intro:false,timed:false});
 const freshScenario=async()=>{await reset();const s=await state();s.settings.methodHints=false;await store(s);};
 const lazyRequests=[],fullRequests=[];
 page.on('request',r=>{if(/\/(?:confusables\.css|js\/confusable-ui\.js)$/.test(r.url()))lazyRequests.push(r.url());if(r.url().endsWith('/data/confusables.json'))fullRequests.push(r.url());});
 await freshScenario();assert.equal(lazyRequests.length,0,'home does not request comparison UI or styles');
 let plain=await state();plain.session=session('v-itinerary','vocab','cloze');await store(plain);await act('resume');
 await page.locator('.lesson-question').waitFor();assert.equal(lazyRequests.length,0,'the first ordinary question does not request comparison UI or styles');
 await act('unknown');await page.locator('.option-details').waitFor();
 await page.waitForFunction(()=>!document.querySelector('[data-answer-comparison]'));
 assert.equal(fullRequests.length,0,'an unrelated correct answer needs no full comparison pack');assert.equal(lazyRequests.length,0);
 plain=await state();plain.words['v-itinerary'].right=1;await store(plain);await nav('library');await page.locator('[data-act=library-tab][data-tab=words]').click();
 const ordinaryCard=page.locator('.lib-card').filter({has:page.locator('[data-word-study-id=\"v-itinerary\"]')});await ordinaryCard.locator('summary').click();
 await page.waitForFunction(()=>document.querySelector('[data-confusable-word-host=\"v-itinerary\"]')?.dataset.loaded==='yes');
 assert.equal(fullRequests.length,0,'opening a non-member card skips full comparisons');assert.equal(lazyRequests.length,0);
 // Optional full-pack failure must leave already-rendered definitions and collection intact.
 await freshScenario();await page.route('**/data/confusables.json',route=>route.abort());
 plain=await state();plain.session=session('v-access','vocab','meaning');await store(plain);await act('resume');await act('unknown');
 await page.locator('[data-act=confusable-answer-retry]').waitFor();assert.equal(await page.locator('.option-detail').count(),4);
 await page.locator('.option-details').evaluate(el=>el.dataset.identity='retained');
 const collect=page.locator('[data-act=option-collect]').first();await collect.click();assert((await state()).personalVocab.items.length>0);
 assert.equal(await page.locator('.option-details').getAttribute('data-identity'),'retained','collection updates buttons without replacing the host');
 await act('confusable-answer-retry');await page.locator('[data-act=confusable-answer-retry]').waitFor();
 assert.equal(await page.locator('.option-details').getAttribute('data-identity'),'retained');assert.equal(await page.locator('[data-act=option-retry]').count(),0);
 await page.unroute('**/data/confusables.json');await act('confusable-answer-retry');await page.locator('[data-confusable-group="cg-access-assess-excess"]').waitFor();
 assert.equal(await page.locator('.option-details').getAttribute('data-identity'),'retained','retry adds comparisons without replacing options');
 assert(lazyRequests.some(u=>u.endsWith('/confusables.css'))&&lazyRequests.some(u=>u.endsWith('/js/confusable-ui.js')));
 await freshScenario();let s=await state();s.session=session('cf-access');await store(s);await act('resume');
 assert.equal(await page.locator('.confusable-card').count(),0,'no comparison before answering');
 assert.equal(await page.locator('[data-act=confusable-difference]').count(),0,'group explanations cannot play before answering');
 assert.equal(await page.locator('[data-options-id]').count(),0);
 assert((await page.locator('.lesson-question').innerText()).includes('_____'));
 const before=await state();await page.locator('.lesson-option').filter({hasText:'assess'}).click();
 const card=page.locator('[data-confusable-group="cg-access-assess-excess"]');await card.waitFor();
 const distinction=await page.evaluate(async()=>(await import('./js/confusables.js')).confusableData().groups.find(g=>g.id==='cg-access-assess-excess').difference);
 for(const language of ['en','ja']){
  assert.equal(await card.locator(`.confusable-difference > p[lang=${language}]`).textContent(),distinction[language]);
  await card.locator(`[data-act=confusable-difference][data-language=${language}]`).click();
  await page.waitForFunction(text=>window.played.at(-1)===text,distinction[language]);
 }
 assert((await card.innerText()).includes('你选了'));assert((await card.innerText()).includes('重音在前'));assert((await card.innerText()).includes('重音在后'));
 assert.equal(await card.locator('[data-confusable-word="v-access-use"]').count(),0);
 s=await state();assert.equal(s.xp,before.xp+4);assert.equal(s.personalVocab.items[0].wordId,'v-access');assert(!s.words['cf-access']);assert(!s.words['v-access-use']);assert(s.errors['cf-access']);
 await card.locator('[data-act=confusable-pair]').first().click();await page.waitForFunction(()=>window.played.slice(-2).join('|')==='access|assess');
 await card.locator('[data-confusable-word="v-access"] [data-language=ja]:not([data-field])').click();await page.waitForFunction(()=>window.spoken.at(-1)?.lang==='ja-JP');
 await card.locator('[data-confusable-word="v-access"] [data-language=en][data-field=example]').click();await page.waitForFunction(()=>window.played.at(-1)?.startsWith('Only holders of current staff badges'));
 await card.locator('[data-confusable-word="v-access"] [data-language=ja][data-field=example]').click();await page.waitForFunction(()=>window.spoken.at(-1)?.lang==='ja-JP'&&window.spoken.at(-1)?.text.length>15);
 assert(await card.locator('button').first().evaluate(el=>el.getBoundingClientRect().height)>=44);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await act('report-issue');await page.locator('#issue-reason').selectOption('易混词解释有误');await act('save-issue');
 assert.equal((await state()).issues.at(-1).reason,'易混词解释有误');
 await page.reload();await page.locator('.habitat').waitFor();await act('resume');await card.waitFor();assert.equal((await state()).xp,before.xp+4,'resume does not regrade');
 await act('leave');await nav('learn');await act('personal-open');assert((await page.locator('#app').innerText()).includes('access'));
 await page.locator('[data-act=personal-start][data-direction=ja-en]').click();assert.equal(await page.locator('.personal-word h2').count(),0);await act('personal-flip');assert.equal(await page.locator('.personal-word h2').textContent(),'access');
 await page.locator('[data-act=personal-rate][data-grade="3"]').click();assert.equal((await state()).words['v-access'].tries,1,'self rating does not double objective attempts');
 // The authored Part 2 family-sound annotation is independent of curated word groups.
 s=await state();s.session=session('p2-026','part2');await store(s);await act('resume');assert.equal(await page.locator('[data-phonetic-trap]').count(),0);await page.locator('[data-act=answer][data-i="0"]').click();await page.locator('[data-phonetic-trap="p2-026"]').waitFor();
 const annotated=page.locator('.option-detail').filter({has:page.locator('.option-result',{hasText:'音近陷阱'})});
 assert.equal(await annotated.count(),1);assert((await annotated.locator('summary').innerText()).includes('The project starts in March.'));
 s=await state();s.session=session('p2-020','part2');await store(s);await act('resume');
 assert.equal(await page.locator('.option-result').filter({hasText:'音近陷阱'}).count(),0);await act('unknown');
 await page.locator('[data-confusable-group="cg-career-carrier-courier-curry"]').waitFor();
 assert.equal(await annotated.count(),1);assert((await annotated.locator('summary').innerText()).includes("I'll have the chicken curry."));
 // Lightweight members preserve their own definition and source when collected automatically.
 s=await state();s.session=session('cf-curry');await store(s);await act('resume');await act('unknown');await page.locator('.confusable-card').waitFor();
 s=await state();const item=s.personalVocab.items.find(w=>w.key==='personal-lex-conf-curry');assert(item&&!item.wordId);assert(item.source.context.includes('vegetable curry'));assert(!s.words['lex-conf-curry']);
 await act('leave');await nav('report');assert((await page.locator('#app').innerText()).includes('我的单词本'));
 // Exact curated homographs retain both independent enrichment slots.
 s=await state();s.session=session('cf-import');await store(s);await act('resume');
 assert.equal(await page.locator('.morph-word,.confusable-card').count(),0);
 await page.locator('.lesson-option').filter({hasText:'export'}).click();
 await page.locator('[data-morph-word="v-import"]').waitFor();await page.locator('[data-confusable-group="cg-import-export"]').waitFor();
 assert.equal(await page.locator('[data-morph-word="v-import-goods"],[data-morph-word="v-export-goods"]').count(),0);
 const shared=await state();assert(shared.personalVocab.items.some(w=>w.wordId==='v-import'));assert(!shared.personalVocab.items.some(w=>w.wordId==='v-import-goods'));
 await act('leave');s=await state();s.session=session('cf-import');await store(s);await act('resume');await page.locator('.lesson-option').filter({hasText:'import'}).click();await page.locator('[data-confusable-group="cg-import-export"]').waitFor();
 await act('leave');await nav('library');await page.locator('[data-act=library-tab][data-tab=words]').click();
 const entry=page.locator('.lib-card').filter({has:page.locator('[data-word-study-id="v-import"]')});
 await entry.locator('summary').click();await entry.locator('[data-morph-word="v-import"]').waitFor();await entry.locator('[data-confusable-group="cg-import-export"]').waitFor();
 const studyDifference=entry.locator('[data-confusable-group="cg-import-export"] .confusable-difference');
 for(const language of ['en','ja']){
  const text=await studyDifference.locator(`p[lang=${language}]`).textContent();
  await studyDifference.locator(`[data-act=confusable-difference][data-language=${language}]`).click();
  await page.waitForFunction(text=>window.played.at(-1)===text,text);
 }
 // Normal vocabulary uses only the small English projection until answer review.
 const calls=[];page.on('request',r=>{if(r.url().includes('/data/confusables.json'))calls.push(r.url());});
 await freshScenario();await quiz('vocab','','english');assert.equal(calls.length,0,'normal questions download only the candidate projection before an answer');
 await act('unknown');await page.locator('.option-details').waitFor();await page.waitForFunction(()=>document.querySelector('[data-options-id]')&&!document.querySelector('[data-act=option-retry]'));await act('leave');
 await nav('learn');await act('personal-open');await context.setOffline(true);await nav('home');await nav('learn');await act('personal-open');await context.setOffline(false);
};
