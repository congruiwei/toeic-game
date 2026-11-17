// Real app integration. All source keys keep their text and cast; a small checked-in
// audition clip supplies deterministic bytes for each voice, without generating the full bank.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url'),{createServer}=require('node:http'),{chromium,webkit,devices}=require('playwright');
const engine=process.env.PW_ENGINE||'chromium',browserType={chromium,webkit}[engine];
if(!browserType)throw Error('PW_ENGINE must be chromium or webkit');
const root=path.resolve(__dirname,'..'),digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const voices={en:['af_heart','am_puck','af_bella'],ja:['jf_alpha']},mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.m4a':'audio/mp4'};
const groupHash=s=>[...s].reduce((n,c)=>(Math.imul(n,31)+c.charCodeAt(0))>>>0,0);
function mediaMock(){
 // WebKit may return a fresh native speech wrapper; replace the test facade itself.
 const states=new WeakMap(),state=e=>{if(!states.has(e))states.set(e,{paused:true,ended:false,epoch:0});return states.get(e);};
 const timeout=window.setTimeout.bind(window);window.setTimeout=(fn,ms,...args)=>timeout(fn,ms===5500?12:ms,...args);
 window.audioProbe={plays:[],speeches:[],events:[],autoEnd:false,maxActive:0,requireUnlock:false,unlocked:false};const active=new Set();
 const fetch=window.fetch.bind(window);window.fetch=(input,...args)=>{const src=new URL(typeof input==='string'||input instanceof URL?input:input.url,location.href).href;audioProbe.events.push({type:'fetch',src});return fetch(input,...args).then(response=>{audioProbe.events.push({type:'response',src});return response;});};
 const finish=audio=>{state(audio).ended=true;state(audio).paused=true;active.delete(audio);audio.dispatchEvent(new Event('ended'));};window.finishAudio=()=>{const audio=document.querySelector('#recorded-audio-player');if(audio)finish(audio);};
 Object.defineProperties(HTMLMediaElement.prototype,{
  paused:{configurable:true,get(){return state(this).paused;}},ended:{configurable:true,get(){return state(this).ended;}},
  load:{configurable:true,value(){state(this).epoch++;state(this).ended=false;}},
  pause:{configurable:true,value(){state(this).paused=true;active.delete(this);}},
  play:{configurable:true,value(){const entry=state(this),epoch=entry.epoch,play={type:'play',src:this.src,trusted:window.event?.isTrusted,event:window.event?.type};audioProbe.plays.push(play);audioProbe.events.push(play);if(this.src.startsWith('data:audio/')&&play.trusted)audioProbe.unlocked=true;if(audioProbe.requireUnlock&&this.src.includes('/audio/generated/')&&!audioProbe.unlocked)return Promise.reject(new DOMException('A trusted unlock is required','NotAllowedError'));entry.paused=false;entry.ended=false;active.add(this);audioProbe.maxActive=Math.max(audioProbe.maxActive,active.size);this.dispatchEvent(new Event('playing'));if(audioProbe.autoEnd)timeout(()=>{if(entry.epoch===epoch&&!entry.paused)finish(this);},8);return Promise.resolve();}}
 });
 Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class{constructor(text){this.text=text;}}});
 Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[{name:'Ava',voiceURI:'test-en',lang:'en-US'},{name:'Kyoko',voiceURI:'test-ja',lang:'ja-JP'}],cancel:()=>{},speak:u=>{audioProbe.speeches.push(u.text);u.onstart?.();timeout(()=>u.onend?.(),8);}}});
}
async function fixtures(){
 const {sourceUnits}=await import(pathToFileURL(path.join(root,'js/translation-source.js'))),audition=JSON.parse(await fs.readFile(path.join(root,'data/audio-audition-manifest.json'),'utf8'));
 const sample=Object.values(audition.clips.af_heart)[0],audio=await fs.readFile(path.join(root,sample.src)),sha=digest(audio),sourceSha=digest('audio-app fixture v1'),packs=[];
 for(const bank of ['vocab','part1','part2','grammar','listening','reading','methods']){
  const records=JSON.parse(await fs.readFile(path.join(root,'data/'+bank+'.json'),'utf8')),ja=JSON.parse(await fs.readFile(path.join(root,'data/i18n/ja/'+bank+'.json'),'utf8')).entries;
  const groups=new Map(),speakers=new Map(),dictation=new Map();
  for(const row of records){groups.set(row.id,row.id);if(row.turns)speakers.set(row.id,[...new Set(row.turns.map(t=>t.speaker))].sort());for(const q of row.questions||[])groups.set(q.id,bank==='grammar'?q.id:row.id);if(row.dictation){groups.set(row.dictation.id,row.id);dictation.set(row.dictation.id,row.turns.find(t=>t.text.includes(row.dictation.text))?.speaker||'A');}}
  const units=sourceUnits(bank,records);
  for(const language of ['en','ja']){
   const clips={};for(const unit of units){const text=language==='ja'?ja[unit.key]:unit.text;if(!text)continue;const group=groups.get(unit.id)||unit.id,n=groupHash(group),speaker=unit.speaker||dictation.get(unit.id),people=speakers.get(group)||[],female=n%2?'af_bella':'af_heart',pair=n%4<2?[female,'am_puck']:['am_puck',female];
    const voiceId=language==='ja'?'jf_alpha':bank==='part2'?pair[unit.key.includes('/audio/')?0:1]:speaker&&people.length===2?pair[Math.max(0,people.indexOf(speaker))]:voices.en[(n+(speaker?Math.max(0,people.indexOf(speaker)):0))%3];
    clips[unit.key]={text,language,voiceId,speaker,required:true,src:`./audio/generated/${language}/${voiceId}/${sha.slice(0,32)}.m4a`,duration:sample.duration,bytes:audio.length,sha256:sha};
   }
   packs.push({version:1,sourceSha256:sourceSha,bank,language,complete:true,requiredComplete:true,clips});
  }
 }
 const labels={};for(const voiceId of voices.en)for(const letter of 'ABCD')labels[`labels/${voiceId}/${letter}`]={text:letter+'.',voiceId,language:'en',src:`./audio/generated/en/${voiceId}/${sha.slice(0,32)}.m4a`,duration:sample.duration,bytes:audio.length,sha256:sha};
 packs.push({version:1,sourceSha256:sourceSha,bank:'labels',language:'en',complete:true,clips:labels});
 const terms=JSON.parse(await fs.readFile(path.join(root,'data/i18n/ja/terms.json'),'utf8')).entries;
 packs.push({version:1,sourceSha256:sourceSha,bank:'terms',language:'ja',complete:true,clips:Object.fromEntries(Object.entries(terms).map(([key,text])=>[key,{text,voiceId:'jf_alpha',language:'ja',src:`./audio/generated/ja/jf_alpha/${sha.slice(0,32)}.m4a`,duration:sample.duration,bytes:audio.length,sha256:sha}]))});
 const files=new Map(),entries=[];
 for(const pack of packs){const body=JSON.stringify(pack),src=`./data/audio/${pack.language}/${pack.bank}.json`,count=Object.keys(pack.clips).length,unique=new Set(Object.values(pack.clips).map(c=>c.src)).size;files.set(src.slice(2),body);entries.push({bank:pack.bank,language:pack.language,src,complete:true,requiredComplete:true,count,bytes:Buffer.byteLength(body),sha256:digest(body),duration:sample.duration*unique,audioBytes:audio.length*unique});}
 files.set('data/audio/manifest.json',JSON.stringify({version:1,model:'integration fixture',voices,complete:true,sourceSha256:sourceSha,packs:entries}));return {files,audio};
}
async function freshScreenCase(browser,url,width){
 const context=await browser.newContext({...devices['iPhone 13'],viewport:{width,height:844},colorScheme:width===390?'dark':'light',serviceWorkers:'block'});
 await context.addInitScript(mediaMock);const page=await context.newPage(),errors=[];page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
 let releaseVocab,requestedVocab;const vocabGate=new Promise(resolve=>releaseVocab=resolve),requestStarted=new Promise(resolve=>requestedVocab=resolve);
 await page.route('**/data/vocab.json',async route=>{requestedVocab();await vocabGate;await route.continue();});
 try{
  await page.goto(url+'test-blank');assert.equal(await page.evaluate(()=>localStorage.getItem('sprout-isle.save')),null,'this path must start without any saved progress');
  await page.goto(url);await page.locator('.habitat').waitFor();assert.equal(await page.evaluate(async()=>Boolean((await import('./js/bank.js')).bank.vocab)),false,'fresh home must not load vocab');
  await page.evaluate(()=>{audioProbe.requireUnlock=true;});await page.locator('#mobile-nav [data-page=learn]').click();await requestStarted;
  assert.equal((await page.evaluate(()=>audioProbe)).plays.length,0,'opening the map must not autoplay');
  await page.locator('[data-act=screen-open]').click();
  const waiting=await page.evaluate(()=>audioProbe),unlock=waiting.events.findIndex(event=>event.type==='play'&&event.src.startsWith('data:audio/'));
  assert(unlock>=0,'screen-open must unlock synchronously while the map vocabulary prefetch is still pending');
  assert(!waiting.events.some(event=>event.type==='response'&&new URL(event.src).pathname.endsWith('/data/vocab.json')),'vocab must remain unloaded while the trusted unlock occurs');
  assert.equal(waiting.events[unlock].trusted,true);assert.equal(waiting.events[unlock].event,'click');
  assert.equal(waiting.plays.filter(play=>play.src.includes('/audio/generated/')).length,0,'no word may play before its delayed data arrives');
  assert.equal(waiting.speeches.length,0);assert.equal(await page.locator('[data-act=screen-open]').isDisabled(),true);
  releaseVocab();await page.locator('.screen-card').waitFor();await page.waitForFunction(()=>audioProbe.plays.some(play=>play.src.includes('/audio/generated/')));
  const played=await page.evaluate(async()=>{const s=JSON.parse(localStorage.getItem('sprout-isle.save')),id=s.screening.run.ids[0],{getAudioClip}=await import('./js/recorded-audio.js'),clip=getAudioClip(id+'/meaning',{bank:'vocab'});return {probe:audioProbe,id,text:clip?.text,src:clip&&new URL(clip.src,location.href).href};});
  const vocabResponse=played.probe.events.findIndex(event=>event.type==='response'&&new URL(event.src).pathname.endsWith('/data/vocab.json')),
    metadataFetch=played.probe.events.findIndex(event=>event.type==='fetch'&&new URL(event.src).pathname.endsWith('/data/audio/manifest.json'));
  assert(vocabResponse>unlock&&metadataFetch>unlock,'trusted unlock must precede the delayed vocabulary response and recording metadata fetch');
  assert.equal(await page.locator('.screen-card').getAttribute('data-word'),played.id);assert.equal(await page.locator('.screen-card h2').textContent(),played.text);
  assert.equal(played.probe.plays.at(-1).src,played.src,'the first screened word must use its recorded word clip');assert.equal(played.probe.speeches.length,0,'fresh screening must never fall back to system speech');assert.equal(played.probe.maxActive,1);assert.deepEqual(errors,[]);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'fresh screening horizontal overflow');
  console.log(`PASS app fresh screening trusted unlock before delayed vocab at ${width}px${width===390?' (dark)':''}`);
 }finally{releaseVocab();await context.close();}
}
(async()=>{
 const fixture=await fixtures();let audioDelay=100;
 const server=createServer(async(req,res)=>{try{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/island\//,'')||'index.html';
  if(name==='test-blank'){res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><title>Fixture setup</title>');return;}
  let body,type;if(fixture.files.has(name)){body=fixture.files.get(name);type='application/json';}else if(name.startsWith('audio/generated/')){await new Promise(r=>setTimeout(r,audioDelay));body=fixture.audio;type='audio/mp4';}else{const file=path.resolve(root,name);if(!file.startsWith(root+path.sep))throw Error('path');body=await fs.readFile(file);type=mime[path.extname(file)]||'application/octet-stream';}
  res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(body);
 }catch{res.writeHead(404).end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}/island/`,browser=await browserType.launch({headless:true,...(engine==='chromium'?{channel:process.env.PW_CHANNEL||'chrome'}:{})});
 try{for(const width of [375,390,430]){
  await freshScreenCase(browser,url,width);
  const context=await browser.newContext({...devices['iPhone 13'],viewport:{width,height:844},colorScheme:width===390?'dark':'light',serviceWorkers:'block'});await context.addInitScript(mediaMock);const page=await context.newPage(),errors=[],requests=[];page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/audio/generated/'))requests.push(r.url());});
  const act=name=>page.locator(`[data-act="${name}"]:visible`).first().click(),state=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('sprout-isle.save'))),nav=name=>page.locator(`#mobile-nav [data-page="${name}"]`).click();
  const noOverflow=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&(!document.querySelector('dialog[open]')||document.querySelector('dialog[open]').scrollWidth<=document.querySelector('dialog[open]').clientWidth+1)),'horizontal overflow');
  try{
   await page.goto(url+'test-blank');await page.evaluate(async()=>{const s=(await import('./js/state.js')).fresh();s.settings.audioGapMs=0;s.settings.methodHints=false;localStorage.setItem('sprout-isle.save',JSON.stringify(s));});await page.goto(url);await page.locator('.habitat').waitFor();assert.equal((await state()).settings.audioMode,'recorded');const initial=await state();assert.equal(requests.length,0,'home must not download recordings');
   await act('settings');await page.locator('#audio-downloads').waitFor();assert.equal(await page.locator('[data-pref=audioMode]').inputValue(),'recorded');
   assert.deepEqual(await page.locator('[data-pref=audioMode] option').allTextContents(),['Kokoro 录音（推荐）','系统语音'],'compact playback labels fit the mobile selector');
   assert.equal(await page.locator('[data-act=audio-cancel]').isHidden(),true,'cancel stays hidden when no download is active');await noOverflow();
   audioDelay=600;const firstDownload=page.waitForRequest(request=>request.url().includes('/audio/generated/'));await page.locator('[data-act=audio-download][data-group=listening]').click();await firstDownload;await page.locator('[data-act=audio-cancel]:visible').waitFor();await act('audio-cancel');await page.waitForFunction(()=>document.querySelector('[data-audio-progress]')?.textContent.includes('已取消'));await page.locator('[data-act=audio-cancel]').waitFor({state:'hidden'});assert.equal((await state()).xp,initial.xp);
   audioDelay=70;await page.locator('[data-act=audio-download][data-group=listening]').click();await page.waitForFunction(()=>document.querySelector('[data-audio-progress]')?.textContent.includes('已下载，可离线播放'));await page.waitForFunction(()=>document.querySelector('[data-audio-usage]')?.textContent.includes('3 个文件'));assert.equal(await page.evaluate(async()=>{const cache=await caches.open('toeic-island-audio-v1');return (await cache.keys()).length;}),3);
   await act('audio-delete');await page.waitForFunction(()=>document.querySelector('[data-audio-progress]')?.textContent.includes('已删除下载'));assert.equal(await page.evaluate(async()=>{const cache=await caches.open('toeic-island-audio-v1');return (await cache.keys()).length;}),0);const afterSettings=await state();assert.deepEqual(afterSettings.words,initial.words);assert.deepEqual(afterSettings.history,initial.history);await act('close');console.log(`PASS app recorded settings download/cancel/delete at ${width}px`);
   await nav('learn');await act('exam-lobby');audioDelay=130;await page.locator('[data-act=exam-start][data-size=half]').click();await page.getByRole('heading',{name:'准备模拟考试音频'}).waitFor();assert.equal((await page.evaluate(()=>audioProbe)).plays.length,0,'preparation cannot start listening');assert.equal(await page.locator('[data-act=exam-listen-ready]').count(),0);assert.equal((await state()).exam.remaining,38*60000);await page.locator('progress[aria-label="本套音频下载进度"]').waitFor();await noOverflow();
   await page.locator('[data-act=exam-listen-ready]').waitFor();assert.equal((await page.evaluate(()=>audioProbe)).plays.length,0,'ready waits for the next trusted click');const prepared=await state();await act('exam-listen-ready');await page.locator('#exam-audio-status').waitFor();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('sprout-isle.save')).exam.step>0);assert.equal((await page.evaluate(()=>audioProbe)).plays.at(-1).trusted,true);assert.equal((await page.evaluate(()=>audioProbe)).speeches.length,0);assert.equal(await page.locator('.sentence-panel').count(),0,'no transcript before submission');
   await page.locator('[data-act=exam-choice]').first().click();await act('exam-leave');const left=await state();assert.equal(left.exam.startedAt,prepared.exam.startedAt);assert(left.exam.step>0);assert.equal(await page.locator('audio').evaluate(e=>e.paused),true);const count=(await page.evaluate(()=>audioProbe)).plays.length;
   await act('exam-resume');await page.locator('[data-act=exam-listen-ready]').waitFor();assert.equal((await page.evaluate(()=>audioProbe)).plays.length,count,'resume preparation must not autoplay');await act('exam-listen-ready');await page.waitForFunction(step=>JSON.parse(localStorage.getItem('sprout-isle.save')).exam.step>step,left.exam.step);assert.deepEqual((await state()).exam.answers,left.exam.answers);assert.equal((await state()).exam.unit,left.exam.unit);
   await page.evaluate(()=>{audioProbe.autoEnd=true;finishAudio();});await page.locator('#exam-clock').waitFor({timeout:35000});assert.equal((await page.evaluate(()=>audioProbe)).speeches.length,0,'every listening step and letter cue resolves to a recording');assert.equal((await page.evaluate(()=>audioProbe)).maxActive,1);await noOverflow();
   await page.locator('[data-act=exam-choice]').first().click();await act('exam-submit');await act('exam-confirm');await page.getByRole('heading',{name:'模考成绩',exact:true}).waitFor();assert.equal((await state()).exam.phase,'done');
   await page.evaluate(()=>{audioProbe.autoEnd=false;});await page.getByText('逐题用时与作答',{exact:true}).click();const firstId=(await state()).exam.units[0].ids[0];const firstReview=page.locator('.exam-item-review').filter({has:page.locator(`.translations[data-translation-id="${firstId}"]`)}).first();await firstReview.locator(':scope > summary').click();await firstReview.locator('.sentence-panel > summary').click();const first=firstReview.locator('[data-act=sentence-play]').first();const before=(await page.evaluate(()=>audioProbe)).plays.length;await first.click();await page.waitForFunction(n=>audioProbe.plays.length>n,before);assert.equal(await first.getAttribute('aria-pressed'),'true');assert.equal((await page.evaluate(()=>audioProbe)).speeches.length,0);await first.click();assert.equal(await first.getAttribute('aria-pressed'),'false');await noOverflow();assert.deepEqual(errors,[]);console.log(`PASS app exam preparation/click/resume/submission/replay at ${width}px${width===390?' (dark)':''}`);
  }finally{await context.close();}
 }}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
 console.log('PASS audio-app: 9 integrated scenarios across 3 widths');
})().catch(error=>{console.error(error);process.exitCode=1;});
