// One real pointer down/up spans a deliberately late optional image response.
// No synthetic click, retries, or preallocated C-class image space.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createServer } = require('node:http');
const { webkit, chromium, devices } = require('playwright');

const root = process.env.ART_STABILITY_ROOT || path.resolve(__dirname, '..');
const engine = process.env.PW_ENGINE || 'webkit';
const browserType = { webkit, chromium }[engine];
const output = process.env.ART_STABILITY_REPORT?.trim();
const widths = (process.env.ART_STABILITY_WIDTHS || '375,390,430').split(',').map(Number);
const mime = {
  '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json'
};
const cases = [
  { view: 'answer', target: 'humor', gate: 'index' },
  { view: 'library', target: 'word', gate: 'index' },
  { view: 'library', target: 'humor', gate: 'index' },
  { view: 'screen', target: 'humor', gate: 'index' },
  { view: 'answer', target: 'humor', gate: 'svg' },
  { view: 'answer', target: 'humor', gate: 'index', id: 'v-deadline', class: 'B' },
  { view: 'answer', target: 'humor', gate: 'index', id: 'v-valuable', class: 'C' }
];

function responseGate(kind, id) {
  let release, started;
  const wait = new Promise(resolve => { release = resolve; });
  const start = new Promise(resolve => { started = resolve; });
  return { kind, id, wait, start, release, started };
}

function fixtureServer(state) {
  return createServer(async (request, response) => {
    try {
      const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
        .replace(/^\/island\//, '') || 'index.html';
      if (name === 'blank') {
        response.writeHead(200, { 'Content-Type': 'text/html' })
          .end('<!doctype html><title>Fixture</title>');
        return;
      }
      const file = path.resolve(root, name);
      if (!file.startsWith(root + path.sep)) throw Error('path');
      const gate = state.gate;
      const held = gate && (
        gate.kind === 'index' && name === 'data/vocab-art.json'
        || gate.kind === 'svg' && name === `assets/vocab/${gate.id}.svg`
      );
      if (held) {
        gate.started();
        await gate.wait;
      }
      const body = await fs.readFile(file);
      response.writeHead(200, {
        'Content-Type': mime[path.extname(file)] || 'text/plain',
        'Cache-Control': 'no-store'
      }).end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
}

function installBrowserProbe() {
  window.artClickTrace = [];
  window.played = [];
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    value: class { constructor(text) { this.text = text; } }
  });
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: {
      getVoices: () => [
        { lang: 'en-US', name: 'Ava', voiceURI: 'en' },
        { lang: 'ja-JP', name: 'Kyoko', voiceURI: 'ja' }
      ],
      cancel() {},
      speak(utterance) {
        window.played.push(utterance.text);
        utterance.onstart?.();
        setTimeout(() => utterance.onend?.(), 5);
      }
    }
  });
  for (const type of ['pointerdown', 'pointerup', 'click']) {
    document.addEventListener(type, event => {
      window.artClickTrace.push({
        type, trusted: event.isTrusted, tag: event.target.tagName,
        action: event.target.closest('[data-act]')?.dataset.act,
        summary: !!event.target.closest('summary'),
        x: event.clientX, y: event.clientY
      });
    }, true);
  }
}

async function seedSave(page, url, id, view) {
  await page.goto(url + 'blank');
  await page.evaluate(async ({ id, view }) => {
    const save = (await import('./js/state.js')).fresh();
    Object.assign(save.settings, {
      audioMode: 'system', sound: false, motion: false, methodHints: false
    });
    save.words[id] = { box: 0, right: 1, tries: 1, due: 0 };
    if (view === 'answer') {
      save.session = {
        mode: 'vocab', title: '延迟图片测试',
        items: [{ id, mode: 'vocab', format: 'cloze' }],
        index: 0, right: 0, gain: 0, selected: null,
        elapsed: 0, timed: false, intro: false
      };
    }
    if (view === 'screen') {
      save.screening = {
        marks: {
          'v-crate': 'unconfirmed', 'v-invoice': 'unconfirmed', 'v-forklift': 'learn'
        },
        run: {
          ids: ['v-crate', 'v-invoice', 'v-forklift', 'v-valuable'],
          index: 3, claims: 3, known: 2, unknown: 1,
          checks: 1, correct: 0, pending: false,
          feedback: { id: 'v-forklift', selected: '__isle_unknown__' }
        }
      };
    }
    localStorage.setItem('sprout-isle.save', JSON.stringify(save));
  }, { id, view });
  await page.goto(url);
  await page.locator('.habitat').waitFor();
}

async function openCard(page, id, view, artRequests) {
  if (view === 'answer') {
    await page.locator('[data-act=resume]').first().click();
    await page.locator('.lesson-question').waitFor();
    assert.equal(await page.locator('[data-vocab-art]').count(), 0, 'no art slot before answer');
    assert.equal(artRequests.length, 0);
    await page.locator('[data-act=unknown]').click();
    return page.locator('.lesson-word-note');
  }
  if (view === 'library') {
    await page.locator('#mobile-nav [data-page=library]').click();
    const item = page.locator('.lib-card').filter({
      has: page.locator(`[data-word-study-id="${id}"]`)
    });
    if (!await item.evaluate(element => element.open)) {
      await item.locator(':scope > summary').click();
    }
    return page.locator(`[data-word-study-id="${id}"]`);
  }
  await page.locator('#mobile-nav [data-page=learn]').click();
  await page.locator('[data-act=screen-open]').click();
  return page.locator('[data-screen-feedback]');
}

