import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validPublishedASREvidence} from '../scripts/validate-bank-audio.mjs';
const original=JSON.parse(await readFile(new URL('./fixtures/context-proof.json',import.meta.url),'utf8'));
const fixture=()=>structuredClone(original);
const valid=f=>validPublishedASREvidence(f.unit,f.clip,f.record,f.row);

test('publication gate accepts the bound context proof without rewriting individual ASR',()=>{
  const f=fixture();assert.equal(valid(f),true);
  assert.equal(f.record.recognized,f.row.contextProbes[0].originalASR.recognized);
  assert.equal(f.row.contextProbes[0].originalASR.status,'review');
});
test('publication gate rejects unknown acceptance and fabricated accepted status',()=>{
  for(const change of [f=>f.record.acceptance.method='unknown',f=>f.row.contextProbes=[],f=>f.record.recognized='signed',f=>f.record.acceptance.proofId='0'.repeat(64)]){
    const f=fixture();change(f);assert.equal(valid(f),false);
  }
});
test('publication gate rejects a proof for different actual source audio',()=>{
  const f=fixture();f.clip.sha256='0'.repeat(64);f.record.sha256=f.clip.sha256;
  assert.equal(valid(f),false);
});
