import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { audioURL, validAudioIndex, validAudioPack, loadAudioPack, resolveAudioPieces, playAudioPieces, cancelRecordedAudio, pauseRecordedAudio, resumeRecordedAudio } from '../js/recorded-audio.js';
import { validAudioResponse, downloadAudioPack, precacheAudio, audioCacheUsage, deleteAudioCache, prepareExamAudio } from '../js/audio-downloads.js';
const bytes=Buffer.from('00000018667479704d3441200000000069736f6d6d703432','hex'),hash=createHash('sha256').update(bytes).digest('hex');
const make=(text,voiceId='af_heart')=>({text,voiceId,src:'./audio/generated/en/'+voiceId+'/'+hash.slice(0,32)+'.m4a',duration:1,bytes:bytes.length,sha256:hash,language:'en'});
const pack={version:1,sourceSha256:'1'.repeat(64),bank:'part2',language:'en',complete:true,clips:{'p2-test/audio/0':make('When is lunch?'),'p2-test/options/0/0':make('At noon.'),'p2-test/options/1/0':make('After the meeting.'),'p2-test/options/2/0':make('Tomorrow.') }};
const labels={version:1,sourceSha256:'1'.repeat(64),bank:'labels',language:'en',complete:true,clips:Object.fromEntries(['A','B','C'].map(letter=>['labels/af_heart/'+letter,make(letter+'.')]))};
const listening={version:1,sourceSha256:'1'.repeat(64),bank:'listening',language:'en',complete:true,clips:{'p3-demo/turns/0/0':{...make('Good morning.'),speaker:'A'},'p3-demo/turns/1/0':{...make('Good morning.','am_puck'),speaker:'B'},'p3-demo/turns/2/0':{...make('Please sit down.'),speaker:'A'},'p3-demo/turns/2/1':{...make('We will begin.'),speaker:'A'}}};
const vocab={version:1,sourceSha256:'1'.repeat(64),bank:'vocab',language:'en',complete:false,requiredComplete:true,clips:{'v-available/meaning':make('available'),'v-record/meaning':make('record','am_puck'),'v-record-document/meaning':make('record')}};
const index={version:1,complete:true,sourceSha256:'1'.repeat(64),packs:[pack,labels,listening,vocab].map(p=>({bank:p.bank,language:'en',complete:true,count:Object.keys(p.clips).length,src:'./data/audio/en/'+p.bank+'.json',bytes:Buffer.byteLength(JSON.stringify(p)),sha256:createHash('sha256').update(JSON.stringify(p)).digest('hex')}))};
const storage=new Map();let quota=false,requests=[],pendingFetch;
const cache={async match(key){return storage.get(String(key))?.clone();},async put(key,response){if(quota)throw new DOMException('full','QuotaExceededError');storage.set(String(key),response.clone());},async delete(key){return storage.delete(String(key));},async keys(){return [...storage.keys()].filter(url=>url.includes('/audio/generated/')).map(url=>({url,toString(){return url;}}));}};
globalThis.caches={open:async()=>cache,delete:async()=>{for(const key of storage.keys())if(key.includes('/audio/generated/'))storage.delete(key);return true;}};
globalThis.fetch=async(url,options={})=>{requests.push(String(url));if(String(url).endsWith('manifest.json'))return Response.json(index);if(String(url).includes('/data/audio/'))return Response.json(String(url).endsWith('/labels.json')?labels:String(url).endsWith('/listening.json')?listening:String(url).endsWith('/vocab.json')?vocab:pack);if(pendingFetch)return pendingFetch(options);return new Response(bytes,{headers:{'Content-Type':'audio/mp4'}});};
let media;
globalThis.document={createElement(){return media={src:'',paused:true,ended:false,plays:0,preload:'',setAttribute(){},removeAttribute(){this.src='';},load(){this.ended=false;},pause(){this.paused=true;},play(){this.paused=false;this.plays++;this.onplaying?.();return Promise.resolve();}};},body:{append(){}}};
globalThis.window={speechSynthesis:{pause(){},resume(){}}};
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
test('metadata loading only fetches small packs; exact labels and grouped content are retained',async()=>{
 assert(validAudioIndex(index));assert(validAudioPack(pack,'part2','en'));assert(!validAudioIndex({...index,packs:[...index.packs,index.packs[0]]}));
 assert.throws(()=>audioURL('./audio/generated/../private.m4a'));assert.throws(()=>audioURL('https://example.com/audio.m4a'));
 await loadAudioPack('part2');await loadAudioPack('labels');assert(requests.every(url=>!url.includes('/audio/generated/')));
 const pieces=resolveAudioPieces([{speaker:'A',text:'A. At noon.'}],{bank:'part2',seed:'p2-test'});
 assert.deepEqual(pieces.map(p=>p.key),['labels/af_heart/A','p2-test/options/0/0']);
 assert.equal(resolveAudioPieces([{text:'At night.'}],{bank:'part2'})[0].src,undefined);
});
test('single player cancels stale callbacks and ignores obsolete ended events',async()=>{
 let completed=0,canceled=0,starts=0;
 playAudioPieces([make('old')],{}, {onEnd(){completed++;},onCancel(){canceled++;}});const oldEnd=media.onended;
 playAudioPieces([make('new'),make('second')],{audioGapMs:0},{onStart(){starts++;},onEnd(){completed++;}});
 media.ended=true;oldEnd();assert.equal(completed,0);assert.equal(canceled,1);
 media.ended=false;media.onended();await tick();assert.equal(media.plays,2);
 media.ended=true;media.onended();media.onended();await tick();assert.equal(media.plays,3);assert.equal(starts,1);
 media.ended=true;media.onended();assert.equal(completed,1);assert.equal(media.preservesPitch,true);cancelRecordedAudio();
});
test('inter-sentence pause resumes and a media failure starts only one fallback',async()=>{
 let fallback=0,done=0;
 playAudioPieces([make('one'),make('two')],{audioGapMs:20},{fallback(_p,h){fallback++;h.onStart();h.onEnd();return true;},onEnd(){done++;}});
 media.ended=true;media.onended();pauseRecordedAudio();const count=media.plays;await new Promise(r=>setTimeout(r,30));assert.equal(media.plays,count);resumeRecordedAudio();assert.equal(media.plays,count+1);
 const failed=media.onerror;failed();failed();assert.equal(fallback,1);assert.equal(done,1);cancelRecordedAudio();
});
test('fullbody/hash validation rejects partial, HTML, corrupt bytes and wrong hash',async()=>{
 const clip=make('a');assert(await validAudioResponse(new Response(bytes),clip));
 assert.equal(await validAudioResponse(new Response(bytes,{status:206}),clip),false);
 assert.equal(await validAudioResponse(new Response(bytes,{headers:{'Content-Type':'text/html'}}),clip),false);
 assert.equal(await validAudioResponse(new Response('HTML'),clip),false);
 assert.equal(await validAudioResponse(new Response(bytes),{...clip,sha256:'0'.repeat(64)}),false);
});
test('download deduplicates, reports bytes, removes corrupt cache, and handles quota/cancel',async()=>{
 await deleteAudioCache();const events=[];await precacheAudio([{key:'p2-test/audio/0'},{key:'p2-test/options/0/0'}],{onProgress:p=>events.push(p)});
 assert.equal(events.at(-1).total,1);assert.equal(events.at(-1).status,'complete');assert.deepEqual(await audioCacheUsage(),{bytes:bytes.length,files:1});
 await deleteAudioCache();quota=true;await assert.rejects(precacheAudio([{key:'p2-test/audio/0'}]),e=>e.code==='AUDIO_QUOTA');quota=false;
 const abort=new AbortController();abort.abort();await assert.rejects(precacheAudio([{key:'p2-test/audio/0'}],{signal:abort.signal}),{name:'AbortError'});
 await cache.put(audioURL(make('x').src),new Response('<html>not audio</html>'));await precacheAudio([{key:'p2-test/audio/0'}]);assert.equal((await audioCacheUsage()).bytes,bytes.length);
 await deleteAudioCache();pendingFetch=async()=>{await deleteAudioCache();return new Response(bytes);};await assert.rejects(precacheAudio([{key:'p2-test/audio/0'}]),{name:'AbortError'});pendingFetch=null;assert.equal((await audioCacheUsage()).files,0);
});
test('exam preparation requires every cue and rejects uncovered content',async()=>{
 const q={id:'p2-test',audio:'When is lunch?',options:['At noon.','After the meeting.','Tomorrow.']},catalog=new Map([['p2-test',{data:q}]]),exam={units:[{part:2,ids:['p2-test']}]};
 const result=await prepareExamAudio(exam,catalog);assert.equal(result.total,1);
 q.options[2]='This is not recorded.';await assert.rejects(prepareExamAudio(exam,catalog),/不完整/);
});

