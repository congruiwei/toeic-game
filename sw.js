// Bump for changes to the application shell or a breaking data format change.
const CACHE = 'toeic-island-shell-54';
const files = [
  './',
  './index.html',
  './manifest.webmanifest',
  './style.css',
  './practice.css',
  './library.css',
  './morphemes.css','./js/morphemes.js','./js/word-enrichment.js','./data/morphemes.json',
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
  './js/library.js','./js/vocab-humor.js','./js/vocab-art.js','./js/confusables.js','./js/confusable-memory.js',
  './js/practice.js',
  './data/vocab.json','./data/confusable-candidates.json',
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
    const morphemes=await (await cache.match(new URL('data/morphemes.json',self.registration.scope))).json();
    if(!validMorphemePack(morphemes))throw Error('Invalid morpheme packet');
    const candidates=await (await cache.match(new URL('data/confusable-candidates.json',self.registration.scope))).json();
    if(!validConfusablePack(candidates,true))throw Error('Invalid confusable candidate index');
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

// Morphemes are an object-shaped packet, not a question-bank array. Keep
// the same structure gate as loadMorphemes before replacing a working copy.
function validMorphemePack(data) {
  const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
  const nonempty=x=>typeof x==='string'&&Boolean(x.trim());
  const types={prefix:true,root:true,suffix:true},posNames={'n.':true,'v.':true,'adj.':true,'adv.':true};
  if(!object(data)||data.version!==1||!object(data.sources)||!Array.isArray(data.entries)||!data.entries.length)return false;
  const ids=new Set();
  return data.entries.every(m=>object(m)&&/^(pre|root|suf)-[a-z-]+$/.test(m.id)&&!ids.has(m.id)&&Boolean(ids.add(m.id))&&Object.hasOwn(types,m.type)&&Array.isArray(m.forms)&&m.forms.length>0&&m.forms.every(nonempty)&&nonempty(m.zh)&&nonempty(m.ja)&&Array.isArray(m.examples)&&m.examples.length>=2&&m.examples.length<=6&&new Set(m.examples).size===m.examples.length&&m.examples.every(nonempty)&&Array.isArray(m.sources)&&m.sources.length>0&&m.sources.every(id=>object(data.sources[id])&&/^https:\/\//.test(data.sources[id].url))&&(m.type!=='suffix'||Array.isArray(m.pos)&&m.pos.length>0&&m.pos.every(p=>Object.hasOwn(posNames,p))));
}

// The small projection may be installed with the shell. Full explanations and
// translations load on demand, then remain usable for offline answer review.
function validConfusablePack(value,candidates=false) {
  const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
  const text=x=>typeof x==='string'&&x.trim().length>0;
  const id=x=>text(x)&&/^[a-zA-Z0-9_-]+$/.test(x)&&!['__proto__','constructor','prototype'].includes(x);
  if(!object(value)||value.version!==1)return false;
  if(candidates)return object(value.entries)&&Object.keys(value.entries).length>0&&
    Object.entries(value.entries).every(([key,words])=>id(key)&&Array.isArray(words)&&words.length>0&&
      words.every(text)&&new Set(words).size===words.length)&&
    (value.part2TrapIds===undefined||Array.isArray(value.part2TrapIds)&&new Set(value.part2TrapIds).size===value.part2TrapIds.length&&value.part2TrapIds.every(key=>/^p2-[a-zA-Z0-9_-]+$/.test(key)))&&
    (value.semanticAvoid===undefined||Array.isArray(value.semanticAvoid)&&value.semanticAvoid.every(pair=>
      Array.isArray(pair)&&pair.length===2&&pair.every(text)&&pair[0]!==pair[1]));
  if(!Array.isArray(value.groups)||!value.groups.length||!object(value.words)||
    !Array.isArray(value.questions)||!value.questions.length||!Array.isArray(value.part2Traps))return false;
  if(!Object.entries(value.words).every(([key,word])=>id(key)&&object(word)&&word.id===key&&
    ['word','pos','zh','ja','example'].every(field=>text(word[field]))&&
    (word.wordId===null||word.wordId===key)))return false;
  const groups=new Map();
  for(const group of value.groups){
    if(!object(group)||!id(group.id)||groups.has(group.id)||!text(group.type)||!Array.isArray(group.members)||
      group.members.length<2||group.members.length>4||new Set(group.members).size!==group.members.length||
      !group.members.every(member=>id(member)&&Object.hasOwn(value.words,member))||
      !object(group.difference)||!['en','zh','ja'].every(lang=>text(group.difference[lang])))return false;
    groups.set(group.id,group);
  }
  const questions=new Set();
  for(const q of value.questions){
    const group=object(q)&&groups.get(q.groupId);
    if(!group||!id(q.id)||questions.has(q.id)||!group.members.includes(q.wordId)||
      !['sentence','sentenceZh','sentenceJa','prompt','answer','en','zh'].every(field=>text(q[field]))||
      ![400,500,600,700,800,900].includes(q.level)||!Array.isArray(q.options)||q.options.length<2||q.options.length>4||
      new Set(q.options).size!==q.options.length||!q.options.includes(q.answer)||
      q.answer!==value.words[q.wordId].word||!q.options.every(option=>group.members.some(member=>value.words[member].word===option)))return false;
    questions.add(q.id);
  }
  return value.part2Traps.every(trap=>object(trap)&&id(trap.id)&&text(trap.option)&&text(trap.reasonZh)&&
    (!trap.groupId||(groups.has(trap.groupId)&&groups.get(trap.groupId).members.includes(trap.sourceWordId)&&
      groups.get(trap.groupId).members.includes(trap.distractorWordId))));
}

// Humor has three complete, appendable packs. Generic translations deliberately
// retain their existing validation and cache policy.
const humorPackPaths=new Set(['data/vocab-humor.json','data/i18n/zh/vocab-humor.json','data/i18n/ja/vocab-humor.json']
  .map(path=>new URL(path,self.registration.scope).pathname));
function validHumorPack(value,requiredKeys=[]) {
  const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
  if(!object(value)||value.version!==1||!object(value.entries)||!Object.keys(value.entries).length)return false;
  return Object.entries(value.entries).every(([key,text])=>/^[a-zA-Z0-9_-]+\/humor\/0$/.test(key)&&
    typeof text==='string'&&text.trim().length>0)&&requiredKeys.every(key=>Object.hasOwn(value.entries,key));
}
async function updateHumorPack(request,shellCache) {
  const cache=await caches.open('toeic-island-translations-v1'),required=new Set();
  // Never replace a complete downloaded pack with a truncated successful response.
  // New keys may be appended without changing the worker or a hard-coded count.
  try {
    const previous=await cache.match(request),value=previous&&await previous.json();
    if(validHumorPack(value))Object.keys(value.entries).forEach(key=>required.add(key));
  } catch {/* An unusable previous entry cannot authorize a new malformed pack. */}
  try {
    const bank=await shellCache.match(new URL('data/vocab.json',self.registration.scope));
    const words=bank&&await bank.json();
    if(Array.isArray(words))for(const word of words)if(typeof word?.id==='string')required.add(word.id+'/humor/0');
  } catch {/* A downloaded humor pack still supplies its own coverage baseline. */}
  const response=await updateBank(request,cache,true,value=>validHumorPack(value,[...required]));
  // WebKit reports Response.error from a worker as a page error even when the
  // optional loader catches fetch(). A regular failure keeps its retry UI usable.
  return response.type==='error'?new Response('{"error":"humor-pack-unavailable"}',
    {status:503,headers:{'Content-Type':'application/json'}}):response;
}

// Image metadata is a separate object pack, not a translation dictionary.
function validVocabArtIndex(value) {
  const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
  const id=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]+$/.test(x)&&!['__proto__','constructor','prototype'].includes(x);
  if(!object(value)||value.version!==1||!object(value.entries)||!Object.keys(value.entries).length)return false;
  if(!Object.entries(value.entries).every(([key,entry])=>id(key)&&object(entry)&&
    (entry.class==='C'?Object.keys(entry).length===1:
      ['A','B'].includes(entry.class)&&typeof entry.alt==='string'&&entry.alt.trim().length>0&&/^[a-f0-9]{12}$/.test(entry.rev))))return false;
  return value.aliases===undefined||object(value.aliases)&&Object.entries(value.aliases).every(([alias,target])=>
    id(alias)&&!Object.hasOwn(value.entries,alias)&&id(target)&&Object.hasOwn(value.entries,target)&&value.entries[target].class!=='C');
}
async function validVocabArtImage(response,rev) {
  if(!response||response.status!==200||!response.headers.get('Content-Type')?.toLowerCase().includes('image/svg+xml'))return false;
  const bytes=await response.clone().arrayBuffer();
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  return hash.startsWith(rev);
}
async function vocabArtResource(request) {
  // A versioned image may only fill its own digest URL, including after an older
  // worker left a bad entry. Never download the whole illustration collection.
  const rev=new URL(request.url).searchParams.get('v');
  const missing=()=>new Response('',{status:404,headers:{'Content-Type':'image/svg+xml'}});
  if(!/^[a-f0-9]{12}$/.test(rev||''))return missing();
  const cache=await caches.open('toeic-island-vocab-art-v1');
  try {
    const hit=await cache.match(request);
    if(hit){
      if(await validVocabArtImage(hit,rev))return hit;
      await cache.delete(request);
    }
    const response=await fetch(request,{cache:'no-cache'});
    if(await validVocabArtImage(response,rev)){
      try{await cache.put(request,response.clone());}catch{/* Storage may be full. */}
      return response;
    }
  } catch {/* A missing optional picture must not reject the worker event. */}
  return missing();
}

async function updateBank(request, cache, translation=false, validate=null) {
  // Adding records to an existing file requires no service-worker edit.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), translation?15000:2500);
  try {
    const response = await fetch(request, { cache: 'no-cache', signal: controller.signal });
    if (response.ok) {
      const rows = await response.clone().json();
      if (validate ? validate(rows) : translation ? rows?.version===1 && rows.entries && !Array.isArray(rows.entries) && typeof rows.entries==='object' : Array.isArray(rows) && rows.length) {
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

// An absent optional comparison pack is an ordinary unavailable response.
// WebKit also reports Response.error() as a page error even when fetch is caught.
async function updateConfusableBank(request,cache,candidates=false){
  const response=await updateBank(request,cache,false,rows=>validConfusablePack(rows,candidates));
  return response.type==='error'?new Response('{"error":"confusable-pack-unavailable"}',{status:503,headers:{'Content-Type':'application/json'}}):response;
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

// Load answer-only UI on first use, then keep it in this shell revision for offline review.
const comparisonFiles=new Map(['confusables.css','js/confusable-ui.js'].map(p=>[new URL(p,self.registration.scope).pathname,p.endsWith('.css')?'text/css':'javascript']));
async function comparisonResource(request,cache){
  const cached=await cache.match(request);if(cached)return cached;
  try{
    const response=await fetch(request),type=response.headers.get('Content-Type')||'';
    if(!response.ok||!type.includes(comparisonFiles.get(new URL(request.url).pathname)))return Response.error();
    try{await cache.put(request,response.clone());}catch{/* Online rendering remains usable if storage is full. */}
    return response;
  }catch{return Response.error();}
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
      if(request.url.startsWith(new URL('assets/vocab/',self.registration.scope).href))return vocabArtResource(request);
      if(new URL(request.url).pathname===new URL('data/vocab-art.json',self.registration.scope).pathname)
        return updateBank(request,await caches.open('toeic-island-vocab-art-v1'),true,validVocabArtIndex);
      if(request.url.startsWith(new URL('audio/generated/',self.registration.scope).href))return audioResource(request);
      // The page validates metadata before caching it; a bad download must not replace a good pack.
      if(request.url.startsWith(new URL('data/audio/',self.registration.scope).href))return auditionResource(request,await caches.open('toeic-island-audio-meta-v1'),false);
      // The page owns validated, generation-ordered option-pack writes too.
      if(request.url.startsWith(new URL('data/options/',self.registration.scope).href))return auditionResource(request,await caches.open('toeic-island-option-details-v1'),false);
      if(comparisonFiles.has(new URL(request.url).pathname))return comparisonResource(request,cache);
      if(auditionFiles.has(new URL(request.url).pathname))return auditionResource(request,cache);
      if(humorPackPaths.has(new URL(request.url).pathname))return updateHumorPack(request,cache);
      if (request.url.startsWith(new URL('data/i18n/',self.registration.scope).href)) {
        return updateBank(request,await caches.open('toeic-island-translations-v1'),true);
      }
      if(new URL(request.url).pathname===new URL('data/morphemes.json',self.registration.scope).pathname)
        return updateBank(request,cache,false,validMorphemePack);
      if(new URL(request.url).pathname===new URL('data/confusables.json',self.registration.scope).pathname)
        return updateConfusableBank(request,cache);
      if(new URL(request.url).pathname===new URL('data/confusable-candidates.json',self.registration.scope).pathname)
        return updateConfusableBank(request,cache,true);
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
