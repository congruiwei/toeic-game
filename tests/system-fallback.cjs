// Private integration fixture: real browser modules/CacheStorage, controlled audio and native TTS facades.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url'),{createServer}=require('node:http');
const {chromium,webkit,devices}=require('playwright');
const engine=process.env.PW_ENGINE||'chromium',type={chromium,webkit}[engine],root=path.resolve(__dirname,'..');
if(!type)throw Error('PW_ENGINE must be chromium or webkit');
const html=`<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Explicit Japanese fallback</title><style>*{box-sizing:border-box}body{margin:16px;font:16px system-ui;overflow-wrap:anywhere}button{min-height:44px;max-width:100%;margin:4px 0;padding:8px 12px;font:inherit}button:disabled{opacity:.5}p{line-height:1.5}progress{max-width:100%}output{display:block}@media(prefers-color-scheme:dark){body{color:#eee;background:#222}}</style><button id="bad">系统后备句</button><button id="good">相同文字的合格录音</button><button id="mixed">混合连续朗读</button><button id="stop">停止</button><output id="status"></output><main id="settings"></main><script type="module">
import * as r from './js/recorded-audio.js';import * as d from './js/audio-downloads.js';import * as j from './js/japanese-audio.js';import * as a from './js/audio.js';import * as settings from './js/audio-settings.js';
window.api={r,d,j,a,settings};window.completed=0;const prefs={audioMode:'recorded',rate:.9,audioGapMs:0,japaneseVoice:'system-ja'},notify=t=>document.querySelector('#status').textContent=t;
const opts={bank:'reading',seed:'read-demo',onEnd(){completed++;}};
document.querySelector('#bad').onclick=()=>j.speakJapanese('返金は明日です。',prefs,notify,{...opts,key:'read-demo/documents/0/text/1'});
document.querySelector('#good').onclick=()=>j.speakJapanese('返金は明日です。',prefs,notify,{...opts,key:'read-other/documents/0/text/0'});
document.querySelector('#mixed').onclick=()=>j.speakJapanese('受付は午前九時です。 返金は明日です。 領収書をお持ちください。',prefs,notify,opts);
document.querySelector('#stop').onclick=a.hush;
if(!location.search.includes('cold'))document.querySelector('#settings').innerHTML=settings.audioSettingsView();
document.addEventListener('click',event=>{const b=event.target.closest('[data-act^=audio-]');if(b)settings.audioSettingsAction(b.dataset.act,b,notify);});
window.ready=location.search.includes('cold')?Promise.resolve():Promise.all([r.loadAudioPack('reading','ja'),settings.mountAudioSettings()]);
</script></html>`;
function mock(){
 const states=new WeakMap(),state=e=>{if(!states.has(e))states.set(e,{paused:true,ended:false});return states.get(e);};window.probe={plays:[],speeches:[]};window.speechPending=[];
 Object.defineProperties(HTMLMediaElement.prototype,{paused:{configurable:true,get(){return state(this).paused;}},ended:{configurable:true,get(){return state(this).ended;}},load:{configurable:true,value(){state(this).ended=false;}},pause:{configurable:true,value(){state(this).paused=true;}},play:{configurable:true,value(){probe.plays.push({src:this.src,trusted:window.event?.isTrusted});state(this).paused=false;state(this).ended=false;this.dispatchEvent(new Event('playing'));return Promise.resolve();}}});
 window.finishMedia=()=>{const e=document.querySelector('audio');state(e).ended=true;state(e).paused=true;e.dispatchEvent(new Event('ended'));};
 window.finishSpeech=()=>speechPending.shift()?.onend?.();
 Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class{constructor(text){this.text=text;}}});
 Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[{name:'Ava',lang:'en-US',voiceURI:'system-en',localService:true},{name:'Kyoko',lang:'ja-JP',voiceURI:'system-ja',localService:true}],cancel(){speechPending=[];},speak(u){speechPending.push(u);probe.speeches.push({text:u.text,lang:u.lang,voice:u.voice?.voiceURI,trusted:window.event?.isTrusted});u.onstart?.();},pause(){},resume(){}}});
}
(async()=>{
 const f=await import(pathToFileURL(path.join(__dirname,'system-fallback-fixtures.mjs')).href);let revision=1,checks=0;
 const server=createServer(async(req,res)=>{try{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/island\//,'');let body,type;
  if(name==='test.html'){body=html;type='text/html';}
  else if(name==='data/audio/manifest.json'){body=JSON.stringify(f.fixture(revision).index);type='application/json';}
  else if(name.startsWith('data/audio/')){const p=f.fixture(revision).packs.find(p=>name===`data/audio/${p.language}/${p.bank}.json`);if(!p)throw Error('missing pack');body=JSON.stringify(p);type='application/json';}
  else if(name===f.goodSrc.slice(2)){body=f.goodBytes;type='audio/mp4';}
  else if(name===f.oldSrc.slice(2)){body=f.oldBytes;type='audio/mp4';}
  else{const file=path.resolve(root,name);if(!file.startsWith(root+path.sep))throw Error('path');body=await fs.readFile(file);type=name.endsWith('.js')?'text/javascript':'application/octet-stream';}
  res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'}).end(body);
 }catch{res.writeHead(404).end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}/island/`;
 try{for(const width of [375,390,430]){
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'isle-fallback-'));
  const context=await type.launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{channel:process.env.PW_CHANNEL||'chrome'}:{}),...devices['iPhone 13'],viewport:{width,height:844},colorScheme:width===390?'dark':'light',serviceWorkers:'block'});
  await context.addInitScript(mock);const page=context.pages()[0]||await context.newPage(),errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',req=>{if(req.url().includes('/audio/generated/'))requests.push(req.url());});
  try{
   revision=1;await page.goto(url+'test.html');await page.evaluate(()=>ready);
   await page.evaluate(async src=>{const cache=await caches.open(api.r.AUDIO_CACHE),url=new URL(src,location.href);await cache.put(url,await fetch(url));},f.oldSrc);
   await page.click('#bad');assert((await page.evaluate(()=>probe.plays.at(-1).src)).endsWith(f.oldSrc.slice(2)));
   await page.click('#stop');revision=2;await page.reload();await page.evaluate(()=>ready);
   const before=requests.length;await page.click('#bad');let probe=await page.evaluate(()=>window.probe);
   assert.equal(probe.plays.length,0,'explicit fallback must not play cached retired media or identical text');assert.equal(probe.speeches.at(-1).text,f.text);assert.equal(probe.speeches.at(-1).lang,'ja-JP');assert.equal(probe.speeches.at(-1).voice,'system-ja');assert.equal(probe.speeches.at(-1).trusted,true);assert.equal(requests.length,before);
   assert(await page.evaluate(async src=>Boolean(await(await caches.open(api.r.AUDIO_CACHE)).match(new URL(src,location.href))),f.oldSrc));
   const saved=await page.evaluate(async()=>{const p=await(await caches.open(api.r.AUDIO_META_CACHE)).match(new URL('./data/audio/ja/reading.json',location.href));return p.json();});assert(saved.fallbacks[f.badKey]);assert.equal(saved.clips[f.badKey],undefined);
   await page.click('#good');assert((await page.evaluate(()=>probe.plays.at(-1).src)).endsWith(f.goodSrc.slice(2)));await page.click('#stop');checks++;
   await page.click('#mixed');const p0=await page.evaluate(()=>probe.plays.length),s0=await page.evaluate(()=>probe.speeches.length);
   await page.evaluate(()=>finishMedia());await page.waitForFunction(n=>probe.speeches.length===n+1,s0);assert.equal((await page.evaluate(()=>probe.speeches.at(-1))).text,f.text);
   assert.equal(await page.evaluate(()=>probe.plays.length),p0);await page.evaluate(()=>finishSpeech());await page.waitForFunction(n=>probe.plays.length===n+1,p0);await page.evaluate(()=>finishMedia());assert.equal(await page.evaluate(()=>completed),1);checks++;
   assert.match(await page.locator('[data-audio-fallbacks]').textContent(),/日语系统语音：1 句/);
   const downloadAt=requests.length;await page.click('[data-group=japanese]');await page.waitForFunction(()=>document.querySelector('[data-audio-progress]').textContent.includes('另有 1 句'));
   assert(!requests.slice(downloadAt).some(src=>src.endsWith(f.oldSrc.slice(2))));assert(requests.slice(downloadAt).some(src=>src.endsWith(f.goodSrc.slice(2))));assert.match(await page.locator('[data-audio-progress]').textContent(),/不包含在下载中/);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks++;
   await page.goto(url+'test.html?cold');await page.waitForFunction(()=>Boolean(window.api));await page.click('#bad');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('请再点一次开始'));
   assert.equal(await page.evaluate(()=>probe.speeches.length),0,'async metadata discovery cannot pretend it retained an iOS speech gesture');assert.equal(await page.evaluate(()=>probe.plays.filter(p=>p.src.endsWith('.m4a')).length),0);
   await page.click('#bad');assert.equal((await page.evaluate(()=>probe.speeches.at(-1))).trusted,true);assert.equal((await page.evaluate(()=>probe.speeches.at(-1))).voice,'system-ja');checks++;
   assert.deepEqual(errors,[]);console.log(`PASS explicit system fallback, mixed queue, settings/download, metadata refresh/cold gesture at ${width}px${width===390?' dark':''} [${engine}]`);
  }finally{await context.close();await fs.rm(profile,{recursive:true,force:true});}
 }}finally{await new Promise(resolve=>server.close(resolve));}
 console.log(`PASS system-fallback: ${checks} scenarios [${engine}]`);
})().catch(error=>{console.error(error);process.exitCode=1;});
