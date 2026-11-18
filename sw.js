// Bump for changes to the application shell or a breaking data format change.
const CACHE = 'toeic-island-shell-47';
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
  './translation.css','./js/translations.js','./js/translation-ui.js','./js/translation-source.js',
  './report.css','./js/report.js',
  './read-aloud.css','./js/readable.js','./js/read-aloud.js',
  './option-details.css','./js/option-details.js','./js/personal-vocab.js',
  './js/shell-update.js','./js/app.js','./js/exam.js','./js/exam-ui.js','./js/exam-controller.js',
  './js/prediction.js','./js/prediction-migration.js','./diagnosis.css','./js/diagnosis.js','./js/diagnosis-ui.js','./data/methods.json','./js/methods.js','./js/japanese-terms.js','./js/replay.js','./js/question-tools.js','./js/answers.js',
  './js/art.js',
  './js/audio.js','./js/japanese-audio.js','./js/recorded-audio.js','./js/audio-downloads.js','./js/audio-settings.js','./js/expressions.js','./js/expression-ui.js',
  './js/bank.js','./js/vocabulary-language.js','./js/screening.js','./js/screen-view.js',
  './js/icons.js',
  './js/state.js','./js/review-scheduler.js','./vendor/ts-fsrs/index.js',
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

self.addEventListener('message',event=>{
  if(event.data?.type==='activate-ready-shell')event.waitUntil(self.skipWaiting());
  if(event.data?.type==='audio-cache-cleared')audioCacheGeneration++;
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

async function updateBank(request, cache, translation=false) {
  // Adding records to an existing file requires no service-worker edit.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), translation?15000:2500);
  try {
    const response = await fetch(request, { cache: 'no-cache', signal: controller.signal });
    if (response.ok) {
      const rows = await response.clone().json();
      if (translation ? rows?.version===1 && rows.entries && !Array.isArray(rows.entries) && typeof rows.entries==='object' : Array.isArray(rows) && rows.length) {
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

// The optional audition is fetched only when visited. Its object-shaped JSON
// is neither a question-bank array nor a translation pack; audio is not prefetched.
const auditionFiles = new Set(['audition.html','audition.css','js/audition.js',
  'audio-review.html','audio-review.css','js/audio-review.js',
  'data/audio-audition-source.json','data/audio-audition-manifest.json']
  .map(path=>new URL(path,self.registration.scope).pathname));
async function auditionResource(request,cache,write=true) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try {
    const response=await fetch(request,{cache:'no-cache',signal:controller.signal});
    if(response.ok){if(write)await cache.put(request,response.clone());return response;}
  } catch { /* A previously opened audition can still display its controls offline. */ }
  finally { clearTimeout(timer); }
  return (await cache.match(request)) || Response.error();
}

let audioCacheGeneration=0;
// Safari probes media with Range requests. Cache a whole file once, then serve
// proper byte ranges offline rather than storing an unusable 206 response.
async function audioRange(response,range) {
  const bytes=await response.arrayBuffer(),size=bytes.byteLength;
  const headers=new Headers(response.headers);
  headers.set('Accept-Ranges','bytes');
  headers.delete('Content-Encoding');
  headers.set('Content-Length',String(size));
  if(!range)return new Response(bytes,{status:200,headers});
  const match=/^bytes=(\d*)-(\d*)$/.exec(range);
  let start=match?.[1]?Number(match[1]):0,end=match?.[2]?Number(match[2]):size-1;
  if(match && !match[1] && match[2]){start=Math.max(0,size-Number(match[2]));end=size-1;}
  if(!match || (!match[1]&&!match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start<0 || start>=size || end<start){
    headers.set('Content-Range',`bytes */${size}`);headers.set('Content-Length','0');
    return new Response(null,{status:416,headers});
  }
  end=Math.min(end,size-1);
  headers.set('Content-Range',`bytes ${start}-${end}/${size}`);
  headers.set('Content-Length',String(end-start+1));
  return new Response(bytes.slice(start,end+1),{status:206,headers});
}
async function audioResource(request) {
  const url=new URL(request.url);url.search='';
  const cache=await caches.open('toeic-island-audio-v1'),key=url.href;
  let response=await cache.match(key);
  if(!response){
    const ticket=audioCacheGeneration;
    response=await fetch(key,{credentials:'same-origin'});
    if(!response.ok || response.status!==200)return response;
    const bytes=await response.clone().arrayBuffer();
    if(bytes.byteLength<12 || new TextDecoder().decode(bytes.slice(4,8))!=='ftyp')return Response.error();
    if(ticket===audioCacheGeneration){try{await cache.put(key,response.clone());}catch{/* Playback still works if storage is full. */}}
  }
  return audioRange(response,request.headers.get('Range'));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if(request.url.startsWith(new URL('audio/generated/',self.registration.scope).href))return audioResource(request);
      // The page validates metadata before caching it; a bad download must not replace a good pack.
      if(request.url.startsWith(new URL('data/audio/',self.registration.scope).href))return auditionResource(request,await caches.open('toeic-island-audio-meta-v1'),false);
      // The page owns validated, generation-ordered option-pack writes too.
      if(request.url.startsWith(new URL('data/options/',self.registration.scope).href))return auditionResource(request,await caches.open('toeic-island-option-details-v1'),false);
      if(auditionFiles.has(new URL(request.url).pathname))return auditionResource(request,cache);
      if (request.url.startsWith(new URL('data/i18n/',self.registration.scope).href)) {
        return updateBank(request,await caches.open('toeic-island-translations-v1'),true);
      }
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
