import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const code = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const scope = 'https://example.test/toeic-game/';

test('A home-screen installation opens the review page under a project path, including offline revisits', async () => {
  const handlers = new Map();
  const stores = new Map();
  let online = true;
  const caches = {async open(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      async match(request) {return store.get(request.url || request)?.clone();},
      async put(request,response) {store.set(request.url || request,response.clone());}
    };
  }};
  const self = {registration: {scope}, addEventListener(name,handler) {handlers.set(name,handler);}};
  vm.runInNewContext(code, {self, caches, URL, Response, AbortController, setTimeout, clearTimeout,
    async fetch(request) {
      if (!online) throw new TypeError('Offline');
      return new Response('network '+request.url);
    }});
  const get = relative => {
    const url = new URL(relative, scope).href;
    return new Promise(resolve => handlers.get('fetch')({request: {url, method: 'GET', mode: relative.endsWith('.html')?'navigate':'cors'}, respondWith: resolve}));
  };
  for (const file of ['audio-review.html','audio-review.css','js/audio-review.js']) {
    const expected = 'network '+new URL(file, scope).href;
    online=true;
    assert.equal(await (await get(file)).text(), expected);
    online=false;
    assert.equal(await (await get(file)).text(), expected);
  }
  online=true;
  await get('data/audio/review-queue.json');
  const cachedQueue = [...stores.values()].some(store => store.has(new URL('data/audio/review-queue.json',scope).href));
  assert.equal(cachedQueue, false, 'Only the page caches schema-validated queue responses');
});
