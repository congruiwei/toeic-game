import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {sourceUnits} from '../js/translation-source.js';
const read=p=>JSON.parse(fs.readFileSync(new URL('../'+p,import.meta.url)));
const words=read('data/vocab.json'),added=words.filter(w=>w.i18nDetails===true);
const translations={zh:read('data/i18n/zh/vocab.json').entries,ja:read('data/i18n/ja/vocab.json').entries};
const reasons=read('data/options/authoring/reasons-vocab.json');
const required='access assess excess import export principal principle insure assure invaluable inflammable copyright exporter importer accept except advice advise complementary later latter lay lie loose lose rise perspective awareness useful careless wireless'.split(' ');

test('the high-frequency expansion has complete, separately labeled senses and bilingual source fields',()=>{
 assert.equal(added.length,37);
 assert.deepEqual([...new Set(added.map(w=>w.word))].sort(),required.sort());
 for(const w of added){
  const units=sourceUnits('vocab',[w]);
  assert.deepEqual(units.map(u=>u.key),['meaning','example/0','collocation/0','paraphrase/0'].map(s=>w.id+'/'+s));
  for(const unit of units)for(const lang of ['zh','ja'])assert.equal(typeof translations[lang][unit.key],'string',unit.key+' '+lang);
  assert.equal(translations.zh[w.id+'/meaning'],w.zh);
  assert.deepEqual(Object.keys(reasons[w.id]),[w.word,...w.clozeDistractors]);
  assert(Object.values(reasons[w.id]).every(reason=>reason.length>15&&!/不符合语境|TODO|待补/.test(reason)),w.id);
 }
 for(const head of ['access','excess','import','export','principal','lie']){
  const senses=added.filter(w=>w.word===head);assert.equal(senses.length,2,head);
  assert.equal(new Set(senses.map(w=>w.sense)).size,2,head);
 }
});

test('optional detail translations do not introduce missing keys for legacy cards',()=>{
 const base={id:'v-fixture',word:'file',zh:'归档',pos:'v.',example:'Please file these receipts before the accounting team arrives.',collocation:'file a receipt',paraphrase:'store a document'};
 assert.deepEqual(sourceUnits('vocab',[base]).map(u=>u.key),['v-fixture/meaning','v-fixture/example/0']);
 assert.equal(sourceUnits('vocab',[{...base,i18nDetails:true}]).length,4);
 assert.equal(sourceUnits('vocab',[{...base,i18nDetails:false}]).length,2);
});

test('look-alike translation answers exclude genuine synonyms and preserve the current sense',()=>{
 const avoid=id=>new Set(words.find(w=>w.id===id).avoidWith||[]);
 for(const [id,other] of [['v-inflammable','flammable'],['v-invaluable','valuable'],['v-assure','ensure'],['v-insure','ensure'],['v-useful','beneficial'],['v-advice','suggestion']])assert(avoid(id).has(other),id+' '+other);
 const byId=new Map(added.map(w=>[w.id,w]));
 assert.equal(byId.get('v-principal').pos,'adj.');
 assert.equal(byId.get('v-principal-capital').pos,'n.');
 assert.notEqual(byId.get('v-import').ipa,byId.get('v-import-goods').ipa,'noun/verb stress is independently authored');
 assert.notEqual(byId.get('v-export').ipa,byId.get('v-export-goods').ipa);
});
