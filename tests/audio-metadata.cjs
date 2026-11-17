// Real installed SW regression: only validated metadata may replace an offline pack.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {createServer}=require('node:http'),{chromium,webkit,devices}=require('playwright');
const root=path.resolve(__dirname,'..'),engine=process.env.PW_ENGINE||'chromium',browserType={chromium,webkit}[engine];
if(!browserType)throw Error('PW_ENGINE must be chromium or webkit');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.webmanifest':'application/manifest+json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
function fixture(revision){
 const text=revision===1?'invoice':'updated invoice',sourceSha256=String(revision).repeat(64);
 const pack={version:1,sourceSha256,bank:'vocab',language:'en',complete:true,clips:{'v-test/meaning':{text,language:'en',voiceId:'af_heart',src:'./audio/generated/en/af_heart/'+'a'.repeat(32)+'.m4a',duration:1,bytes:100,sha256:'b'.repeat(64)}}};
 const bytes=JSON.stringify(pack),index={version:1,complete:true,sourceSha256,packs:[{bank:'vocab',language:'en',complete:true,count:1,src:'./data/audio/en/vocab.json',bytes:Buffer.byteLength(bytes),sha256:hash(bytes)}]};
 return {pack,bytes,index,text};
}
(async()=>{
 let revision=1,bad='',serving=false,port,checks=0;
 const server=createServer(async(req,res)=>{try{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/island\//,'')||'index.html',current=fixture(revision);let body,type;
  if(name==='audition.html'){body='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Audio metadata regression</title>';type='text/html';}
  else if(name==='data/audio/manifest.json'){body=JSON.stringify(current.index);type='application/json';}
  else if(name==='data/audio/en/vocab.json'){
   body=bad==='html'?'<!doctype html><title>Temporary hosting error</title>':bad==='hash'?JSON.stringify({...current.pack,unexpected:'valid JSON with the wrong declared hash'}):current.bytes;
   type=bad==='html'?'text/html':'application/json';
  }else{const file=path.resolve(root,name);if(!file.startsWith(root+path.sep))throw Error('path');body=await fs.readFile(file);type=mime[path.extname(file)]||'application/octet-stream';}
  res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'}).end(body);
 }catch{res.writeHead(404).end();}});
 async function start(){await new Promise(resolve=>server.listen(port||0,'127.0.0.1',resolve));port=server.address().port;serving=true;}
 async function stop(){if(!serving)return;await new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.();});serving=false;}
 await start();const url=`http://127.0.0.1:${port}/island/`,browser=await browserType.launch({headless:true,...(engine==='chromium'?{channel:process.env.PW_CHANNEL||'chrome'}:{})});
 const load=page=>page.evaluate(async()=>{
  const api=await import('./js/recorded-audio.js'),pack=await api.loadAudioPack('vocab');
  const cache=await caches.open('toeic-island-audio-meta-v1'),saved=await cache.match(new URL('./data/audio/en/vocab.json',location.href));
  return {text:pack.clips['v-test/meaning'].text,cached:saved?await saved.json():null};
 });
 async function offline(context,value){
  // Playwright WebKit's setOffline blocks even a SW-synthesized Response. Closing
  // this server tests real network loss without disabling that browser's SW.
  if(engine==='webkit'){if(value)await stop();else await start();}
  else await context.setOffline(value);
 }
 try{for(const width of [375,390,430]){
  revision=1;bad='';const context=await browser.newContext({...devices['iPhone 13'],viewport:{width,height:844},colorScheme:width===390?'dark':'light'}),page=await context.newPage(),errors=[],audio=[];
  page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().includes('/audio/generated/'))audio.push(request.url());});
  try{
   await page.goto(url+'audition.html');await page.evaluate(async()=>{await navigator.serviceWorker.register('./sw.js');await navigator.serviceWorker.ready;});
   await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
   assert.equal((await load(page)).text,'invoice');
   for(const mode of ['html','hash']){
    bad=mode;await page.reload();const result=await load(page);
    assert.equal(result.text,'invoice',`${mode} must retain the previous validated pack`);
    assert.deepEqual(result.cached,fixture(1).pack,`${mode} must not overwrite or delete good metadata`);checks++;
   }
   await offline(context,true);await page.reload();assert.equal((await load(page)).text,'invoice');checks++;
   await offline(context,false);bad='';revision=2;await page.reload();const updated=await load(page);
   assert.equal(updated.text,'updated invoice');assert.deepEqual(updated.cached,fixture(2).pack);checks++;
   await offline(context,true);await page.reload();assert.equal((await load(page)).text,'updated invoice');checks++;
   await offline(context,false);assert.deepEqual(errors,[]);assert.equal(audio.length,0,'metadata loading must not preload audio');
   console.log(`PASS audio metadata HTML/hash rejection, offline retention and valid update at ${width}px${width===390?' (dark)':''} [${engine}]`);
  }finally{if(!serving)await start();await context.close();}
 }}finally{await browser.close();await stop();}
 console.log(`PASS audio-metadata: ${checks} scenarios across 3 widths`);
})().catch(error=>{console.error(error);process.exitCode=1;});
