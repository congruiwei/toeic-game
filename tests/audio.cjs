// Playback/cache contract tests use one checked-in audition M4A; no full-bank generation is required.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {createServer}=require('node:http'),{chromium,webkit,devices}=require('playwright');
const engine=process.env.PW_ENGINE||'chromium',browserType={chromium,webkit}[engine];
if(!browserType)throw Error('PW_ENGINE must be chromium or webkit');
const root=path.resolve(__dirname,'..'),hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.m4a':'audio/mp4'};
const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:16px;font:16px system-ui}button{min-height:44px;max-width:100%;margin:4px}section{overflow-wrap:anywhere}.is-reading{outline:2px solid purple}@media(prefers-color-scheme:dark){body{background:#201f28;color:white}}</style><title>Audio contract</title><button id="en">英语</button><button id="ja">日语</button><button id="system">系统试听</button><button id="queue">连续播放</button><button id="stop">停止</button><button id="pause">暂停</button><button id="resume">继续</button><button id="markers-en">英语标记</button><button id="markers-ja">日语标记</button><section data-read-text="When is lunch?" data-read-key="p2-fixture/audio/0" data-read-bank="part2">When is lunch?</section><button data-read-text="Do not nest buttons">已有按钮</button><section hidden data-read-text="Never expose this answer">未答原文</section><output id="status"></output><script type="module">
import * as a from './js/audio.js';import * as r from './js/recorded-audio.js';import * as d from './js/audio-downloads.js';import * as j from './js/japanese-audio.js';import * as read from './js/read-aloud.js';
window.api={a,r,d,j,read};window.events=[];const prefs={audioMode:'recorded',rate:.85,audioGapMs:0},status=document.querySelector('#status');
const notify=m=>status.textContent=m,options={seed:'p2-fixture',onEnd(){events.push('end')}};
document.querySelector('#en').onclick=()=>a.speak([{text:'When is lunch?',key:'p2-fixture/audio/0',bank:'part2',speaker:'A'}],prefs,notify,options);
document.querySelector('#ja').onclick=()=>j.speakJapanese('昼食は何時ですか。',prefs,notify,{key:'p2-fixture/audio/0',bank:'part2'});
document.querySelector('#system').onclick=()=>a.speak([{text:'When is lunch?',speaker:'A'}],prefs,notify,{preview:'test-en'});
document.querySelector('#queue').onclick=()=>a.speak([{text:'A. At noon.',speaker:'A',bank:'part2'}],prefs,notify,options);
document.querySelector('#stop').onclick=a.hush;document.querySelector('#pause').onclick=r.pauseRecordedAudio;document.querySelector('#resume').onclick=r.resumeRecordedAudio;
document.querySelector('#markers-en').onclick=()=>{window.markerEnded=0;a.speak([{text:'[1] [2]'},{text:'[1] On 3/4, model A4 costs $35 at 9:30. [2]'},{text:'[3]'},{text:'[3] Keep 12 copies and reference [5]. [4]'}],{...prefs,audioMode:window.markerMode},notify,{onEnd(){window.markerEnded++;}});};
document.querySelector('#markers-ja').onclick=()=>{window.markerEnded=0;j.speakJapanese('[1] [2] [3] [4]',{...prefs,audioMode:window.markerMode},notify,{onEnd(){window.markerEnded++;j.speakJapanese('[1] 11月17日9:30、A4用紙を3枚、$35で購入します。[2] 1箱は12冊です。[4]',{...prefs,audioMode:window.markerMode},notify,{onEnd(){window.markerEnded++;}});}});};
read.mountReadAloud(document.body);document.addEventListener('click',event=>{const b=event.target.closest('[data-act="read-aloud"]');if(b)read.playReadAloud(b,prefs,notify);});
window.ready=location.search.includes('cold')?Promise.resolve():r.prepareRecordedAudio({banks:['part2'],languages:['en','ja']});
</script>`;
function mock(){
 // WebKit may return a fresh native speech wrapper; replace the test facade itself.
 const states=new WeakMap(),state=e=>{if(!states.has(e))states.set(e,{paused:true,ended:false});return states.get(e);};window.probe={plays:[],speeches:[],fail:false};
 Object.defineProperties(HTMLMediaElement.prototype,{paused:{configurable:true,get(){return state(this).paused;}},ended:{configurable:true,get(){return state(this).ended;}},load:{configurable:true,value(){state(this).ended=false;}},pause:{configurable:true,value(){state(this).paused=true;}},play:{configurable:true,value(){probe.plays.push({src:this.src,trusted:window.event?.isTrusted,rate:this.playbackRate});if(probe.fail){probe.fail=false;return Promise.reject(Error('injected'));}state(this).paused=false;state(this).ended=false;this.dispatchEvent(new Event('playing'));return Promise.resolve();}}});
 window.finish=()=>{const e=document.querySelector('audio');state(e).ended=true;state(e).paused=true;e.dispatchEvent(new Event('ended'));};
 window.speechPending=[];window.finishSpeech=()=>window.speechPending.shift()?.onend?.();
 Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class{constructor(text){this.text=text;}}});Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[{name:'Ava',lang:'en-US',voiceURI:'test-en'},{name:'Kyoko',lang:'ja-JP',voiceURI:'test-ja'}],cancel:()=>{window.speechPending=[];},speak:u=>{window.speechPending.push(u);probe.speeches.push({text:u.text,trusted:window.event?.isTrusted});u.onstart?.();}}});
}
(async()=>{
 const audition=JSON.parse(await fs.readFile(path.join(root,'data/audio-audition-manifest.json'),'utf8')),source=audition.clips.af_heart[Object.keys(audition.clips.af_heart)[0]],bytes=await fs.readFile(path.join(root,source.src));
 const digest=hash(bytes),src=language=>'./audio/generated/'+language+'/'+(language==='en'?'af_heart':'jf_alpha')+'/'+digest.slice(0,32)+'.m4a';
 const clip=(text,language='en')=>({src:src(language),text,language,voiceId:language==='en'?'af_heart':'jf_alpha',duration:source.duration,bytes:bytes.length,sha256:digest});
 const packs=[{version:1,sourceSha256:digest,bank:'part2',language:'en',complete:true,clips:{'p2-fixture/audio/0':clip('When is lunch?'),'p2-fixture/options/0/0':clip('At noon.')}},{version:1,sourceSha256:digest,bank:'part2',language:'ja',complete:true,clips:{'p2-fixture/audio/0':clip('昼食は何時ですか。','ja')}},{version:1,sourceSha256:digest,bank:'labels',language:'en',complete:true,clips:{'labels/af_heart/A':clip('A.')}}];
 const index={version:1,complete:true,sourceSha256:digest,packs:packs.map(p=>({bank:p.bank,language:p.language,complete:true,src:'./data/audio/'+p.language+'/'+p.bank+'.json',count:Object.keys(p.clips).length,bytes:Buffer.byteLength(JSON.stringify(p)),sha256:hash(JSON.stringify(p))}))};
 let broken=false,delay=0;
 const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost'),relative=decodeURIComponent(url.pathname).replace(/^\/island\//,'');let body,type;
  if(relative==='audition.html'){body=html;type='text/html';}
  else if(relative==='data/audio/manifest.json'){body=JSON.stringify(index);type='application/json';}
  else if(relative.startsWith('data/audio/')){const pack=packs.find(p=>relative===`data/audio/${p.language}/${p.bank}.json`);if(!pack){res.writeHead(404);res.end();return;}body=JSON.stringify(pack);type='application/json';}
  else if(relative.startsWith('audio/generated/')){if(delay)await new Promise(r=>setTimeout(r,delay));body=broken?Buffer.from('<html>offline fallback</html>'):bytes;type=broken?'text/html':'audio/mp4';}
  else{const target=path.resolve(root,relative||'index.html');if(!target.startsWith(root+path.sep))throw Error('path');body=await fs.readFile(target);type=mime[path.extname(target)]||'application/octet-stream';}
  const buffer=Buffer.isBuffer(body)?body:Buffer.from(body);res.writeHead(200,{'Content-Type':type,'Content-Length':buffer.length,'Cache-Control':'no-store'});res.end(buffer);
 }catch{res.writeHead(404);res.end('not found');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}/island/`;
 const browser=await browserType.launch({headless:true,...(engine==='chromium'?{channel:process.env.PW_CHANNEL||'chrome'}:{})});let checks=0;
 try{
  for(const width of [375,390,430]){
   const context=await browser.newContext({...devices['iPhone 13'],viewport:{width,height:844},colorScheme:width===390?'dark':'light',serviceWorkers:'block'});await context.addInitScript(mock);const page=await context.newPage(),errors=[],audioRequests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/audio/generated/'))audioRequests.push(r.url());});
   await page.goto(url+'audition.html');await page.evaluate(()=>ready);assert.equal(audioRequests.length,0);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await page.locator('[data-act=read-aloud]').count(),1);
   await page.click('#en');assert.equal((await page.evaluate(()=>probe)).plays.at(-1).trusted,true);assert.equal(await page.locator('audio').count(),1);assert.equal(await page.locator('audio').evaluate(e=>e.playbackRate),.85);assert(await page.locator('audio').evaluate(e=>e.preservesPitch));
   await page.click('#ja');assert((await page.evaluate(()=>probe)).plays.at(-1).src.includes('/ja/jf_alpha/'));
   await page.click('[data-act=read-aloud]');assert.equal(await page.locator('[data-act=read-aloud]').getAttribute('aria-pressed'),'true');await page.click('#ja');assert.equal(await page.locator('[data-act=read-aloud]').getAttribute('aria-pressed'),'false');
   await page.click('#queue');let count=(await page.evaluate(()=>probe)).plays.length;await page.locator('audio').dispatchEvent('ended');await page.waitForTimeout(20);assert.equal((await page.evaluate(()=>probe)).plays.length,count,'obsolete ended while ended=false cannot advance');await page.evaluate(()=>finish());await page.waitForTimeout(30);assert.equal((await page.evaluate(()=>probe)).plays.length,count+1);
   await page.click('#pause');assert(await page.locator('audio').evaluate(e=>e.paused));await page.click('#resume');assert.equal(await page.locator('audio').evaluate(e=>e.paused),false);
   await page.click('#system');const systemProbe=await page.evaluate(()=>probe);assert(systemProbe.speeches.length,`System preview did not reach speechSynthesis: ${JSON.stringify({errors,status:await page.locator('#status').textContent()})}`);assert.equal(systemProbe.speeches.at(-1).trusted,true);await page.evaluate(()=>{probe.fail=true;});await page.click('#en');await page.waitForFunction(()=>probe.speeches.length>=2);assert.equal((await page.evaluate(()=>probe)).speeches.at(-1).text,'When is lunch?');
   await page.click('#stop');assert(await page.locator('audio').evaluate(e=>e.paused));
   for(const mode of ['system','recorded']){
    await page.evaluate(mode=>{window.markerMode=mode;},mode);let before=(await page.evaluate(()=>probe)).speeches.length;
    await page.click('#markers-en');let spoken=(await page.evaluate(()=>probe)).speeches.slice(before);
    assert.deepEqual(spoken.map(item=>item.text),['On 3/4, model A4 costs $35 at 9:30.','Keep 12 copies and reference [5].'],`${mode}: only insertion markers may change`);
    assert(spoken.every(item=>item.trusted));assert.equal(await page.evaluate(()=>markerEnded),0);
    await page.evaluate(()=>finishSpeech());assert.equal(await page.evaluate(()=>markerEnded),0);
    await page.evaluate(()=>finishSpeech());assert.equal(await page.evaluate(()=>markerEnded),1,'marker-only pieces cannot stall the English queue');
    before=(await page.evaluate(()=>probe)).speeches.length;await page.click('#markers-ja');spoken=(await page.evaluate(()=>probe)).speeches.slice(before);
    assert.deepEqual(spoken.map(item=>item.text),['11月17日9:30、A4用紙を3枚、$35で購入します。 1箱は12冊です。']);assert(spoken.every(item=>item.trusted));
    assert.equal(await page.evaluate(()=>markerEnded),1,'marker-only Japanese item advances without an empty utterance');
    await page.evaluate(()=>finishSpeech());assert.equal(await page.evaluate(()=>markerEnded),2);
   }
   assert.deepEqual(errors,[]);await context.close();console.log(`PASS recorded controls/EN+JA system markers/click-to-read at ${width}px${width===390?' (dark)':''}`);checks++;
   const cold=await browser.newContext({...devices['iPhone 13'],viewport:{width,height:844},colorScheme:width===390?'dark':'light',serviceWorkers:'block'});await cold.addInitScript(mock);await cold.route('**/data/audio/**',async route=>{await new Promise(r=>setTimeout(r,120));await route.continue().catch(()=>{});});const cp=await cold.newPage();await cp.goto(url+'audition.html?cold');await cp.waitForFunction(()=>!!window.api);
   await cp.click('#en');assert((await cp.evaluate(()=>probe)).plays[0].src.startsWith('data:audio/wav'));assert.equal((await cp.evaluate(()=>probe)).plays[0].trusted,true);await cp.click('#stop');await cp.waitForTimeout(650);assert.equal((await cp.evaluate(()=>probe)).plays.filter(p=>p.src.endsWith('.m4a')).length,0,'cancel during metadata fetch cannot cause late playback');
   await cp.click('#ja');await cp.waitForFunction(()=>probe.plays.some(p=>p.src.includes('/ja/jf_alpha/')));assert.equal((await cp.evaluate(()=>probe)).speeches.length,0,'first JA click must load Alpha metadata and play recorded audio');await cp.click('#stop');
   await cp.reload();await cp.waitForFunction(()=>!!window.api);await cp.click('#en');await cp.waitForFunction(()=>probe.plays.some(p=>p.src.includes('/en/af_heart/')));assert.equal((await cp.evaluate(()=>probe)).speeches.length,0,'first EN click must load its own metadata');await cp.click('#stop');await cold.close();console.log(`PASS cold EN/JA first-click metadata and cancel at ${width}px`);checks++;
  }
  const context=await browser.newContext({...devices['iPhone 13'],viewport:{width:390,height:844}}),page=await context.newPage();await page.goto(url+'audition.html?cold');await page.waitForFunction(()=>!!window.api);await page.click('#en');await page.waitForFunction(()=>document.querySelector('audio')?.src.endsWith('.m4a')&&document.querySelector('audio').currentTime>.1);await page.click('#stop');console.log('PASS native first click unlocks audio before asynchronous metadata');checks++;
  await page.evaluate(()=>api.d.precacheAudio([{key:'p2-fixture/audio/0',bank:'part2'}]));assert.deepEqual(await page.evaluate(()=>api.d.audioCacheUsage()),{bytes:bytes.length,files:1});
  await page.evaluate(()=>api.d.deleteAudioCache());broken=true;assert.match(await page.evaluate(async()=>{try{await api.d.precacheAudio([{key:'p2-fixture/audio/0'}]);return 'unexpected';}catch(e){return e.message;}}),/校验失败/);assert.equal((await page.evaluate(()=>api.d.audioCacheUsage())).files,0);broken=false;
  assert.equal(await page.evaluate(async()=>{const put=Cache.prototype.put;Cache.prototype.put=async()=>{throw new DOMException('full','QuotaExceededError');};try{await api.d.precacheAudio([{key:'p2-fixture/audio/0'}]);}catch(e){return e.code;}finally{Cache.prototype.put=put;}}),'AUDIO_QUOTA');
  delay=300;assert.equal(await page.evaluate(async()=>{const controller=new AbortController();setTimeout(()=>controller.abort(),30);try{await api.d.precacheAudio([{key:'p2-fixture/audio/0'}],{signal:controller.signal});}catch(e){return e.name;}}),'AbortError');delay=0;assert.equal((await page.evaluate(()=>api.d.audioCacheUsage())).files,0);
  console.log('PASS fullbody SHA validation, HTML rejection, quota, cancel and usage/delete');checks++;
  await page.evaluate(async()=>{await navigator.serviceWorker.register('./sw.js');await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('SW installation timed out')),15000))]);});await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{timeout:15000});await page.reload();await page.evaluate(()=>ready);
  await page.evaluate(()=>api.d.precacheAudio([{key:'p2-fixture/audio/0'}]));await page.click('#en');await page.waitForFunction(()=>document.querySelector('audio')?.currentTime>.1);await page.locator('audio').evaluate(e=>{e.currentTime=2;});await page.waitForFunction(()=>document.querySelector('audio').currentTime>2);await page.click('#stop');
  assert.deepEqual(await page.evaluate(()=>api.d.audioCacheUsage()),{bytes:bytes.length,files:1});
  const cachedKeys=await page.evaluate(async()=>{const cache=await caches.open('toeic-island-audio-v1');return(await cache.keys()).map(request=>request.url);});assert.equal(cachedKeys.length,1);
  const onlineRange=await page.evaluate(async()=>{const clip=api.r.getAudioClip('p2-fixture/audio/0'),response=await fetch(new URL(clip.src,location.href),{headers:{Range:'bytes=0-31'}});return{status:response.status,length:(await response.arrayBuffer()).byteLength};});assert.deepEqual(onlineRange,{status:206,length:32});console.log('PASS installed-SW cache has one full clip and online Range returns 206');
  // WebKit's protocol offline flag blocks even fixed SW responses. Closing the
  // origin instead verifies a real network outage with every offline assertion intact.
  if(engine==='webkit')await new Promise(resolve=>server.close(resolve));else await context.setOffline(true);
  const range=await page.evaluate(async()=>{const clip=api.r.getAudioClip('p2-fixture/audio/0');const response=await fetch(new URL(clip.src,location.href),{headers:{Range:'bytes=0-31'}});return {status:response.status,length:(await response.arrayBuffer()).byteLength,range:response.headers.get('Content-Range')};});assert.equal(range.status,206);assert.equal(range.length,32);assert.equal(range.range,`bytes 0-31/${bytes.length}`);
  await page.reload();await page.evaluate(()=>ready);await page.click('#en');await page.waitForFunction(()=>document.querySelector('audio')?.currentTime>.1);assert(await page.locator('audio').evaluate(e=>Number.isFinite(e.duration)&&e.duration>0));await page.click('#stop');
  const invalid=await page.evaluate(async()=>{const clip=api.r.getAudioClip('p2-fixture/audio/0');return (await fetch(new URL(clip.src,location.href),{headers:{Range:'bytes=999999999-'}})).status;});assert.equal(invalid,416);
  await page.evaluate(()=>api.d.deleteAudioCache());assert.equal((await page.evaluate(()=>api.d.audioCacheUsage())).files,0);await context.close();console.log('PASS native M4A playback/seek and installed-SW offline reopen/range 206/416');checks++;
  console.log(`PASS audio contract: ${checks} scenarios`);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
