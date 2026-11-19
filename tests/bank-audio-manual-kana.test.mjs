import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {validateManualKanaAttempt,validateManualKanaRecord,validManualKanaSupersession,validateManualKanaReport} from '../scripts/audio-manual-kana.mjs';
const {validASREvidence}=await import(pathToFileURL(process.cwd()+'/scripts/validate-bank-audio.mjs'));
const fixture=JSON.parse(await readFile(new URL('./fixtures/manual-kana.json',import.meta.url),'utf8'));
const options={validateOriginal:validASREvidence};
const token=u=>`${u.language}:${u.bank}:${u.key}`;
const items=f=>{const u=f.source.units[0],row=f.quality.records[token(u)],a=row.manualKanaAttempts[0],pack=f.packs['ja:grammar'];return {u,row,a,c:pack.pack.clips[u.key],r:pack.audit.records[u.key]};};
const verify=f=>validateManualKanaReport(f.source,f.report,f.quality,new Map(Object.entries(f.packs)),f.overrides,f.normalization,f.human,options);
const seal=a=>{const value=Object.fromEntries(Object.entries(a).filter(([k])=>!['id','archive','proofCanonical'].includes(k)));a.proofCanonical=JSON.stringify(value);a.id=createHash('sha256').update(a.proofCanonical).digest('hex');};
test('actual Python publisher output independently validates matched and empty attempts',()=>{
 assert.deepEqual(verify(fixture),[]);const {u,row,a,c,r}=items(fixture);assert.deepEqual(validateManualKanaAttempt(u,a,row,options),[]);assert(validateManualKanaRecord(u,c,r,row,options));
 const empty=fixture.quality.records[token(fixture.source.units[1])].manualKanaAttempts[0];assert.equal(empty.rawASR.recognized,'');assert.equal(empty.candidate.asr.status,'error');assert.equal(empty.disposition,'system-fallback');
});
test('pinned model, no-prompt, actual segments and phoneme provenance cannot be replaced',()=>{
 for(const change of [a=>a.rawASR.generation.model='whisper-small',a=>a.rawASR.generation.prompt='expected text',a=>a.rawASR.generation.beamSize=1,a=>a.candidate.clip.spoken='べつ',a=>a.override.phonemes='wrong',a=>a.rawASR.segments[0].text='fake']){
  const f=structuredClone(fixture),{u,row,a}=items(f);change(a);seal(a);assert(validateManualKanaAttempt(u,a,row,options).length,change.toString());
 }
});
test('a genuine empty result cannot authorize a matched clip',()=>{
 const f=structuredClone(fixture),u=f.source.units[1],row=f.quality.records[token(u)],a=row.manualKanaAttempts[0];a.candidate.asr.comparison.equivalent=true;a.candidate.asr.comparison.proofExpected=a.candidate.asr.comparison.proofRecognized='pretend';a.candidate.asr.status=a.candidate.clip.asrStatus='matched';a.disposition='recorded-matched';a.originalAudioReplaced=true;seal(a);assert(validateManualKanaAttempt(u,a,row,options).some(x=>x.includes('Empty')));
});
test('missing proof, changed current SHA/transcript and English sources fail',()=>{
 const {u,row,c,r}=items(fixture);assert(!validateManualKanaRecord(u,c,r,{},options));assert(!validateManualKanaRecord(u,{...c,sha256:'0'.repeat(64)},r,row,options));assert(!validateManualKanaRecord(u,c,{...r,recognized:'fake'},row,options));assert(!validateManualKanaRecord({...u,language:'en'},c,r,row,options));
});
test('old correction remains exact and cannot be silently bypassed',()=>{
 const {u,row,c,r}=items(fixture),d=fixture.normalization.confirmedInputCorrections[0];assert(validManualKanaSupersession(u,c,r,row,d,options));const changed=structuredClone(d);changed.appliedOverride.phonemes='changed previous target';assert(!validManualKanaSupersession(u,c,r,row,changed,options));
});
test('complete coverage and failed transcripts are mandatory without adding human review',()=>{
 for(const change of [f=>delete f.report.entries[token(f.source.units[1])],f=>f.report.failures=[],f=>f.report.failures[0].recognized='fake',f=>f.report.matched++]){const f=structuredClone(fixture);change(f);assert(verify(f).length,change.toString());}
});
test('failed candidates require verified private archive and unchanged system routing',()=>{
 for(const change of [f=>f.quality.records[token(f.source.units[1])].manualKanaAttempts[0].archive.copyVerified=false,f=>delete f.packs['ja:grammar'].pack.fallbacks[f.source.units[1].key]]){const f=structuredClone(fixture);change(f);assert(verify(f).length);}
});
