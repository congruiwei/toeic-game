import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {speak,hush} from '../js/audio.js';
import {loadAudioPack,resolveAudioPieces} from '../js/recorded-audio.js';
import {morphemeSpelling} from '../js/word-enrichment.js';
const digest=x=>createHash('sha256').update(x).digest('hex');
const hash='a'.repeat(64),clip={text:'re-',spoken:'R. E.',voiceId:'af_heart',language:'en',src:'./audio/generated/en/af_heart/'+hash.slice(0,32)+'.m4a',duration:1,bytes:30,sha256:hash};
const pack={version:1,sourceSha256:hash,bank:'vocab',language:'en',complete:true,clips:{'morph-pre-re/forms/0':clip}};
const body=JSON.stringify(pack),index={version:1,complete:true,sourceSha256:hash,packs:[{bank:'vocab',language:'en',count:1,complete:true,src:'./data/audio/en/vocab.json',bytes:Buffer.byteLength(body),sha256:digest(body)}]};
const spoken=[];let media;
globalThis.window={SpeechSynthesisUtterance:class{constructor(text){this.text=text;}},speechSynthesis:{getVoices:()=>[{name:'Ava',lang:'en-US',voiceURI:'ava'}],cancel(){},speak(u){spoken.push(u);u.onstart?.();}}};
globalThis.document={createElement(){return media={src:'',paused:true,ended:false,setAttribute(){},removeAttribute(){this.src='';},load(){},pause(){this.paused=true;},play(){this.paused=false;this.onplaying?.();return Promise.resolve();}};},body:{append(){}}};
globalThis.fetch=async url=>Response.json(String(url).endsWith('manifest.json')?index:pack);
const turn={speaker:'A',text:'re-',key:'morph-pre-re/forms/0',bank:'vocab',systemText:morphemeSpelling('re-')};
test('spelling uses explicit letter names without changing source text',()=>{
 assert.equal(morphemeSpelling('-ion'),'I. O. N.');assert.equal(morphemeSpelling('im-'),'I. M.');
 speak([turn,{text:'portable'}],{audioMode:'system'});assert.deepEqual(spoken.map(u=>u.text),['R. E.','portable']);assert.equal(turn.text,'re-');hush();
});
test('recording resolves by exact displayed form and failed playback spells the same letters',async()=>{
 spoken.length=0;await loadAudioPack('vocab');const pieces=resolveAudioPieces([turn]);
 assert.equal(pieces[0].src,clip.src);assert.equal(pieces[0].text,'re-');assert.equal(pieces[0].systemText,'R. E.');
 speak([turn],{audioMode:'recorded'});assert.equal(spoken.length,0);media.onerror();assert.deepEqual(spoken.map(u=>u.text),['R. E.']);hush();
});
test('missing morphology recording keeps spelling on system fallback',()=>{
 spoken.length=0;const absent={...turn,text:'-ion',key:'morph-suf-ion/forms/0',systemText:morphemeSpelling('-ion')};
 assert.equal(resolveAudioPieces([absent])[0].src,undefined);assert.equal(resolveAudioPieces([absent])[0].systemText,'I. O. N.');
 speak([absent],{audioMode:'recorded'});assert.deepEqual(spoken.map(u=>u.text),['I. O. N.']);hush();
});
