// Real worker lifecycle at a GitHub Pages-style subpath; no app or bank fixtures are rewritten.
// Run: NODE_PATH=/path/to/node_modules PW_CHANNEL=chrome node tests/i18n-offline.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createServer } = require('node:http');
const { chromium, devices } = require('playwright');

const root = path.resolve(__dirname, '..');
const translationCache = 'toeic-island-translations-v1';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json' };

async function main() {
  let release = 1;
  const networkRequests = [];
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname.includes('/data/i18n/')) networkRequests.push(pathname);
    const file = path.resolve(root, pathname.replace(/^\/island\//, '') || 'index.html');
    if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
    try {
      let body = await fs.readFile(file);
      if (path.basename(file) === 'sw.js') {
        body = body.toString().replace(/(const CACHE\s*=\s*['"])toeic-island-shell-[^'"]+/, (_, prefix) =>
          prefix + 'toeic-island-shell-i18n-test-' + release);
      }
      if (path.basename(file) === 'index.html') {
        body = body.toString().replace('<head>', `<head><meta name="test-i18n-release" content="${release}">`);
      }
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store' }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/island/`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true,
      ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
      ...(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {}) });
    for (const width of [375, 390, 430]) {
      release = 1;
      networkRequests.length = 0;
      const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width, height: 844 },
        colorScheme: width === 390 ? 'dark' : 'light', serviceWorkers: 'allow' });
      const errors = [], requestedTranslations = [];
      context.on('request', request => {
        if (request.url().includes('/data/i18n/')) requestedTranslations.push(request.url());
      });
      let page;
      const visit = async () => {
        const opened = await context.newPage();
        opened.setDefaultTimeout(20000);
        opened.on('pageerror', error => errors.push(error.message));
        const response = await opened.goto(url);
        await opened.locator('.habitat').waitFor();
        return { page: opened, response };
      };
      const action = name => page.locator(`[data-act="${name}"]:visible`).first().click();
      const nav = name => page.locator(`#mobile-nav [data-page="${name}"]`).click();
      const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('sprout-isle.save')));
      const panel = () => page.locator('.lesson-feedback > .translations');
      const layout = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      const rows = () => panel().locator('.translation-line').evaluateAll(lines => lines.map(line => ({
        key: line.dataset.translationKey,
        en: line.querySelector('[lang=en]')?.textContent,
        zh: line.querySelector('[lang=zh-CN]')?.textContent,
        ja: line.querySelector('[lang=ja]')?.textContent
      })));
      const cacheSnapshot = () => page.evaluate(async name => {
        const result = [];
        for (const cacheName of await caches.keys()) {
          const cache = await caches.open(cacheName);
          for (const request of await cache.keys()) {
            if (!request.url.includes('/data/i18n/')) continue;
            const response = await cache.match(request);
            const bytes = await response.arrayBuffer();
            const hash = await crypto.subtle.digest('SHA-256', bytes);
            result.push({ cache: cacheName, path: new URL(request.url).pathname,
              hash: [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('') });
          }
        }
        return result.sort((a, b) => a.path.localeCompare(b.path) || a.cache.localeCompare(b.cache));
      }, translationCache);
      const packsIn = snapshot => snapshot.map(item => item.path.replace('/island/data/i18n/', '')).sort();
      const readyWorker = async () => {
        await page.waitForFunction(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          return registration?.active?.state === 'activated' && !!navigator.serviceWorker.controller;
        });
        await page.evaluate(() => navigator.serviceWorker.ready);
      };
      const quiz = async (mode, filter) => {
        await nav('learn');
        await page.locator(`[data-act=configure][data-mode="${mode}"]`).click();
        if (filter) await page.locator('#mode-filter').selectOption(filter);
        await action('configured');
        if (await page.locator('[data-act=replace]').isVisible()) await action('replace');
        await page.locator('.lesson-shell').waitFor();
      };
      try {
        ({ page } = await visit());
        await readyWorker();
        assert.equal(requestedTranslations.length, 0, 'home does not request language packs');
        assert.equal(networkRequests.length, 0, 'worker installation does not prefetch language packs');
        assert.deepEqual(await cacheSnapshot(), [], 'home has no cached translations');
        assert(await layout());

        await action('settings');
        await page.locator('[data-pref=methodHints]').uncheck();
        await action('close');
        await quiz('part2', 'response');
        assert.equal(await page.locator('.translations').count(), 0);
        assert.equal(requestedTranslations.length, 0, 'first live Part 2 question does not request translations');
        assert.deepEqual(await cacheSnapshot(), []);
        await action('unknown');
        assert.equal(requestedTranslations.length, 0, 'answering alone does not download translations');
        await panel().locator('[data-act=translate]').click();
        await panel().locator('.translation-line [lang=ja]').first().waitFor();
        const originalRows = await rows(), saved = await state(), firstCache = await cacheSnapshot();
        assert(originalRows.length >= 4 && originalRows.every(row => row.en && row.zh && row.ja));
        assert.deepEqual([...new Set(networkRequests)].sort(),
          ['/island/data/i18n/ja/part2.json', '/island/data/i18n/zh/part2.json']);
        assert.deepEqual(packsIn(firstCache), ['ja/part2.json', 'zh/part2.json']);
        assert(firstCache.every(item => item.cache === translationCache), 'packs use the persistent translation cache');
        assert(await layout());
        console.log(`PASS i18n ${width}px: no eager packs; Part 2 downloads exactly the requested bilingual pair`);

        await page.close();
        await context.setOffline(true);
        const offline = await visit();
        page = offline.page;
        assert(offline.response.fromServiceWorker(), 'offline cold navigation is served by the real worker');
        await readyWorker();
        assert.deepEqual((await state()).session, saved.session, 'answered session survives a closed page');
        await action('resume');
        await page.locator('.lesson-feedback').waitFor();
        await panel().locator('[data-act=translate]').click();
        await panel().locator('.translation-line [lang=ja]').first().waitFor();
        assert.deepEqual(await rows(), originalRows, 'cold offline module reads the saved bilingual pack');
        assert.deepEqual(await cacheSnapshot(), firstCache);
        console.log(`PASS i18n ${width}px: closed-page offline reopen restores the answer and downloaded translations`);

        await quiz('reading', '7');
        await action('unknown');
        const beforeFailure = (await state()).session;
        await panel().locator('[data-act=translate]').click();
        await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('译文尚未下载'));
        assert.equal(await panel().locator('[data-act=translate]').getAttribute('aria-expanded'), 'false');
        assert.equal(await panel().locator('.translation-line').count(), 0);
        assert.deepEqual(await cacheSnapshot(), firstCache, 'a missing offline pack is not cached as an error');
        assert.deepEqual((await state()).session, beforeFailure, 'a failed download does not change the answer');
        assert.deepEqual(errors, []);

        await context.setOffline(false);
        await panel().locator('[data-act=translate]').click();
        await panel().locator('.translation-line [lang=ja]').first().waitFor();
        assert((await rows()).every(row => row.en && row.zh && row.ja));
        assert.deepEqual((await state()).session, beforeFailure, 'online retry stays on the same answered question');
        const completeCache = await cacheSnapshot();
        assert.deepEqual(packsIn(completeCache), ['ja/part2.json', 'ja/reading.json', 'zh/part2.json', 'zh/reading.json']);
        assert(await layout());
        console.log(`PASS i18n ${width}px: uncached reading reports offline status; same-page online retry succeeds`);

        // Serve a new worker cache name, without modifying any repository file or learning data.
        release = 2;
        await page.evaluate(async () => { await (await navigator.serviceWorker.ready).update(); });
        await page.waitForFunction(async () =>
          (await navigator.serviceWorker.getRegistration())?.waiting?.state === 'installed');
        assert.equal(await page.locator('meta[name=test-i18n-release]').getAttribute('content'), '1');
        await page.close();
        ({ page } = await visit());
        await page.waitForFunction(() => document.querySelector('meta[name=test-i18n-release]')?.content === '2');
        await readyWorker();
        const keys = await page.evaluate(() => caches.keys());
        assert(keys.includes('toeic-island-shell-i18n-test-2'));
        assert(!keys.includes('toeic-island-shell-i18n-test-1'), 'activation removes the previous shell');
        assert.deepEqual(await cacheSnapshot(), completeCache, 'shell activation retains every language pack byte-for-byte');
        assert.deepEqual(errors, []);
        assert(await layout());
        console.log(`PASS i18n ${width}px: real shell activation removes the old shell and preserves all translation packs`);
      } finally { await context.close(); }
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
