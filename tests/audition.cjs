// Standalone audition QA: run only after local audio generation has finished.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {createServer}=require('node:http');
const {chromium,devices}=require('playwright');
const root=path.resolve(__dirname,'..');
const SAVE='sprout-isle.save',PREFS='toeic-island-audition-v1';
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json',
  '.svg':'image/svg+xml','.png':'image/png','.m4a':'audio/mp4','.webmanifest':'application/manifest+json'};

function controlsMock() {
  const states=new WeakMap(),active=new Set();
  const state=element=>{if(!states.has(element))states.set(element,{paused:true,time:0,ended:false});return states.get(element);};
  window.auditionProbe={plays:[],pauses:[],speeches:[],cancels:0,failNext:false,maxActive:0};
  const probe=window.auditionProbe;
  Object.defineProperties(HTMLMediaElement.prototype,{
    paused:{configurable:true,get(){return state(this).paused;}},
    ended:{configurable:true,get(){return state(this).ended;}},
    currentTime:{configurable:true,get(){return state(this).time;},set(value){state(this).time=value;}},
    duration:{configurable:true,get(){return 12;}},
    readyState:{configurable:true,get(){return 4;}},
    load:{configurable:true,value(){state(this).time=0;state(this).ended=false;}},
    pause:{configurable:true,value(){state(this).paused=true;active.delete(this);probe.pauses.push(this.src);this.dispatchEvent(new Event('pause'));}},
    play:{configurable:true,value(){
      probe.plays.push({src:this.src,rate:this.playbackRate,trusted:window.event?.isTrusted,type:window.event?.type});
      if(probe.failNext){probe.failNext=false;return Promise.reject(new DOMException('Injected media failure','NotSupportedError'));}
      state(this).paused=false;state(this).ended=false;active.add(this);probe.maxActive=Math.max(probe.maxActive,active.size);
      this.dispatchEvent(new Event('loadedmetadata'));this.dispatchEvent(new Event('play'));this.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    }}
  });
  window.auditionEnd=()=>{const audio=document.querySelector('#audition-audio');state(audio).paused=true;state(audio).ended=true;active.delete(audio);audio.dispatchEvent(new Event('ended'));};
  const voices=[{name:'Kyoko Enhanced',lang:'ja-JP',voiceURI:'test-ja-kyoko',localService:true},
    {name:'Otoya Premium',lang:'ja-JP',voiceURI:'test-ja-otoya',localService:true},
    {name:'Ava',lang:'en-US',voiceURI:'test-en-ava',localService:true}];
  Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:class{constructor(text){this.text=text;}}});
  Object.defineProperties(window.speechSynthesis,{
    getVoices:{configurable:true,value:()=>voices},
    cancel:{configurable:true,value:()=>{probe.cancels++;}},
    speak:{configurable:true,value:utterance=>{
      probe.speeches.push({text:utterance.text,lang:utterance.lang,voice:utterance.voice?.voiceURI,rate:utterance.rate,
        trusted:window.event?.isTrusted,type:window.event?.type,active:navigator.userActivation?.isActive});
      utterance.onstart?.();
    }}
  });
}

