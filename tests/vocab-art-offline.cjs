// Actual Pages subpath, real worker fetches, and a fresh iPhone context per width.
const {chromium,webkit,devices}=require('playwright');
const engine=process.env.PW_ENGINE||'chromium',browserType={chromium,webkit}[engine];
if(!browserType)throw Error('PW_ENGINE must be chromium or webkit');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const {createHash}=require('node:crypto');
const {createServer}=require('node:http');
const root=path.resolve(__dirname,'..');
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const digest=body=>createHash('sha256').update(body).digest('hex');
(async()=>{
  const overrides=new Map();
  const server=createServer(async(req,res)=>{
    const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/island\//,'')||'index.html';
    const file=path.resolve(root,relative);
    if(!file.startsWith(root+path.sep)){res.writeHead(404).end();return;}
    try{
      const override=overrides.get(relative),body=override?.body??await fs.readFile(file);
      res.writeHead(200,{'Content-Type':override?.type??mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(body);
    }catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port,url='http://127.0.0.1:'+port+'/island/';
  const catalog=JSON.parse(await fs.readFile(path.join(root,'data/vocab-art.json'),'utf8'));
  const oldSvg=await fs.readFile(path.join(root,'assets/vocab/v-forklift.svg'));
  assert.equal(catalog.entries['v-forklift'].rev,digest(oldSvg).slice(0,12));
  // Only the test server changes. The real SVG stays untouched on disk.
  const newSvg=Buffer.from(oldSvg.toString().replace('</svg>','<!-- validated-update-fixture --></svg>'));
  const next=structuredClone(catalog);next.entries['v-forklift'].rev=digest(newSvg).slice(0,12);
  next.entries['v-forklift'].alt+='（有效更新）';
  const indexUrl=url+'data/vocab-art.json';
  const oldUrl=url+'assets/vocab/v-forklift.svg?v='+catalog.entries['v-forklift'].rev;
  const newUrl=url+'assets/vocab/v-forklift.svg?v='+next.entries['v-forklift'].rev;
  let browser;
  try {
    browser=await browserType.launch({headless:true,...(engine==='chromium'&&process.env.PW_CHANNEL?{channel:process.env.PW_CHANNEL}:{})});
    for(const width of [375,390,430]){
      overrides.clear();
      const context=await browser.newContext({...devices['iPhone 13'],viewport:{width,height:844},colorScheme:width===390?'dark':'light',serviceWorkers:'allow'});
      try{
        let page=await context.newPage();const errors=[];
        const watch=()=>page.on('pageerror',error=>errors.push(String(error)));
        watch();
        const play=async action=>page.locator('[data-act="'+action+'"]:visible').first().click();
        const cached=address=>page.evaluate(async address=>{
          const hit=await(await caches.open('toeic-island-vocab-art-v1')).match(address);return hit?await hit.text():null;
        },address);
        const get=address=>page.evaluate(async address=>{const response=await fetch(address,{cache:'no-store'});return {status:response.status,text:await response.text()};},address);
        await page.goto(url);await page.locator('.habitat').waitFor();
        await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
        assert.equal(await cached(indexUrl),null,'first screen must not preload picture index');
        await page.evaluate(()=>{const key='sprout-isle.save',s=JSON.parse(localStorage.getItem(key));s.settings.methodHints=false;s.settings.audioMode='system';
          s.session={mode:'vocab',title:'单词练习',items:[{id:'v-forklift',mode:'vocab',format:'cloze'}],index:0,right:0,gain:0,selected:null,elapsed:0,timed:false,intro:false};localStorage.setItem(key,JSON.stringify(s));});
        await page.reload();await play('resume');assert.equal(await cached(indexUrl),null,'unanswered card must not preload picture index');
        await play('unknown');
        const image=()=>page.locator('.lesson-word-note [data-vocab-art="v-forklift"] img');
        await image().scrollIntoViewIfNeeded();await image().evaluate(e=>e.decode());
        await page.locator('.lesson-word-note [data-humor-id] summary').click();
        await page.locator('.lesson-word-note [data-humor-id] [lang=ja]').waitFor();
        assert.equal(await cached(oldUrl),oldSvg.toString());
        const invalids=[
          {version:1,entries:{}},
          {...catalog,entries:[]},
          {...catalog,aliases:{'cf-update-fixture':'v-does-not-exist'}},
          {...catalog,aliases:{'cf-update-fixture':'v-valuable'}},
          {...catalog,entries:{...catalog.entries,'v-forklift':{class:'A',alt:'坏指纹',rev:'not-a-digest'}}},
          {...catalog,entries:{...catalog.entries,'v-forklift':{class:'A',rev:catalog.entries['v-forklift'].rev}}},
          '<html><body>upstream fallback</body></html>',
        ];
        for(const invalid of invalids){
          overrides.set('data/vocab-art.json',{body:typeof invalid==='string'?invalid:JSON.stringify(invalid),type:typeof invalid==='string'?'text/html':'application/json'});
          assert.deepEqual(JSON.parse((await get(indexUrl)).text),catalog,'HTTP 200 malformed/empty/dangling index must return cached valid data');
          assert.deepEqual(JSON.parse(await cached(indexUrl)),catalog,'bad index must not overwrite valid cache');
        }
        overrides.set('data/vocab-art.json',{body:JSON.stringify(next)});
        assert.deepEqual(JSON.parse((await get(indexUrl)).text),next,'valid updated object index is returned');
        assert.deepEqual(JSON.parse(await cached(indexUrl)),next,'valid updated object index is cached');
        // The HTTP response is a real SVG, but belongs to the previous digest.
        overrides.set('assets/vocab/v-forklift.svg',{body:oldSvg});
        assert.equal((await get(newUrl)).status,404,'wrong SVG version is neither returned nor cached');
        assert.equal(await cached(newUrl),null);
        assert.equal(await cached(oldUrl),oldSvg.toString(),'new-version failure preserves old-version cache');
        await page.evaluate(async({address,text})=>{await(await caches.open('toeic-island-vocab-art-v1')).put(address,new Response(text,{headers:{'Content-Type':'image/svg+xml'}}));},{address:newUrl,text:oldSvg.toString()});
        assert.equal((await get(newUrl)).status,404,'previous worker poisoned digest entry is rejected too');
        assert.equal(await cached(newUrl),null);
        overrides.set('assets/vocab/v-forklift.svg',{body:'<html>wrong upstream response</html>',type:'text/html'});
        assert.equal((await get(newUrl)).status,404);assert.equal(await cached(newUrl),null);
        overrides.set('assets/vocab/v-forklift.svg',{body:newSvg});
        const renewed=await get(newUrl);assert.equal(renewed.status,200);assert.equal(digest(renewed.text),digest(newSvg));
        assert.equal(await cached(newUrl),newSvg.toString());
        // A subsequent bad update must preserve the newest good index, not the install version.
        overrides.set('data/vocab-art.json',{body:JSON.stringify({version:1,entries:{}})});
        assert.deepEqual(JSON.parse((await get(indexUrl)).text),next);
        await page.waitForLoadState('networkidle');
        await page.reload();await play('resume');await image().scrollIntoViewIfNeeded();await image().evaluate(e=>e.decode());
        assert.equal(await image().getAttribute('src'),newUrl);assert.match(await image().getAttribute('alt'),/有效更新/);
        await page.waitForLoadState('networkidle');
        // WebKit setOffline can block even a worker-only response; shut the real server instead.
        if(engine==='webkit')await new Promise(resolve=>server.close(resolve));else await context.setOffline(true);
        await page.close();page=await context.newPage();watch();
        const response=await page.goto(url);if(engine==='chromium')assert(response.fromServiceWorker());
        await play('resume');await image().scrollIntoViewIfNeeded();await image().evaluate(e=>e.decode());
        await page.locator('.lesson-word-note [data-humor-id] summary').click();
        await page.locator('.lesson-word-note [data-humor-id] [lang=ja]').waitFor();
        assert.equal(await image().getAttribute('src'),newUrl);assert(await image().evaluate(e=>e.naturalWidth>0));
        assert.deepEqual(JSON.parse(await cached(indexUrl)),next);
        assert.equal(await cached(oldUrl),oldSvg.toString());assert.equal(await cached(newUrl),newSvg.toString());
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
        assert.deepEqual(errors,[],'no page errors across update rejection and offline reopen');
        console.log('PASS '+engine+' '+width+'px: 7 bad indexes preserve cache; valid update; wrong SVG hash/HTML/old poison rejected; correct digest and offline cold reopen');
      }finally{
        await context.close();
        if(!server.listening)await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
      }
    }
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
