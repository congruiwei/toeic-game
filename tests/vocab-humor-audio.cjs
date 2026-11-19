// Real app + real current M4A bytes. Speech is only observed to detect fallback;
// HTMLMediaElement.play/load/decoding retain their native browser behavior.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createServer } = require('node:http');
const { chromium, webkit, devices } = require('playwright');

const root = path.resolve(__dirname, '..');
// An optional staging audio tree supports preparation before publication. A
// normal invocation reads runtime, text, metadata, and media from this checkout.
const audioRoot = path.resolve(process.env.VOCAB_HUMOR_AUDIO_ROOT || root);
const engine = process.env.PW_ENGINE || 'chromium';
const browserType = { chromium, webkit }[engine];
const id = 'v-available', key = id + '/humor/0';
const mime = {
  '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.m4a': 'audio/mp4'
};
const sha256 = body => createHash('sha256').update(body).digest('hex');

async function currentClips() {
  const manifest = JSON.parse(await fs.readFile(path.join(audioRoot, 'data/audio/manifest.json'), 'utf8'));
  const clips = {};
  for (const language of ['en', 'ja']) {
    const record = manifest.packs.find(pack => pack.bank === 'vocab' && pack.language === language);
    assert(record, `${language} vocabulary pack must be in the current manifest`);
    const bytes = await fs.readFile(path.join(audioRoot, record.src));
    assert.equal(sha256(bytes), record.sha256, `${language} metadata must match its manifest SHA`);
    const pack = JSON.parse(bytes);
    assert.equal(pack.bank, 'vocab');
    assert.equal(pack.language, language);
    const clip = pack.clips[key];
    assert(clip, `${language} ${key} needs a published recording; no fixture substitution`);
    assert(!pack.fallbacks?.[key], 'a recording cannot simultaneously be a system fallback');
    const textFile = language === 'en' ? 'data/vocab-humor.json' : 'data/i18n/ja/vocab-humor.json';
    const source = JSON.parse(await fs.readFile(path.join(root, textFile), 'utf8')).entries[key];
    assert.equal(clip.text, source, `${language} recording must belong to the current displayed sentence`);
    const media = await fs.readFile(path.join(audioRoot, clip.src));
    assert.equal(sha256(media), clip.sha256, `${language} current M4A must match its metadata SHA`);
    assert.equal(media.length, clip.bytes);
    assert(Number.isFinite(clip.duration) && clip.duration > 0);
    clips[language] = clip;
  }
  return clips;
}

function installProbe() {
  window.humorAudioProbe = { plays: [], playing: [], speeches: [] };
  const nativePlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    humorAudioProbe.plays.push({
      src: this.src, trusted: window.event?.isTrusted, type: window.event?.type
    });
    return nativePlay.call(this);
  };
  document.addEventListener('playing', event => {
    if (event.target instanceof HTMLMediaElement) {
      humorAudioProbe.playing.push({ src: event.target.currentSrc, duration: event.target.duration });
    }
  }, true);
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    value: class { constructor(text) { this.text = text; } }
  });
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: {
      getVoices: () => [
        { name: 'Ava', voiceURI: 'test-en', lang: 'en-US' },
        { name: 'Kyoko', voiceURI: 'test-ja', lang: 'ja-JP' }
      ],
      cancel() {},
      speak(utterance) {
        humorAudioProbe.speeches.push({ text: utterance.text, lang: utterance.lang });
        utterance.onstart?.();
        setTimeout(() => utterance.onend?.(), 10);
      }
    }
  });
}

function serve(clips, serverErrors) {
  const expected = new Map(Object.values(clips).map(clip => [clip.src.replace(/^\.\//, ''), clip.sha256]));
  return createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (!pathname.startsWith('/island/')) {
        response.writeHead(404).end();
        return;
      }
      const name = decodeURIComponent(pathname).slice('/island/'.length) || 'index.html';
      if (name === 'test-blank') {
        response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Fixture setup</title>');
        return;
      }
      const base = name.startsWith('data/audio/') || name.startsWith('audio/generated/') ? audioRoot : root;
      const file = path.resolve(base, name);
      if (!file.startsWith(base + path.sep)) throw Error('path');
      const body = await fs.readFile(file);
      if (expected.has(name)) assert.equal(sha256(body), expected.get(name), 'served media changed after manifest validation');
      const headers = {
        'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
        'Content-Length': body.length, 'Cache-Control': 'no-store'
      };
      if (request.headers.range) {
        const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range);
        assert(range, 'expected one native byte range');
        const start = Number(range[1]);
        const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
        if (start >= body.length || end < start) {
          response.writeHead(416, { 'Content-Range': `bytes */${body.length}` }).end();
          return;
        }
        response.writeHead(206, {
          ...headers, 'Content-Length': end - start + 1,
          'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Accept-Ranges': 'bytes'
        }).end(body.subarray(start, end + 1));
      } else response.writeHead(200, headers).end(body);
    } catch (error) {
      if (error.code !== 'ENOENT') serverErrors.push(error.message);
      response.writeHead(404).end();
    }
  });
}

