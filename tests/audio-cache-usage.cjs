// Isolated real CacheStorage regression; no app saves, model generation or production audio writes.
// CACHE_USAGE_FILES=5000 measures approximately 100 MB; the default keeps routine checks small.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createServer}=require('node:http'),{chromium,webkit,devices}=require('playwright');
const root=path.resolve(__dirname,'..'),engine=process.env.PW_ENGINE||'webkit',browserType={chromium,webkit}[engine];
const files=Number(process.env.CACHE_USAGE_FILES||1000);
assert(browserType,'PW_ENGINE must be chromium or webkit');assert(Number.isInteger(files)&&files>=8&&files<=10000);
(async()=>{
 const audio=await fs.readFile(path.join(root,'audio/audition/bf_isabella/en-vocab-receipt-01.m4a'));
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'audio-cache-usage-'));let context;
 const server=createServer(async(req,res)=>{try{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/bench\//,'');let body,type='text/javascript';
  if(!name||name==='index.html'){
   body='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cache usage fixture</title><style>body{font:16px system-ui;background:#171520;color:white;margin:12px}button{font:inherit;min-height:48px}#poke{position:fixed;right:0;top:0;z-index:2}progress{max-width:100%}</style><button id="poke">响应测试</button><div id="host"></div>';
   type='text/html';
  }else if(name==='sample.m4a'){body=audio;type='audio/mp4';}
  else if(name==='data/audio/manifest.json'){body=JSON.stringify({version:1,complete:true,sourceSha256:'f'.repeat(64),packs:[]});type='application/json';}
  else if(name.startsWith('js/')){const file=path.resolve(root,name);if(!file.startsWith(root+path.sep))throw Error('path');body=await fs.readFile(file);}
  else throw Error('route');
  res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'}).end(body);
 }catch{res.writeHead(404).end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}/bench/`;
 try{
  context=await browserType.launchPersistentContext(profile,{headless:true,...devices['iPhone 13'],viewport:{width:390,height:844},colorScheme:'dark',...(engine==='chromium'?{channel:process.env.PW_CHANNEL||'chrome'}:{})});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(120000);await page.goto(url);
  await page.evaluate(async()=>{
   window.api=await import('./js/audio-downloads.js');window.settings=await import('./js/audio-settings.js');window.probe={reads:0,bytes:0,clicks:0};
   document.querySelector('#poke').onclick=()=>probe.clicks++;
   const original=Response.prototype.arrayBuffer;
   Response.prototype.arrayBuffer=async function(){
    if(!this.headers.has('x-usage-fixture'))return original.call(this);
    probe.reads++;if(window.bodyGate)await window.bodyGate;
    const data=await original.call(this);probe.bytes+=data.byteLength;return data;
   };
   const fetch=window.fetch;window.fetch=(input,...args)=>{
    if(String(input).endsWith('/data/audio/manifest.json')){probe.manifestAt=performance.now();probe.manifestReads=probe.reads;}
    return fetch(input,...args);
   };
   window.holdBodies=()=>{window.bodyGate=new Promise(resolve=>window.releaseBodies=()=>{window.bodyGate=null;resolve();});};
   window.mount=()=>{
    document.querySelector('#host').innerHTML=settings.audioSettingsView();
    document.querySelector('[data-act=audio-delete]').onclick=async event=>{await settings.audioSettingsAction('audio-delete',event.currentTarget,()=>{});window.deleteDone=true;};
    window.mountPromise=settings.mountAudioSettings().then(()=>window.mountDone=true);
   };
  });
  const fill=async count=>page.evaluate(async count=>{
   const cache=await caches.open('toeic-island-audio-v1'),data=await (await fetch('./sample.m4a')).arrayBuffer();
   for(let i=0;i<count;i++)await cache.put(new URL('./audio/generated/fixture/'+String(i).padStart(32,'0')+'.m4a',location.href),new Response(data,{headers:{'Content-Type':'audio/mp4','Content-Length':String(data.byteLength),'x-usage-fixture':'1'}}));
  },count);
  await fill(files);

  // Metadata must finish even while all four exact body readers are held.
  await page.evaluate(()=>{holdBodies();probe.start=performance.now();mount();});
  await page.waitForFunction(()=>probe.reads===4&&document.querySelector('[data-audio-size=listening]')?.textContent==='约 0.0 MB');
  assert.equal(await page.evaluate(()=>Boolean(window.mountDone)),false);
  await page.locator('#poke').click();assert.equal(await page.evaluate(()=>probe.clicks),1);
  const metadata=await page.evaluate(()=>({delayMs:probe.manifestAt-probe.start,bodyReadsAtRequest:probe.manifestReads}));
  await page.evaluate(()=>releaseBodies());await page.evaluate(()=>mountPromise);
  assert.deepEqual(await page.evaluate(()=>({reads:probe.reads,bytes:probe.bytes})),{reads:files,bytes:files*audio.length});
  console.log(`PASS ${engine}: manifest and UI remain available while ${files} cache bodies are pending ${JSON.stringify(metadata)}`);

  // Timings are diagnostic, not machine-dependent pass thresholds.
  const measured=await page.evaluate(async()=>{const start=performance.now(),usage=await api.audioCacheUsage();return {...usage,durationMs:performance.now()-start};});
  assert.equal(measured.files,files);assert.equal(measured.bytes,files*audio.length);
  console.log(`PASS ${engine}: exact bounded cache usage ${JSON.stringify(measured)}`);

  // An older settings scan must never overwrite the successful deletion display.
  await page.evaluate(()=>{
   holdBodies();window.mountDone=false;probe.reads=0;probe.beforeDeleteBytes=probe.bytes;mount();window.displayTrace=[];
   new MutationObserver(()=>displayTrace.push(document.querySelector('[data-audio-usage]').textContent)).observe(document.querySelector('[data-audio-usage]'),{childList:true,subtree:true,characterData:true});
  });
  await page.waitForFunction(()=>probe.reads===4);await page.locator('[data-act=audio-delete]').click();await page.waitForFunction(()=>window.deleteDone);
  assert.match(await page.locator('[data-audio-usage]').textContent(),/ 0 个文件 · 0\.0 MB/);
  await page.evaluate(()=>releaseBodies());await page.evaluate(()=>mountPromise);
  await page.waitForFunction(bytes=>probe.bytes===probe.beforeDeleteBytes+4*bytes,audio.length);
  assert.match(await page.locator('[data-audio-usage]').textContent(),/ 0 个文件 · 0\.0 MB/);
  assert.equal(await page.evaluate(async()=>(await (await caches.open('toeic-island-audio-v1')).keys()).length),0);
  assert((await page.evaluate(()=>displayTrace)).every(text=>text.includes(' 0 个文件')));
  console.log(`PASS ${engine}: deletion cannot be overwritten by the old settings scan`);

  // The public API also handles deletion without the UI's AbortController.
  await fill(32);await page.evaluate(()=>{probe.reads=0;holdBodies();window.oldScan=api.audioCacheUsage();});await page.waitForFunction(()=>probe.reads===4);
  assert.deepEqual(await page.evaluate(()=>api.deleteAudioCache()),{bytes:0,files:0});await page.evaluate(()=>releaseBodies());
  assert.deepEqual(await page.evaluate(()=>oldScan),{bytes:0,files:0});
  assert.equal(await page.evaluate(()=>localStorage.length),0);assert.deepEqual(errors,[]);
  console.log(`PASS ${engine}: stale Cache handles reopen the empty cache; isolated save and page-error checks passed`);
 }finally{await context?.close();await new Promise(resolve=>server.close(resolve));await fs.rm(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
