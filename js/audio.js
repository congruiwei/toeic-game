import { cancelRecordedAudio, playAudioPieces, resolveAudioPieces, unloadedAudioPacks, loadAudioPack, unlockRecordedAudio } from './recorded-audio.js';
let ctx;
export function tone(kind, enabled) {
  if (!enabled) return;
  try {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    ctx ??= new C();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const notes =
      kind === 'evolve'
        ? [392, 494, 587, 784, 988]
        : kind === 'level'
          ? [440, 554, 659, 880]
          : [659, 880];
    notes.forEach((f, i) => {
      const osc = ctx.createOscillator(),
        g = ctx.createGain();
      const t = ctx.currentTime + i * 0.105;
      osc.type = 'sine';
      osc.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.065, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.25);
    });
  } catch {}
}
let active = [],
  generation = 0;
let cleanup;
export const audioGeneration = () => generation;
export function setAudioCleanup(callback) { cleanup=callback; }
export function hush() {
  generation++;
  cancelRecordedAudio();
  if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
  active = [];
  const previous=cleanup;cleanup=null;previous?.();
}
export const accents = ['en-US','en-GB','en-AU','en-CA'];
const novelty = /\b(albert|bad news|bells|boing|bubbles|jester|trinoids|whisper|zarvox|good news|cellos|deranged|hysterical|pipe organ|wobble|bahh)\b/i;
const eloquence = /eloquence|\b(eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/i;
const names = /\b(samantha|ava|allison|tom|zoe|evan|nathan|daniel|kate|serena|karen|lee)\b/i;
const traits = v => (v.name+' '+v.voiceURI).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[_-]/g,' ');
export const voiceKey = v => v.voiceURI || v.name+'|'+v.lang;
// Insertion positions are display cues, not spoken numbers. Keep all other text.
export const systemSpeechText = text => String(text ?? '').replace(/\[[1-4]\]/g, '').trim();
export const quality = v => /premium|高级|高級/i.test(traits(v))?2:/enhanced|增强|增強/i.test(traits(v))?1:0;
const person = v => (v.name || v.voiceURI).replace(/\s*[（(].*?[）)]/g,'').trim().toLowerCase();
const gender = v => /\b(samantha|ava|allison|zoe|kate|serena|karen|tessa|moira)\b/i.test(traits(v))?'f':/\b(tom|evan|nathan|daniel|lee|oliver|aaron)\b/i.test(traits(v))?'m':'';
const language = v => v.lang.replace('_','-').toLowerCase();
export function englishVoices(list) {
  const safe = list.filter(v => /^en(?:[-_]|$)/i.test(v.lang) && !/com\.apple\.speech\.synthesis/i.test(v.voiceURI) && !novelty.test(traits(v)));
  const normal = safe.filter(v => !eloquence.test(traits(v)));
  return [...new Map((normal.length?normal:safe).map(v=>[voiceKey(v),v])).values()]
    .sort((a,b)=>quality(b)-quality(a)||Number(names.test(traits(b)))-Number(names.test(traits(a)))||a.name.localeCompare(b.name));
}
export const voices = () => englishVoices(window.speechSynthesis?.getVoices() || []);

