// Run one feature by name or omit names to exercise all available v6 scenarios.
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createServer } = require('node:http');
const root = path.resolve(__dirname, '..');
const mime = {'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};

async function run() {
  const features = process.argv.slice(2);
  if (!features.length) features.push(...(await fs.readdir(path.join(__dirname,'v6'))).filter(f=>f.endsWith('.cjs')).sort().map(f=>f.slice(0,-4)));
  const server = createServer(async (req,res) => {
    const name = decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/island\//,'') || 'index.html';
    const file = path.resolve(root,name);
    if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
    try { const body = await fs.readFile(file); res.writeHead(200,{'Content-Type':mime[path.extname(file)] || 'text/plain'}).end(body); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url = 'http://127.0.0.1:'+server.address().port+'/island/';
  let browser;
  try {
    browser = await chromium.launch({headless:true,...(process.env.PW_CHANNEL?{channel:process.env.PW_CHANNEL}:{})});
    for (const feature of features) for (const width of [375,390,430]) {
      const context = await browser.newContext({...devices['iPhone 13'],viewport:{width,height:844},colorScheme:width===390?'dark':'light',serviceWorkers:'block'});
      try {
        await context.addInitScript(()=>{
          const api=window.speechSynthesis;
          const list=['en-US','en-GB','en-AU','en-CA'].map((lang,i)=>({lang,name:['Ava Premium','Daniel Enhanced','Karen','Claire'][i],voiceURI:lang}));
          let generation=0;window.played=[];
          Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class {constructor(text){this.text=text;}}});
          Object.defineProperties(api,{getVoices:{value:()=>list},cancel:{value:()=>generation++},speak:{value:u=>{
            const ticket=generation;window.played.push(u.text);u.onstart?.();
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
          await page.goto(url+'manifest.webmanifest');
          await page.evaluate(v=>v?localStorage.setItem('sprout-isle.save',JSON.stringify(v)):localStorage.clear(),s||null);
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
        await require('./v6/'+feature+'.cjs')({page,context,width,act,nav,state,store,reset,quiz,url});
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');
        assert.deepEqual(errors,[]);
        console.log('PASS '+feature+' at '+width+'px');
      } finally { await context.close(); }
    }
  } finally { await browser?.close(); await new Promise(r=>server.close(r)); }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