test('exam playback does not restart a partially heard sentence with system speech',()=>{
 let fallback=0,errors=0;playAudioPieces([make('strict')],{}, {noFallbackAfterStart:true,fallback(){fallback++;return true;},onError(){errors++;}});
 media.onerror();assert.equal(errors,1);assert.equal(fallback,0);
});

test('same-text speakers and multi-sentence turns resolve only inside the original scene',async()=>{
 await loadAudioPack('listening');
 const b=resolveAudioPieces([{speaker:'B',text:'Good morning.'}],{bank:'listening',seed:'p3-demo'});assert.equal(b[0].voiceId,'am_puck');
 const two=resolveAudioPieces([{speaker:'A',text:'Please sit down. We will begin.'}],{bank:'listening',seed:'p3-demo'});assert.equal(two.length,2);assert(two.every(p=>p.src));
 assert.equal(resolveAudioPieces([{speaker:'C',text:'Good morning.'}],{bank:'listening',seed:'p3-demo'})[0].src,undefined);
 assert.equal(resolveAudioPieces([{speaker:'A',text:'Good morning.'}],{bank:'listening',seed:'p3-other'})[0].src,undefined);
});

test('dynamic vocabulary options reuse word heads and required-complete packs can be downloaded',async()=>{
 await loadAudioPack('vocab');
 const pieces=resolveAudioPieces([{text:'available',key:'v-other/options/0/0',bank:'vocab'}],{seed:'v-other'});assert.equal(pieces[0].key,'v-available/meaning');
 const crossBank=resolveAudioPieces([{text:'available',bank:'grammar'}],{seed:'gram-other'});assert.equal(crossBank[0].key,'v-available/meaning');
 assert.equal((await downloadAudioPack('vocab')).done,2);
});
test('vocabulary audio keeps the selected sense instead of a hyphen-prefixed sibling',async()=>{
 await loadAudioPack('vocab');
 for(const id of ['v-record','v-record-document']){
  assert.equal(resolveAudioPieces([{text:'record'}],{bank:'vocab',seed:id})[0].key,id+'/meaning');
  assert.equal(resolveAudioPieces([{text:'record',key:id+'/meaning',bank:'vocab'}],{seed:id})[0].key,id+'/meaning');
 }
 assert.equal(resolveAudioPieces([{text:'record',key:'v-record-missing/meaning',bank:'vocab'}],{seed:'v-record-missing'})[0].src,undefined,'a missing sense must not borrow a different pronunciation');
});