export function castVoices(turns, prefs, seed, list) {
  const cast = [...new Set(turns.map(t=>t.speaker))], assigned = new Map();
  const start = Math.max(0, Number((String(seed).match(/\d+/g)||['1']).at(-1))-1);
  const installed = accents.filter(a=>list.some(v=>language(v)===a.toLowerCase()));
  const rotating = installed.length ? installed : accents;
  for(const s of cast){
    const selected=list.find(v=>voiceKey(v)===prefs.voiceSlots?.[s]);
    if(selected && ![...assigned.values()].includes(selected))assigned.set(s,selected);
  }
  for(const s of cast){
    if(assigned.has(s))continue;
    const assignedVoices=[...assigned.values()], i=Math.max(0,'ABC'.indexOf(s));
    const target=!prefs.accent||prefs.accent==='auto'?rotating[(start+i)%rotating.length]:prefs.accent;
    const distinct=list.filter(v=>!assignedVoices.includes(v));
    const rank=v=>Number(assignedVoices.some(w=>person(w)===person(v)))*100
      +Number(language(v)!==target.toLowerCase())*20 + (2-quality(v))*5
      +Number(!!gender(v)&&assignedVoices.some(w=>gender(w)===gender(v)))*2
      +Number(!names.test(traits(v)));
    const choice=(distinct.length?distinct:[...list]).sort((a,b)=>rank(a)-rank(b))[0];
    if(choice)assigned.set(s,choice);
  }
  return assigned;
}
export function speak(turns, prefs={}, fail=()=>{}, options={}) {
  const {seed='',preview='',onEnd,onStart,onCancel,onSegment,onSegmentEnd,castTurns=turns,bank,loop=false,noFallbackAfterStart=false}=options;
  hush();
  if(!turns?.length)return false;
  if(!turns.some(piece=>systemSpeechText(piece.systemText ?? piece.text))){onEnd?.();return true;}
  const raw=window.speechSynthesis?.getVoices()||[],list=englishVoices(raw);
  const cast=castVoices(castTurns,prefs,seed,list),token=generation;
  const available=()=>Boolean(window.speechSynthesis&&window.SpeechSynthesisUtterance&&(!raw.length||list.length));
  function utter(piece,callbacks) {
    const text=systemSpeechText(piece.systemText ?? piece.text);
    if(!text){callbacks.onEnd?.();return true;}
    if(!available())return false;
    const u=new window.SpeechSynthesisUtterance(text),speaker=piece.speaker||'A';
    const voice=(preview&&list.find(v=>voiceKey(v)===preview))||cast.get(speaker);
    if(voice)u.voice=voice;
    u.lang=voice?.lang||(!prefs.accent||prefs.accent==='auto'?'en-US':prefs.accent);
    u.rate=Math.min(1.2,Math.max(.75,Number(prefs.rate)||1));
    const i=Math.max(0,'ABC'.indexOf(speaker));
    u.pitch=list.length<cast.size||!list.length||new Set(cast.values()).size<cast.size?[1,1.12,.88][i]:1;
    u.onstart=()=>{if(token===generation)callbacks.onStart?.();};
    u.onend=()=>{if(token!==generation)return;active=active.filter(x=>x!==u);callbacks.onEnd?.();};
    u.onerror=event=>{if(token===generation&&!['canceled','interrupted'].includes(event.error))callbacks.onError?.(event);};
    active.push(u);window.speechSynthesis.speak(u);return true;
  }
  const failure=()=>{hush();fail('声音未能播放，请再次点击，或在设置中测试设备英语语音。');};
  const useRecorded=!preview&&prefs.audioMode!=='system';
  const resolve=()=>resolveAudioPieces(turns,{seed,bank});
  const play=pieces=>playAudioPieces(pieces,prefs,{onStart,onEnd,onCancel,onSegment,onSegmentEnd,loop,noFallbackAfterStart,fallback:utter,onError:failure});
  const missing=useRecorded?unloadedAudioPacks(turns,{seed,bank}):[];
  if(missing.length){
    // Unlock the shared media element in this trusted click, before fetching metadata.
    setAudioCleanup(onCancel);unlockRecordedAudio();
    Promise.allSettled(missing.map(({bank,language})=>loadAudioPack(bank,language))).then(()=>{
      if(token!==generation)return;
      const pieces=resolve();
      if(pieces.some(piece=>piece.src)){cleanup=null;play(pieces);}
      else{hush();fail('此句录音暂不可用，请再点一次使用设备英语语音。');}
    });
    return true;
  }
  const pieces=useRecorded?resolve():[];
  if(pieces.some(piece=>piece.src))return play(pieces);
  if(!available()){fail(raw.length?'未发现可用的英语语音。请在系统设置中下载英语声音后重试。':'此浏览器无法朗读。请在 Safari 中测试英语语音。');return false;}
  // Queue every system utterance synchronously in the trusted click for iOS.
  let started=false,remaining=turns.length;
  setAudioCleanup(onCancel);
  try{turns.forEach((piece,i)=>utter(piece,{
    onStart(){if(!started){started=true;onStart?.();}onSegment?.(piece,i);},
    onEnd(){onSegmentEnd?.(piece,i);if(--remaining===0){cleanup=null;onEnd?.();}},onError:failure
  }));return true;}catch{failure();return false;}
}
