import { hush, quality, voiceKey } from './audio.js';

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

// Keep speak() in the initiating click stack, including when iOS has not listed voices yet.
export function speakJapanese(text, prefs = {}, notify = () => {}, { preview = '' } = {}) {
  const synthesis = window.speechSynthesis;
  if (!synthesis || !window.SpeechSynthesisUtterance) {
    notify('此浏览器无法朗读，请在 Safari 中测试日语语音。');
    return false;
  }
  if (!text?.trim()) return false;
  hush();
  const raw = synthesis.getVoices(), list = japaneseVoices(raw);
  if (raw.length && !list.length) {
    notify('未发现可用的日语语音，请在 iPhone 设置中下载日语声音。');
    return false;
  }
  const voice = list.find(item => voiceKey(item) === (preview || prefs.japaneseVoice)) || list[0];
  const current = new window.SpeechSynthesisUtterance(text);
  utterance = current;
  current.lang = voice?.lang || 'ja-JP';
  if (voice) current.voice = voice;
  const rate = Number(prefs.rate);
  current.rate = Number.isFinite(rate) ? Math.min(1.2, Math.max(0.75, rate)) : 1;
  current.onend = () => { if (utterance === current) utterance = null; };
  current.onerror = event => {
    if (utterance !== current) return;
    utterance = null;
    if (!['canceled', 'interrupted'].includes(event.error)) {
      notify('日语声音未能播放，请在设置中试听。');
    }
  };
  try {
    synthesis.speak(current);
    return true;
  } catch {
    utterance = null;
    hush();
    notify('日语朗读未能启动，请再点一次。');
    return false;
  }
}
