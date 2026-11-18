import { AUDIO_CACHE, audioURL, loadAudioPack, inferAudioBank, getAudioClip, getAudioFallback, prepareRecordedAudio, resolveAudioPieces } from './recorded-audio.js';
import { listeningScript } from './exam.js';
let cacheGeneration=0;
const abortError=()=>new DOMException('录音下载已取消','AbortError');
const checkAbort=(signal,generation)=>{if(signal?.aborted||generation!==cacheGeneration)throw abortError();};
function abortable(promise,signal) {
  if(!signal)return promise;
  if(signal.aborted)return Promise.reject(abortError());
  return new Promise((resolve,reject)=>{
    const aborted=()=>reject(abortError());signal.addEventListener('abort',aborted,{once:true});
    promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',aborted));
  });
}
export async function validAudioResponse(response,clip) {
  if(!response||response.status!==200||/text\/|json|html/i.test(response.headers.get('content-type')||''))return false;
  const data=await response.clone().arrayBuffer(),bytes=new Uint8Array(data);
  if(data.byteLength!==clip.bytes||data.byteLength<12||String.fromCharCode(...bytes.slice(4,8))!=='ftyp')return false;
  const digest=await crypto.subtle.digest('SHA-256',data);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('')===clip.sha256;
}
async function download(clips,{signal,onProgress=()=>{}}={}) {
  const generation=cacheGeneration;checkAbort(signal,generation);
  if(!globalThis.caches)throw Error('此浏览器无法保存离线录音，请使用 HTTPS 或 Safari。');
  const unique=new Map();
  for(const clip of clips){const url=audioURL(clip.src),other=unique.get(url);if(other&&(other.sha256!==clip.sha256||other.bytes!==clip.bytes))throw Error('同一录音的校验信息冲突');unique.set(url,clip);}
  const list=[...unique.entries()],cache=await caches.open(AUDIO_CACHE),total=list.length,totalBytes=list.reduce((n,[,c])=>n+c.bytes,0);
  let done=0,bytes=0;
  const progress=(status,key)=>onProgress({status,done,total,bytes,totalBytes,key});
  progress('downloading');
  try {
    // One complete file at a time keeps memory bounded on iPhones and makes cancellation predictable.
    for(const [url,clip] of list){
      checkAbort(signal,generation);let saved=await cache.match(url);
      if(saved&&!await validAudioResponse(saved,clip)){await cache.delete(url);saved=null;}
      checkAbort(signal,generation);
      if(!saved){
        const response=await fetch(url,{signal,cache:'no-cache'});
        if(!await validAudioResponse(response,clip)){await cache.delete(url);throw Error('录音文件不完整或校验失败，请重新下载。');}
        checkAbort(signal,generation);
        await cache.put(url,response);
        if(generation!==cacheGeneration){await cache.delete(url);throw abortError();}
      }
      checkAbort(signal,generation);done++;bytes+=clip.bytes;progress('downloading',clip.key);
    }
    progress('complete');return {done,total,bytes,totalBytes};
  }catch(error){
    if(error?.name==='QuotaExceededError'){const quota=Error('设备可用空间不足，已完成的录音仍可使用。');quota.code='AUDIO_QUOTA';progress('error');throw quota;}
    progress(error?.name==='AbortError'?'canceled':'error');throw error;
  }
}
export async function downloadAudioPack(bank,language='en',options={}) {
  const pack=await abortable(loadAudioPack(bank,language),options.signal);
  if(pack.complete!==true&&pack.requiredComplete!==true&&pack.requiredPlaybackComplete!==true)throw Error('这一类录音尚未生成完整，暂不能整包下载。');
  const result=await download(Object.entries(pack.clips).map(([key,clip])=>({...clip,key})),options);
  const systemFallbacks=Object.keys(pack.fallbacks||{}).length;return systemFallbacks?{...result,systemFallbacks}:result;
}
export async function precacheAudio(refs,options={}) {
  const groups=new Map();
  for(const ref of refs){const bank=ref.bank||inferAudioBank(ref.key),language=ref.language||'en';if(!bank)throw Error('无法识别录音分类');groups.set(language+'/'+bank,{bank,language});}
  await abortable(Promise.all([...groups.values()].map(({bank,language})=>loadAudioPack(bank,language))),options.signal);
  const clips=refs.map(ref=>getAudioClip(ref.key,{bank:ref.bank||inferAudioBank(ref.key),language:ref.language||'en'}));
  const fallback=refs.map(ref=>getAudioFallback(ref.key,{bank:ref.bank||inferAudioBank(ref.key),language:ref.language||'en'}));
  if(clips.some((clip,i)=>!clip&&!fallback[i]))throw Error('所需录音缺失，请重新下载或使用设备语音。');
  const result=await download(clips.filter(Boolean),options),systemFallbacks=fallback.filter(Boolean).length;
  return systemFallbacks?{...result,systemFallbacks}:result;
}
export async function prepareExamAudio(exam,catalog,options={}) {
  const units=exam.units.filter(unit=>unit.part<=4),banks=[...new Set(units.map(unit=>unit.part===1?'part1':unit.part===2?'part2':'listening'))];
  await abortable(prepareRecordedAudio({banks}),options.signal);
  const refs=[];
  for(const unit of units){
    checkAbort(options.signal,cacheGeneration);
    const first=catalog.get(unit.ids[0]).data,bank=unit.part===1?'part1':unit.part===2?'part2':'listening';
    const pieces=resolveAudioPieces(listeningScript(unit,catalog).filter(step=>step.text),{bank,seed:first.set?.id||first.id});
    if(pieces.some(piece=>!piece.src))throw Error('这套模考所需录音尚不完整，请稍后重试或选择设备语音。');
    refs.push(...pieces.map(({key,bank,language})=>({key,bank,language})));
  }
  return precacheAudio(refs,options);
}
export async function audioCacheUsage({signal}={}) {
  if(signal?.aborted)throw abortError();
  if(!globalThis.caches)return {bytes:0,files:0};
  for(;;){
    const generation=cacheGeneration,cache=await abortable(caches.open(AUDIO_CACHE),signal);
    const keys=await abortable(cache.keys(),signal);let bytes=0,files=0,cursor=0;
    // Read exact body sizes with bounded memory; headers can be missing or stale.
    const worker=async()=>{
      while(cursor<keys.length&&generation===cacheGeneration){
        if(signal?.aborted)throw abortError();
        const response=await abortable(cache.match(keys[cursor++]),signal);
        if(!response||generation!==cacheGeneration)continue;
        const data=await abortable(response.arrayBuffer(),signal);
        bytes+=data.byteLength;files++;
      }
    };
    await Promise.all(Array.from({length:Math.min(4,keys.length)},worker));
    if(signal?.aborted)throw abortError();
    // A deleted Cache object stays readable. Reopen it instead of reporting its old bodies.
    if(generation===cacheGeneration)return {bytes,files};
  }
}
export async function deleteAudioCache({bank,language}={}) {
  cacheGeneration++;
  globalThis.navigator?.serviceWorker?.controller?.postMessage({type:'audio-cache-cleared'});
  if(!globalThis.caches)return {bytes:0,files:0};
  try{
    if(!bank&&!language)await caches.delete(AUDIO_CACHE);
    else{
      const cache=await caches.open(AUDIO_CACHE);
      if(bank){const packs=await Promise.all((language?[language]:['en','ja']).map(lang=>loadAudioPack(bank,lang)));for(const pack of packs)for(const clip of Object.values(pack.clips))await cache.delete(audioURL(clip.src));}
      else for(const request of await cache.keys())if(new URL(request.url).pathname.includes('/audio/generated/'+language+'/'))await cache.delete(request);
    }
  }finally{cacheGeneration++;}
  return audioCacheUsage();
}
