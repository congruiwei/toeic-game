// Real worker and local HTTP server; no request routing or mocked CacheStorage.
const {chromium,webkit,devices}=require('playwright');
const engine=process.env.PW_ENGINE||'chromium',browserType={chromium,webkit}[engine];
if(!browserType)throw Error('PW_ENGINE must be chromium or webkit');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {createServer}=require('node:http');
const root=path.resolve(__dirname,'..'),key='v-available/humor/0',addedKey='v-humor-update-fixture/humor/0';
const paths=['data/vocab-humor.json','data/i18n/zh/vocab-humor.json','data/i18n/ja/vocab-humor.json'];
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
(async()=>{
  const originals=await Promise.all(paths.map(file=>fs.readFile(path.join(root,file),'utf8').then(JSON.parse)));
  const extended=originals.map(pack=>({version:1,entries:{...pack.entries,[addedKey]:'Additional complete entry for the update fixture.'}}));
  const overrides=new Map();let comparisonGate=null;
  const server=createServer(async(req,res)=>{
    const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/island\//,'')||'index.html';
    const file=path.resolve(root,relative);
    if(!file.startsWith(root+path.sep)){res.writeHead(404).end();return;}
    try{if(relative==='data/confusables.json'&&comparisonGate){comparisonGate.started();await comparisonGate.wait;}const item=overrides.get(relative),body=item?.body??await fs.readFile(file);
      res.writeHead(200,{'Content-Type':item?.type??mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(body);
    }catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port,url='http://127.0.0.1:'+port+'/island/';let browser;
  try{
    browser=await browserType.launch({headless:true,...(engine==='chromium'&&process.env.PW_CHANNEL?{channel:process.env.PW_CHANNEL}:{})});
    for(const width of [375,390,430]){
      overrides.clear();
      let releaseComparison,startedComparison;
      const comparisonWait=new Promise(resolve=>{releaseComparison=resolve;}),comparisonStarted=new Promise(resolve=>{startedComparison=resolve;});
      comparisonGate={wait:comparisonWait,started:startedComparison};
      const context=await browser.newContext({...devices['iPhone 13'],viewport:{width,height:844},colorScheme:width===390?'dark':'light',serviceWorkers:'allow'});
      try{
        await context.addInitScript(()=>{
          window.humorClickTrace=[];let nextId=0;const ids=new WeakMap();
          const nodeId=n=>{if(!n)return null;if(!ids.has(n))ids.set(n,++nextId);return ids.get(n);};
          const snapshot=()=>{const summary=document.querySelector('.humor-reveal > summary'),rect=summary?.getBoundingClientRect();return {summaryId:nodeId(summary),summaryRect:rect?{x:rect.x,y:rect.y,width:rect.width,height:rect.height}:null,scrollY,viewport:visualViewport?{height:visualViewport.height,offsetTop:visualViewport.offsetTop}:null};};
          for(const type of ['pointerdown','pointerup','click','toggle','scroll'])document.addEventListener(type,e=>{const el=e.target;window.humorClickTrace.push({type,time:performance.now(),tag:el?.tagName,cls:el?.className,action:el?.closest?.('[data-act]')?.dataset.act,summary:el?.closest?.('summary')?.textContent,open:el?.closest?.('details')?.open,x:e.clientX,y:e.clientY,...snapshot()});},true);
          document.addEventListener('DOMContentLoaded',()=>new MutationObserver(records=>{for(const r of records)if(r.type==='childList'&&(r.target.closest?.('.lesson-shell')||r.target.id==='app'))window.humorClickTrace.push({type:'mutation',time:performance.now(),target:r.target.tagName,cls:r.target.className,added:r.addedNodes.length,removed:r.removedNodes.length,...snapshot()});}).observe(document.body,{childList:true,subtree:true}));
        });
        let page=await context.newPage();const errors=[],network=[],clickTraces=[];const watch=()=>{page.on('pageerror',e=>errors.push(String(e)));page.on('requestfailed',r=>network.push({url:r.url(),error:r.failure()}));page.on('response',r=>{if(r.url().includes('vocab-humor.json'))network.push({url:r.url(),status:r.status(),sw:r.fromServiceWorker()});});};watch();
        const act=action=>page.locator('[data-act="'+action+'"]:visible').first().click();
        const cached=file=>page.evaluate(async file=>{const response=await(await caches.open('toeic-island-translations-v1')).match(file);return response?await response.json():null;},url+file);
        const fetchPack=file=>page.evaluate(async file=>{const response=await fetch(file,{cache:'no-store'});return {status:response.status,value:await response.json()};},url+file);
        const host=()=>page.locator('.lesson-word-note [data-humor-id="v-available"]');
        const checkVisible=async(delayedComparison=false)=>{
          await host().locator('blockquote[lang=en]').waitFor();
          const details=host().locator('details');
          if(!await details.evaluate(e=>e.open)){
            if(delayedComparison){
              // Hold a real late-loading comparison response until one pointer press.
              // Hydration must not move the humor summary away before release.
              let deadline;try{await Promise.race([comparisonStarted,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('comparison request was not issued')),6500);})]);}finally{clearTimeout(deadline);}
              await details.locator('summary').scrollIntoViewIfNeeded();
              const box=await details.locator('summary').boundingBox();
              await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
              await page.mouse.down();releaseComparison();comparisonGate=null;
              await page.locator('[data-answer-comparison] [data-confusable-group]').first().waitFor();
              await page.mouse.up();
            }else await details.locator('summary').click();
          }
          try{await host().locator('[lang=zh-CN]').waitFor();await host().locator('[data-act=humor-ja]').waitFor();}catch(error){console.error('humor network',JSON.stringify({errors,network,clicks:await page.evaluate(()=>window.humorClickTrace),resources:await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>({name:r.name,start:r.startTime,end:r.responseEnd})))}));throw error;}
          const shown=await host().evaluate(element=>{
            const text=selector=>{const copy=element.querySelector(selector).cloneNode(true);copy.querySelectorAll('button,span[aria-hidden=true]').forEach(x=>x.remove());return copy.textContent.trim();};
            return {en:text('blockquote[lang=en]'),zh:text('[lang=zh-CN]'),ja:text('[data-act=humor-ja]')};
          });
          assert.deepEqual(shown,{en:originals[0].entries[key],zh:originals[1].entries[key],ja:originals[2].entries[key]});
          if(process.env.HUMOR_TRACE_DIR){await fs.mkdir(process.env.HUMOR_TRACE_DIR,{recursive:true});await page.locator('.lesson-word-note').screenshot({path:path.join(process.env.HUMOR_TRACE_DIR,engine+'-'+width+'-word.png')});}
        };
        await page.goto(url);await page.locator('.habitat').waitFor();await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
        for(const file of paths)assert.equal(await cached(file),null,'no humor preload on home');
        // An initially incomplete 200 response cannot establish the cache baseline.
        overrides.set(paths[0],{body:JSON.stringify({version:1,entries:{[key]:originals[0].entries[key]}})});
        assert.equal(await page.evaluate(async file=>(await fetch(file)).status,url+paths[0]),503,'uncached invalid optional pack fails without a rejected worker event');
        assert.equal(await cached(paths[0]),null);overrides.delete(paths[0]);
        await page.evaluate(()=>{const saveKey='sprout-isle.save',s=JSON.parse(localStorage.getItem(saveKey));s.settings.methodHints=false;s.settings.audioMode='system';s.settings.translationLanguage='both';
          s.session={mode:'vocab',title:'词卡练习',items:[{id:'v-available',mode:'vocab',format:'cloze'}],index:0,right:0,gain:0,selected:null,elapsed:0,timed:false,intro:false};localStorage.setItem(saveKey,JSON.stringify(s));});
        await page.reload();await act('resume');assert.equal(await host().count(),0,'no example leak before answering');
        await act('unknown');await checkVisible(true);
        for(let i=0;i<paths.length;i++)assert.deepEqual(await cached(paths[i]),originals[i]);
        for(let i=0;i<paths.length;i++){
          const pack=originals[i],missing=structuredClone(pack);delete missing.entries[Object.keys(pack.entries).find(x=>x!==key)];
          const bad=[{version:1,entries:{}},missing,{...pack,entries:{...pack.entries,[key]:''}},
            {...pack,entries:{...pack.entries,[key]:null}},{...pack,entries:{...pack.entries,[key]:{text:'wrong shape'}}},
            {...pack,entries:[]},'<html>upstream fallback</html>'];
          for(const value of bad){
            overrides.set(paths[i],{body:typeof value==='string'?value:JSON.stringify(value),type:typeof value==='string'?'text/html':'application/json'});
            const response=await fetchPack(paths[i]);assert.equal(response.status,200);assert.deepEqual(response.value,pack,'bad 200 must return the complete cached pack');
            assert.deepEqual(await cached(paths[i]),pack,'bad 200 must not replace complete cache');
          }
          overrides.set(paths[i],{body:JSON.stringify(extended[i])});
          assert.deepEqual((await fetchPack(paths[i])).value,extended[i],'new entries can be appended without worker update');
          assert.deepEqual(await cached(paths[i]),extended[i]);
          overrides.set(paths[i],{body:JSON.stringify(pack)});
          assert.deepEqual((await fetchPack(paths[i])).value,extended[i],'later truncated update cannot drop a previously downloaded added key');
        }
        // Prove only these three paths use the new complete-pack rule.
        const ordinary='data/i18n/zh/humor-policy-probe.json';overrides.set(ordinary,{body:JSON.stringify({version:1,entries:{}})});
        assert.deepEqual((await fetchPack(ordinary)).value,{version:1,entries:{}});
        await page.waitForLoadState('networkidle');
        clickTraces.push({phase:'online',events:await page.evaluate(()=>window.humorClickTrace)});
        if(process.env.HUMOR_TRACE_DIR){await fs.mkdir(process.env.HUMOR_TRACE_DIR,{recursive:true});await fs.writeFile(path.join(process.env.HUMOR_TRACE_DIR,engine+'-'+width+'.json'),JSON.stringify(clickTraces,null,2));}
        if(engine==='webkit')await new Promise(resolve=>server.close(resolve));else await context.setOffline(true);
        await page.close();page=await context.newPage();watch();
        const response=await page.goto(url);if(engine==='chromium')assert(response.fromServiceWorker());
        await act('resume');await checkVisible();
        for(let i=0;i<paths.length;i++)assert.deepEqual(await cached(paths[i]),extended[i]);
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
        assert.deepEqual(errors,[],'no page errors through corrupt update and offline cold reopen');
        clickTraces.push({phase:'offline',events:await page.evaluate(()=>window.humorClickTrace)});
        if(process.env.HUMOR_TRACE_DIR)await fs.writeFile(path.join(process.env.HUMOR_TRACE_DIR,engine+'-'+width+'.json'),JSON.stringify(clickTraces,null,2));
        console.log('PASS '+engine+' '+width+'px: three full humor packs; 21 invalid updates rejected; append allowed; no truncated rollback; unchanged generic translations; exact EN/ZH/JA after offline cold reopen');
      }catch(error){
        const page=context.pages().at(-1);console.error('humor failure',width,await page?.locator('[data-humor-id]').evaluateAll(nodes=>nodes.map(n=>({html:n.outerHTML,row:n.humorRow}))));throw error;
      }finally{
        releaseComparison();comparisonGate=null;await context.close();if(!server.listening)await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
      }
    }
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
