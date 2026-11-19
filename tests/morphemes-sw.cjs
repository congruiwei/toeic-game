// Real PWA worker under a Pages subpath. Close the server for real offline
// WebKit checks; context.setOffline() also suppresses worker replies there.
const {chromium,webkit,devices}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {createServer}=require('node:http'),{tmpdir}=require('node:os');
const root=path.resolve(__dirname,'..');
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
(async()=>{
 const engine=process.env.PW_ENGINE==='webkit'?webkit:chromium;let browser;
 if(engine===chromium)browser=await engine.launch({headless:true,...(process.env.PW_CHANNEL?{channel:process.env.PW_CHANNEL}:{})});
 try{for(const width of [375,390,430]){
  let transform=null;
  const server=createServer(async(req,res)=>{
   const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/island\//,'')||'index.html';
   const file=path.resolve(root,relative);
   if(!file.startsWith(root+path.sep)){res.writeHead(404).end();return;}
   try{
    let body=await fs.readFile(file),type=mime[path.extname(file)]||'application/octet-stream';
    if(relative==='data/morphemes.json'&&transform){
     if(transform==='html'){body=Buffer.from('<!doctype html><title>Offline publisher</title>');type='text/html';}
     else {const data=JSON.parse(body);transform(data);body=Buffer.from(JSON.stringify(data));}
    }
    res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'}).end(body);
   }catch{res.writeHead(404).end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let stopped=false;
  const shutdown=async()=>{if(stopped)return;stopped=true;const done=new Promise(r=>server.close(r));server.closeAllConnections?.();await done;};
  const url='http://127.0.0.1:'+server.address().port+'/island/';
  const options={...devices['iPhone 13'],viewport:{width,height:844},colorScheme:width===390?'dark':'light',serviceWorkers:'allow'};
  const profile=engine===webkit?await fs.mkdtemp(path.join(tmpdir(),'toeic-morpheme-sw-')):null;let context;
  try{
   context=profile?await engine.launchPersistentContext(profile,{headless:true,...options}):await browser.newContext(options);
   let page=await context.newPage();const errors=[];
   const observe=p=>{p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(12000);};observe(page);
   const nav=p=>page.locator('#mobile-nav [data-page="'+p+'"]').click();
   const open=async()=>{await nav('library');await page.locator('[data-act=library-tab][data-tab=morphemes]').click();await page.locator('.morph-index').waitFor();};
   const refresh=()=>page.evaluate(async()=>(await import('./js/morphemes.js')).loadMorphemes({refresh:true}));
   await page.goto(url);await page.locator('.habitat').waitFor();await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
   await page.evaluate(()=>{const key='sprout-isle.save',s=JSON.parse(localStorage.getItem(key));s.settings.audioMode='system';localStorage.setItem(key,JSON.stringify(s));});
   await page.reload();await page.locator('.habitat').waitFor();
   const save=await page.evaluate(()=>JSON.parse(localStorage.getItem('sprout-isle.save')));
   await open();const original=await refresh();assert(original.entries.length>0);
   const baseline=original.entries.find(m=>m.id==='root-port').zh,changed=baseline+' · 已更新的词根说明';
   transform=data=>{data.entries.find(m=>m.id==='root-port').zh=changed;};
   const updated=await refresh();assert.equal(updated.entries.find(m=>m.id==='root-port').zh,changed,'valid network object replaces the installed shell copy');
   await nav('home');await open();await page.locator('.morph-card[data-morpheme-id="root-port"]').getByText(changed,{exact:true}).waitFor();
   for(const invalid of [
    'html',data=>{delete data.entries;},data=>{data.entries=[];},
    data=>{data.entries[0].id=data.entries[1].id;},
    data=>{delete data.sources[data.entries[0].sources[0]];},
    data=>{data.entries.find(m=>m.type==='suffix').pos=['not-a-POS'];},
   ]){
    transform=invalid;
    // Test both direct worker responses and the module refresh API: neither
    // may revert to the old installed object or poison the page-owned cache.
    assert.deepEqual(await page.evaluate(async()=>await(await fetch('./data/morphemes.json')).json()),updated);
    assert.deepEqual(await refresh(),updated);
   }
   const cacheCopies=await page.evaluate(async()=>{
    const result=[];for(const name of await caches.keys()){
     const response=await(await caches.open(name)).match(new URL('./data/morphemes.json',location.href));
     if(response)result.push({name,data:await response.json()});
    }return result;
   });
   assert(cacheCopies.some(c=>c.name.startsWith('toeic-island-shell-')));assert(cacheCopies.some(c=>c.name==='toeic-island-morphemes-v1'));
   for(const copy of cacheCopies)assert.deepEqual(copy.data,updated,'both valid caches retain the latest object');
   await page.close();await shutdown();page=await context.newPage();observe(page);
   const response=await page.goto(url);assert(response.fromServiceWorker());await page.locator('.habitat').waitFor();await open();
   await page.locator('.morph-card[data-morpheme-id="root-port"]').getByText(changed,{exact:true}).waitFor();
   assert.deepEqual(await refresh(),updated,'a cold offline reopen still has the valid update');
   await page.locator('.morph-card[data-morpheme-id="root-port"]').click();await page.locator('dialog [data-morpheme-family="root-port"]').waitFor();
   assert.match(await page.locator('dialog').innerText(),/已更新的词根说明/);
   const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('sprout-isle.save')));
   assert.equal(after.xp,save.xp);assert.deepEqual(after.words,save.words);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
   console.log(`PASS ${engine===webkit?'WebKit':'Chrome'} morphemes real SW valid update/bad packet retention/cold offline reopen at ${width}px${width===390?' dark':''}`);
  }finally{await context?.close();await shutdown();if(profile)await fs.rm(profile,{recursive:true,force:true});}
 }}finally{await browser?.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
