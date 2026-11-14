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
export function hush() {
  generation++;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  active = [];
}
export const accents = ['en-US','en-GB','en-AU','en-CA'];
const novelty = /\b(albert|bad news|bells|boing|bubbles|jester|trinoids|whisper|zarvox|good news|cellos|deranged|hysterical|pipe organ|wobble|bahh)\b/i;
const eloquence = /eloquence|\b(eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/i;
const names = /\b(samantha|ava|allison|tom|zoe|evan|nathan|daniel|kate|serena|karen|lee)\b/i;
const traits = v => (v.name+' '+v.voiceURI).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[_-]/g,' ');
export const voiceKey = v => v.voiceURI || v.name+'|'+v.lang;
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
    const target=prefs.accent==='auto'?rotating[(start+i)%rotating.length]:prefs.accent;
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
export function speak(turns, prefs, fail, {seed='',preview='',onEnd,onStart}={}) {
  hush();
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) { fail('此浏览器无法朗读。请在 Safari 中测试英语语音。'); return; }
  const raw=speechSynthesis.getVoices(),list=englishVoices(raw);
  if(raw.length && !list.length){fail('未发现可用的英语语音。请在系统设置中下载英语声音后重试。');return;}
  const cast=castVoices(turns,prefs,seed,list), token=generation;
  let started=false;
  active=turns.map(({text,speaker},i)=>{
    const u=new SpeechSynthesisUtterance(text);
    const voice=(preview && list.find(v=>voiceKey(v)===preview))||cast.get(speaker);
    if(voice)u.voice=voice;
    u.lang=voice?.lang||(prefs.accent==='auto'?'en-US':prefs.accent);
    u.rate=prefs.rate;
    const index=Math.max(0,'ABC'.indexOf(speaker));
    u.pitch=list.length<cast.size||!list.length||new Set(cast.values()).size<cast.size?[1,1.12,.88][index]:1;
    u.onstart=()=>{if(token===generation&&!started){started=true;onStart?.();}};
    u.onerror=e=>{if(token!==generation)return;hush();fail('声音未能播放，请在设置中测试已安装的英语语音。');};
    if(i===turns.length-1)u.onend=()=>{if(token===generation){active=[];onEnd?.();}};
    return u;
  });
  try{for(const u of active)speechSynthesis.speak(u);}catch{hush();fail('朗读启动失败，请重新测试声音。');}
}
