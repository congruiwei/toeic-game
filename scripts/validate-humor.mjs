import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8').then(JSON.parse);
const cards=await read('data/vocab.json');
const collections=await Promise.all(['data/vocab-humor.json',...['zh','ja'].map(lang=>'data/i18n/'+lang+'/vocab-humor.json')].map(read));
const keys=cards.map(card=>card.id+'/humor/0').sort();
for(const collection of collections){
  assert.equal(collection.version,1);
  assert.deepEqual(Object.keys(collection.entries).sort(),keys);
  assert.equal(new Set(Object.values(collection.entries)).size,keys.length,'每个义项应有自己的例句');
}
// Compare whole words, allowing ordinary past-tense forms used in these examples.
const wordTokens=text=>text.toLowerCase().match(/[a-z]+/g)||[];
function usesHeadword(headword,sentence){
  const head=wordTokens(headword),words=wordTokens(sentence);
  const last=head.at(-1);
  const endings=new Set([last,last+'s',last+'es',last.endsWith('e')?last+'d':last+'ed',last.replace(/e$/,'')+'ing']);
  if(/[^aeiou]y$/.test(last))for(const ending of ['ies','ied'])endings.add(last.slice(0,-1)+ending);
  if(last==='withdraw')endings.add('withdrew');
  return words.some((_,start)=>head.every((part,i)=>i===head.length-1
    ?endings.has(words[start+i]):words[start+i]===part));
}
const heads=new Map(cards.map(card=>[card.id+'/humor/0',card.word]));
for(const key of keys){
  const [en,zh,ja]=collections.map(collection=>collection.entries[key]);
  const n=en.match(/[A-Za-z0-9]+(?:[’'-][A-Za-z0-9]+)*/g)?.length||0;
  if(!usesHeadword(heads.get(key),en))console.warn(key+'：请核对例句里的不规则词形与本义项是否对应。');
  assert.ok(n>=10&&n<=16,`${key}: ${n} words`);
  assert.ok(/[\p{Script=Han}]/u.test(zh)&&/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(ja),key);
}
console.log(`PASS 职场趣句 · ${keys.length} 个义项，英文均为 10–16 词，中日逐句齐全。`);
