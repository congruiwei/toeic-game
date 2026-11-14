import assert from 'node:assert/strict';
import {accents,englishVoices,castVoices} from '../js/audio.js';
const data=[['Ava (Premium)','en-US'],['Samantha','en-US'],['Daniel (Enhanced)','en-GB'],['Karen','en-AU'],['Claire','en-CA'],['Flo','en-US'],['Bad News','en-US'],['Eleanor','en-GB','com.apple.speech.synthesis.legacy']];
const list=englishVoices(data.map(([name,lang,voiceURI=name])=>({name,lang,voiceURI})));
assert.equal(list.length,5);
const turns=['A','B','C'].map(speaker=>({speaker}));
const primary=accents.map((_,i)=>{
 const cast=castVoices(turns,{accent:'auto'},'p2-'+(i+1),list);
 assert.equal(new Set(cast.values()).size,3);
 return cast.get('A').lang;
});
assert.deepEqual(primary,accents);
assert.equal(castVoices(turns,{accent:'auto',voiceSlots:{B:'Claire'}},'p3-g09',list).get('B').name,'Claire');
console.log('PASS voice quality, exclusions, four-accent rotation and distinct manual cast');
