// Actual shell and option caches: no service-worker or network-response mocks.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {createServer}=require('node:http'),{chromium,webkit,devices}=require('playwright');
const engine=process.env.PW_ENGINE||'chromium',browserType={chromium,webkit}[engine];
if(!browserType)throw Error('PW_ENGINE must be chromium or webkit');
const root=path.resolve(__dirname,'..'),mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
(async()=>{
 let optionMode='normal',oldResponse=null,oldRequested=null;
 const currentVocab=JSON.parse(await fs.readFile(path.join(root,'data/options/vocab.json'),'utf8'));
 const obsoleteVocab=structuredClone(currentVocab);obsoleteVocab.entries['v-available'].signature='obsolete-response';
 const server=createServer(async(req,res)=>{try{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/island\//,'')||'index.html',file=path.resolve(root,name);
  if(!file.startsWith(root+path.sep))throw Error('path');
  if(name==='data/options/vocab.json'&&optionMode==='hold-old'){
   // Send no-store headers now, so the browser need not serialize another
   // request behind an undecided HTTP-cache response; delay only this body.
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.flushHeaders();
   optionMode='normal';oldResponse=res;oldRequested();return;
  }
  if(name==='data/options/vocab.json'&&optionMode==='html-once'){
   optionMode='normal';res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'}).end('<!doctype html><title>Temporary server error</title>');return;
  }
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'}).end(await fs.readFile(file));
 }catch{res.writeHead(404).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port,url=`http://127.0.0.1:${port}/island/`,browser=await browserType.launch({headless:true,...(engine==='chromium'&&process.env.PW_CHANNEL?{channel:process.env.PW_CHANNEL}:{})});
 try{for(const width of [375,390,430]){
  const context=await browser.newContext({...devices['iPhone 13'],viewport:{width,height:844},colorScheme:width===390?'dark':'light',serviceWorkers:'allow'}),errors=[];
  let page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
  const act=name=>page.locator(`[data-act="${name}"]:visible`).first().click();
  try{
   await page.goto(url);await page.locator('.habitat').waitFor();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
   assert.equal(await page.evaluate(async()=>{const c=await caches.open('toeic-island-option-details-v1');return(await c.keys()).length;}),0,'home and worker install do not prefetch options');
   await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('sprout-isle.save'));s.settings.audioMode='system';s.settings.methodHints=false;s.session={mode:'vocab',title:'离线选项',items:[{mode:'vocab',id:'v-available',format:'cloze'}],index:0,right:0,gain:0,selected:null,intro:false,timed:false,elapsed:0};localStorage.setItem('sprout-isle.save',JSON.stringify(s));});
   await page.reload();await page.locator('.habitat').waitFor();await act('resume');assert.equal(await page.locator('[data-options-id]').count(),0);await act('unknown');await page.locator('.option-details').waitFor();
   const original=await page.locator('.option-details').innerText(),reasons=await page.locator('.option-reason').allTextContents();assert.match(original,/inaccessible/);
   await page.locator('[data-act=option-collect]').first().click();const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('sprout-isle.save')));
   const keys=await page.evaluate(async()=>{const c=await caches.open('toeic-island-option-details-v1');return(await c.keys()).map(k=>new URL(k.url).pathname);});assert(keys.some(k=>k.endsWith('/vocab.json')));assert(keys.some(k=>k.includes('/lexicon/')));
   // A real SW sees both network responses. Its older response must not write
   // behind the page's successful refresh, even when its JSON shape is valid.
   optionMode='hold-old';const requested=new Promise(resolve=>oldRequested=resolve);
   await page.evaluate(async()=>{
    const ui=await import('./js/option-details.js'),{question,bank}=await import('./js/bank.js');
    const ref={mode:'vocab',id:'v-available',format:'cloze'};window.optionRace={ui,ref,q:question(ref),vocab:bank.vocab};
    ui.invalidateOptionDetails();window.oldOptionResult=ui.loadOptionDetails(ref,question(ref),{vocab:bank.vocab}).then(()=>({ok:true}),error=>({error:error.message}));
   });
   await requested;
   await page.evaluate(async()=>{const {ui,ref,q,vocab}=window.optionRace;ui.invalidateOptionDetails();await ui.loadOptionDetails(ref,q,{vocab});});
   oldResponse.end(JSON.stringify(obsoleteVocab));oldResponse=null;
   assert.match((await page.evaluate(()=>window.oldOptionResult)).error,/选项解析已更新/);
   const cachedSignature=()=>page.evaluate(async()=>{const c=await caches.open('toeic-island-option-details-v1');return(await(await c.match('./data/options/vocab.json')).json()).entries['v-available'].signature;});
   assert.equal(await cachedSignature(),currentVocab.entries['v-available'].signature,'late SW response cannot replace the newly validated persistent pack');
   optionMode='html-once';
   await page.evaluate(async()=>{const {ui,ref,q,vocab}=window.optionRace;ui.invalidateOptionDetails();await ui.loadOptionDetails(ref,q,{vocab});});
   assert.equal(await cachedSignature(),currentVocab.entries['v-available'].signature,'HTML must preserve the useful offline pack');
   // WebKit's protocol offline flag blocks SW responses too; close the origin
   // to test an actual network outage while retaining the same cold-reopen checks.
   if(engine==='webkit')await new Promise(resolve=>server.close(resolve));else await context.setOffline(true);
   await page.close();page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.locator('.habitat').waitFor();await act('resume');await page.locator('.option-details').waitFor();
   const offline=await page.locator('.option-details').innerText();assert(offline.includes('inaccessible'));assert.deepEqual(await page.locator('.option-reason').allTextContents(),reasons);assert(!offline.includes('重试选项释义'));
   assert.equal(await page.locator('.option-detail').count(),4);const restored=await page.evaluate(()=>JSON.parse(localStorage.getItem('sprout-isle.save')));assert.deepEqual(restored.personalVocab,saved.personalVocab);assert.equal(restored.xp,saved.xp);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);console.log(`PASS option refresh inversion, HTML fallback and personal cards survive offline cold reopen at ${width}px${width===390?' (dark)':''}`);
  }finally{oldResponse?.destroy();oldResponse=null;optionMode='normal';await context.close();if(engine==='webkit'&&!server.listening)await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));}
 }}finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
