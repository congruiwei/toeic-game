import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../sw.js',import.meta.url),'utf8');
function worker(fetcher=async()=>new Response('missing',{status:404})){
  const events={},stored=new Map();
  const cache={async match(key){return stored.get(typeof key==='string'?key:key.url)?.clone();},async put(key,response){stored.set(typeof key==='string'?key:key.url,response.clone());}};
  const context={Request,Response,Headers,URL,TextDecoder,AbortController,setTimeout,clearTimeout,fetch:fetcher,
    caches:{async open(){return cache;}},self:{registration:{scope:'https://example.test/game/'},addEventListener(name,callback){events[name]=callback;}}};
  vm.createContext(context);vm.runInContext(source,context);
  return {...context,events,stored};
}
function audio(){const b=new Uint8Array(80);b.set(new TextEncoder().encode('ftyp'),4);b[78]=18;b[79]=19;return b;}

test('Safari media ranges are served from one complete file, including suffix and open-ended ranges',async()=>{
  let requests=0;
  const w=worker(async()=>{requests++;return new Response(audio(),{headers:{'Content-Type':'audio/mp4'}});});
  const request=range=>new Request('https://example.test/game/audio/generated/en/heart/test.m4a',range?{headers:{Range:range}}:{});
  const first=await w.audioResource(request('bytes=0-1'));
  assert.equal(first.status,206);assert.equal(first.headers.get('Content-Range'),'bytes 0-1/80');assert.equal((await first.arrayBuffer()).byteLength,2);
  const suffix=await w.audioResource(request('bytes=-2'));
  assert.deepEqual([...new Uint8Array(await suffix.arrayBuffer())],[18,19]);
  assert.equal(suffix.headers.get('Content-Range'),'bytes 78-79/80');
  const tail=await w.audioResource(request('bytes=78-'));
  assert.equal(tail.headers.get('Content-Length'),'2');
  const all=await w.audioResource(request());assert.equal(all.status,200);assert.equal((await all.arrayBuffer()).byteLength,80);
  assert.equal(requests,1,'later requests work without another network fetch');
  assert.equal(w.stored.size,1);
});

test('invalid media ranges return 416 and HTML cannot poison the audio cache',async()=>{
  const w=worker();
  for(const range of ['bytes=80-','bytes=-0','bytes=-','bytes=5-2','bytes=0-1,4-5','bytes=x-y']){
    const response=await w.audioRange(new Response(audio()),range);
    assert.equal(response.status,416,range);assert.equal(response.headers.get('Content-Range'),'bytes */80');
  }
  const bad=worker(async()=>new Response('<!doctype html><title>Not audio</title>'));
  const response=await bad.audioResource(new Request('https://example.test/game/audio/generated/wrong.m4a'));
  assert.equal(response.type,'error');assert.equal(bad.stored.size,0);
});

test('deleting audio while a network request is in flight does not refill the cache',async()=>{
  let resolve,started;
  const fetched=new Promise(r=>started=r);
  const w=worker(()=>{started();return new Promise(r=>resolve=r);});
  const pending=w.audioResource(new Request('https://example.test/game/audio/generated/flight.m4a'));
  await fetched;w.events.message({data:{type:'audio-cache-cleared'}});
  resolve(new Response(audio()));
  assert.equal((await pending).status,200);assert.equal(w.stored.size,0);
});
