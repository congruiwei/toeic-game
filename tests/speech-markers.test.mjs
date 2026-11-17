import assert from 'node:assert/strict';
import test, {beforeEach} from 'node:test';
import {hush, speak, systemSpeechText} from '../js/audio.js';
import {speakJapanese} from '../js/japanese-audio.js';

let spoken, messages;
beforeEach(()=>{
  hush();spoken=[];messages=[];
  globalThis.window={
    SpeechSynthesisUtterance:class {constructor(text){this.text=text;}},
    speechSynthesis:{
      getVoices:()=>[{name:'Ava',lang:'en-US',voiceURI:'en'},{name:'Kyoko',lang:'ja-JP',voiceURI:'ja'}],
      cancel(){},
      speak(utterance){spoken.push(utterance);utterance.onstart?.();}
    }
  };
});

test('only exact insertion markers are removed; dates, prices, models and other numbers remain',()=>{
  assert.equal(systemSpeechText('[1] On 3/4 at 9:30, buy 12 A4 sheets for $35. [2]'),
    'On 3/4 at 9:30, buy 12 A4 sheets for $35.');
  assert.equal(systemSpeechText('[3] Keep [5], [12], [02] and [2.0]. [4]'),
    'Keep [5], [12], [02] and [2.0].');
});

for(const audioMode of ['system','recorded']){
  test(`English ${audioMode} path skips marker-only queue items and completes every real utterance`,()=>{
    const first='[1] On 3/4, model A4 costs $35 at 9:30. [2]';
    const last='[3] Keep 12 copies and reference [5]. [4]';
    const turns=[{text:'[1] [2]'},{text:first},{text:'[3]'},{text:last}];
    let ended=0,started=0;
    assert.equal(speak(turns,{audioMode},text=>messages.push(text),{
      onStart(){started++;},onEnd(){ended++;}
    }),true);
    assert.deepEqual(spoken.map(u=>u.text),[
      'On 3/4, model A4 costs $35 at 9:30.',
      'Keep 12 copies and reference [5].'
    ]);
    assert.equal(started,1);assert.equal(ended,0);
    spoken[0].onend();assert.equal(ended,0);
    spoken[1].onend();assert.equal(ended,1);
    assert.deepEqual(turns.map(t=>t.text),['[1] [2]',first,'[3]',last],'display/source text is unchanged');
    assert.deepEqual(messages,[]);
  });

  test(`Japanese ${audioMode} path skips a marker-only item and continues through its completion hook`,()=>{
    const text='[1] 11月17日9:30、A4用紙を3枚、$35で購入します。[2] 1箱は12冊です。[4]';
    let ended=0,started=0;
    const notify=text=>messages.push(text);
    assert.equal(speakJapanese('[1] [2] [3] [4]',{audioMode},notify,{onEnd(){
      ended++;
      speakJapanese(text,{audioMode},notify,{onStart(){started++;},onEnd(){ended++;}});
    }}),true);
    assert.deepEqual(spoken.map(u=>u.text),['11月17日9:30、A4用紙を3枚、$35で購入します。 1箱は12冊です。']);
    assert.equal(spoken[0].lang,'ja-JP');assert.equal(started,1);assert.equal(ended,1);
    spoken[0].onend();assert.equal(ended,2);
    assert.deepEqual(messages,[]);
  });
}

test('a marker-only request completes once without a voice, media fetch or empty utterance',()=>{
  window.speechSynthesis=undefined;
  let english=0,japanese=0;
  assert.equal(speak([{text:'[1] [4]'}],{},text=>messages.push(text),{loop:true,onEnd(){english++;}}),true);
  assert.equal(speakJapanese('[2] [3]',{},text=>messages.push(text),{loop:true,onEnd(){japanese++;}}),true);
  assert.equal(english,1);assert.equal(japanese,1);
  assert.deepEqual(spoken,[]);assert.deepEqual(messages,[]);
});
