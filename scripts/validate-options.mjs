import fs from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {optionSourceSignature,optionLexiconBucket} from '../js/option-details.js';
import {sourceUnits} from '../js/translation-source.js';
export const OPTION_BANKS=['part1','part2','grammar','listening','reading'];
const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const nonempty=x=>typeof x==='string'&&!!x.trim();
const norm=x=>x.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
const pack=x=>object(x)&&x.version===1&&object(x.entries);
/** Pure checker; callers supply all banks, even when a pack is missing. */
export function validateOptions({vocab,records,packs,lexicons,translations}={}){
 const errors=[],summaries=[];let questionCount=0,optionCount=0;
 const fail=(code,message,extra={})=>errors.push({code,message,...extra});
 const dictionary=new Map(),lexemeIdentities=new Map(),known=new Map((Array.isArray(vocab)?vocab:[]).map(w=>[w.id,w]));
 if(!Array.isArray(vocab)||!vocab.length)fail('vocab-source','缺少完整单词源数据');
 for(const bucket of [...Array.from({length:26},(_,i)=>String.fromCharCode(97+i)),'other']){
  const file=lexicons?.[bucket];if(!pack(file)){fail('lexicon-pack','词典分片缺失或格式错误',{bucket});continue;}
  for(const [key,entry]of Object.entries(file.entries)){
   if(key!==norm(key)||optionLexiconBucket(key)!==bucket)fail('lexicon-key','词典键未规范化或分片错误',{key,bucket});
   if(dictionary.has(key))fail('lexicon-duplicate','词典键重复',{key});dictionary.set(key,entry);
   if(!object(entry)||![entry.pos,entry.zh,entry.ja].every(nonempty)||!Array.isArray(entry.lexemes)){fail('lexicon-entry','词性、中日释义或词条数组缺失',{key});continue;}
   const ids=new Set();for(const lex of entry.lexemes){
    if(!object(lex)||![lex.id,lex.word,lex.pos,lex.zh,lex.ja].every(nonempty)){fail('lexeme-shape','可收藏词条缺少字段',{key});continue;}
    if(ids.has(lex.id))fail('lexeme-duplicate','同一词典选项的词条 ID 重复',{key,id:lex.id});ids.add(lex.id);
    const identity=JSON.stringify([lex.word,lex.pos,lex.zh,lex.ja,lex.wordId||null]);if(lexemeIdentities.has(lex.id)&&lexemeIdentities.get(lex.id)!==identity)fail('lexeme-id-conflict','同一个可收藏词条 ID 对应了不同释义',{key,id:lex.id});lexemeIdentities.set(lex.id,identity);
    if(lex.wordId){const canonical=known.get(lex.wordId);if(!canonical||lex.id!==lex.wordId||lex.word!==canonical.word||lex.zh!==canonical.zh||lex.pos!==canonical.pos||lex.ja!==translations?.ja?.['vocab-meanings']?.entries?.[`${lex.wordId}/meaning`]||lex.example!==canonical.example||lex.ipa!==canonical.ipa)fail('lexeme-canonical','已知词卡映射不精确',{key,id:lex.id});}
   }
   if(/待补|待翻译|TODO|placeholder|不符合语境/i.test(entry.zh+entry.ja))fail('lexicon-placeholder','词典含占位内容',{key});
  }
 }
 const reason=(text,details)=>{if(!nonempty(text)||text.length<12||!/\p{Script=Han}/u.test(text))fail('reason-missing','选项缺少具体中文理由',details);else if(/待补|TODO|placeholder|不符合语境/i.test(text))fail('reason-placeholder','选项理由含占位表达',details);};
 for(const bank of OPTION_BANKS){
  const rows=records?.[bank];if(!Array.isArray(rows)||!rows.length){fail('source-missing','源题库缺失',{bank});continue;}
  const file=packs?.[bank];if(!pack(file)){fail('option-pack','选项释义包缺失或格式错误',{bank});continue;}
  const units=sourceUnits(bank,rows);const questions=rows.flatMap(row=>row.questions?row.questions.map(q=>({q,group:row})):[{q:row,group:null}]);
  const expected=new Set(questions.map(x=>x.q.id));
  for(const id of Object.keys(file.entries))if(!expected.has(id))fail('question-extra','多余选项解析 ID',{bank,id});
  for(const {q,group}of questions){questionCount++;optionCount+=q.options.length;const ref={id:q.id,mode:bank==='listening'?'dialogue':bank};const entry=file.entries[q.id];const details={bank,id:q.id};
   if(!object(entry)){fail('question-missing','整题选项解析缺失',details);continue;}
   if(entry.signature!==optionSourceSignature(ref,{...q,...(group?{set:group}:{})}))fail('signature-mismatch','解析与当前英文题目未对齐',details);
   if(!nonempty(entry.context))fail('context-missing','缺少收藏来源句',details);
   if(!Array.isArray(entry.options)||entry.options.length!==q.options.length){fail('options-coverage','选项数量不同',details);continue;}
   if(new Set(entry.options.map(x=>x.text)).size!==q.options.length)fail('option-duplicate','选项解析文字重复',details);
   for(let i=0;i<q.options.length;i++){
    const text=q.options[i],value=entry.options.find(x=>x.text===text),d={...details,option:text};
    if(!value){fail('option-missing','缺少具体选项解析',d);continue;}reason(value.reasonZh,d);
    if(!['word','phrase','sentence','position'].includes(value.kind))fail('option-kind','选项类型非法',d);
    if(value.lexical){if(value.lexical!==norm(text)||!dictionary.has(value.lexical))fail('option-lexical','选项词典映射缺失或不同于原文',d);}
    else if(value.kind==='position'){if(!/^\[\d+\]$/.test(text))fail('position-shape','非法插入位置标记',d);}
    else{
     const keys=units.filter(u=>u.id===q.id&&u.option===i).map(u=>u.key);
     if(!keys.length||JSON.stringify(keys)!==JSON.stringify(value.translationKeys))fail('option-translations','未精确复用原有选项翻译键',d);
     for(const lang of ['zh','ja'])for(const key of keys)if(!nonempty(translations?.[lang]?.[bank]?.entries?.[key]))fail('option-translation-missing','选项原译文缺失',{...d,lang,key});
     if(['word','phrase'].includes(value.kind)&&(!nonempty(value.pos)||value.pos==='回答词'))fail('option-pos','单词或短语缺少词性',d);
    }
   }
  }
  summaries.push(`options/${bank}: ${questions.length} questions, ${questions.reduce((n,{q})=>n+q.options.length,0)} choices`);
 }
 const vp=packs?.vocab;if(!pack(vp))fail('vocab-option-pack','词汇填空解析包缺失或格式错误');
 else if(Array.isArray(vocab)){
  for(const id of Object.keys(vp.entries))if(!known.has(id))fail('cloze-extra','多余填空解析 ID',{id});
  for(const w of vocab){const entry=vp.entries[w.id],ref={id:w.id,mode:'vocab'};
   if(!entry||entry.signature!==optionSourceSignature(ref,w)||!object(entry.reasons)){fail('cloze-missing','词汇填空解析缺失或与源不一致',{id:w.id});continue;}
   const expected=[w.word,...w.clozeDistractors];
   for(const option of Object.keys(entry.reasons))if(!expected.includes(option))fail('cloze-extra-option','填空包含非现有选项',{id:w.id,option});
   for(const text of expected){reason(entry.reasons[text],{id:w.id,option:text});if(!dictionary.has(norm(text)))fail('cloze-lexical','词汇填空选项未收录释义',{id:w.id,option:text});}
   for(const word of w.confusables||[])if(!dictionary.has(norm(word)))fail('confusable-lexical','易混词未收录释义',{id:w.id,word});
   const canonical=dictionary.get(norm(w.word))?.lexemes?.find(x=>x.wordId===w.id);
   if(!canonical)fail('canonical-missing','词典中缺少精确义项',{id:w.id});
   else if(canonical.ja!==translations?.ja?.['vocab-meanings']?.entries?.[`${w.id}/meaning`])fail('canonical-ja','精确词卡日文与词义小包不同',{id:w.id});
  }
  summaries.push(`options/vocab: ${vocab.length} cloze cards; all canonical senses and external confusables covered`);
 }
 return{errors,summaries,questionCount,optionCount,lexicalCount:dictionary.size};
}
export function validateOptionsFiles(root=process.cwd()){
 const read=p=>{try{return JSON.parse(fs.readFileSync(resolve(root,p),'utf8'));}catch{return undefined;}};
 return validateOptions({vocab:read('data/vocab.json'),records:Object.fromEntries(OPTION_BANKS.map(b=>[b,read(`data/${b}.json`)])),packs:Object.fromEntries([...OPTION_BANKS,'vocab'].map(b=>[b,read(`data/options/${b}.json`)])),lexicons:Object.fromEntries([...Array.from({length:26},(_,i)=>String.fromCharCode(97+i)),'other'].map(b=>[b,read(`data/options/lexicon/${b}.json`)])),translations:Object.fromEntries(['zh','ja'].map(l=>[l,Object.fromEntries([...OPTION_BANKS,'vocab-meanings'].map(b=>[b,read(`data/i18n/${l}/${b}.json`)]))]))});
}
if(import.meta.url===pathToFileURL(resolve(process.argv[1]||'')).href){const result=validateOptionsFiles();for(const summary of result.summaries)console.log(summary);if(result.errors.length){console.error(JSON.stringify(result.errors,null,2));process.exitCode=1;}else console.log(`Validated ${result.questionCount} questions / ${result.optionCount} static options / ${result.lexicalCount} dictionary surfaces.`);}
