import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSource,validateClip,m4aMetadata,reviewTriage} from '../scripts/validate-bank-audio.mjs';
const u={language:'en',bank:'vocab',key:'v-test/meaning',text:'record',voiceId:'af_heart',required:true};
const clip={...u,spoken:'record',src:'./audio/generated/en/af_heart/'+'a'.repeat(32)+'.m4a',sha256:'a'.repeat(64),inputSha256:'d'.repeat(64),bytes:100,duration:1,decodedPeak:.5,asrStatus:'matched'};
const generation={model:'whisper-small',modelSha256:'c'.repeat(64),device:'cpu',computeType:'int8',conditionOnPreviousText:false,vadFilter:false,prompt:null,beamSize:5};
const record={sha256:clip.sha256,expected:'record',spoken:'record',recognized:'Record.',status:'matched',recognitionMethod:'individual-beam5',singleFileVerification:true,recognitionGeneration:generation};
test('required coverage is strict unless explicitly developing',()=>{assert.ok(validateClip(u,null,null).length);assert.deepEqual(validateClip(u,null,null,{allowIncomplete:true}),[]);});
test('pure visual markers can never get speech',()=>{const m={...u,text:'[2]',required:false,nonSpoken:true};assert.deepEqual(validateSource({units:[m]}),[]);assert.ok(validateClip(m,clip,null,{allowIncomplete:true}).length);assert.ok(validateSource({units:[{...m,required:true}]}).length);});
test('ASR must bind actual current audio and transcript, with unresolved review rejected',()=>{assert.deepEqual(validateClip(u,clip,record),[]);assert.ok(validateClip(u,clip,{...record,sha256:'b'.repeat(64)}).length);assert.ok(validateClip(u,clip,{...record,status:'review'}).length);assert.ok(validateClip(u,clip,{...record,recognitionGeneration:{prompt:'record'}}).length);});
test('review labels preserve semantic risks and never accept a discrepancy',()=>{
  assert.equal(reviewTriage('en','The worktable is clear.','The work table is clear.').category,'possible-spelling');
  assert.equal(reviewTriage('en','Ask Luis.','Ask Lewis.').category,'possible-homophone');
  assert.equal(reviewTriage('en','The glass has fallen.','The glass is falling.','p1-050/options/0/0').priority,'high');
  assert.equal(reviewTriage('en','Pay thirty dollars.','Pay thirteen dollars.').category,'meaning-tense-or-omission');
  const review={...record,status:'review',triage:reviewTriage('en','worktable','work table')};
  assert.ok(validateClip(u,clip,review).some(error=>error.includes('Unresolved or untried')));
});
test('completed real retry allows honest review in coverage mode, but strict quality still fails',()=>{
  const reviewed={...record,status:'review'},c={...clip,asrStatus:'review'};
  const second={...c,sha256:'b'.repeat(64)};
  const retry={complete:true,selectedSha256:c.sha256,synthesisAttemptCount:2,asrAttemptCount:2,
    initial:{clip:c,asr:reviewed},retry:{clip:second,asr:{...reviewed,sha256:second.sha256}}};
  assert.deepEqual(validateClip(u,c,reviewed,{retry}),[]);
  assert.ok(validateClip(u,c,reviewed,{retry,strictQuality:true}).length);
  assert.ok(validateClip(u,c,reviewed,{retry:{...retry,asrAttemptCount:1}}).length);
  assert.ok(validateClip(u,{...c,inputSha256:'e'.repeat(64)},reviewed,{retry}).length);
  assert.ok(validateClip(u,{...c,spoken:'Record'},{...reviewed,spoken:'Record'},{retry}).length);
  assert.ok(validateClip(u,c,reviewed,{retry:{...retry,retry:{clip:second,asr:{...reviewed,sha256:'c'.repeat(64)}}}}).length);
  for(const patch of [{expected:'different'},{spoken:'different'},{recognized:'   '},{recognitionGeneration:{prompt:'record',beamSize:5}},{recognitionMethod:'missing'}])
    assert.ok(validateClip(u,c,reviewed,{retry:{...retry,retry:{clip:second,asr:{...reviewed,sha256:second.sha256,...patch}}}}).length);
});
test('batch acceptance requires exact text, stable boundary and batch provenance',()=>{const r={...record,recognitionMethod:'batch-beam1',singleFileVerification:false,recognitionGeneration:{...generation,beamSize:1},screening:{batchId:'b'.repeat(64),boundaryStable:true,normalizedExact:true}};assert.deepEqual(validateClip(u,clip,r),[]);assert.ok(validateClip(u,clip,{...r,screening:{...r.screening,boundaryStable:false}}).length);});
test('voice, unresolved digits and unsafe audio paths cannot pass development mode',()=>{for(const patch of [{voiceId:'af_bella'},{spoken:'record 3'},{src:'../../bad.m4a'}])assert.ok(validateClip(u,{...clip,...patch},record,{allowIncomplete:true}).length);});
test('Part 2 cast has distinct female and male voices',()=>{const rows=[{...u,bank:'part2',group:'p2-001',key:'p2-001/audio/0'},{...u,bank:'part2',group:'p2-001',key:'p2-001/options/0/0',voiceId:'am_puck'}];assert.deepEqual(validateSource({units:rows}),[]);rows[1].voiceId='af_bella';assert.ok(validateSource({units:rows}).some(e=>e.includes('cast')));});
test('speaker voice cannot switch within a conversation',()=>{const rows=[{...u,bank:'listening',group:'p3-g01',key:'p3-g01/turns/0/0',speaker:'A'},{...u,bank:'listening',group:'p3-g01',key:'p3-g01/turns/1/0',speaker:'B',voiceId:'am_puck'},{...u,bank:'listening',group:'p3-g01',key:'p3-g01/turns/2/0',speaker:'A',voiceId:'af_bella'}];assert.ok(validateSource({units:rows}).some(e=>e.includes('Speaker changed')));});
const atom=(type,data)=>{const b=Buffer.alloc(8+data.length);b.writeUInt32BE(b.length);b.write(type,4);data.copy(b,8);return b;};
test('M4A parser reads real container duration and rejects malformed metadata',()=>{const mv=Buffer.alloc(20);mv.writeUInt32BE(1000,12);mv.writeUInt32BE(1234,16);const sample=Buffer.alloc(28);sample.writeUInt16BE(1,16);sample.writeUInt32BE(24000*65536,24);const stsd=atom('stsd',Buffer.concat([Buffer.alloc(8),atom('mp4a',sample)]));const file=Buffer.concat([atom('ftyp',Buffer.from('M4A ')),atom('moov',Buffer.concat([atom('mvhd',mv),stsd])),atom('mdat',Buffer.from([1]))]);assert.deepEqual(m4aMetadata(file),{ftyp:true,duration:1.234,codec:'aac',channels:1,sampleRate:24000,mdat:true});assert.throws(()=>m4aMetadata(file.subarray(0,-1)),/Invalid/);});
