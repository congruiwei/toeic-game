// Bump for changes to the application shell or a breaking data format change.
const CACHE = 'toeic-island-shell-19';
const files = [
  './',
  './index.html',
  './manifest.webmanifest',
  './style.css',
  './practice.css',
  './library.css',
  './assets/mark.svg',
  './assets/icon-180.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './report.css','./js/report.js',
  './js/app.js','./js/exam.js','./js/exam-ui.js','./js/exam-controller.js',
  './js/question-tools.js','./js/answers.js',
  './js/art.js',
  './js/audio.js',
  './js/bank.js','./js/screening.js','./js/screen-view.js',
  './js/icons.js',
  './js/state.js',
  './js/tiles.js',
  './js/training.js',
  './js/library.js',
  './js/practice.js',
  './data/vocab.json',
  './data/part1.json',
  './data/part2.json',
  './data/grammar.json',
  './data/listening.json',
  './data/reading.json',
];

self.addEventListener('install', (event) => {
  const requests = files.map(
    (path) => new Request(new URL(path, self.registration.scope), { cache: 'reload' }),
  );
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);await cache.addAll(requests);
    const part1=await (await cache.match(new URL('data/part1.json',self.registration.scope))).json();
    await cache.addAll(part1.map(q=>new URL(q.image,self.registration.scope).href));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('toeic-island-shell-') && k !== CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

async function updateBank(request, cache) {
  // Adding records to an existing file requires no service-worker edit.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(request, { cache: 'no-cache', signal: controller.signal });
    if (response.ok) {
      const rows = await response.clone().json();
      if (Array.isArray(rows) && rows.length) {
        await cache.put(request, response.clone());
        return response;
      }
    }
  } catch {
    /* Fall back to the last downloaded bank. */
  } finally {
    clearTimeout(timer);
  }
  return (await cache.match(request)) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (request.url.startsWith(new URL('data/', self.registration.scope).href)) {
        return updateBank(request, cache);
      }
      return (
        (await cache.match(request)) ||
        (request.mode === 'navigate' && (await cache.match('./index.html'))) ||
        fetch(request)
      );
    })(),
  );
});