async function checkControls(browser,url,source,manifest,width) {
  const context=await browser.newContext({...devices['iPhone 13'],viewport:{width,height:844},
    colorScheme:width===390?'dark':'light',serviceWorkers:'block'});
  const original='{"auditionGuard":true,"payload":"keep the main save byte-for-byte"}';
  await context.addInitScript(controlsMock);
  await context.addInitScript(({key,value})=>{if(localStorage.getItem(key)===null)localStorage.setItem(key,value);},{key:SAVE,value:original});
  const page=await context.newPage(),errors=[],audioRequests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(/\/audio\/audition\//.test(request.url()))audioRequests.push(request.url());});
  page.setDefaultTimeout(7000);
  const tab=async language=>page.locator(`[data-act=audition-tab][data-tab="${language}"]`).click();
  const status=expected=>page.waitForFunction(value=>document.querySelector('#audition-status')?.dataset.state===value,expected);
  const probe=()=>page.evaluate(()=>window.auditionProbe);
  const play=voice=>page.locator(`[data-act=audition-play][data-voice="${voice}"]`).click();
  const intact=async()=>assert.equal(await page.evaluate(key=>localStorage.getItem(key),SAVE),original,'main-game save must stay byte-for-byte unchanged');
  const noOverflow=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');
  try {
    await page.goto(url+'audition.html');await page.locator('#audition-en-voice').waitFor();
    assert.equal(await page.locator('audio').count(),1,'one shared media element');
    assert.equal(await page.locator('#audition-audio').getAttribute('preload'),'none');
    assert.equal(audioRequests.length,0,'first render must not fetch any audio');
    assert.equal((await probe()).plays.length,0);assert.equal((await probe()).speeches.length,0);
    await noOverflow();await intact();
    const english=source.voices.filter(voice=>voice.lang.startsWith('en-')),japanese=source.voices.filter(voice=>voice.lang==='ja-JP');
    const first=english[0].id,second=english[1].id,third=english[2].id;
    await page.selectOption('#audition-en-voice',first);await play(first);await status('playing');
    const a=await probe();assert.equal(a.plays.length,1);assert.equal(a.maxActive,1);
    await page.selectOption('#audition-en-voice',second);
    assert(await page.locator('#audition-audio').evaluate(audio=>audio.paused),'switching voices cancels the old audio');
    await play(second);await status('playing');assert.equal((await probe()).plays.length,2);
    assert.notEqual((await probe()).plays.at(-1).src,a.plays[0].src);
    await page.locator('#audition-rate').evaluate(input=>{input.value='0.85';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
    assert.equal(await page.locator('#audition-audio').evaluate(audio=>audio.playbackRate),.85);
    await page.locator('#audition-audio').evaluate(audio=>{audio.currentTime=2;});
    await page.locator('#audition-pause').click();await status('paused');
    assert(await page.locator('#audition-audio').evaluate(audio=>audio.paused));
    await page.locator('#audition-pause').click();await status('playing');
    assert.equal(await page.locator('#audition-audio').evaluate(audio=>audio.currentTime),2);
    await page.locator('#audition-replay').click();await status('playing');
    assert.equal(await page.locator('#audition-audio').evaluate(audio=>audio.currentTime),0);
    assert.equal((await probe()).plays.at(-1).rate,.85);
    await page.evaluate(()=>{window.auditionProbe.failNext=true;});
    await page.locator('#audition-replay').click();await status('error');
    assert((await page.locator('#audition-status').textContent()).trim());
    await page.locator('#audition-replay').click();await status('playing');
    const oldPlays=(await probe()).plays.length;
    await page.locator('[data-act=audition-segment][data-language=en][data-index="0"]').click();
    await status('playing');assert.equal((await probe()).plays.length,oldPlays+1);
    assert.equal(await page.locator('audio').count(),1);
    assert.equal((await probe()).maxActive,1);

    const dialogue=source.samples.find(sample=>sample.kind==='part3');
    await page.selectOption('#audition-pair-a',first);await page.selectOption('#audition-pair-b',second);
    await page.locator('#audition-pair-play').click();await status('playing');
    assert((await probe()).plays.at(-1).src.endsWith(manifest.clips[first][dialogue.id].segments[0].src.slice(1)));
    const playingCount=(await probe()).plays.length;
    assert.equal(await page.locator('#audition-audio').evaluate(audio=>audio.ended),false);
    await page.locator('#audition-audio').evaluate(audio=>audio.dispatchEvent(new Event('ended')));
    assert.equal((await probe()).plays.length,playingCount,'a stale ended event cannot advance a new dialogue while audio.ended is false');
    assert.equal(await page.locator('#audition-status').getAttribute('data-state'),'playing','a stale ended event cannot terminate the active playback');
    assert.equal(await page.locator('#audition-audio').evaluate(audio=>audio.paused),false);
    await page.evaluate(()=>window.auditionEnd());await status('playing');
    assert((await probe()).plays.at(-1).src.endsWith(manifest.clips[second][dialogue.id].segments[1].src.slice(1)));
    const beforeCancel=(await probe()).plays.length;
    await page.selectOption('#audition-en-voice',third);await page.evaluate(()=>window.auditionEnd());
    assert.equal((await probe()).plays.length,beforeCancel,'a canceled dialogue does not start its next queued sentence');
    assert.equal((await probe()).maxActive,1);

    await page.locator(`[data-act=audition-favorite][data-voice="${first}"]`).click();
    await page.locator(`[data-act=audition-favorite][data-voice="${second}"]`).click();
    await page.locator(`[data-act=audition-favorite][data-voice="${third}"]`).click();
    await tab('ja');await noOverflow();
    assert(await page.locator('#audition-audio').evaluate(audio=>audio.paused),'changing tabs stops the previous English clip');
    await page.selectOption('#audition-ja-voice',japanese[0].id);await play(japanese[0].id);await status('playing');
    await page.locator(`[data-act=audition-ja-pick][data-kind=kokoro][data-voice="${japanese[0].id}"]`).click();
    const system=page.locator('#audition-system-voice');
    const options=await system.locator('option').evaluateAll(nodes=>nodes.map(node=>({value:node.value,text:node.textContent})));
    assert(options.some(option=>option.value==='test-ja-kyoko'));
    assert(!options.some(option=>option.value==='test-en-ava'),'Japanese system selector excludes English voices');
    await system.selectOption('test-ja-kyoko');
    await page.locator('#audition-system-play').click();
    const speech=(await probe()).speeches.at(-1);
    assert(speech,'system voice playback starts');assert.equal(speech.voice,'test-ja-kyoko');assert.equal(speech.lang,'ja-JP');
    assert.equal(speech.text,source.samples.find(sample=>sample.language==='ja').segments.map(segment=>segment.spoken||segment.text).join('\n'));
    assert.equal(speech.type,'click');assert.equal(speech.trusted,true);assert.equal(speech.active,true);
    assert(await page.locator('#audition-audio').evaluate(audio=>audio.paused),'system speech stops generated audio');
    const beforeVoiceChange=(await probe()).cancels;
    await system.selectOption('test-ja-otoya');assert((await probe()).cancels>beforeVoiceChange);
    await system.selectOption('test-ja-kyoko');
    await page.locator('[data-act=audition-ja-pick][data-kind=system]').click();
    await tab('selection');await noOverflow();
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('clipboard denied');}}}));
    await page.locator('#audition-copy').click();
    const fallback=page.locator('#audition-copy-fallback');await fallback.waitFor();
    const copied=await fallback.inputValue();assert(copied.trim());
    assert(copied.includes(first)||copied.includes(english[0].name));
    assert(copied.includes(second)||copied.includes(english[1].name));
    assert(copied.includes(third)||copied.includes(english[2].name));
    assert(copied.includes('Kyoko')||copied.includes('test-ja-kyoko'));
    assert(await fallback.evaluate(element=>element.selectionStart===0&&element.selectionEnd===element.value.length));
    const stored=await page.evaluate(key=>localStorage.getItem(key),PREFS);assert(stored,'audition preferences are saved separately');
    await intact();await page.reload();await page.locator('#audition-en-voice').waitFor();
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),PREFS),stored,'audition choices survive reload');
    await intact();await noOverflow();
    assert.deepEqual(errors,[]);
    console.log(`PASS audition controls at ${width}px${width===390?' (dark)':''}`);
  } finally {await context.close();}
}

