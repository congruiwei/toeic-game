const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {createServer}=require('node:http');
const {tmpdir}=require('node:os');
const profiles=new Map();
async function freshContext(browser,options){
 if(engine!==webkit)return browser.newContext(options);
 // Same isolation as tests/v6.cjs: this WebKit build drops ephemeral
 // CacheStorage when reload closes its last connection. A fresh persistent
 // profile keeps Safari-like storage while scenarios remain isolated.
 const profile=await fs.mkdtemp(path.join(tmpdir(),'toeic-review-webkit-'));
 try{const context=await webkit.launchPersistentContext(profile,{headless:true,...options});profiles.set(context,profile);return context;}catch(error){await fs.rm(profile,{recursive:true,force:true});throw error;}
}
async function closeContext(context){try{await context.close();}finally{const profile=profiles.get(context);if(profile){await fs.rm(profile,{recursive:true,force:true});profiles.delete(context);}}}
const {chromium,webkit,devices}=require('playwright');
const root=path.resolve(__dirname,'..'),hash=text=>crypto.createHash('sha256').update(text).digest('hex');
const STORAGE='toeic-island.audio-review.v1',engine=process.env.PW_ENGINE==='webkit'?webkit:chromium;
const banks=['part1','part2','listening','dictation','grammar','vocab','reading'];
const base=[];
for(let i=0;i<126;i++){
 const bank=i<70?'part1':banks[1+Math.floor((i-70)/10)%6],key=`fixture-${String(i).padStart(3,'0')}/text/0`;
 base.push({token:`en:${bank}:${key}`,language:'en',bank,key,text:i===0?'The signed permit was placed beside the invoice. <img src=x onerror=alert(1)>':`The team checked the delivery schedule for order ${i} before confirming the arrangements.`,recognized:`The team checked order ${i}.`,src:`./audio/generated/en/af_heart/${hash(key).slice(0,32)}.m4a`,sha256:hash(key),priority:i===0?'high':'normal',reason:'请比较动作、时态和句尾，自动转写不等于实际听感。'});
}
base[0].reviewStatus='pending-human-review';base[0].asrStatus='matched';
base[0].recognitionModel='whisper-large-v3-turbo';base[2].recognitionModel='whisper-large-v3';
base[0].fullRecognition={model:'whisper-large-v3',recognized:'Full-model-only transcript: the signed permit remained beside the invoice. <img src=x onerror=alert(2)>'};
base[1].fullRecognition={model:'whisper-large-v3',recognized:base[1].recognized};
base.push({token:'ja:reading:ja-long/text/0',language:'ja',bank:'reading',key:'ja-long/text/0',text:'請求書に記載された締め切りまでに、確認済みの書類を受付担当者へお渡しください。',recognized:'請求書に記載された締め切りまでに確認済みの書類を受付担当者へお渡しください。',src:'https://audio.example.test/review/ja-long.m4a',sha256:hash('ja-long'),priority:'high',reason:'確認済みの読み方を確認します。',systemFallback:true});
base.push({token:'ja:vocab:ja-fallback/meaning',language:'ja',bank:'vocab',key:'ja-fallback/meaning',text:'勘測する',recognized:'',src:null,sha256:hash('missing-original'),priority:'normal',reason:'原录音未公开',systemFallback:true});
let changed=false,queueError=false,queueInvalid=false,mediaRequests=0;
const QUEUE_CACHE='toeic-island.audio-review.queue.v1';
function mock(){
 window.reviewMedia=[];window.reviewFailNext=false;window.reviewSpeech=[];
 Object.defineProperties(HTMLMediaElement.prototype,{
  load:{configurable:true,value(){}},pause:{configurable:true,value(){window.reviewMedia.push({action:'pause',src:this.src});}},
  play:{configurable:true,value(){window.reviewMedia.push({action:'play',src:this.src,rate:this.playbackRate,pitch:this.preservesPitch,trusted:window.event?.isTrusted,event:window.event?.type,id:this.id});if(window.reviewFailNext){window.reviewFailNext=false;return Promise.reject(Error('fixture error'));}this.dispatchEvent(new Event('playing'));return Promise.resolve();}}
 });
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('clipboard denied');}}});
 Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class{constructor(text){this.text=text;}}});
 Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[{name:'Kyoko',lang:'ja-JP',voiceURI:'test-ja'}],cancel(){},speak(u){window.reviewSpeech.push(u.text);u.onstart?.();u.onend?.();}}});
}
async function run(){
 const server=createServer(async(req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'')||'audio-review.html';
  if(name==='fixture-review-sw.js'){
   res.writeHead(200,{'Content-Type':'text/javascript'}).end(`self.addEventListener('install',e=>e.waitUntil(caches.open('review-fixture-shell').then(c=>c.addAll(['/','/audio-review.html','/audio-review.css','/js/audio-review.js'])).then(()=>self.skipWaiting())));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{const p=new URL(e.request.url).pathname;if(p==='/data/audio/review-queue.json'||p.endsWith('.m4a'))return;e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));});`);return;
  }
  if(name==='data/audio/review-queue.json'){
   if(queueError){res.writeHead(503).end('temporarily unavailable');return;}
   if(queueInvalid){res.writeHead(200,{'Content-Type':'text/html'}).end('<html>not a valid review queue</html>');return;}
   const entries=structuredClone(base);if(changed){entries[0].sha256=hash('changed audio');entries[0].src='./audio/generated/en/af_heart/'+hash('changed audio').slice(0,32)+'.m4a';}
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({version:1,systemFallbackCount:42,humanApprovedCount:7,entries:entries.reverse()}));return;
  }
  if(name.endsWith('.m4a')){mediaRequests++;res.writeHead(404).end();return;}
  const file=path.resolve(root,name);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{const body=await fs.readFile(file);res.writeHead(200,{'Content-Type':{'.html':'text/html','.css':'text/css','.js':'text/javascript'}[path.extname(file)]||'text/plain'}).end(body);}catch{res.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 let browser;
 try{
  if(engine===chromium)browser=await engine.launch({headless:true,...(process.env.PW_CHANNEL?{channel:process.env.PW_CHANNEL}:{})});
  for(const width of [375,390,430]){
   changed=false;queueError=false;queueInvalid=false;mediaRequests=0;
   const context=await freshContext(browser,{...devices['iPhone 13'],viewport:{width,height:844},colorScheme:width===390?'dark':'light',serviceWorkers:'block'});
   await context.addInitScript(mock);const page=await context.newPage();page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
   try{
    await page.goto(url);await page.locator('.review-row').first().waitFor();
    assert.equal(await page.locator('.review-row').count(),50);assert.equal(mediaRequests,0);assert((await page.locator('#review-processed').textContent()).includes('42'));assert((await page.locator('#review-processed').textContent()).includes('已有 7 条原录音经人工确认'));assert.equal(await page.locator('.review-row').first().locator('.review-badge').textContent(),'新版待复听');assert.equal(await page.locator('audio').count(),1);assert.equal(await page.locator('#review-audio').getAttribute('preload'),'none');
    assert.equal(await page.locator('.review-row').first().getAttribute('data-token'),base[0].token,'Part 1 and high priority come first despite reversed input');
    assert.equal(await page.locator('.review-source img').count(),0,'source markup must remain inert text');
    assert.equal(await page.locator('.review-asr-full').count(),1,'identical full-model text is not duplicated');
    assert.equal(await page.locator('.review-asr-full').textContent(),base[0].fullRecognition.recognized);assert.equal(await page.locator('.review-asr-full img').count(),0);
    assert((await page.locator('.review-row').nth(2).locator('.review-copy-block').nth(1).textContent()).includes('完整 large-v3 识别'));
    await page.locator('#review-search').fill('Full-model-only');assert.equal(await page.locator('.review-row').count(),1);await page.locator('#review-search').fill('');
    await page.evaluate(()=>localStorage.setItem('sprout-isle.save','{"untouched":"game progress"}'));
    await page.locator('#review-more').click();assert.equal(await page.locator('.review-row').count(),100);
    await page.locator('#review-more').click();assert.equal(await page.locator('.review-row').count(),128);assert(await page.locator('#review-more').isHidden());
    const tokens=await page.locator('.review-row').evaluateAll(items=>items.map(x=>x.dataset.token));
    const ranks=tokens.map(token=>token.startsWith('ja:')?9:({part1:0,part2:1,listening:2,dictation:2,grammar:3,vocab:4,reading:5})[token.split(':')[1]]);assert(ranks.every((value,i)=>i===0||value>=ranks[i-1]),'bank priority precedes Japanese rows');
    const first=page.locator('.review-row').first();
    await first.locator('[data-rate="0.75"]').click();await first.locator('[data-rate="1"]').click();
    const plays=await page.evaluate(()=>reviewMedia.filter(x=>x.action==='play'));assert.deepEqual(plays.map(x=>x.rate),[.75,1]);assert(plays.every(x=>x.trusted&&x.event==='click'&&x.pitch&&x.id==='review-audio'));
    await page.locator('.review-row').nth(1).locator('[data-rate="1"]').click();
    const sequence=await page.evaluate(()=>reviewMedia);const last=sequence.findLastIndex(x=>x.action==='play');assert.equal(sequence[last-1].action,'pause','switching rows stops the shared audio first');
    await page.locator('#review-stop').click();assert.equal(await page.locator('#review-audio-status').textContent(),'播放已停止');
    await page.evaluate(()=>{reviewFailNext=true;});await first.locator('[data-rate="1"]').click();await page.waitForFunction(()=>document.querySelector('#review-audio-status').dataset.state==='error');
    await first.locator('[data-rate="1"]').click();await page.waitForFunction(()=>document.querySelector('#review-audio-status').dataset.state==='playing');
    await page.locator('#review-stop').click();
    for(const [index,label]of ['ok','problem','unsure'].entries())await page.locator('.review-row').nth(index).locator(`[data-label=${label}]`).click();
    await first.locator('[data-note]').fill('句末 /t/ 听得清楚。日本語の長いメモも保存できます。');
    const noteIME=await first.locator('[data-note]').evaluate(input=>{input.focus();input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));input.value+='確認';input.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,data:'確認'}));return input.isConnected&&document.activeElement===input;});assert(noteIME);
    const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),STORAGE);assert.equal(Object.keys(saved.decisions).length,3);assert.equal(saved.decisions[JSON.stringify([base[0].token,base[0].sha256])].label,'ok');
    await page.locator('#review-filter').selectOption('mine');assert.equal(await page.locator('.review-row').count(),3);
    await page.locator('#review-export').click();await page.locator('#review-copy-text').waitFor();
    const copied=await page.locator('#review-copy-text').evaluate(el=>({value:el.value,start:el.selectionStart,end:el.selectionEnd}));assert(copied.value.includes(base[0].sha256));assert(copied.value.includes('没问题'));assert(copied.value.includes('听不出来'));assert(copied.value.includes(base[0].recognized));assert(copied.value.includes(base[0].fullRecognition.recognized));assert(copied.value.includes(`完整 large-v3 识别：${base[2].recognized}`));assert.equal(copied.start,0);assert.equal(copied.end,copied.value.length);
    await page.reload();await page.locator('.review-row').first().waitFor();await page.locator('#review-filter').selectOption('mine');assert.equal(await page.locator('.review-row').count(),3,'same current media restores all three judgments');
    changed=true;await page.reload();await page.locator('.review-row').first().waitFor();
    assert.equal(await page.locator('.review-row').first().getAttribute('data-token'),base[0].token);assert.equal(await page.locator('.review-row').first().locator('[aria-pressed=true]').count(),0,'new audio SHA cannot inherit an old verdict');
    await page.locator('#review-filter').selectOption('mine');assert.equal(await page.locator('.review-row').count(),2);
    await page.locator('#review-export').click();assert((await page.locator('#review-copy-text').inputValue()).includes('旧版本或已移出队列'));
    await page.locator('#review-filter').selectOption('all');await page.locator('#review-search').fill('請求書');assert.equal(await page.locator('.review-row').count(),1);assert((await page.locator('.review-row').textContent()).includes('保留供复核的录音'));
    await page.locator('#review-search').fill('ja-fallback');assert.equal(await page.locator('.review-row').count(),1);assert(await page.locator('[data-label=ok]').isDisabled());assert(await page.locator('[data-rate="1"]').isDisabled());
    await page.locator('[data-act=review-system]').click();assert.deepEqual(await page.evaluate(()=>reviewSpeech),['勘測する']);
    await page.locator('[data-note]').fill('设备声音可用；尚未听到原录音。');
    await page.locator('#review-search').fill('');assert.equal(await page.locator('.review-row').count(),50,'search reset restores the first batch');
    const composing=await page.locator('#review-search').evaluate(input=>{input.focus();input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));input.value='請';input.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,data:'請'}));const count=document.querySelectorAll('.review-row').length;input.value='請求書';input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));return{same:document.querySelector('#review-search')===input,focused:document.activeElement===input,before:count,after:document.querySelectorAll('.review-row').length};});assert.deepEqual(composing,{same:true,focused:true,before:50,after:1});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
    for(const button of await page.locator('.review-row button:not(:disabled)').all())assert(await button.evaluate(el=>el.getBoundingClientRect().height>=44),'touch targets remain at least 44px');
    if(process.env.REVIEW_SCREENSHOTS)await page.screenshot({path:path.join(tmpdir(),`audio-review-${width}.png`),fullPage:true});
    assert.equal(await page.evaluate(()=>localStorage.getItem('sprout-isle.save')),'{"untouched":"game progress"}');
    const cached=await page.evaluate(async cacheName=>{const c=await caches.open(cacheName);const r=await c.match(new URL('./data/audio/review-queue.json',location.href).href);return r?.text();},QUEUE_CACHE);assert(cached,'a schema-validated copy is stored by the page');
    queueInvalid=true;await page.reload();await page.locator('.review-row').first().waitFor();assert.equal(await page.locator('#review-queue-status').getAttribute('data-source'),'cache');
    assert.equal(await page.evaluate(async cacheName=>(await(await caches.open(cacheName)).match(new URL('./data/audio/review-queue.json',location.href).href)).text(),QUEUE_CACHE),cached,'HTML 200 cannot replace a good cached queue');
    queueInvalid=false;queueError=true;await page.reload();await page.locator('.review-row').first().waitFor();assert.equal(await page.locator('#review-queue-status').getAttribute('data-source'),'cache');
    await page.evaluate(cacheName=>caches.delete(cacheName),QUEUE_CACHE);await page.reload();await page.locator('[data-act=review-retry]').waitFor();queueError=false;await page.locator('[data-act=review-retry]').click();await page.locator('.review-row').first().waitFor();
    await page.evaluate(key=>localStorage.setItem(key,'not valid JSON'),STORAGE);await page.reload();await page.locator('.review-row').first().waitFor();assert((await page.locator('#review-notice').textContent()).includes('不会覆盖'));
    await page.locator('.review-row').first().locator('[data-label=unsure]').click();assert.equal(await page.evaluate(key=>localStorage.getItem(key),STORAGE),'not valid JSON','corrupt old records are never silently overwritten');
    assert.deepEqual(errors,[]);console.log(`PASS audio-review ${width}px${width===390?' dark':''}`);
   }finally{await closeContext(context);}
   // Reopen offline with an actual shell-only SW. The SW never writes or
   // serves review-queue.json; only the page's validated queue cache can do so.
   const offlineContext=await freshContext(browser,{...devices['iPhone 13'],viewport:{width,height:844},colorScheme:width===390?'dark':'light',serviceWorkers:'allow'});
   await offlineContext.addInitScript(mock);let onlinePage;
   try{
    changed=false;queueError=false;queueInvalid=false;
    onlinePage=await offlineContext.newPage();await onlinePage.goto(url+'/audio-review.html');await onlinePage.locator('.review-row').first().waitFor();
    await onlinePage.locator('.review-row').first().locator('[data-label=ok]').click();
    await onlinePage.evaluate(async()=>{await navigator.serviceWorker.register('./fixture-review-sw.js');await navigator.serviceWorker.ready;});
    await onlinePage.reload();await onlinePage.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));await onlinePage.locator('.review-row').first().waitFor();
    await onlinePage.close();onlinePage=null;
    const port=server.address().port;await new Promise(resolve=>server.close(resolve));
    try{
     const reopened=await offlineContext.newPage();await reopened.goto(url+'/audio-review.html');await reopened.locator('.review-row').first().waitFor();
     assert((await reopened.locator('#review-processed').textContent()).includes('42'));
     assert.equal(await reopened.locator('#review-queue-status').getAttribute('data-source'),'cache','real connection loss uses the page-owned validated queue after reopening');
     await reopened.locator('#review-filter').selectOption('mine');assert.equal(await reopened.locator('.review-row').count(),1);assert.equal(await reopened.locator('[data-label=ok][aria-pressed=true]').count(),1);
     assert.equal(await reopened.locator('.review-asr-full').textContent(),base[0].fullRecognition.recognized,'both actual transcripts survive offline reopen');
     assert.equal(await reopened.locator('audio').count(),1);await reopened.close();
    }finally{await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));}
    console.log(`PASS audio-review offline reopen ${width}px`);
   }finally{await closeContext(offlineContext);}
  }
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
