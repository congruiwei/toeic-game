import assert from 'node:assert/strict';
import { japaneseVoices, speakJapanese } from '../js/japanese-audio.js';
import { hush } from '../js/audio.js';

const voice = (name, lang = 'ja-JP', voiceURI = name) => ({ name, lang, voiceURI });
const kyoko = voice('Kyoko (Enhanced)', 'ja-JP', 'com.apple.voice.enhanced.ja-JP.Kyoko');
const otoya = voice('Otoya');
const premium = voice('Japanese Voice (Premium)');
const foreign = voice('Samantha', 'en-US');
const voices = [foreign, voice('Bad_News'), voice('Whisper'),
  voice('Legacy Kyoko', 'ja-JP', 'com.apple.speech.synthesis.voice.kyoko'),
  voice('Generic'), otoya, kyoko, premium, kyoko, voice('Not Japanese', 'javanese')];
assert.deepEqual(japaneseVoices(voices).map(v => v.name),
  ['Japanese Voice (Premium)', 'Kyoko (Enhanced)', 'Otoya', 'Generic']);
assert.deepEqual(japaneseVoices([voice('Kyoko', 'ja_JP')]).map(v => v.lang), ['ja_JP']);
assert.deepEqual(japaneseVoices([foreign]), []);

const spoken = [], messages = [];
let installed = voices, cancellations = 0, throws = false;
globalThis.window = {
  SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
  speechSynthesis: {
    getVoices: () => installed,
    cancel: () => { cancellations++; },
    speak: item => { if (throws) throw Error('audio unavailable'); spoken.push(item); }
  }
};
globalThis.speechSynthesis = window.speechSynthesis;
const notify = text => messages.push(text);
assert.deepEqual(japaneseVoices(), japaneseVoices(voices));

// A valid stored voice is honored; the call is synchronous rather than waiting for voiceschanged.
const result = speakJapanese('会議は月曜日です。', { japaneseVoice: 'Otoya', rate: 0.9 }, notify);
assert.equal(result, true);
assert.equal(spoken.length, 1);
assert.equal(spoken[0].voice, otoya);
assert.equal(spoken[0].lang, 'ja-JP');
assert.equal(spoken[0].rate, 0.9);
assert.equal(cancellations, 1);

speakJapanese('試聴します。', { japaneseVoice: 'Otoya', rate: 1.2 }, notify, { preview: kyoko.voiceURI });
assert.equal(spoken.at(-1).voice, kyoko);
const replaced = spoken[0];
replaced.onerror({ error: 'voice-unavailable' });
assert.equal(messages.length, 0, 'replaced utterances cannot report a stale failure');

speakJapanese('こんにちは。', { japaneseVoice: foreign.voiceURI, rate: 20 }, notify);
assert.equal(spoken.at(-1).voice, premium, 'an English saved voice never enters the Japanese pool');
assert.equal(spoken.at(-1).rate, 1.2);
speakJapanese('こんにちは。', { rate: 0.1 }, notify, { preview: 'missing' });
assert.equal(spoken.at(-1).rate, 0.75);
assert.equal(spoken.at(-1).voice, premium);

installed = [foreign];
const before = spoken.length;
assert.equal(speakJapanese('予約を確認します。', {}, notify), false);
assert.equal(spoken.length, before);
assert.match(messages.pop(), /未发现可用的日语语音/);
installed = [voice('Whisper'), voice('Old', 'ja-JP', 'com.apple.speech.synthesis.voice.old')];
assert.equal(speakJapanese('予約を確認します。', {}, notify), false);
assert.equal(spoken.length, before);
assert.match(messages.pop(), /未发现可用的日语语音/);

// An unpopulated iOS voice list still permits a native Japanese attempt in the original gesture.
installed = [];
assert.equal(speakJapanese('日本語の音声です。', {}, notify), true);
assert.equal(spoken.length, before + 1);
assert.equal(spoken.at(-1).lang, 'ja-JP');
assert.equal(spoken.at(-1).voice, undefined);
assert.equal(spoken.at(-1).rate, 1);
spoken.at(-1).onerror({ error: 'language-unavailable' });
assert.match(messages.pop(), /日语声音未能播放/);

speakJapanese('停止します。', {}, notify);
spoken.at(-1).onerror({ error: 'canceled' });
assert.equal(messages.length, 0);
speakJapanese('停止します。', {}, notify);
spoken.at(-1).onerror({ error: 'interrupted' });
assert.equal(messages.length, 0);
const cancelsBeforeHush = cancellations;
hush();
assert.equal(cancellations, cancelsBeforeHush + 1, 'navigation uses the shared global speech cancellation');

throws = true;
assert.equal(speakJapanese('再試行します。', {}, notify), false);
assert.match(messages.pop(), /日语朗读未能启动/);
throws = false;
assert.equal(speakJapanese('   ', {}, notify), false);
const synthesis = window.speechSynthesis;
window.speechSynthesis = undefined;
assert.equal(speakJapanese('こんにちは。', {}, notify), false);
assert.match(messages.pop(), /此浏览器无法朗读/);
window.speechSynthesis = synthesis;
window.SpeechSynthesisUtterance = undefined;
assert.equal(speakJapanese('こんにちは。', {}, notify), false);
assert.match(messages.pop(), /此浏览器无法朗读/);
console.log('PASS Japanese voice filtering, quality, preferences, synchronous start and failure paths');
