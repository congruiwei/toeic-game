export const AUDIO_CACHE = 'toeic-island-audio-v1';
export const AUDIO_META_CACHE = 'toeic-island-audio-meta-v1';
const base = () => new URL('../', import.meta.url);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const normalized = value => String(value ?? '').normalize('NFC').trim().replace(/\s+/gu, ' ');
const validLanguage = value => ['en','ja'].includes(value);
const validBank = value => /^(vocab|part1|part2|grammar|listening|reading|methods|terms|labels)$/.test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
let index, indexPending;
const packs = new Map(), pending = new Map(), failed = new Map();

export function audioURL(src) {
  const url = new URL(src,base()), prefix = new URL('audio/generated/',base());
  if(typeof src !== 'string' || !src.startsWith('./audio/generated/') || /[?#%\\]/.test(src) || src.split('/').slice(1).some(p=>p==='.'||p==='..') || url.origin!==prefix.origin || !url.pathname.startsWith(prefix.pathname) || !url.pathname.endsWith('.m4a')) throw Error('录音路径无效');
  return url.href;
}
function metadataURL(src) {
  const url=new URL(src,base()),prefix=new URL('data/audio/',base());
  if(typeof src!=='string'||url.origin!==prefix.origin||!url.pathname.startsWith(prefix.pathname)||!url.pathname.endsWith('.json')||/[?#%\\]/.test(src)||src.split('/').slice(1).some(p=>p==='.'||p==='..'))throw Error('录音清单路径无效');
  return url.href;
}
export function validAudioIndex(value) {
  return record(value)&&value.version===1&&typeof value.complete==='boolean'&&sha(value.sourceSha256)&&Array.isArray(value.packs)&&value.packs.every(pack=>record(pack)&&validBank(pack.bank)&&validLanguage(pack.language)&&typeof pack.src==='string'&&Number.isSafeInteger(pack.count)&&pack.count>=0&&typeof pack.complete==='boolean'&&Number.isSafeInteger(pack.bytes)&&pack.bytes>0&&sha(pack.sha256))
    &&new Set(value.packs.map(pack=>pack.language+'/'+pack.bank)).size===value.packs.length;
}
export function validAudioPack(value,bank,language) {
  return record(value)&&value.version===1&&value.bank===bank&&value.language===language&&record(value.clips)
    &&Object.entries(value.clips).every(([key,clip])=>key.length>0&&record(clip)&&clip.language===language&&typeof clip.text==='string'&&clip.text.trim()&&typeof clip.voiceId==='string'&&Number.isFinite(clip.duration)&&clip.duration>0&&Number.isSafeInteger(clip.bytes)&&clip.bytes>0&&sha(clip.sha256)&&(()=>{try{audioURL(clip.src);return true;}catch{return false;}})());
}
async function readMetadata(src,valid,expected) {
  async function decoded(response) {
    if(response.status!==200)throw Error('录音清单未下载');
    const data=await response.arrayBuffer();
    if(expected){
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(b=>b.toString(16).padStart(2,'0')).join('');
      if(data.byteLength!==expected.bytes||hash!==expected.sha256)throw Error('录音清单校验失败');
    }
    const value=JSON.parse(new TextDecoder().decode(data));if(!valid(value))throw Error('录音清单格式无效');return value;
  }
  const url=metadataURL(src);let cache;
  try{cache=await caches.open(AUDIO_META_CACHE);}catch{}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try {
    const response=await fetch(url,{cache:'no-cache',signal:controller.signal});
    const value=await decoded(response.clone());
    try{await cache?.put(url,response);}catch{}
    return value;
  }catch {
    const saved=cache?await cache.match(url).catch(()=>null):null;
    if(saved){try{return await decoded(saved);}catch{await cache.delete(url).catch(()=>{});}}
    throw Error('录音清单暂不可用，将使用设备语音。');
  }finally{clearTimeout(timer);}
}
export function loadAudioIndex() {
  if(index)return Promise.resolve(index);
  return indexPending??=readMetadata('./data/audio/manifest.json',validAudioIndex).then(value=>index=value).finally(()=>{indexPending=null;});
}
function registerPack(value) {
  const byText=new Map(),byGroup=new Map();
  for(const [key,raw] of Object.entries(value.clips)) {
    const clip={...raw,key,bank:value.bank};
    const text=normalized(clip.text);if(!byText.has(text))byText.set(text,[]);byText.get(text).push(clip);
    const match=/^(.*)\/(\d+)$/.exec(key);
    if(match){if(!byGroup.has(match[1]))byGroup.set(match[1],[]);byGroup.get(match[1]).push({...clip,ordinal:Number(match[2])});}
  }
  const groups=new Map();
  for(const group of byGroup.values()) {
    group.sort((a,b)=>a.ordinal-b.ordinal);
    if(group.length<2||group.some((clip,i)=>clip.ordinal!==i))continue;
    const text=normalized(group.map(clip=>clip.text).join(' '));if(!groups.has(text))groups.set(text,[]);groups.get(text).push(group);
  }
  const loaded={value,byText,groups};packs.set(value.language+'/'+value.bank,loaded);return value;
}
export async function loadAudioPack(bank,language='en') {
  if(!validBank(bank)||!validLanguage(language))throw Error('录音分类无效');
  const key=language+'/'+bank;if(packs.has(key))return packs.get(key).value;
  if(!pending.has(key))pending.set(key,(async()=>{
    const manifest=await loadAudioIndex(),entry=manifest.packs.find(pack=>pack.bank===bank&&pack.language===language);
    if(!entry)throw Error('这一类录音尚未提供，将使用设备语音。');
    const pack=await readMetadata(entry.src,value=>validAudioPack(value,bank,language)&&value.sourceSha256===manifest.sourceSha256,entry);
    return registerPack(pack);
  })().then(value=>{failed.delete(key);return value;},error=>{failed.set(key,Date.now());throw error;}).finally(()=>pending.delete(key)));
  return pending.get(key);
}
export async function prepareRecordedAudio({banks=[],languages=['en']}={}) {
  const wanted=[...new Set(banks)];
  if(languages.includes('en')&&wanted.some(bank=>['part1','part2','listening'].includes(bank)))wanted.push('labels');
  return Promise.allSettled([...new Set(wanted)].flatMap(bank=>languages.map(language=>loadAudioPack(bank,language))));
}
// Playback can wait for only the missing metadata. Failed requests briefly permit a
// synchronous system-voice retry instead of trapping offline users in another fetch.
export function unloadedAudioPacks(turns,{language='en',bank,seed=''}={}) {
  const wanted=new Map();
  for(const turn of turns){
    const lang=turn.language||language,target=turn.bank||bank||inferAudioBank(turn.key||turn.audioKey||seed);
    if(!target)continue;
    wanted.set(lang+'/'+target,{bank:target,language:lang});
    if(lang==='en'&&['part1','part2','listening'].includes(target))wanted.set('en/labels',{bank:'labels',language:'en'});
  }
  return [...wanted].filter(([key])=>!packs.has(key)&&Date.now()-(failed.get(key)||0)>30000).map(([,value])=>value);
}
export function inferAudioBank(key='') {
  return /^v-/.test(key)?'vocab':/^p1-/.test(key)?'part1':/^p2-/.test(key)?'part2':/^p[34]-/.test(key)?'listening':/^gram-/.test(key)?'grammar':/^read-/.test(key)?'reading':/^labels\//.test(key)?'labels':null;
}
export function getAudioClip(key,{bank=inferAudioBank(key),language='en'}={}) {
  const candidates=bank?[packs.get(language+'/'+bank)]:[...packs.entries()].filter(([name])=>name.startsWith(language+'/')).map(([,pack])=>pack);
  for(const pack of candidates){const clip=pack?.value.clips[key];if(clip)return {...clip,key,bank:pack.value.bank};}
  return null;
}
function exactClips(text,{bank,language='en',seed='',speaker}={}) {
  const wanted=normalized(text);let choices=[];
  for(const [name,pack] of packs){if(!name.startsWith(language+'/')||bank&&pack.value.bank!==bank)continue;
    for(const clip of pack.byText.get(wanted)||[])choices.push([clip]);
    for(const group of pack.groups.get(wanted)||[])choices.push(group);
  }
  if(seed){
    // A word's other sense may extend its ID with a hyphen and have a different
    // pronunciation. Prefer the exact record before related question IDs.
    const direct=choices.filter(clips=>clips[0].key.startsWith(seed+'/'));
    const scoped=direct.length?direct:choices.filter(clips=>clips[0].key.startsWith(seed+'-'));
    if(scoped.length||bank==='listening'||/^p[34]-/.test(seed))choices=scoped;
  }
  if(speaker&&choices.some(clips=>clips[0].speaker))choices=choices.filter(clips=>clips[0].speaker===speaker);
  return choices.sort((a,b)=>a[0].key.localeCompare(b[0].key))[0]||null;
}
export function resolveAudioPieces(turns,{language='en',bank,seed=''}={}) {
  return turns.flatMap((turn,turnIndex)=>{
    const lang=turn.language||language,context={language:lang,bank:turn.bank||bank,seed:turn.seed||seed,speaker:turn.speaker};
    const keys=turn.keys||((turn.key||turn.audioKey)?[turn.key||turn.audioKey]:null);
    const exactHead=keys?.length===1&&/^(?:v-|lex-)[^/]+\/meaning$/.test(keys[0]);
    let clips=keys?.map(key=>getAudioClip(key,context));
    if(clips?.some(clip=>!clip)||clips&&normalized(clips.map(clip=>clip.text).join(' '))!==normalized(turn.text))clips=null;
    if(!clips&&!exactHead)clips=exactClips(turn.text,context);
    // Only untyped choices may reuse a word head. Explicit vocabulary or external
    // lexeme senses must keep their own pronunciation; missing clips use speech.
    if(!clips&&!exactHead&&lang==='en'&&/^[\p{L}][\p{L}'’ -]*$/u.test(turn.text.trim())){
      const heads=packs.get('en/vocab')?.byText.get(normalized(turn.text))||[];
      const head=heads.find(clip=>clip.key.endsWith('/meaning'));if(head)clips=[head];
    }
    const prefix=/^([A-D])\.\s+([\s\S]+)$/.exec(turn.text);
    if(!clips&&prefix){
      const body=exactClips(prefix[2],context);
      if(body){const label=getAudioClip(`labels/${body[0].voiceId}/${prefix[1]}`,{language:'en',bank:'labels'});if(label)clips=[label,...body];}
    }
    return clips?clips.map(clip=>({...clip,speaker:turn.speaker,turnIndex})): [{text:turn.text,speaker:turn.speaker,language:lang,turnIndex,key:turn.key||turn.audioKey||''}];
  });
}

let media,run=null,serial=0,delay=0;
const rateOf=prefs=>Math.min(1.2,Math.max(.75,Number(prefs?.rate)||1));
function element() {
  if(media)return media;
  media=document.createElement('audio');media.preload='none';media.setAttribute('playsinline','');media.hidden=true;media.id='recorded-audio-player';
  (document.body||document.documentElement).append(media);return media;
}
export function recordedAudioElement(){return media||null;}
export function cancelRecordedAudio() {
  serial++;clearTimeout(delay);delay=0;
  const previous=run;run=null;
  if(media){media.onended=null;media.onerror=null;media.onplaying=null;media.pause();media.removeAttribute('src');media.load();}
  previous?.onCancel?.();
}
export function unlockRecordedAudio() {
  const audio=element();if(run)return Promise.resolve(true);
  const ticket=serial;audio.src='data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';
  try{return Promise.resolve(audio.play()).then(()=>{if(ticket===serial&&!run){audio.pause();audio.removeAttribute('src');audio.load();}return true;},()=>false);}catch{return Promise.resolve(false);}
}
export function playAudioPieces(pieces,prefs={},hooks={}) {
  if(!pieces.length)return false;
  cancelRecordedAudio();
  const current=run={...hooks,pieces,index:0,token:serial,started:false,paused:false,inGap:false,system:false,item:0};
  const valid=()=>run===current&&current.token===serial;
  const fail=error=>{if(!valid())return;cancelRecordedAudio();hooks.onError?.(error);};
  const gap=Math.min(1500,Math.max(0,Number.isFinite(Number(prefs.audioGapMs))?Number(prefs.audioGapMs):200));
  function start() {
    if(!valid()||current.paused)return;
    current.inGap=false;const piece=pieces[current.index],item=++current.item,position=current.index;
    let pieceStarted=false,finished=false,fellBack=false;
    const itemValid=()=>valid()&&current.item===item&&!finished;
    const started=()=>{if(!itemValid()||pieceStarted)return;pieceStarted=true;if(!current.started){current.started=true;hooks.onStart?.();}hooks.onSegment?.(piece,position);};
    const ended=()=>{
      if(!itemValid())return;finished=true;hooks.onSegmentEnd?.(piece,position);
      current.index++;
      if(current.index>=pieces.length){if(hooks.loop)current.index=0;else{run=null;hooks.onEnd?.();return;}}
      current.inGap=true;if(!current.paused)delay=setTimeout(start,gap);
    };
    const fallback=()=>{
      if(!itemValid()||fellBack)return;if(pieceStarted&&hooks.noFallbackAfterStart){fail(Error('录音中途停止，请从当前进度继续。'));return;}fellBack=true;current.system=true;
      try{if(!hooks.fallback?.(piece,{onStart:started,onEnd:ended,onError:error=>{if(itemValid())fail(error);}}))fail(Error('没有可用的录音或设备语音'));}catch(error){fail(error);}
    };
    if(!piece.src){fallback();return;}
    current.system=false;const audio=element();
    try{
      const url=audioURL(piece.src);audio.onended=null;audio.onerror=null;audio.onplaying=null;audio.pause();audio.src=url;audio.load();
      audio.playbackRate=rateOf(prefs);audio.preservesPitch=true;if('webkitPreservesPitch' in audio)audio.webkitPreservesPitch=true;
      audio.onplaying=()=>{if(itemValid()&&!fellBack&&audio.src===url)started();};
      audio.onended=()=>{if(itemValid()&&!fellBack&&audio.src===url&&audio.ended)ended();};
      const failed=()=>{if(!itemValid()||audio.src!==url||fellBack)return;audio.onended=null;audio.onplaying=null;audio.onerror=null;audio.pause();fallback();};
      audio.onerror=failed;
      const playing=audio.play();playing?.then(()=>{if(itemValid()&&!fellBack&&audio.src===url&&!audio.paused)started();}).catch(failed);
    }catch{fallback();}
  }
  current.start=start;start();return true;
}
export function pauseRecordedAudio() {
  if(!run)return false;run.paused=true;
  if(run.inGap){clearTimeout(delay);delay=0;}else if(run.system)window.speechSynthesis?.pause();else media?.pause();
  return true;
}
export function resumeRecordedAudio() {
  if(!run?.paused)return false;run.paused=false;
  if(run.inGap)run.start();
  else if(run.system)window.speechSynthesis?.resume();else media?.play()?.catch(()=>{});return true;
}