const twoFrames = page => page.evaluate(() => new Promise(resolve => {
  requestAnimationFrame(() => requestAnimationFrame(resolve));
}));
const imageFor = (scope, id) => scope
  .locator(`[data-vocab-art="${id}"]:not(.vocab-art-small) img`).first();

async function decodedImage(page, image) {
  await page.waitForFunction(element => element.complete && element.naturalWidth > 0,
    await image.elementHandle());
  await image.evaluate(element => element.decode());
}

async function gateRequested(gate) {
  let timer;
  try {
    await Promise.race([
      gate.start,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('image gate not requested')), 10000);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function observeHydration(page, scope, id, spec, artRequests) {
  if (spec.class === 'C') {
    await page.waitForFunction(() => performance.getEntriesByType('resource')
      .some(resource => resource.name.endsWith('/data/vocab-art.json')));
    await twoFrames(page);
    assert.equal(await scope.locator('.vocab-art img').count(), 0);
    assert.equal(await scope.locator('.vocab-art').evaluate(element =>
      getComputedStyle(element).display), 'none');
    assert(!artRequests.some(url => url.includes('/' + id + '.svg')));
    return;
  }
  const image = imageFor(scope, id);
  await image.waitFor({ state: 'attached' });
  if (spec.gate === 'svg') await decodedImage(page, image);
  await twoFrames(page);
}

async function singlePress(page, scope, id, spec, gate, state, artRequests) {
  await scope.locator('.word-humor blockquote').waitFor();
  const target = spec.target === 'word'
    ? scope.locator(`[data-act=read-aloud][data-key="${id}/meaning"]`)
    : scope.locator('.word-humor summary');
  await page.evaluate(() => document.fonts.ready);
  await target.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await twoFrames(page);
  await gateRequested(gate);

  const original = await target.elementHandle();
  const before = await target.boundingBox();
  const beforeScroll = await page.evaluate(() => scrollY);
  assert(before);
  assert(await target.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(
      rect.x + rect.width / 2, rect.y + rect.height / 2));
  }), 'original pointer point must actually hit the target');

  // Keep this order: press once, release the HTTP response, observe layout, then
  // release the same pointer at its original coordinates. Never retry the click.
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  const pressed = await target.boundingBox();
  gate.release();
  state.gate = null;
  await observeHydration(page, scope, id, spec, artRequests);
  const after = await target.boundingBox();
  const afterScroll = await page.evaluate(() => scrollY);
  await page.mouse.up();

  const same = await target.evaluate((element, old) => element === old, original);
  const delta = Math.round((after.y - before.y) * 10) / 10;
  const documentDelta = Math.round((after.y + afterScroll - pressed.y - beforeScroll) * 10) / 10;
  await twoFrames(page);
  const activated = spec.target === 'word'
    ? await page.evaluate(() => window.played.includes('forklift'))
    : await target.evaluate(element => element.closest('details').open);
  const events = await page.evaluate(() => window.artClickTrace.slice(-3));

  if (spec.class !== 'C') {
    const image = imageFor(scope, id);
    await image.scrollIntoViewIfNeeded();
    await decodedImage(page, image);
    assert(await image.evaluate(element => element.naturalWidth > 0), 'A/B remains visible and decodes');
  }
  assert(same, 'the control node must be retained');
  assert(Math.abs(documentDelta) < 1,
    'late optional art must not move the already-pressed control (the existing button active style translates 1px)');
  assert(activated, 'one original pointer press must activate the control');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  return { delta, documentDelta, beforeScroll, afterScroll, same, activated, events };
}

async function runCase(browser, url, width, spec, state) {
  const id = spec.id || 'v-forklift';
  const gate = responseGate(spec.gate, id);
  state.gate = gate;
  const context = await browser.newContext({
    ...devices['iPhone 13'], viewport: { width, height: 844 },
    colorScheme: width === 390 ? 'dark' : 'light', serviceWorkers: 'block'
  });
  try {
    await context.addInitScript(installBrowserProbe);
    const page = await context.newPage();
    const errors = [], artRequests = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.url().includes('/assets/vocab/')) artRequests.push(request.url());
    });
    await seedSave(page, url, id, spec.view);
    const scope = await openCard(page, id, spec.view, artRequests);
    const result = await singlePress(page, scope, id, spec, gate, state, artRequests);
    assert.deepEqual(errors, []);
    return { engine, width, ...spec, id, ...result, errors };
  } catch (error) {
    error.message = `[${engine} ${width}px ${spec.view}/${spec.target}/${spec.gate} ${id}] ${error.message}`;
    throw error;
  } finally {
    gate.release();
    state.gate = null;
    await context.close();
  }
}

async function run() {
  if (!browserType) throw Error('PW_ENGINE must be chromium or webkit');
  const state = { gate: null };
  const server = fixtureServer(state);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/island/`;
  let browser;
  try {
    browser = await browserType.launch({
      headless: true,
      ...(engine === 'chromium' && process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {})
    });
    const rows = [];
    for (const width of widths) {
      for (const spec of cases) rows.push(await runCase(browser, url, width, spec, state));
    }
    // Normal test runs need no writable report directory. Traces are opt-in.
    if (output) {
      await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
      await fs.writeFile(output, JSON.stringify(rows, null, 2) + '\n');
    }
    console.log('PASS', rows.length, 'single-press cases');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
