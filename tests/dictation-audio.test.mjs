import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadBank,bank,question} from '../js/bank.js';
import {sourceUnits} from '../js/translation-source.js';

test('dictation retains its actual dialogue speaker and exact per-sentence audio keys',async()=>{
  const previous=globalThis.fetch;
  globalThis.fetch=async()=>Response.json(JSON.parse(await readFile(new URL('../data/listening.json',import.meta.url),'utf8')));
  try{await loadBank(['listening']);}finally{globalThis.fetch=previous;}
  let differentSpeaker=0;
  for(const set of bank.listening){
    const d=set.dictation;if(!d)continue;
    const q=question({id:d.id,mode:'dictation'}),speaker=set.turns.find(turn=>turn.text.includes(d.text))?.speaker||'A';
    assert.equal(q.turns[0].speaker,speaker,d.id);
    assert.deepEqual(q.turns[0].keys,sourceUnits('listening',[set]).filter(unit=>unit.id===d.id).map(unit=>unit.key),d.id);
    assert.equal(q.turns[0].bank,'listening');
    if(speaker!=='A')differentSpeaker++;
  }
  assert(differentSpeaker>=31,'exercise the B/C speaker regressions in the actual bank');
});
