// Repeatable cold-load measurement; run from the repository root.
const {chromium, devices} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const {gzipSync} = require('node:zlib');
const gzip = process.env.PW_GZIP === '1';
const path = require('node:path');
const {createServer} = require('node:http');
const root = path.resolve(__dirname, '..');
const mime = {'.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};

(async () => {
  const server = createServer(async (request, response) => {
    let name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (name === '/') name = '/index.html';
    const file = path.resolve(root, '.' + name);
    if (!file.startsWith(root + path.sep)) { response.writeHead(404).end(); return; }
    try {
      const body = await fs.readFile(file);
      response.setHeader('Content-Type', mime[path.extname(file)] || 'text/html');
      if(gzip && /\.(?:html|js|json|css|svg|webmanifest)$/.test(file) && request.headers['accept-encoding']?.includes('gzip')){
        response.setHeader('Content-Encoding','gzip');
        response.end(gzipSync(body));
      }else response.end(body);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const rows = [];
  try {
    browser = await chromium.launch({headless:true, ...(process.env.PW_CHANNEL ? {channel:process.env.PW_CHANNEL} : {})});
    for (let i = 0; i < 5; i++) {
      const context = await browser.newContext({...devices['iPhone 13'], serviceWorkers:'block'});
      try {
        const page = await context.newPage(), cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', {offline:false, latency:80, downloadThroughput:250000, uploadThroughput:125000});
        const requests = [];
        page.on('request', request => requests.push(request.url()));
        if(gzip)await page.addInitScript(()=>{
          window.studyTimings={};
          document.addEventListener('click',event=>{
            if(event.target.closest('[data-act=configured]'))window.studyTimings.click=performance.now();
          },true);
          new MutationObserver(()=>{
            if(!window.studyTimings.home && document.querySelector('.habitat'))window.studyTimings.home=performance.now();
            if(window.studyTimings.click && !window.studyTimings.first && document.querySelector('.lesson-option'))
              window.studyTimings.first=performance.now()-window.studyTimings.click;
          }).observe(document,{subtree:true,childList:true});
        });
        let start = Date.now();
        await page.goto('http://127.0.0.1:' + server.address().port);
        await page.locator('.habitat').waitFor();
        const home = Date.now() - start;
        const homeAudioRequests=requests.filter(url=>url.includes('/data/audio/')||url.includes('/audio/generated/')).length;
        await page.locator('#mobile-nav [data-page=learn]').click();
        await page.locator('[data-act=configure][data-mode=vocab]').click();
        start = Date.now();
        await page.locator('[data-act=configured]').click();
        await page.locator('.lesson-option').first().waitFor();
        const timings=gzip?await page.evaluate(()=>window.studyTimings):{home,first:Date.now()-start};
        const optionalRequests = requests.filter(url =>
          /\/assets\/vocab\/|\/audio\/generated\/|\/data\/(?:methods|vocab-art|vocab-humor|confusables)\.json(?:\?|$)/.test(url));
        assert.deepEqual(optionalRequests, [], 'opening a vocabulary question must leave unneeded lesson content unloaded');
        rows.push({home:Math.round(timings.home),first:Math.round(timings.first), translations:requests.filter(url=>url.includes('/i18n/')).length,
          homeAudioRequests,
          vocabPictures:requests.filter(url=>url.includes('/assets/vocab/')||url.endsWith('/data/vocab-art.json')).length,
          humorPacks:requests.filter(url=>url.endsWith('/vocab-humor.json')).length,
          fullComparisonPacks:requests.filter(url=>url.endsWith('/data/confusables.json')).length,
          optionPacks:requests.filter(url=>url.includes('/data/options/')).length,
          audioFiles:requests.filter(url=>url.includes('/audio/generated/')).length});
      } finally { await context.close(); }
    }
    console.log(JSON.stringify({network:'2 Mbps down / 1 Mbps up / 80 ms latency, cold cache, SW blocked'+(gzip?', gzip, DOM insertion':''), rows,
      median:{home:rows.map(row=>row.home).sort((a,b)=>a-b)[2], first:rows.map(row=>row.first).sort((a,b)=>a-b)[2]}}, null, 2));
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode=1; });
