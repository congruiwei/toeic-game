// Run from the repository root: NODE_PATH=/path/to/node_modules node tests/e2e.cjs
const {chromium,devices}=require('playwright');
const assert=require('node:assert/strict');
const {createServer}=require('node:http');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const root=path.resolve(__dirname,'..'), mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.webmanifest':'application/manifest+json'};
async function main(){
 const server=createServer(async(req,res)=>{
   const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/island\//,'')||'index.html';
   const file=path.resolve(root,name);
   if(!file.startsWith(root+path.sep)){res.writeHead(404);return res.end();}
   try{const body=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'text/plain'});res.end(body);}
   catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let browser;const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'island-e2e-'));
 try{
 browser=await chromium.launch({headless:true,...(process.env.PW_CHANNEL?{channel:process.env.PW_CHANNEL}:{})});
 const context=await browser.newContext({...devices['iPhone 13'],viewport:{width:375,height:812},acceptDownloads:true});
 await context.addInitScript(()=>{
   const api=window.speechSynthesis;if(!api)return;
   const list=['en-US','en-GB','en-AU','en-CA'].map((lang,i)=>({lang,name:['Ava Premium','Daniel Enhanced','Karen','Claire'][i],voiceURI:lang}));
   let gen=0;
   Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class {constructor(text){this.text=text;}}});
   Object.defineProperties(api,{
     getVoices:{value:()=>list},cancel:{value:()=>gen++},
     speak:{value:u=>{const g=gen;window.played ||= [];window.played.push(u.text);u.onstart?.();setTimeout(()=>{if(g===gen)u.onend?.();},25);}}
   });
 });
 const page=await context.newPage();page.setDefaultTimeout(8000);const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const url='http://127.0.0.1:'+server.address().port+'/island/';
 const action=(a)=>page.locator('[data-act="'+a+'"]:visible').first().click();
 const nav=p=>page.locator('#mobile-nav [data-page="'+p+'"]').click();
 const state=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('sprout-isle.save')));
 const ready=()=>page.locator('.habitat').waitFor();
 await page.goto(url);await ready();
 for(const width of [375,390,430]){await page.setViewportSize({width,height:812});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await page.setViewportSize({width:375,height:812});console.log('PASS home at 375/390/430px');
 await action('settings');await page.locator('[data-pref=methodHints]').uncheck();await page.locator('[data-voice-slot=B]').selectOption('en-GB');
 await page.locator('#voice-controls summary').click();await action('preview-voice');assert((await state()).settings.voiceSlots.B==='en-GB');await action('close');
 console.log('PASS manual voice selection and audition');
 async function quiz(mode,filter){
   await nav('learn');await page.locator('[data-act=configure][data-mode='+mode+']').click();
   if(filter)await page.locator('#mode-filter').selectOption(filter);
   await action('configured');const replace=page.locator('[data-act=replace]');if(await replace.isVisible())await replace.click();
   await page.locator('.lesson-shell').waitFor();
   if(await page.locator('[data-act=begin]').isVisible())await action('begin');
 }
 async function pick(correct){
   const n=await page.evaluate(async ok=>{
     const s=JSON.parse(localStorage.getItem('sprout-isle.save')).session;
     const {question}=await import('./js/bank.js');const q=question(s.items[s.index]);
     return q.options.findIndex(o=>(o===q.answer)===ok);
   },correct);
   await page.locator('[data-act=answer][data-i="'+n+'"]').click();
   await page.locator('.lesson-feedback').waitFor();
 }
 for(const [mode,f] of [['vocab',''],['grammar',''],['part1',''],['part2','first'],['part2','response'],['dialogue','3'],['dialogue','4'],['dictation',''],['reading','6'],['reading','7']]){
   await quiz(mode,f);
   if(mode==='part1'){
     const img=page.locator('.lesson-photo img');await img.waitFor();assert(await img.evaluate(el=>el.complete&&el.naturalWidth>0));
     assert.match(await page.locator('.lesson-option').first().innerText(),/选择 A/);
   }
   if(['part1','part2','dialogue','dictation'].includes(mode))await action('play');
   if(mode==='dictation'){await page.locator('#dict-input').fill('incorrect');await action('submit-dict');}else await pick(mode!=='part1');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await action('leave');
 }
 console.log('PASS vocabulary, diagrams, illustrated Part 1, Parts 2–7, dictation and mobile layout');
 await nav('library');await page.locator('[data-act=library-tab][data-tab=errors]').click();assert(await page.locator('[data-act=review-one]').count()>=2);
 await nav('report');assert.match(await page.locator('#app').innerText(),/7 天|7天|近 7|近7/);
 console.log('PASS mistake book and learning report');
 await action('settings');const downloading=page.waitForEvent('download');await action('export');const downloaded=await downloading;const backup=path.join(tmp,'backup.json');await downloaded.saveAs(backup);
 const before=await state();await page.locator('#import-file').setInputFiles(backup);await action('restore');assert.equal((await state()).xp,before.xp);
 console.log('PASS JSON export and import');
 await nav('learn');await action('exam-lobby');await page.locator('[data-act=exam-start][data-size=full]').click();
 await page.locator('#exam-audio-status').waitFor();assert.equal((await state()).exam.units.flatMap(u=>u.ids).length,200);
 await action('exam-choice');await action('exam-leave');const saved=(await state()).exam;assert(Object.keys(saved.answers).length===1);
 await page.reload();await ready();await nav('learn');await action('exam-lobby');await action('exam-resume');assert((await state()).exam.step>=saved.step);
 await action('exam-leave');console.log('PASS full exam creation, checkpoint, interruption and resume');
 // Fast-forward only the passage cursor in the fixture; exercise the real playback-to-reading transition.
 await page.evaluate(()=>{const k='sprout-isle.save',s=JSON.parse(localStorage.getItem(k)),e=s.exam;
   e.unit=e.units.findLastIndex(u=>u.part===4);e.step=0;e.wait=0;e.focus=null;localStorage.setItem(k,JSON.stringify(s));});
 await page.reload();await ready();await nav('learn');await action('exam-lobby');await page.clock.install();await action('exam-resume');
 for(let i=0;i<55;i++){if((await state()).exam.phase==='reading')break;await page.clock.runFor(1000);}
 assert.equal((await state()).exam.phase,'reading');await page.locator('#exam-jump').selectOption('8');await action('exam-choice');
 await action('exam-leave');const remain=(await state()).exam.remaining;await page.clock.runFor(3000);await action('exam-resume');assert((await state()).exam.remaining<=remain);
 await action('exam-submit');await action('exam-confirm');await page.getByRole('heading',{name:'模考成绩'}).waitFor();assert.equal((await state()).exam.phase,'done');
 const misses=Object.keys((await state()).errors).length;assert(misses>=198);
 await action('exam-lobby');await page.locator('[data-act=exam-start][data-size=half]').click();assert.equal((await state()).exam.units.flatMap(u=>u.ids).length,100);await action('exam-leave');
 console.log('PASS continuous listening, timed reading, jumps, score, per-item timing, exam errors and half exam');
 await page.evaluate(()=>{const k='sprout-isle.save',s=JSON.parse(localStorage.getItem(k)),e=s.exam;e.phase='reading';e.unit=e.units.findIndex(u=>u.part===5);e.remaining=120;e.deadline=0;e.step=0;e.wait=0;e.cursor=0;localStorage.setItem(k,JSON.stringify(s));});
 await page.reload();await ready();await nav('learn');await action('exam-lobby');await action('exam-resume');await page.clock.runFor(1600);
 assert.equal((await state()).exam.phase,'done');assert.equal((await state()).exam.remaining,0);console.log('PASS reading deadline auto-submits exactly once');
 
 await nav('home');await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);await context.setOffline(true);await page.reload();await ready();
 await quiz('part1','');await page.waitForFunction(()=>document.querySelector('.lesson-photo img')?.naturalWidth>0);await pick(true);
 assert.deepEqual(errors,[]);console.log('PASS offline reopen, offline illustration and saved answer; zero uncaught page errors');
 }finally{await browser?.close();await new Promise(r=>server.close(r));await fs.rm(tmp,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1});
