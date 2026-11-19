import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root));
const cards=JSON.parse(await read('data/vocab.json'));
const catalog=JSON.parse(await read('data/vocab-art.json'));
const files=await readdir(new URL('assets/vocab/',root));
const referenced=new Set();
const counts={A:0,B:0,C:0};
let bytes=0;
function nonemptyTextLabels(svg){
  const body=svg.replace(/<!--[\s\S]*?-->|<(?:title|desc)\b[^>]*>[\s\S]*?<\/(?:title|desc)\s*>/gi,'');
  return [...body.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text\s*>/gi)].filter(([,value])=>
    value.replace(/<[^>]*>/g,'').replace(/&nbsp;/gi,' ').replace(/&#(x[\da-f]+|\d+);/gi,(_,number)=>String.fromCodePoint(Number.parseInt(number.replace(/^x/i,''),/^x/i.test(number)?16:10))).trim().length>0
  ).length;
}
assert.equal(catalog.version,1);
assert.deepEqual(Object.keys(catalog.entries).sort(),cards.map(card=>card.id).sort());
const duels=JSON.parse(await read('data/confusables.json')).questions;
const duelArt=duels.filter(q=>catalog.entries[q.wordId]&&catalog.entries[q.wordId].class!=='C');
assert.deepEqual(catalog.aliases,Object.fromEntries(duelArt.map(q=>[q.id,q.wordId])),'duel illustration must belong to the same sense');
for(const [id,entry] of Object.entries(catalog.entries)){
  assert(Object.hasOwn(counts,entry.class),id);
  counts[entry.class]++;
  if(entry.class==='C'){assert.deepEqual(Object.keys(entry),['class'],id);continue;}
  assert(/[\p{Script=Han}]/u.test(entry.alt),id);
  const filename=id+'.svg',source=await read('assets/vocab/'+filename),svg=source.toString();
  assert(source.length<=8192,id+' exceeds 8 KB');
  assert(svg.includes('<svg')&&svg.includes('viewBox=')&&svg.includes('prefers-color-scheme'),id+' theme or dimensions');
  assert(!/<(?:script|foreignObject|image|use\b[^>]+href=["'](?:https?:|data:))|\son[a-z]+\s*=|url\(https?:/i.test(svg),id+' external or active content');
  if(entry.class==='B')assert(nonemptyTextLabels(svg)<=3,id+' B illustration exceeds 3 nonempty text labels');
  assert.equal(entry.rev,createHash('sha256').update(source).digest('hex').slice(0,12),id);
  referenced.add(filename);bytes+=source.length;
}
assert.deepEqual([...referenced].sort(),files.sort(),'unreferenced or missing illustrations');
console.log(`PASS 单词配图 · A ${counts.A} / B ${counts.B} / C ${counts.C} · ${referenced.size} 张原创 SVG，合计 ${bytes} 字节。`);
