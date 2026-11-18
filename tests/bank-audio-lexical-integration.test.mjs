import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import test from 'node:test';
const root=process.env.LEXICAL_INTEGRATION_ROOT;
const {validPublishedASREvidence:valid}=await import(root?pathToFileURL(path.join(root,'scripts/validate-bank-audio.mjs')):new URL('../scripts/validate-bank-audio.mjs',import.meta.url));
const fixtures=[...JSON.parse(await readFile(new URL('./fixtures/lexical-proof.json',import.meta.url),'utf8')).records,JSON.parse(await readFile(new URL('./fixtures/lexical-full-name-proof.json',import.meta.url),'utf8'))];
test('actual publication dispatcher rejects naked, missing, null and unknown acceptance',()=>{
 for(const f of fixtures){
  assert.equal(valid(f.unit,f.clip,f.record,f.row),true,f.ruleId);
  assert.equal(valid(f.unit,f.clip,f.record,{}),false);
  assert.equal(valid(f.unit,f.clip,f.row.repair.candidate.asr,f.row),true);
  for(const acceptance of ['absent',null,{}, {...f.record.acceptance,proofId:'0'.repeat(64)},{method:'unknown'}]){
   const bad=structuredClone(f.record);
   if(acceptance==='absent')delete bad.acceptance;else bad.acceptance=acceptance;
   assert.equal(valid(f.unit,f.clip,bad,f.row),false,JSON.stringify(acceptance));
  }
 }
});
