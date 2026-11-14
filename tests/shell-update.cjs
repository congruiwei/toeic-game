// Static buildless assets served as successive releases at the same project scope.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {chromium,devices}=require('playwright');
const root=path.resolve(__dirname,'..');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
(async()=>{
 let release=1;
 const server=http.createServer(async(req,res)=>{
   const pathname=new URL(req.url,'http://localhost').pathname.replace(/^\/island\//,'');
   const file=path.resolve(root,pathname||'index.html');
   if(!file.startsWith(root+path.sep)){res.writeHead(404);return res.end();}
   try{
     let body=await fs.readFile(file);
     if(path.basename(file)==='sw.js')body=body.toString().replace(/(const CACHE\s*=\s*['"])toeic-island-shell-[^'"]+/,(_,prefix)=>prefix+'toeic-island-shell-test-'+release);
     if(path.basename(file)==='index.html')body=body.toString().replace('<head>','<head><meta name="test-shell-release" content="'+release+'">');
     res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(body);
   }catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,...(process.env.PW_CHANNEL?{channel:process.env.PW_CHANNEL}:{}),...(process.env.PW_EXECUTABLE?{executablePath:process.env.PW_EXECUTABLE}:{})});
 try{
 const ctx=await browser.newContext({...devices['iPhone 13'],viewport:{width:390,height:844}});
 const url='http://127.0.0.1:'+server.address().port+'/island/';
 const key='sprout-isle.save';
 const visit=async()=>{const p=await ctx.newPage();await p.goto(url);await p.locator('.habitat').waitFor();return p;};
 const installedWaiting=async p=>{
   const until=Date.now()+20000;
   while(Date.now()<until){
     if(await p.evaluate(async()=>(await navigator.serviceWorker.ready).waiting?.state==='installed'))return;
     await new Promise(r=>setTimeout(r,100));
   }
   throw Error('Updated worker never reached the real installed/waiting state.');
 };
 const version=p=>p.locator('meta[name="test-shell-release"]').getAttribute('content');
 const hasVersion=(p,v)=>p.waitForFunction(value=>document.querySelector('meta[name="test-shell-release"]')?.content===String(value),v,{timeout:20000});
 const state=p=>p.evaluate(k=>JSON.parse(localStorage.getItem(k)),key);
 const initial=await visit();await initial.evaluate(async()=>{await navigator.serviceWorker.ready;});
 await initial.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
 await initial.locator('[data-act="start"][data-mode="vocab"]:visible').first().click();
 await initial.locator('[data-act="answer"]').first().click();
 const saved=await state(initial);assert.ok(saved.xp>0&&saved.session.selected!==null);
 await initial.close();
 release=2;
 const cold=await visit();await hasVersion(cold,2);await cold.locator('.habitat').waitFor();
 let resumed=await state(cold);assert.equal(resumed.xp,saved.xp);assert.deepEqual(resumed.session,saved.session);
 console.log('PASS: single online cold open adopted version 2; XP and answered item retained.');
 await ctx.setOffline(true);await cold.close();
 const offline=await visit();assert.equal(await version(offline),'2');assert.deepEqual((await state(offline)).session,saved.session);
 await offline.locator('[data-act="resume"]:visible').first().click();await offline.locator('.lesson-feedback').waitFor();
 await ctx.setOffline(false);
 let navigations=0;offline.on('framenavigated',frame=>{if(frame===offline.mainFrame())navigations++;});
 release=3;
 // Detect an update while a real answered exercise is open. Installer must wait.
 await offline.evaluate(async()=>{const r=await navigator.serviceWorker.ready;await r.update();});
 await installedWaiting(offline);
 assert.equal(await version(offline),'2');assert.equal(navigations,0);
 console.log('PASS: offline relaunch and resume; background update does not interrupt practice.');
 const next=await visit();await hasVersion(next,3);await next.locator('.habitat').waitFor();
 assert.equal(navigations,0);await offline.locator('.lesson-feedback').waitFor();
 assert.deepEqual((await state(next)).session,saved.session);
 console.log('PASS: another cold window activates the update without reloading the live exercise.');
 await offline.close();
 await next.locator('#mobile-nav [data-page="learn"]').click();
 await next.locator('[data-act="exam-lobby"]:visible').first().click();
 // Reading mode is persisted by the ordinary exam validator and restored via the real lobby.
 await next.evaluate(async()=>{
   const {bank,loadBank}=await import('./js/bank.js');const {buildExam}=await import('./js/exam.js');
   await loadBank(['part1','part2','listening','grammar','reading']);
   const key='sprout-isle.save',s=JSON.parse(localStorage.getItem(key));s.exam=buildExam(bank,s,'half','upgrading');
   s.exam.phase='reading';s.exam.unit=s.exam.units.findIndex(u=>u.part===5);s.exam.remaining=600000;
   localStorage.setItem(key,JSON.stringify(s));
 });
 await next.reload();await next.locator('.habitat').waitFor();await next.locator('#mobile-nav [data-page="learn"]').click();
 await next.locator('[data-act="exam-lobby"]:visible').first().click();await next.locator('[data-act="exam-resume"]').click();
 await next.locator('#exam-clock').waitFor();const examId=(await state(next)).exam.units[0].ids[0];
 release=4;await next.evaluate(async()=>{await(await navigator.serviceWorker.ready).update();});
 await installedWaiting(next);
 assert.equal(await version(next),'3');assert.equal((await state(next)).exam.phase,'reading');assert.equal((await state(next)).exam.units[0].ids[0],examId);
 const final=await visit();await hasVersion(final,4);await final.locator('.habitat').waitFor();
 await next.locator('#exam-clock').waitFor();assert.equal(await version(next),'3');
 assert.equal((await state(final)).exam.units[0].ids[0],examId);
 console.log('PASS: live timed exam keeps its task and timer as a newer cold window activates the next shell.');
 await ctx.close();
 }finally{await browser.close();server.close();}
})().catch(err=>{console.error(err);process.exitCode=1;});
