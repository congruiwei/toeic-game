import test from 'node:test';
import assert from 'node:assert/strict';
import {audioCacheUsage,deleteAudioCache} from '../js/audio-downloads.js';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const address=(i,language='en')=>`https://cache.test/audio/generated/${language}/voice/${i}.m4a`;
function fixture(t,{sizes=[3,7,19,31,53,97,101,127,149],readGate,deleteGate}={}){
  const old=globalThis.caches,started=deferred(),rows=new Map(sizes.map((size,i)=>[address(i),size]));
  const metrics={opens:0,matches:0,reads:0,active:0,peak:0};
  const make=entries=>({
    rows:entries,
    async keys(){return [...entries.keys()].map(url=>({url}));},
    async match(request){
      metrics.matches++;const size=entries.get(request.url||request);if(size===undefined)return undefined;
      return {headers:new Headers({'content-length':'999999'}),async arrayBuffer(){
        metrics.reads++;metrics.active++;metrics.peak=Math.max(metrics.peak,metrics.active);started.resolve();
        try{await (readGate?.promise||tick());return new ArrayBuffer(size);}finally{metrics.active--;}
      }};
    },
    async delete(request){return entries.delete(request.url||request);},
  });
  let current=make(rows);
  globalThis.caches={
    async open(){metrics.opens++;return current;},
    async delete(){await deleteGate?.promise;current=make(new Map());return true;},
  };
  t.after(()=>{if(old===undefined)delete globalThis.caches;else globalThis.caches=old;});
  return {metrics,started:started.promise,get current(){return current;},rows};
}

test('usage sums actual body bytes with four bounded readers and ignores size headers',async t=>{
  const sizes=[3,7,19,31,53,97,101,127,149],f=fixture(t,{sizes});
  assert.deepEqual(await audioCacheUsage(),{bytes:sizes.reduce((n,v)=>n+v,0),files:sizes.length});
  assert.equal(f.metrics.peak,4);assert.equal(f.metrics.reads,sizes.length);
});

test('usage counts only responses that still exist after the key snapshot',async t=>{
  const f=fixture(t,{sizes:[9,21]});const keys=f.current.keys;
  f.current.keys=async()=>{const result=await keys();f.rows.delete(address(1));return result;};
  assert.deepEqual(await audioCacheUsage(),{bytes:9,files:1});
});

test('usage cancellation rejects promptly and schedules no additional bodies',async t=>{
  const gate=deferred(),f=fixture(t,{readGate:gate}),controller=new AbortController();
  const pending=audioCacheUsage({signal:controller.signal});await f.started;
  controller.abort();await assert.rejects(pending,{name:'AbortError'});
  assert.equal(f.metrics.reads,4);gate.resolve();await tick();
  assert.equal(f.metrics.reads,4);assert.equal(f.metrics.active,0);
});

test('a scan holding a deleted Cache object reopens the current empty cache',async t=>{
  const gate=deferred(),f=fixture(t,{readGate:gate});
  const pending=audioCacheUsage();await f.started;
  assert.deepEqual(await deleteAudioCache(),{bytes:0,files:0});
  gate.resolve();assert.deepEqual(await pending,{bytes:0,files:0});
  assert.equal(f.metrics.reads,4,'stop the obsolete scan after its in-flight bodies');
});

test('a scan started during deletion is invalidated when that deletion finishes',async t=>{
  const readGate=deferred(),deleteGate=deferred(),f=fixture(t,{readGate,deleteGate});
  const deleting=deleteAudioCache(),pending=audioCacheUsage();await f.started;
  deleteGate.resolve();assert.deepEqual(await deleting,{bytes:0,files:0});
  readGate.resolve();assert.deepEqual(await pending,{bytes:0,files:0});
});

test('language deletion recomputes exact bytes for the surviving recordings',async t=>{
  const gate=deferred(),f=fixture(t,{sizes:[4,8,12,16],readGate:gate});
  f.rows.set(address('ja','ja'),23);
  const pending=audioCacheUsage();await f.started;
  const deleting=deleteAudioCache({language:'en'});gate.resolve();
  assert.deepEqual(await deleting,{bytes:23,files:1});
  assert.deepEqual(await pending,{bytes:23,files:1});
});

test('unavailable CacheStorage stays compatible and pre-aborted scans never open it',async t=>{
  const f=fixture(t),controller=new AbortController();controller.abort();
  await assert.rejects(audioCacheUsage({signal:controller.signal}),{name:'AbortError'});
  assert.equal(f.metrics.opens,0);delete globalThis.caches;
  assert.deepEqual(await audioCacheUsage(),{bytes:0,files:0});
});