async function checkNativeMedia(browser,url,source,manifest) {
  const context=await browser.newContext({...devices['iPhone 13'],viewport:{width:390,height:844},serviceWorkers:'allow'});
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);
  page.on('pageerror',error=>errors.push(error.message));
  try {
    await page.goto(url);await page.locator('.habitat').waitFor();
    await page.evaluate(()=>Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('Service worker installation timed out')),20000))]));
    await page.waitForFunction(()=>navigator.serviceWorker.controller);
    const audioRequests=[];page.on('request',request=>{if(/\/audio\/audition\//.test(request.url()))audioRequests.push(request.url());});
    await page.goto(url+'audition.html');await page.locator('#audition-en-voice').waitFor();
    const original=await page.evaluate(key=>localStorage.getItem(key),SAVE);
    assert.equal(audioRequests.length,0,'installed SW navigation still opens audition without preloading audio');
    const initialCached=await page.evaluate(async()=>{
      const keys=await caches.keys();return (await Promise.all(keys.map(async key=>(await (await caches.open(key)).keys()).map(request=>request.url)))).flat();
    });
    assert(!initialCached.some(value=>/\/audio\/audition\//.test(value)),'the main PWA install does not precache audition audio');
    for(const language of ['en','ja']) {
      if(language==='ja')await page.locator('[data-act=audition-tab][data-tab=ja]').click();
      const voice=source.voices.find(value=>language==='ja'?value.lang==='ja-JP':value.lang.startsWith('en-'));
      const sample=source.samples.find(value=>value.language===language),clip=manifest.clips[voice.id][sample.id];
      await page.selectOption(`#audition-${language}-voice`,voice.id);
      await page.selectOption(`#audition-${language}-sample`,sample.id);
      await page.locator(`[data-act=audition-play][data-voice="${voice.id}"]`).click();
      await page.waitForFunction(()=>{const audio=document.querySelector('#audition-audio');return audio&&Number.isFinite(audio.duration)&&audio.duration>0&&!audio.paused&&audio.currentTime>.08;});
      const actual=await page.locator('#audition-audio').evaluate(audio=>({duration:audio.duration,error:audio.error?.message||null,src:audio.currentSrc}));
      assert.equal(actual.error,null);assert(actual.src.endsWith(clip.src.slice(1)));
      assert(Math.abs(actual.duration-clip.duration)<.25,`native duration ${actual.duration} differs from manifest ${clip.duration}`);
      await page.locator('#audition-pause').click();
      console.log(`PASS native M4A metadata/playback ${voice.id}/${sample.id} (${actual.duration.toFixed(2)}s)`);
    }
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),SAVE),original,'audition does not change the installed game save');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
    console.log('PASS installed service-worker audition navigation');
  } finally {await context.close();}
}


