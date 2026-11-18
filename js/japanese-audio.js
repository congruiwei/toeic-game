import { hush, quality, voiceKey, audioGeneration, setAudioCleanup, systemSpeechText } from './audio.js';
import { playAudioPieces, resolveAudioPieces, unloadedAudioPacks, loadAudioPack, unlockRecordedAudio } from './recorded-audio.js';

let utterance;
const novelty = /\b(albert|bad news|bells|boing|bubbles|jester|trinoids|whisper|zarvox|good news|cellos|deranged|hysterical|pipe organ|wobble|bahh)\b/i;
const traits = voice => `${voice.name} ${voice.voiceURI}`.replace(/[_-]/g, ' ');
const preferred = voice => /\b(kyoko|otoya)\b/i.test(traits(voice));

export function japaneseVoices(list = window.speechSynthesis?.getVoices() || []) {
  const safe = list.filter(voice => /^ja(?:[-_]|$)/i.test(voice.lang)
    && !/com\.apple\.speech\.synthesis/i.test(voice.voiceURI)
    && !novelty.test(traits(voice)));
  return [...new Map(safe.map(voice => [voiceKey(voice), voice])).values()]
    .sort((a, b) => quality(b) - quality(a)
      || Number(preferred(b)) - Number(preferred(a))
      || a.name.localeCompare(b.name));
}

// The first audio.play()/speak() stays in the initiating click stack on iOS.
export function speakJapanese(text,prefs={},notify=()=>{},options={}) {
  const {preview='',key,bank,seed='',onStart,onEnd,onCancel,onSegment,onSegmentEnd,loop=false}=options;
  if(!text?.trim())return false;
  hush();
  if(!systemSpeechText(text)){onEnd?.();return true;}
  const token=audioGeneration(),synthesis=window.speechSynthesis;
  const raw=synthesis?.getVoices()||[],list=japaneseVoices(raw);
  const available=()=>Boolean(synthesis&&window.SpeechSynthesisUtterance&&(!raw.length||list.length));
  const voice=list.find(item=>voiceKey(item)===(preview||prefs.japaneseVoice))||list[0];
  const failure=()=>{hush();notify('日语声音未能播放，请再次点击，或在设置中试听设备日语语音。');};
  function utter(piece,callbacks) {
    const text=systemSpeechText(piece.text);
    if(!text){callbacks.onEnd?.();return true;}
    if(!available())return false;
    const current=new window.SpeechSynthesisUtterance(text);utterance=current;
    current.lang=voice?.lang||'ja-JP';if(voice)current.voice=voice;
    current.rate=Math.min(1.2,Math.max(.75,Number(prefs.rate)||1));
    current.onstart=()=>{if(token===audioGeneration())callbacks.onStart?.();};
    current.onend=()=>{if(token===audioGeneration()&&utterance===current){utterance=null;callbacks.onEnd?.();}};
    current.onerror=event=>{if(token===audioGeneration()&&utterance===current&&!['canceled','interrupted'].includes(event.error)){utterance=null;callbacks.onError?.(event);}};
    synthesis.speak(current);return true;
  }
  const turns=[{text,key,bank,language:'ja'}],useRecorded=!preview&&prefs.audioMode!=='system';
  const resolve=()=>resolveAudioPieces(turns,{language:'ja',seed,bank});
  const play=pieces=>playAudioPieces(pieces,prefs,{onStart,onEnd,onCancel,onSegment,onSegmentEnd,loop,fallback:utter,onError:failure});
  const missing=useRecorded?unloadedAudioPacks(turns,{language:'ja',seed,bank}):[];
  if(missing.length){
    setAudioCleanup(onCancel);unlockRecordedAudio();
    Promise.allSettled(missing.map(({bank,language})=>loadAudioPack(bank,language))).then(()=>{
      if(token!==audioGeneration())return;
      const pieces=resolve();
      if(pieces.some(piece=>piece.src)){setAudioCleanup(null);play(pieces);}
      else{hush();notify(pieces.some(piece=>piece.playback==='system')?'此句使用设备日语语音，请再点一次开始。':'此句录音暂不可用，请再点一次使用设备日语语音。');}
    });
    return true;
  }
  const pieces=useRecorded?resolve():[];
  if(pieces.some(piece=>piece.src))return play(pieces);
  if(!available()){notify(raw.length?'未发现可用的日语语音，请在 iPhone 设置中下载日语声音。':'此浏览器无法朗读，请在 Safari 中测试日语语音。');return false;}
  setAudioCleanup(onCancel);
  try{return utter({text},{onStart,onEnd(){setAudioCleanup(null);onEnd?.();},onError:failure});}catch{hush();utterance=null;notify('日语朗读未能启动，请再点一次。');return false;}
}
