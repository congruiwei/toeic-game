// Real service worker, Pages subpath and independent persistent WebKit profiles.
// For WebKit, close the HTTP server instead of setOffline(): the latter also
// blocks service-worker responses in the automated engine used by this project.
const {chromium,webkit,devices}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {createServer}=require('node:http'),{tmpdir}=require('node:os');
const root=path.resolve(__dirname,'..'),withArt=process.env.WITH_ART==='1';
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
(async()=>{
 const engine=process.env.PW_ENGINE==='webkit'?webkit:chromium;let browser;
 if(engine===chromium)browser=await engine.launch({headless:true,...(process.env.PW_CHANNEL?{channel:process.env.PW_CHANNEL}:{})});
 try{for(const width of [375,390,430]){
  const faults=new Map(),requests=[];
  const server=createServer(async(req,res)=>{
   const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/island\//,'')||'index.html';requests.push(relative);
   const file=path.resolve(root,relative);
   if(!file.startsWith(root+path.sep)){res.writeHead(404).end();return;}
   try{
    let body=await fs.readFile(file),type=mime[path.extname(file)]||'application/octet-stream';
    const fault=faults.get(relative);
    if(fault==='html'){body=Buffer.from('<!doctype html><title>Unavailable</title>');type='text/html';}
    else if(fault){const data=JSON.parse(body);fault(data);body=Buffer.from(JSON.stringify(data));}
    res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'}).end(body);
   }catch{res.writeHead(404).end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let stopped=false;
  const shutdown=async()=>{if(stopped)return;stopped=true;const done=new Promise(r=>server.close(r));server.closeAllConnections?.();await done;};
  const url='http://127.0.0.1:'+server.address().port+'/island/';
  const options={...devices['iPhone 13'],viewport:{width,height:844},colorScheme:width===390?'dark':'light',serviceWorkers:'allow'};
  const profile=engine===webkit?await fs.mkdtemp(path.join(tmpdir(),'toeic-confusable-sw-')):null;
  let context;
  try{
   context=profile?await engine.launchPersistentContext(profile,{headless:true,...options}):await browser.newContext(options);
   let page=await context.newPage();const errors=[];
   const observe=p=>{p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(12000);};observe(page);
   const act=a=>page.locator('[data-act="'+a+'"]:visible').first().click();
   const nav=p=>page.locator('#mobile-nav [data-page="'+p+'"]').click();
   const state=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('sprout-isle.save')));
   const decoded=async image=>{await image.waitFor();await image.scrollIntoViewIfNeeded();await image.evaluate(e=>e.decode());assert(await image.evaluate(e=>e.naturalWidth>0));};
   const putSession=async(id,mode)=>{
    await page.evaluate(({id,mode})=>{const key='sprout-isle.save',s=JSON.parse(localStorage.getItem(key));s.settings.methodHints=false;s.settings.audioMode='system';s.session={mode,title:'离线题库检查',items:[{id,mode,...(mode==='vocab'?{format:'cloze'}:{})}],index:0,right:0,gain:0,selected:null,elapsed:0,timed:false,intro:false};localStorage.setItem(key,JSON.stringify(s));},{id,mode});
    await page.reload();await page.locator('.habitat').waitFor();await act('resume');
   };
   const collect=async key=>{await page.locator('[data-act=collect-expression][data-key="'+key+'"]').click();await page.waitForFunction(k=>JSON.parse(localStorage.getItem('sprout-isle.save')).expressions.items.some(i=>i.key===k),key);};
   await page.goto(url);await page.locator('.habitat').waitFor();await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
   assert.equal(requests.filter(p=>p==='data/confusables.json').length,0,'the full answer explanations are not prefetched with the shell');
   assert.equal(requests.filter(p=>['confusables.css','js/confusable-ui.js'].includes(p)).length,0,'SW install does not prefetch answer-only UI');
   await putSession('v-itinerary','vocab');
   assert.equal(requests.filter(p=>['confusables.css','js/confusable-ui.js'].includes(p)).length,0,'first ordinary question has no comparison resource requests');
   await act('unknown');await page.locator('.option-details').waitFor();await page.waitForFunction(()=>!document.querySelector('[data-answer-comparison]'));
   assert.equal(requests.filter(p=>p==='data/confusables.json').length,0,'unrelated answer skips full comparisons');
   assert.equal(requests.filter(p=>['confusables.css','js/confusable-ui.js'].includes(p)).length,0);
   await putSession('v-available','vocab');await act('unknown');await page.locator('[data-confusable-group="cg-available-valuable"]').waitFor();
   const ordinarySnapshot=await state();
   assert(requests.includes('confusables.css')&&requests.includes('js/confusable-ui.js'),'comparison resources load on first rendered comparison');
   const small=await page.evaluate(async()=>await(await fetch('./data/confusable-candidates.json')).json());assert(small.entries['v-available']);
   if(withArt){
    await putSession('v-forklift','vocab');assert.equal(await page.locator('.vocab-art img').count(),0);await act('unknown');
    const firstImage=page.locator('.lesson-word-note [data-vocab-art="v-forklift"] img');await decoded(firstImage);
    const background=await firstImage.evaluate(img=>{const canvas=document.createElement('canvas');canvas.width=240;canvas.height=144;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,240,144);return [...ctx.getImageData(120,5,1,1).data];});
    assert.equal(background[3],255);const luminance=(background[0]+background[1]+background[2])/3;
    assert(width===390?luminance<110:luminance>160,'the actual SVG image honors the dark/light color scheme');
    await act('translate');await collect('v-forklift/example/0');
    await page.locator('.option-lexeme-actions').filter({has:page.locator('[data-vocab-art="v-forklift"]')}).locator('[data-act=option-collect]').click();
   }
   await putSession('cf-available','confusable');
   assert.equal(await page.locator('.confusable-card').count(),0,'no answer comparison before grading');
   await act('unknown');await page.locator('[data-confusable-group="cg-available-valuable"]').waitFor();
   await act('translate');await collect('cf-available/sentence/0');
   const baseline=await state();assert(baseline.personalVocab.items.some(i=>i.wordId==='v-available'));
   const full=await page.evaluate(async()=>await(await fetch('./data/confusables.json')).json());assert(full.questions.some(q=>q.id==='cf-available'));

   // An HTTP 200 response is insufficient: malformed or internally incomplete
   // objects must not replace a previously valid cached packet.
   for(const [name,invalid] of [
    ['confusables.json','html'],['confusables.json',d=>{delete d.words;}],
    ['confusables.json',d=>{d.questions[0].groupId='missing-group';}],
    ['confusable-candidates.json','html'],['confusable-candidates.json',d=>{d.entries=[];}],
    ['confusable-candidates.json',d=>{d.entries['v-available']=[''];}],
    ['confusable-candidates.json',d=>{d.semanticAvoid={wrong:'shape'};}],
    ['confusable-candidates.json',d=>{d.semanticAvoid=[['only-one']];}],
    ['confusable-candidates.json',d=>{d.part2TrapIds={wrong:'shape'};}],
    ['confusable-candidates.json',d=>{d.part2TrapIds=['p2-026','p2-026'];}],
   ]){
    faults.set('data/'+name,invalid);
    const result=await page.evaluate(async name=>await(await fetch('./data/'+name)).json(),name);
    assert.deepEqual(result,name==='confusables.json'?full:small,'invalid '+name+' must retain the valid cached object');
    faults.delete('data/'+name);
   }
   faults.set('data/confusable-candidates.json',d=>{delete d.semanticAvoid;});
   const legacySmall=await page.evaluate(async()=>await(await fetch('./data/confusable-candidates.json')).json());
   assert.deepEqual(legacySmall.entries,small.entries);assert.equal(Object.hasOwn(legacySmall,'semanticAvoid'),false,'old candidate packets remain valid');
   faults.delete('data/confusable-candidates.json');
   assert.deepEqual(await page.evaluate(async()=>await(await fetch('./data/confusable-candidates.json')).json()),small);
   faults.set('data/confusables.json',d=>{d.cacheProbe='valid-refresh';});
   assert.equal(await page.evaluate(async()=> (await(await fetch('./data/confusables.json')).json()).cacheProbe),'valid-refresh');
   faults.delete('data/confusables.json');
   if(withArt){
    await nav('learn');await act('expression-open');await page.getByRole('heading',{name:'职场三语表达本',exact:true}).waitFor();await decoded(page.locator('[data-vocab-art="cf-available"] img'));
    await nav('learn');await act('personal-open');await page.getByRole('heading',{name:'我的单词本',exact:true}).waitFor();await decoded(page.locator('[data-personal-key="v-available"] img'));
   }
   // Stop network service only after required metadata/translation hydration.
   await page.close();await shutdown();page=await context.newPage();observe(page);
   const response=await page.goto(url);assert(response.fromServiceWorker());await page.locator('.habitat').waitFor();await act('resume');
   await page.locator('[data-confusable-group="cg-available-valuable"]').waitFor();
   await act('translate');await page.locator('[data-act=collect-expression][data-key="cf-available/sentence/0"]').waitFor();
   assert.equal((await state()).xp,baseline.xp,'offline resume never grades an answered duel again');
   assert.equal(await page.evaluate(async()=> (await(await fetch('./data/confusables.json')).json()).cacheProbe),'valid-refresh');
   assert.deepEqual(await page.evaluate(async()=>await(await fetch('./data/confusable-candidates.json')).json()),small);
   await nav('learn');await act('expression-open');await page.getByRole('heading',{name:'职场三语表达本',exact:true}).waitFor();
   assert.match(await page.locator('#app').innerText(),/Every meeting room is booked/);
   if(withArt){await decoded(page.locator('[data-vocab-art="cf-available"] img'));await decoded(page.locator('[data-vocab-art="v-forklift"] img'));}
   await nav('learn');await act('personal-open');await page.getByRole('heading',{name:'我的单词本',exact:true}).waitFor();
   if(withArt){await decoded(page.locator('[data-personal-key="v-available"] img'));await decoded(page.locator('[data-personal-key="v-forklift"] img'));}
   await page.locator('[data-act=personal-start][data-direction=ja-en]').click();assert.equal(await page.locator('.vocab-art').count(),0);await act('personal-flip');
   assert.equal(await page.locator('.personal-word h2').count(),1,'offline saved vocabulary remains playable');
   if(withArt){
    assert(!(await page.evaluate(async()=>{const cache=await caches.open('toeic-island-vocab-art-v1');return (await cache.keys()).map(r=>r.url);})).some(url=>url.includes('/v-ladder.svg')));
    // Browse an unseen picture through the real quick-screen detail flow.
    // This does not add unrelated uncached option-lexicon requests to the test.
    await page.evaluate(()=>{const key='sprout-isle.save',s=JSON.parse(localStorage.getItem(key));s.screening={marks:{},run:{ids:['v-ladder','v-crate'],index:0,claims:0,known:0,unknown:0,checks:0,correct:0,pending:false}};localStorage.setItem(key,JSON.stringify(s));});
    await page.reload();await page.locator('.habitat').waitFor();await nav('learn');await act('screen-open');await act('screen-no');
    const missing=page.waitForResponse(r=>r.url().includes('/assets/vocab/v-ladder.svg'));
    await act('screen-last-word');assert.equal((await missing).status(),404,'an uncached optional picture has an ordinary absent response');
    await page.waitForFunction(()=>{const slot=document.querySelector('dialog [data-vocab-art="v-ladder"]');return slot&&!slot.querySelector('img');});
    assert.match(await page.locator('dialog').innerText(),/ladder/,'an unseen optional picture cannot block an offline word card');
    await act('close');await act('screen-no');assert.equal((await state()).screening.run.index,2);
   }
   // Optional data can be missing even though answer definitions were cached earlier.
   await page.evaluate(async snapshot=>{
    localStorage.setItem('sprout-isle.save',JSON.stringify(snapshot));
    for(const name of await caches.keys())if(name.startsWith('toeic-island-shell-'))await(await caches.open(name)).delete(new URL('./data/confusables.json',location.href).href);
   },ordinarySnapshot);
   await page.close();page=await context.newPage();observe(page);await page.goto(url);await page.locator('.habitat').waitFor();await act('resume');
   await page.locator('[data-act=confusable-answer-retry]').waitFor();assert.equal(await page.locator('.option-detail').count(),4);
   assert.equal(await page.evaluate(async()=> (await fetch('./data/confusables.json')).status),503,'an uncached optional pack is unavailable, never a cacheable success');
   await page.locator('[data-act=option-collect]').first().click();assert((await state()).personalVocab.items.length>0);
   await page.locator('.option-details').evaluate(el=>el.dataset.identity='offline-kept');
   await act('confusable-answer-retry');await page.locator('[data-act=confusable-answer-retry]').waitFor();
   assert.equal(await page.locator('.option-details').getAttribute('data-identity'),'offline-kept');assert.equal(await page.locator('[data-act=option-retry]').count(),0);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
   console.log(`PASS ${engine===webkit?'WebKit':'Chrome'} real SW confusables online/cache rejection/offline reopen${withArt?' + both illustrated books':''} at ${width}px${width===390?' dark':''}`);
  }finally{await context?.close();await shutdown();if(profile)await fs.rm(profile,{recursive:true,force:true});}
 }}finally{await browser?.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
