import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {pendingInputCorrections,validateArchivedRetry,validateRetryPredecessor} from '../scripts/validate-bank-audio.mjs';
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const token='ja:reading:read-test/documents/0/title',key='read-test/documents/0/title';
const binding={text:'受け取り日',spoken:'受け取り日',voiceId:'jf_alpha',language:'ja'};
const target='ɯketoɾʲibʲi';
const generation={model:'whisper-small',modelSha256:'f'.repeat(64),device:'cpu',computeType:'int8',beamSize:5,conditionOnPreviousText:false,vadFilter:false,prompt:null};
function clip(hash,phones){return {...binding,sha256:hash.repeat(64),phonemeSha256:sha(phones),inputSha256:sha(hash+phones)};}
function actual(c){return {sha256:c.sha256,expected:c.text,spoken:c.spoken,recognized:'受け取り日',status:'review',recognitionMethod:'individual-beam5',singleFileVerification:true,recognitionGeneration:generation};}
function fixture(){
  const before=clip('a','ɯketoɾʲi ʥiʦɨ'),current=clip('b',target),record=actual(current);
  const delivery={token,sourceBinding:binding,appliedOverride:{phonemes:target},delivery:'regenerated-with-both-ASR-versions',selectedSha256:current.sha256};
  const entry={token,kind:'confirmed-input-correction',complete:true,selectedSha256:current.sha256,synthesisAttemptCount:2,asrAttemptCount:2,initial:{clip:before,asr:actual(before)},retry:{clip:current,asr:record}};
  return {before,current,record,delivery,entry,review:{confirmedInputCorrections:[delivery],asrTextReviewNotes:[{token,confirmedInputError:true}]},packs:new Map([['ja:reading',{pack:{clips:{[key]:current}},audit:{records:{[key]:record}}}]]),retries:{records:{[token]:entry}}};
}
test('known confirmed error without a completed delivery remains explicitly pending',()=>{
  const f=fixture();f.review.confirmedInputCorrections=[];
  assert.deepEqual(pendingInputCorrections(f.review,f.packs,f.retries).map(x=>x.token),[token]);
});
test('missing review summary cannot hide a confirmed correction recorded in retry history',()=>{
  const f=fixture();
  const result=pendingInputCorrections({},f.packs,f.retries);
  assert.deepEqual(result.map(x=>x.token),[token]);
  assert.match(result[0].reason,/no reviewed correction delivery/);
});
test('a newly observed error cannot reuse an older successful correction on the same source key',()=>{
  const f=fixture();f.delivery.delivery='future-required-generation';f.retries={records:{}};
  f.review.asrTextReviewNotes[0].disposition='pending-reviewed-input-correction';
  assert.match(pendingInputCorrections(f.review,f.packs,f.retries)[0].reason,/Newly observed/);
});
test('ordinary pace retry cannot publish the old wrong phonemes',()=>{
  const f=fixture(),stillWrong=clip('c','ɯketoɾʲi ʥiʦɨ');
  f.packs.get('ja:reading').pack.clips[key]=stillWrong;f.packs.get('ja:reading').audit.records[key]=actual(stillWrong);
  f.entry.retry={clip:stillWrong,asr:actual(stillWrong)};f.entry.selectedSha256=stillWrong.sha256;
  assert.match(pendingInputCorrections(f.review,f.packs,f.retries)[0].reason,/target input/);
});
test('reviewed target with both actual versions can retain an honest ASR review',()=>{
  const f=fixture();assert.deepEqual(pendingInputCorrections(f.review,f.packs,f.retries),[]);
  f.entry.initial.asr.recognized='';assert.match(pendingInputCorrections(f.review,f.packs,f.retries)[0].reason,/before\/after/);
});
test('future first generation needs target and current actual ASR, not an invented earlier version',()=>{
  const f=fixture();f.delivery.delivery='future-required-generation';f.retries={records:{}};f.review.asrTextReviewNotes=[];
  assert.deepEqual(pendingInputCorrections(f.review,f.packs,f.retries),[]);
  delete f.packs.get('ja:reading').audit.records[key];assert.match(pendingInputCorrections(f.review,f.packs,f.retries)[0].reason,/actual ASR/);
  delete f.packs.get('ja:reading').pack.clips[key];assert.match(pendingInputCorrections(f.review,f.packs,f.retries)[0].reason,/not been generated/);
});
test('deferred optional material can remain absent from publication',()=>{
  const f=fixture();f.delivery.delivery='future-optional-only';f.review.asrTextReviewNotes=[];
  assert.deepEqual(pendingInputCorrections(f.review,new Map(),{records:{}}),[]);
});
test('voice, source and spoken changes cannot reuse a target-phone-only claim',()=>{
  for(const patch of [{voiceId:'af_heart'},{text:'受け取り時刻'},{spoken:'別の文章'}]){
    const f=fixture();Object.assign(f.current,patch);f.packs.get('ja:reading').audit.records[key]=actual(f.current);
    assert.match(pendingInputCorrections(f.review,f.packs,f.retries)[0].reason,/target input/);
  }
});
test('a second correction preserves a valid three-version predecessor chain',()=>{
  const f=fixture(),third=clip('c','ɯketoɾʲibʲi.'),old=structuredClone(f.entry);
  const next={...structuredClone(old),initial:structuredClone(old.retry),retry:{clip:third,asr:actual(third)},selectedSha256:third.sha256,
    predecessor:{archiveIndex:0,token,selectedSha256:old.selectedSha256}};
  assert.equal(validateArchivedRetry(old),true);
  assert.equal(validateRetryPredecessor(next,[old]),true);
  assert.equal(validateArchivedRetry(next),true);
  for(const section of ['initial','retry'])for(const change of ['missing','blank','stale']){
    const broken=structuredClone(old);
    if(change==='missing')delete broken[section].asr;
    if(change==='blank')broken[section].asr.recognized='  ';
    if(change==='stale')broken[section].asr.sha256='f'.repeat(64);
    assert.equal(validateArchivedRetry(broken),false,section+':'+change);
    assert.equal(validateRetryPredecessor(next,[broken]),false,section+':'+change);
  }
});
test('predecessor indices, tokens and selected media cannot be redirected',()=>{
  const f=fixture(),next={token,initial:f.entry.retry,predecessor:{archiveIndex:0,token,selectedSha256:f.current.sha256}};
  for(const patch of [{archiveIndex:1},{archiveIndex:-1},{archiveIndex:.5},{token:'ja:reading:other'},{selectedSha256:'c'.repeat(64)}]){
    const broken=structuredClone(next);Object.assign(broken.predecessor,patch);
    assert.equal(validateRetryPredecessor(broken,[f.entry]),false);
  }
  const mismatch=structuredClone(next);mismatch.initial.clip.sha256='d'.repeat(64);
  assert.equal(validateRetryPredecessor(mismatch,[f.entry]),false);
  const old=structuredClone(f.entry);old.selectedSha256='e'.repeat(64);
  assert.equal(validateArchivedRetry(old),false);
});
