import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validMorphemes} from '../js/morphemes.js';
import {morphemeSourceUnits,morphologyAudioUnits} from '../js/word-enrichment.js';
export function validateMorphemes(data,vocab,grammar){
 const errors=[];if(!validMorphemes(data))return ['词根文件结构不合法'];
 const entries=new Map(data.entries.map(m=>[m.id,m])),words=new Map(vocab.map(w=>[w.id,w]));
 for(const m of data.entries){
  for(const id of m.examples){const w=words.get(id);if(!w)errors.push(`${m.id}: 例词不存在 ${id}`);else if(!w.parts?.some(p=>p.morpheme===m.id))errors.push(`${m.id}: 例词未人工关联 ${id}`);}
  if(new Set(m.forms).size!==m.forms.length)errors.push(`${m.id}: 重复形式`);
  if(m.noteZh&&!m.noteJa||m.noteJa&&!m.noteZh)errors.push(`${m.id}: 说明缺少中日对照`);
 }
 for(const w of vocab){
  if(w.parts){
   if(!Array.isArray(w.parts)||!w.parts.length||w.parts.some(p=>typeof p.text!=='string'||!p.text||p.morpheme&&!entries.has(p.morpheme)))errors.push(`${w.id}: parts 引用或形态错误`);
   else if(w.parts.map(p=>p.text).join('')!==w.word)errors.push(`${w.id}: parts 拼回原词不一致`);
  }
  for(const field of ['partsNote','partsTrap'])if(w[field]&&(!w[field].zh?.trim()||!w[field].ja?.trim()))errors.push(`${w.id}: ${field} 缺少中日文`);
  if(w.partsTrap&&(!Array.isArray(w.partsTrap.sources)||!w.partsTrap.sources.length||w.partsTrap.sources.some(s=>!data.sources[s])))errors.push(`${w.id}: 陷阱缺少来源`);
 }
 for(const id of ['v-portion','v-invaluable','v-inflammable'])if(!words.get(id)?.partsTrap)errors.push(`${id}: 必须说明拆词陷阱`);
 const questions=new Map(grammar.flatMap(t=>t.questions.map(q=>[q.id,q])));
 for(const [id,rows] of Object.entries(data.grammarHints||{})){
  const q=questions.get(id);if(!q||!Array.isArray(rows)||rows.length!==q.options.length||new Set(rows.map(r=>r.text)).size!==q.options.length){errors.push(`${id}: 词形注释与题目不符`);continue;}
  for(const row of rows)if(!q.options.includes(row.text)||!row.label?.trim()||typeof row.ending!=='string'||row.ending&&!row.text.endsWith(row.ending)||row.morpheme&&!entries.has(row.morpheme))errors.push(`${id}/${row.text}: 词形注释不合法`);
 }
 for(const q of grammar.find(t=>t.id==='gram-word-form')?.questions||[])if(!data.grammarHints?.[q.id])errors.push(`${q.id}: 缺少词形说明`);
 return errors;
}
export function validateMorphemePacks(data,packs){
 const errors=[],units=morphemeSourceUnits(data),keys=new Set(units.map(u=>u.key));
 for(const lang of ['zh','ja']){
  const pack=packs?.[lang];if(pack?.version!==1||!pack.entries){errors.push('词根译文包缺失 '+lang);continue;}
  for(const u of units)if(pack.entries[u.key]!==u[lang])errors.push(`${lang}/${u.key}: 译文与人工条目不一致`);
  for(const key of Object.keys(pack.entries))if(!keys.has(key))errors.push(`${lang}/${key}: 多余译文键`);
 }
 return errors;
}
export function validateMorphemeFiles(root){
 const read=n=>JSON.parse(fs.readFileSync(path.join(root,'data',n+'.json'),'utf8'));
 try{const data=read('morphemes'),vocab=read('vocab'),errors=validateMorphemes(data,vocab,read('grammar'));errors.push(...validateMorphemePacks(data,{zh:read('i18n/zh/morphemes'),ja:read('i18n/ja/morphemes')}));return {errors,summary:`词根 ${data.entries.length} · 人工拆分 ${vocab.filter(w=>w.parts).length} · 拆词陷阱 ${vocab.filter(w=>w.partsTrap).length} · 词形注释 ${Object.keys(data.grammarHints||{}).length}题 · 音频文本 ${morphologyAudioUnits(data,vocab).length}`};}catch(error){return {errors:[error.message],summary:'词根资料读取失败'};}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),result=validateMorphemeFiles(root);
 console.log(JSON.stringify({ok:!result.errors.length,...result},null,2));if(result.errors.length)process.exitCode=1;
}
