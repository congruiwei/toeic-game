import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {validateLexicalAcceptance} from '../scripts/audio-lexical-proof.mjs';
const fixtures=JSON.parse(await readFile(new URL('./fixtures/lexical-proof.json',import.meta.url),'utf8')).records;
const valid=f=>validateLexicalAcceptance(f.unit,f.clip,f.record,f.row);
test('Python-created finite proofs independently validate in the Node publication gate',()=>{
 assert.equal(fixtures.length,12);for(const f of fixtures)assert(valid(f),f.ruleId);
});
test('dictionary rule, current recipe and original full ASR cannot be replaced',()=>{
 const f=fixtures.find(f=>f.ruleId==='route-root-oot');
 for(const mutate of [x=>x.clip.sha256='0'.repeat(64),x=>x.clip.phonemeSha256='0'.repeat(64),x=>x.clip.spoken='rout',x=>x.unit.voiceId='wrong_voice',x=>x.row.repair.complete=false,x=>x.row.repair.disposition='system-fallback',x=>x.row.lexicalEquivalences[0].rule.phoneToken='ɹˈWt',x=>x.row.lexicalEquivalences[0].input.phonemes='ɹˈWt.',x=>x.row.lexicalEquivalences[0].decision.sourceWord='rout',x=>x.row.lexicalEquivalences[0].originalASR.recognized='roots',x=>x.record.recognized='roots',x=>x.record.comparison.equivalent=true,x=>x.record.acceptance.sourceAudioSha256='0'.repeat(64),x=>x.row.lexicalEquivalences.push(structuredClone(x.row.lexicalEquivalences[0]))]){
  const bad=structuredClone(f);mutate(bad);assert.equal(valid(bad),false,mutate.toString());
 }
});
test('actual strong evidence remains mandatory even with a complete dictionary proof',()=>{
 const f=fixtures[0];
 for(const mutation of [g=>g.prompt='insures',g=>g.hotwords='insures',g=>g.beamSize=1,g=>g.model='small',g=>g.modelSha256='0'.repeat(64)]){
  const bad=structuredClone(f);mutation(bad.row.lexicalEquivalences[0].originalASR.recognitionGeneration);assert.equal(valid(bad),false);
 }
 assert.equal(validateLexicalAcceptance(f.unit,f.clip,f.record,f.row,{validateOriginal:()=>false}),false);
 for(const change of [p=>p.actualAsrFingerprintInput='[]',p=>p.actualAsrFingerprintInput=p.actualAsrFingerprintInput.replace('cpu','gpu')]){
  const bad=structuredClone(f);change(bad.row.lexicalEquivalences[0]);assert.equal(valid(bad),false);
 }
});
test('accepted record changes only status/admission, not raw transcript, segments or comparison',()=>{
 for(const f of fixtures){const p=f.row.lexicalEquivalences[0];assert.equal(p.originalASR.status,'review');assert.equal(p.originalASR.comparison.equivalent,false);const stripped=structuredClone(f.record);delete stripped.acceptance;stripped.status='review';assert.deepEqual(stripped,p.originalASR);assert.equal(p.newRecognitionCalls,0);assert.equal(p.originalAudioResynthesized,false);}
});

const fullName=JSON.parse(await readFile(new URL('./fixtures/lexical-full-name-proof.json',import.meta.url),'utf8'));
test('pinned full-model name proof validates without broadening sentence or name scope',()=>{
 assert(valid(fullName));assert.equal(fullName.record.recognitionGeneration.model,'whisper-large-v3');
 for(const mutate of [x=>x.unit.key='p2-other/options/2/0',x=>x.record.recognized='Lewis had the front desk till noon.',x=>x.row.lexicalEquivalences[0].originalASR.recognitionGeneration.modelSha256='e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da',x=>x.row.lexicalEquivalences[0].originalASR.recognitionGeneration.model='unknown',x=>x.row.lexicalEquivalences[0].originalASR.recognitionGeneration.beamSize=1,x=>x.row.lexicalEquivalences[0].originalASR.recognitionGeneration.prompt='Luis']){
  const bad=structuredClone(fullName);mutate(bad);assert.equal(valid(bad),false,mutate.toString());
 }
});