async function checkLegacyWorker(browser,url,setWorker,currentCache) {
  const context=await browser.newContext({...devices['iPhone 13'],viewport:{width:390,height:844},serviceWorkers:'allow'});
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(30000);
  page.on('pageerror',error=>errors.push(error.message));
  try {
    setWorker('legacy');
    await page.goto(url);await page.locator('.habitat').waitFor();
    await page.evaluate(()=>Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('Legacy worker installation timed out')),20000))]));
    await page.waitForFunction(()=>navigator.serviceWorker.controller);
    assert((await page.evaluate(()=>caches.keys())).includes('toeic-island-shell-34'));
    await page.evaluate(key=>{
      const saved=JSON.parse(localStorage.getItem(key));saved.xp=84;saved.stats.vocab=84;
      saved.words['v-available']={box:1,due:Date.now()+86400000,right:2,tries:2};
      localStorage.setItem(key,JSON.stringify(saved));
    },SAVE);
    // Reload while version 34 is still served so the in-memory game sees the fixture.
    await page.reload();await page.locator('.habitat').waitFor();
    const before=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),SAVE);
    setWorker('current');
    // One user navigation. No test-triggered registration.update, skipWaiting or reload.
    await page.goto(url+'audition.html');
    await page.locator('#audition-en-voice').waitFor({timeout:40000});
    assert.equal(page.url(),url+'audition.html');
    await page.waitForFunction(cache=>caches.keys().then(keys=>keys.includes(cache)&&!keys.includes('toeic-island-shell-34')),currentCache,{timeout:30000});
    const after=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),SAVE);
    for(const field of ['xp','stats','words','history','errors','seen','session','exam'])assert.deepEqual(after[field],before[field],field+' survives automatic legacy-shell upgrade');
    assert.equal(await page.locator('.habitat').count(),0,'the old navigation fallback cannot leave audition showing the game home');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
    console.log('PASS legacy shell-34 → '+currentCache+' audition navigation after one open (progress preserved)');
  } finally {setWorker('current');await context.close();}
}

