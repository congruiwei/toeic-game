const CACHE='toeic-island-shell-1';
const files=['./','./index.html','./style.css','./manifest.webmanifest','./assets/mark.svg','./assets/icon-180.png','./assets/icon-192.png','./assets/icon-512.png','./js/app.js','./js/art.js','./js/audio.js','./js/bank.js','./js/icons.js','./js/state.js','./js/tiles.js','./data/vocab.json','./data/part2.json'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(files))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('toeic-island-shell-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
 event.respondWith((async()=>{const c=await caches.open(CACHE);return (await c.match(event.request))||(event.request.mode==='navigate'&&await c.match('./index.html'))||fetch(event.request);})());});