async function seed(page, url) {
  await page.goto(url + 'test-blank');
  await page.evaluate(async id => {
    const save = (await import('./js/state.js')).fresh();
    Object.assign(save.settings, {
      audioMode: 'recorded', sound: false, motion: false, methodHints: false,
      translationLanguage: 'both', translationExpanded: false, audioGapMs: 0
    });
    save.session = {
      mode: 'vocab', title: '趣句录音回归',
      items: [{ id, mode: 'vocab', format: 'cloze' }],
      index: 0, right: 0, gain: 0, elapsed: 0, selected: null, intro: false, timed: false
    };
    localStorage.setItem('sprout-isle.save', JSON.stringify(save));
  }, id);
  await page.goto(url);
  await page.locator('.habitat').waitFor();
  await page.locator('[data-act=resume]').first().click();
  await page.locator('.lesson-question').waitFor();
}

async function verifyPlay(page, button, clip, url, requests, responses) {
  const src = new URL(clip.src, url).href;
  const before = await page.evaluate(() => ({
    plays: humorAudioProbe.plays.length, playing: humorAudioProbe.playing.length
  }));
  await button.click();
  await page.waitForFunction(({ src, count }) => {
    const audio = document.querySelector('#recorded-audio-player');
    return audio?.currentSrc === src && audio.currentTime > .1
      && humorAudioProbe.playing.length > count;
  }, { src, count: before.playing });
  const observed = await page.evaluate(() => {
    const audio = document.querySelector('#recorded-audio-player');
    return {
      src: audio.currentSrc, duration: audio.duration,
      currentTime: audio.currentTime, error: audio.error?.code, probe: humorAudioProbe
    };
  });
  assert.equal(observed.src, src);
  assert.equal(observed.error, undefined);
  assert(Math.abs(observed.duration - clip.duration) < .2, 'native decoder duration must match the current clip');
  assert(observed.currentTime > .1, 'native playback must actually advance');
  assert(observed.probe.plays.slice(before.plays).some(play => play.trusted && play.type === 'click'),
    'the user click must synchronously play the clip or unlock native audio before metadata loading');
  assert.equal(observed.probe.speeches.length, 0, 'no Web Speech fallback');
  assert(requests.includes(src), 'the displayed sentence must request its exact current M4A');
  assert(responses.some(response => response.url === src && [200, 206].includes(response.status)));
  await page.evaluate(async () => { (await import('./js/audio.js')).hush(); });
}

async function scenario(browser, url, width, clips) {
  const context = await browser.newContext({
    ...devices['iPhone 13'], viewport: { width, height: 844 },
    colorScheme: width === 390 ? 'dark' : 'light', serviceWorkers: 'block'
  });
  try {
    await context.addInitScript(installProbe);
    const page = await context.newPage(), errors = [], requests = [], responses = [];
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().endsWith('.m4a')) requests.push(request.url()); });
    page.on('response', response => {
      if (response.url().endsWith('.m4a')) responses.push({ url: response.url(), status: response.status() });
    });
    await seed(page, url);
    assert.equal(requests.length, 0, 'home and unanswered cloze must not download recordings');
    assert.equal(await page.locator('[data-humor-id]').count(), 0, 'no humor sentence or playback entry before answering');
    const questionText = await page.locator('#app').innerText();
    assert(!questionText.includes(clips.en.text));
    assert(!questionText.includes(clips.ja.text));
    assert.equal(await page.evaluate(() => humorAudioProbe.plays.length), 0);
    assert.equal(await page.evaluate(() => humorAudioProbe.speeches.length), 0);

    await page.locator('[data-act=unknown]').click();
    const host = page.locator(`.lesson-word-note [data-humor-id="${id}"]`);
    const english = host.locator(`[data-act=read-aloud][data-key="${key}"]`);
    await english.waitFor();
    assert.equal(await english.getAttribute('data-bank'), 'vocab');
    assert.equal(await english.getAttribute('data-text'), clips.en.text);
    assert.equal(requests.length, 0, 'rendering the answer must not autoplay or preload M4A');
    // No metadata preload: both language paths exercise their real first click.
    await verifyPlay(page, english, clips.en, url, requests, responses);

    await host.locator('.humor-reveal > summary').click();
    const japanese = host.locator('[data-act=humor-ja]');
    await japanese.waitFor();
    assert.equal(await japanese.getAttribute('aria-label'), '朗读日语：' + clips.ja.text);
    assert(!requests.includes(new URL(clips.ja.src, url).href), 'expanding a translation must not autoplay Japanese');
    await verifyPlay(page, japanese, clips.ja, url, requests, responses);
    assert.deepEqual(errors, []);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    console.log(`PASS native humor EN/JA ${width}px${width === 390 ? ' dark' : ''} (${engine})`);
  } finally {
    await context.close();
  }
}

async function run() {
  if (!browserType) throw Error('PW_ENGINE must be chromium or webkit');
  const clips = await currentClips(), serverErrors = [];
  const server = serve(clips, serverErrors);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/island/`;
  let browser;
  try {
    browser = await browserType.launch({
      headless: true,
      ...(engine === 'chromium' && process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {})
    });
    for (const width of [375, 390]) await scenario(browser, url, width, clips);
    assert.deepEqual(serverErrors, []);
    console.log('PASS 4 current-manifest native humor plays; no answer leak or system fallback');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
