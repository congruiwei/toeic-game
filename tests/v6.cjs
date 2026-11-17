// Run one feature by name or omit names to exercise all available v6 scenarios.
const { chromium, webkit, devices } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {tmpdir} = require('node:os');
const { createServer } = require('node:http');
const root = path.resolve(__dirname, '..');
const mime = {'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};

async function run() {
  const features = process.argv.slice(2);
  if (!features.length) features.push(...(await fs.readdir(path.join(__dirname,'v6'))).filter(f=>f.endsWith('.cjs')).sort().map(f=>f.slice(0,-4)));
  const server = createServer(async (req,res) => {
    const name = decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/island\//,'') || 'index.html';
    if(name==='test-blank'){res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><title>Fixture</title>');return;}
    const file = path.resolve(root,name);
    if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
    try { const body = await fs.readFile(file); res.writeHead(200,{'Content-Type':mime[path.extname(file)] || 'text/plain'}).end(body); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url = 'http://127.0.0.1:'+server.address().port+'/island/';
  let browser;
  try {
    const engine=process.env.PW_ENGINE==='webkit'?webkit:chromium;
    if(engine===chromium)browser = await engine.launch({headless:true,...(process.env.PW_CHANNEL?{channel:process.env.PW_CHANNEL}:{})});
    for (const feature of features) for (const width of [375,390,430]) {
      const options={...devices['iPhone 13'],viewport:{width,height:844},colorScheme:width===390?'dark':'light',serviceWorkers:'block'};
      // This WebKit build drops CacheStorage when the last connection in an
      // ephemeral context closes on reload. A fresh persistent profile tests
      // normal Safari storage while keeping every scenario isolated.
      const profile=engine===webkit?await fs.mkdtemp(path.join(tmpdir(),'toeic-webkit-')):null;
      let context;
      try {
        context=profile?await engine.launchPersistentContext(profile,{headless:true,...options}):await browser.newContext(options);
        await context.addInitScript(()=>{
          const list=[...['en-US','en-GB','en-AU','en-CA'].map((lang,i)=>({lang,name:['Ava Premium','Daniel Enhanced','Karen','Claire'][i],voiceURI:lang})),
            {lang:'ja-JP',name:'Kyoko Enhanced',voiceURI:'com.apple.voice.enhanced.ja-JP.Kyoko'},
            {lang:'ja-JP',name:'Otoya Premium',voiceURI:'com.apple.voice.premium.ja-JP.Otoya'},
            {lang:'ja-JP',name:'Japanese Bad News',voiceURI:'test.ja-JP.bad-news'}];
          let generation=0;window.played=[];window.spoken=[];window.speechGestures=[];
          Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class {constructor(text){this.text=text;}}});
          // WebKit may return another native wrapper on a later property read.
          // Keep one stable fake speech API; media playback has its own native tests.
          Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>list,cancel:()=>generation++,speak:u=>{
            const ticket=generation;window.played.push(u.text);
            window.spoken.push({text:u.text,lang:u.lang,voice:u.voice?.name,rate:u.rate});
            // window.event is restored after the click callback returns; userActivation
            // alone lasts too long to catch an await before native speak().
            window.speechGestures.push({type:window.event?.type,trusted:window.event?.isTrusted,active:navigator.userActivation?.isActive});
            u.onstart?.();
            setTimeout(()=>{if(ticket===generation)u.onend?.();},35);
          }}});
        });
        const page=await context.newPage(), errors=[];
        page.on('pageerror',e=>errors.push(e.message)); page.setDefaultTimeout(6500);
        const ready=()=>page.locator('.habitat').waitFor();
        const act=a=>page.locator('[data-act="'+a+'"]:visible').first().click();
        const nav=p=>page.locator('#mobile-nav [data-page="'+p+'"]').click();
        const state=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('sprout-isle.save')));
        async function store(s) {
          await page.goto(url+'test-blank');
          // These scenarios mock native speech to verify the system fallback.
          // Generated audio and its default preference have their own suite.
          await page.evaluate(async v=>{
            if(!v){localStorage.clear();v=(await import('./js/state.js')).fresh();}
            v.settings.audioMode='system';localStorage.setItem('sprout-isle.save',JSON.stringify(v));
          },s||null);
          await page.goto(url);await ready();
        }
        const reset=()=>store(null);
        async function quiz(mode,filter='',format='') {
          await nav('learn');
          await page.locator('[data-act=configure][data-mode="'+mode+'"]').click();
          if(filter)await page.locator('#mode-filter').selectOption(filter);
          if(format)await page.locator('#vocab-format').selectOption(format);
          await act('configured');
          if(await page.locator('[data-act=replace]').isVisible())await act('replace');
          await page.locator('.lesson-shell').waitFor();
          if(await page.locator('[data-act=begin]').isVisible())await act('begin');
        }
        await page.goto(url);await ready();
        const progress=await state();
        if(feature!=='methods')progress.settings.methodHints=false;
        await store(progress);
        await require('./v6/'+feature+'.cjs')({page,context,width,act,nav,state,store,reset,quiz,url});
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');
        assert.deepEqual(errors,[]);
        console.log('PASS '+feature+' at '+width+'px');
      } finally { await context?.close();if(profile)await fs.rm(profile,{recursive:true,force:true}); }
    }
  } finally { await browser?.close(); await new Promise(r=>server.close(r)); }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
