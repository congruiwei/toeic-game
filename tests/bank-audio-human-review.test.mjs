import test from 'node:test';
import assert from 'node:assert/strict';
import {validateHumanReview,humanReviewState} from '../scripts/audio-human-review.mjs';
import {eligibleVoiceOverride,selectedVoice} from '../scripts/audio-voice-override.mjs';
const unit={language:'en',bank:'labels',key:'labels/am_puck/B',voiceId:'am_puck',text:'B.'},clip={sha256:'a'.repeat(64)},id='en:labels:labels/am_puck/B';
function doc(label='ok'){return {version:1,batches:[{id:'b',source:'User verdicts',queueSha256:'c'.repeat(64),count:1}],feedback:[{token:id,sha256:clip.sha256,text:'B.',batchId:'b',label}],requests:[]};}
test('exact human approval is separate from and cannot rewrite raw ASR',()=>{const d=doc(),before=JSON.stringify(d);assert.deepEqual(validateHumanReview(d),[]);assert.equal(humanReviewState(d,unit,clip).status,'approved');assert.equal(JSON.stringify(d),before);});
test('replacement SHA never inherits human approval',()=>{const state=humanReviewState(doc(),unit,{sha256:'b'.repeat(64)});assert.equal(state.status,'required');assert.equal(state.previousReviewedSha256,clip.sha256);});
test('problem and unsure remain pending independently of matched model status',()=>{for(const label of ['problem','unsure'])for(const asrStatus of ['matched','review','accepted'])assert.equal(humanReviewState(doc(label),unit,{...clip,asrStatus}).status,'required');});
test('JA requests remain pending across another regeneration',()=>{const u={language:'ja',bank:'vocab',key:'v-aisle/meaning',text:'通路'},d={version:1,batches:[],feedback:[],requests:[{token:'ja:vocab:v-aisle/meaning',sha256:'a'.repeat(64),text:'通路',reason:'新版待复听',origin:'manual-kana'}]};assert.deepEqual(validateHumanReview(d),[]);assert.equal(humanReviewState(d,u,{sha256:'b'.repeat(64)}).status,'required');});
test('source changes and malformed/duplicate feedback fail closed',()=>{assert.throws(()=>humanReviewState(doc(),{...unit,text:'D.'},clip),/source/);for(const mutate of [d=>d.feedback[0].sha256='bad',d=>d.feedback[0].label='passed',d=>d.feedback.push(d.feedback[0]),d=>d.batches[0].count=2,d=>d.feedback[0].batchId='missing']){const d=doc();mutate(d);assert(validateHumanReview(d).length);}});
test('only exact user-reviewed source exceptions can change sentence/letter casting',()=>{assert(eligibleVoiceOverride(unit));assert.equal(selectedVoice(unit,{voiceId:'af_heart',phonemes:'bˈi.'}),'af_heart');for(const u of [{...unit,key:'labels/am_puck/C'},{...unit,text:'D.'},{...unit,voiceId:'af_bella'},{...unit,speaker:'A'},{...unit,language:'ja'}])assert.equal(eligibleVoiceOverride(u),false);});
import {validateClip} from '../scripts/validate-bank-audio.mjs';
test('publication requires actual ASR even after approval, and forced review rejects matched in strict mode',()=>{
 const u={language:'en',bank:'vocab',key:'v-test/meaning',text:'record',voiceId:'af_heart',required:true};
 const c={...u,spoken:'record',src:'./audio/generated/en/af_heart/'+'a'.repeat(32)+'.m4a',sha256:'a'.repeat(64),bytes:100,duration:1,decodedPeak:.5,asrStatus:'review'};
 const r={sha256:c.sha256,expected:'record',spoken:'record',recognized:'Record.',status:'review',recognitionMethod:'individual-beam5',singleFileVerification:true,recognitionGeneration:{model:'whisper-small',modelSha256:'c'.repeat(64),device:'cpu',computeType:'int8',conditionOnPreviousText:false,vadFilter:false,prompt:null,beamSize:5}};
 assert.deepEqual(validateClip(u,c,r,{strictQuality:true,human:{status:'approved'}}),[]);
 assert(validateClip(u,c,{...r,recognized:''},{human:{status:'approved'}}).length);
 const matched={...r,status:'matched'},mc={...c,asrStatus:'matched'};
 assert.deepEqual(validateClip(u,mc,matched,{human:{status:'required'}}),[]);
 assert.deepEqual(validateClip(u,mc,matched,{strictQuality:true,human:{status:'required'}}),['Pending human listening review en:vocab:v-test/meaning (actual ASR: matched)']);
});
