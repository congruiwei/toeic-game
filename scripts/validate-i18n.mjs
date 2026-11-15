import {validateGlossary,loadGlossaryInputs,glossarySummary} from './validate-glossary.mjs';
import fs from 'node:fs';
import {sourceUnits} from '../js/translation-source.js';

const banks=['vocab','part1','part2','listening','grammar','reading','methods'];
const errors=[];
const literals=JSON.parse(fs.readFileSync(new URL('../data/i18n/literals.json',import.meta.url)));
let total=0;
// Numbers, clock times, insertion positions and identifiers have no translatable words.
const literal=text=>!/[A-Za-z]{2}/.test(text.replace(/\b(?:mm|cm|kg|km|AM|PM)\b/g,''));
for(const bank of banks){
  const units=sourceUnits(bank,JSON.parse(fs.readFileSync(new URL(`../data/${bank}.json`,import.meta.url))));
  total+=units.length;
  for(const lang of ['zh','ja']){
    let pack;
    try{pack=JSON.parse(fs.readFileSync(new URL(`../data/i18n/${lang}/${bank}.json`,import.meta.url)));}
    catch{errors.push(`${lang}/${bank}: 文件缺失或不是有效 JSON`);continue;}
    if(pack.version!==1 || !pack.entries || Array.isArray(pack.entries)){errors.push(`${lang}/${bank}: 数据格式错误`);continue;}
    const expected=new Set(units.map(u=>u.key));
    for(const key of Object.keys(pack.entries))if(!expected.has(key))errors.push(`${lang}/${key}: 多余的翻译键`);
    for(const u of units){
      const text=pack.entries[u.key];
      if(typeof text!=='string'||!text.trim()){errors.push(`${lang}/${u.key}: 缺少译文`);continue;}
      if(text.trim()===u.text.trim()&&!literal(u.text)&&literals[u.key]?.source!==u.text)errors.push(`${lang}/${u.key}: 译文与英文相同`);
      if(u.kind==='table' && text.split(' | ').length!==u.columns)errors.push(`${lang}/${u.key}: 表格列数不一致`);
    }
    console.log(`i18n ${lang}/${bank}: ${Object.keys(pack.entries).length}/${units.length} units`);
  }
}
if(errors.length){console.error(errors.join('\n'));throw Error(`翻译校验失败：${errors.length} 项`);}
console.log(`Translation validation passed: ${total} Chinese + ${total} Japanese units; aligned keys and table columns.`);

const {unitsByBank,packs,glossary}=loadGlossaryInputs();
const terminology=validateGlossary(unitsByBank,packs,glossary);
console.log(glossarySummary(terminology));
if(terminology.errors.length){
  console.error(terminology.errors.map(error=>JSON.stringify(error)).join('\n'));
  throw Error(`术语校验失败：${terminology.errors.length} 项`);
}
