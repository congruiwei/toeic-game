import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fresh,decode} from '../js/state.js';
const names=['vocab','part1','part2','grammar','listening','reading'];
const read=async name=>JSON.parse(await fs.readFile(new URL('../data/'+name+'.json',import.meta.url),'utf8'));

test('canonical restore works without optional candidates, while subsequent new vocabulary still requires them',async()=>{
  const previous=globalThis.fetch,calls=[];let optionalAvailable=false;
  globalThis.fetch=async url=>{
    const name=String(url).match(/data\/([^/]+)\.json$/)?.[1];calls.push(name);
    if(name==='confusable-candidates'&&!optionalAvailable)return new Response('',{status:503});
    return Response.json(await read(name));
  };
  try{
    const {loadBank,bank,catalog}=await import('../js/bank.js?canonical-restore-test');
    await loadBank(names,{candidates:false});
    assert.deepEqual(calls.sort(),names.slice().sort());assert(!bank['confusable-candidates']);
    const s=fresh();s.xp=84;s.stats.vocab=84;s.words['v-available']={box:1,due:Date.now()+86400000,right:2,tries:2};
    const restored=decode(JSON.stringify(s),catalog);assert.equal(restored.xp,84);assert.equal(restored.words['v-available'].right,2);
    await assert.rejects(loadBank(['vocab']),/confusable-candidates/);
    assert(bank.vocab);assert(!bank['confusable-candidates']);
    optionalAvailable=true;await loadBank(['vocab']);assert(bank['confusable-candidates']);
    assert.equal(calls.filter(name=>name==='vocab').length,1,'restoring vocabulary does not refetch the canonical bank');
  }finally{globalThis.fetch=previous;}
});

test('explicit confusable requests remain mandatory and a failed load can retry without replacing the canonical catalog',async()=>{
  const previous=globalThis.fetch;let fullAvailable=false;
  globalThis.fetch=async url=>{
    const name=String(url).match(/data\/([^/]+)\.json$/)?.[1];
    if(name==='confusables'&&!fullAvailable)return new Response('',{status:503});
    return Response.json(await read(name));
  };
  try{
    const {loadBank,bank,catalog}=await import('../js/bank.js?required-duel-restore-test');
    await loadBank(names,{candidates:false});const word=catalog.get('v-available');
    await assert.rejects(loadBank(['confusables'],{candidates:false}),/confusables/);
    assert(!bank.confusables);assert.equal(catalog.get('v-available'),word);assert(!catalog.has('cf-available'));
    fullAvailable=true;await loadBank(['confusables'],{candidates:false});
    assert(catalog.has('cf-available'));assert.equal(catalog.get('v-available'),word);
  }finally{globalThis.fetch=previous;}
});
