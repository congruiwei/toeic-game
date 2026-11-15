import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
const pack = read('../data/i18n/ja/terms.json');

test('all 17 grammar topics and 22 methods have a nonempty Japanese term', () => {
  const grammar = read('../data/grammar.json');
  const methods = read('../data/methods.json');
  assert.equal(grammar.length, 17);
  assert.equal(methods.length, 22);
  assert.equal(pack.version, 1);
  assert.deepEqual(Object.keys(pack.entries).sort(), [...grammar, ...methods].map(item => item.id).sort());
  for (const item of [...grammar, ...methods]) {
    const value = pack.entries[item.id];
    assert.equal(typeof value, 'string', item.id);
    assert(value.trim() && value === value.trim(), item.id);
    assert.notEqual(value, item.title, item.id);
    assert(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value), item.id);
  }
  assert.equal(pack.entries['gram-conditional'], '仮定法過去');
  assert.equal(pack.entries.keywords, 'キーワードの聞き取り');
  assert(!Object.values(pack.entries).some(value => value.includes('定位')));
});

test('loading is opt-in, retries a failure, coalesces calls, and caches the terms for offline reuse', async () => {
  const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
  const cache = new Map();
  let requests = 0, fail = true;
  globalThis.caches = { open: async name => {
    assert.equal(name, 'toeic-island-translations-v1');
    return { put: async (url, response) => cache.set(url, response.clone()), match: async url => cache.get(url)?.clone() };
  } };
  globalThis.fetch = async url => {
    requests++;
    assert.equal(url, './data/i18n/ja/terms.json');
    if (fail) throw Error('offline before first download');
    return new Response(JSON.stringify(pack));
  };
  try {
    const { loadTerms, mountTerms } = await import('../js/japanese-terms.js');
    assert.equal(requests, 0, 'import does not fetch terms or other translation packs');
    assert.equal(await mountTerms({ querySelectorAll: () => [] }), 0);
    assert.equal(requests, 0, 'a page without marked titles stays lazy');
    await assert.rejects(loadTerms(), /尚未下载/);
    fail = false;
    const [first, second] = await Promise.all([loadTerms(), loadTerms()]);
    assert.equal(requests, 2, 'one failed attempt and one shared retry');
    assert.strictEqual(first, second);
    assert.deepEqual(first, pack.entries);
    assert.deepEqual(await cache.get('./data/i18n/ja/terms.json').json(), pack);
    fail = true;
    assert.strictEqual(await loadTerms(), first);
    assert.equal(requests, 2, 'a repeated mount does not download again');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  }
});
