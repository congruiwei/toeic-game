// Actual current review queue, actual Service Worker, and actual M4A playback.
// No speech/media mocks and no changes to the user's normal browser profile.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {createServer}=require('node:http'),{tmpdir}=require('node:os');
const {chromium,webkit,devices}=require('playwright');
const root=path.resolve(process.env.REVIEW_ROOT||path.join(__dirname,'..'));
const isWebKit=process.env.PW_ENGINE==='webkit',prefix='/toeic-game/';
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.m4a':'audio/mp4'};
async function main(){
 const queue=JSON.parse(await fs.readFile(path.join(root,'data/audio/review-queue.json'),'utf8'));
 assert(queue.entries.length,'This release integration test needs a remaining playable review row');
 assert(queue.entries.every(r=>r.src&&!r.systemFallback),'processed system fallbacks must never enter the production queue');
 let audioRequests=0;
 const server=createServer(async(req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(!pathname.startsWith(prefix)){res.writeHead(404).end();return;}
  const file=path.resolve(root,pathname.slice(prefix.length)||'index.html');
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{const bytes=await fs.readFile(file);if(file.endsWith('.m4a'))audioRequests++;
   res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','Content-Length':bytes.length}).end(bytes);
  }catch{res.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port,url=`http://127.0.0.1:${port}${prefix}`;
 let browser;
 try{
  if(!isWebKit)browser=await chromium.launch({headless:true,...(process.env.PW_CHANNEL?{channel:process.env.PW_CHANNEL}:{})});
  for(const width of [375,390,430]){
   audioRequests=0;const options={...devices['iPhone 13'],viewport:{width,height:844},colorScheme:width===390?'dark':'light',serviceWorkers:'allow'};
   const profile=isWebKit?await fs.mkdtemp(path.join(tmpdir(),'toeic-review-live-')):null;
   const context=isWebKit?await webkit.launchPersistentContext(profile,{headless:true,...options}):await browser.newContext(options);
   try{
    let page=await context.newPage();page.setDefaultTimeout(20000);
    await page.goto(url+'audio-review.html');await page.locator('.review-row').first().waitFor();
    assert.equal(audioRequests,0,'opening the real queue must not preload any audio');
    await page.evaluate(async()=>{await navigator.serviceWorker.register('./sw.js');await navigator.serviceWorker.ready;});
    await page.reload();await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));await page.locator('.review-row').first().waitFor();
    assert.equal(await page.locator('h1').textContent(),'音频复听','SW-controlled navigation must not substitute the game index');
    assert.equal(await page.locator('.review-row').count(),Math.min(50,queue.entries.length));
    assert.equal(audioRequests,0,'installing the production SW must not fetch the audio library');
    const first=page.locator('.review-row').first(),token=await first.getAttribute('data-token');
    assert.equal(token,queue.entries[0].token);await first.locator('[data-rate="0.75"]').click();
    await page.waitForFunction(()=>{const a=document.querySelector('#review-audio');return a.readyState>=2&&a.currentTime>.05;});
    assert.equal(await page.locator('#review-audio').evaluate(a=>a.playbackRate),.75,'native media retains the selected slow rate after metadata loads');
    assert(await page.locator('#review-audio').evaluate(a=>a.preservesPitch??a.webkitPreservesPitch),'slow playback preserves pitch');
    const firstURL=new URL(queue.entries[0].src,url).href;
    assert.equal(await page.locator('#review-audio').evaluate(a=>a.currentSrc),firstURL);
    await page.waitForFunction(async src=>Boolean(await(await caches.open('toeic-island-audio-v1')).match(src)),firstURL);
    assert.equal(audioRequests,1,'one clicked recording is fetched once as a whole cacheable file');
    await page.locator('#review-stop').click();await first.locator('[data-label=unsure]').click();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if(width!==430)await page.screenshot({path:`/private/tmp/audio-review-live-${isWebKit?'webkit':'chromium'}-${width}.png`,fullPage:false});
    await page.close();await new Promise(resolve=>server.close(resolve));
    try{
     page=await context.newPage();page.setDefaultTimeout(20000);await page.goto(url+'audio-review.html');await page.locator('.review-row').first().waitFor();
     assert.equal(await page.locator('h1').textContent(),'音频复听');
     assert.equal(await page.locator('#review-queue-status').getAttribute('data-source'),'cache');
     await page.locator('#review-filter').selectOption('mine');assert.equal(await page.locator('.review-row').count(),1);assert.equal(await page.locator('.review-row').getAttribute('data-token'),token);
     await page.locator('[data-rate="1"]').click();await page.waitForFunction(()=>{const a=document.querySelector('#review-audio');return a.readyState>=2&&a.currentTime>.05;});
     assert.equal(await page.locator('#review-audio').evaluate(a=>a.currentSrc),firstURL);
     assert.equal(await page.locator('#review-audio').evaluate(a=>a.playbackRate),1,'offline replay honors the newly selected rate');
     assert.equal(audioRequests,1,'offline replay uses the existing SW media cache');
     await page.locator('#review-stop').click();await page.close();
    }finally{await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));}
    console.log(`PASS actual queue + production SW + native online/offline M4A ${width}px${width===390?' dark':''}`);
   }finally{await context.close();if(profile)await fs.rm(profile,{recursive:true,force:true});}
  }
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