async function run() {
  const {loadAuditionInputs,validateAudition,auditionSummary}=await import(pathToFileURL(path.join(root,'scripts/validate-audition.mjs')).href);
  const inputs=await loadAuditionInputs(root),validation=await validateAudition(inputs);
  assert.deepEqual(validation.errors,[]);console.log(auditionSummary(validation));
  // One in-memory corruption fixture checks rejection paths without touching source/audio files.
  const invalid={...inputs,source:structuredClone(inputs.source),manifest:structuredClone(inputs.manifest)};
  invalid.manifest.complete=false;
  invalid.manifest.generation={...invalid.manifest.generation,sourceSha256:'0'.repeat(64)};
  invalid.source.voices.push(structuredClone(invalid.source.voices[0]));
  invalid.source.samples.push(structuredClone(invalid.source.samples[0]));
  invalid.source.voices[1].grade='A';invalid.source.voices[1].gender='male';
  invalid.source.voices=invalid.source.voices.filter(voice=>voice.id!=='bm_george');
  invalid.source.samples[1].segments[0].text+=' changed';
  invalid.source.samples[2].segments[0].key='not-a-source/turns/0/0';
  const voiceId=inputs.source.voices[0].id,sampleId=inputs.source.samples.find(sample=>sample.language==='en').id;
  const brokenClip=invalid.manifest.clips[voiceId][sampleId];
  brokenClip.src='../outside.m4a';brokenClip.duration=0;brokenClip.segments[0].bytes++;
  const vocabId=inputs.source.samples.find(sample=>sample.kind==='vocab').id;
  invalid.manifest.clips[voiceId][vocabId].segments[0].sha256='0'.repeat(64);
  invalid.manifest.totals={...validation.stats,voices:validation.stats.voices,samples:validation.stats.clips,files:validation.stats.files+1};
  const rejected=await validateAudition(invalid),messages=rejected.errors.map(error=>error.message).join('\n');
  for(const expected of ['Duplicate voice ID','Duplicate sample ID','Quality grade disagrees','language, group or gender',
    'Text differs','not present in sourceUnits','Audio path must remain','Duration must be','bytes do not match',
    'Each English group requires 2–3','Repeated audio src has conflicting','SHA-256 does not match','Total disagrees',
    'not marked complete','different source JSON byte hash'])assert(messages.includes(expected),expected);
  console.log('PASS audition validator rejects incomplete/stale generation, duplicate IDs, source drift, group limits, unsafe paths, hash drift and inconsistent totals');
  // Published shell-34 baseline from commit 7c8fb5b, checked in so ZIP/shallow clones work.
  const legacyWorker=await fs.readFile(path.join(root,'tests/fixtures/sw-shell-34.txt'),'utf8');
  const currentCache=(await fs.readFile(path.join(root,'sw.js'),'utf8')).match(/const CACHE = '([^']+)'/)[1];
  let worker='current';
  const server=createServer(async(request,response)=>{
    const name=decodeURIComponent(new URL(request.url,'http://localhost').pathname).replace(/^\/island\//,'')||'index.html';
    if(name==='sw.js'&&worker==='legacy'){response.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'}).end(legacyWorker);return;}
    const filename=path.resolve(root,name);
    if(!filename.startsWith(root+path.sep)){response.writeHead(404).end();return;}
    try{
      const info=await fs.stat(filename),type=mime[path.extname(filename)]||'application/octet-stream';
      const range=request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if(range){const start=Number(range[1]),end=Math.min(range[2]?Number(range[2]):info.size-1,info.size-1);
        if(start>end){response.writeHead(416,{'Content-Range':`bytes */${info.size}`}).end();return;}
        const handle=await fs.open(filename,'r');try{const buffer=Buffer.alloc(end-start+1);await handle.read(buffer,0,buffer.length,start);response.writeHead(206,{'Content-Type':type,'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${info.size}`,'Content-Length':buffer.length}).end(buffer);}finally{await handle.close();}
      }else response.writeHead(200,{'Content-Type':type,'Accept-Ranges':'bytes','Content-Length':info.size}).end(await fs.readFile(filename));
    }catch{response.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/island/`;let browser;
  try{
    browser=await chromium.launch({headless:true,...(process.env.PW_CHANNEL?{channel:process.env.PW_CHANNEL}:{})});
    for(const width of [375,390,430])await checkControls(browser,url,inputs.source,inputs.manifest,width);
    await checkNativeMedia(browser,url,inputs.source,inputs.manifest);
    await checkLegacyWorker(browser,url,value=>{worker=value;},currentCache);
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
