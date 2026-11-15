import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {sourceUnits} from '../js/translation-source.js';

test('translation units preserve source text and uniquely address every sentence',()=>{
  for(const bank of ['vocab','part1','part2','listening','grammar','reading','methods']){
    const rows=JSON.parse(fs.readFileSync(new URL(`../data/${bank}.json`,import.meta.url)));
    const before=JSON.stringify(rows),units=sourceUnits(bank,rows);
    assert.equal(new Set(units.map(u=>u.key)).size,units.length);
    assert.equal(JSON.stringify(rows),before);
    assert(units.every(u=>u.text.trim()&&u.bank===bank));
    if(bank==='reading')for(const set of rows.filter(r=>r.part===6)){
      const lines=units.filter(u=>u.id===set.id&&u.key.includes('/text/'));
      assert(lines.length>0);
      assert(lines.every(u=>!u.text.match(/\[\d\]/)),'Part 6 is completed before translation');
    }
  }
});

test('punctuation in times and titles does not break a sentence',()=>{
  const units=sourceUnits('vocab',[{id:'v-test',word:'visit',zh:'拜访',pos:'v.',example:'Ms. Nora will visit at 9 a.m. tomorrow. Please call her.'}]);
  assert.equal(units.length,3);
  assert.equal(units[1].text,'Ms. Nora will visit at 9 a.m. tomorrow.');
});
