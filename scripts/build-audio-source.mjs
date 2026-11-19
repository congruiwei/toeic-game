// Authoring only: produce stable keys without changing a question or translation.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceUnits} from '../js/translation-source.js';
import {splitSentences} from '../js/replay.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const outputIndex=process.argv.indexOf('--output');
if(outputIndex>=0&&(!process.argv[outputIndex+1]||process.argv[outputIndex+1].startsWith('--')))throw new Error('Missing --output JSON path');
const output=outputIndex>=0?path.resolve(process.argv[outputIndex+1]):path.join(root,'data/audio/source.json');
const voices={en:['af_heart','am_puck','af_bella'],ja:['jf_alpha']};
const banks=['part1','part2','listening','vocab','reading','grammar','methods'];
const units=[], seen=new Set(), castSpeakers=new Map(), expandedVocab=new Set(), addedRequired=new Set();
const hash=s=>[...s].reduce((n,c)=>(Math.imul(n,31)+c.charCodeAt(0))>>>0,0);
function actor(bank,group,key,speaker) {
  const n=hash(group),female=n%2?'af_bella':'af_heart';
  const pair=n%4<2?[female,'am_puck']:['am_puck',female];
  if(bank==='part2'&&!key.includes('/explanation/'))return pair[key.includes('/audio/')?0:1];
  const people=castSpeakers.get(group)||[];
  if(speaker&&people.length===2)return pair[Math.max(0,people.indexOf(speaker))];
  const offset=speaker?Math.max(0,people.indexOf(speaker)):0;
  return voices.en[(n+offset)%3];
}
function add(bank,language,key,text,extra={}) {
  if(typeof text!=='string'||!text.trim())return;
  const token=`${language}:${bank}:${key}`;
  if(seen.has(token))return;
  seen.add(token);
  const group=extra.group||key.split('/')[0];
  units.push({bank,language,key,text,voiceId:language==='ja'?'jf_alpha':actor(bank,group,key,extra.speaker),
    kind:extra.kind||'sentence',group,...extra});
}
function sentences(bank,id,field,text,extra={}) {
  splitSentences(text||'').forEach((line,i)=>add(bank,'en',`${id}/${field}/${i}`,line,extra));
}
for(const bank of banks) {
  const records=JSON.parse(await fs.readFile(path.join(root,`data/${bank}.json`),'utf8'));
  const japanese=JSON.parse(await fs.readFile(path.join(root,`data/i18n/ja/${bank}.json`),'utf8')).entries;
  const groupOf=new Map(),dictationSpeaker=new Map();
  const byID=new Map(records.map(row=>[row.id,row]));
  if(bank==='vocab')for(const row of records)if(row.i18nDetails===true)expandedVocab.add(row.id);
  for(const row of records) {
    if(row.turns)castSpeakers.set(row.id,[...new Set(row.turns.map(t=>t.speaker))].sort());
    groupOf.set(row.id,row.id);
    for(const q of row.questions||[])groupOf.set(q.id,bank==='grammar'?q.id:row.id);
    if(row.dictation) {
      groupOf.set(row.dictation.id,row.id);
      dictationSpeaker.set(row.dictation.id,row.turns.find(t=>t.text.includes(row.dictation.text))?.speaker||'A');
    }
  }
  for(const u of sourceUnits(bank,records)) {
    const extra={group:groupOf.get(u.id)||u.id,kind:u.kind};
    if(u.speaker||dictationSpeaker.has(u.id))extra.speaker=u.speaker||dictationSpeaker.get(u.id);
    const englishExtra=bank==='vocab'&&u.kind==='meaning'?{...extra,pos:byID.get(u.id).pos,ipa:byID.get(u.id).ipa}:extra;
    add(bank,'en',u.key,u.text,englishExtra);
    if(japanese[u.key]!==undefined)add(bank,'ja',u.key,japanese[u.key],extra);
  }
  for(const row of records) {
    if(bank==='vocab') {
      for(const field of ['collocation','paraphrase'])sentences(bank,row.id,field,row[field]);
      for(const field of ['clozeDistractors','confusables'])for(const [i,text] of (row[field]||[]).entries())
        add(bank,'en',`${row.id}/${field}/${i}/0`,text,{kind:'word'});
    }
    for(const q of row.questions||[row]) {
      const extra={group:groupOf.get(q.id)||q.id};
      if(bank==='grammar')sentences(bank,q.id,'prompt',q.prompt,extra);
      if(bank==='grammar'||(bank==='reading'&&row.part===6))
        for(const [i,text] of (q.options||[]).entries())sentences(bank,q.id,`options/${i}`,text,extra);
      if(q.en)sentences(bank,q.id,'explanation',q.en,extra);
    }
  }
}
// Lightweight new distractor senses share the established vocab lookup keys.
const addedLexemesPath=path.join(root,'data/options/authoring/lexemes-word-upgrade.json');
let addedLexemes=[];
try {addedLexemes=JSON.parse(await fs.readFile(addedLexemesPath,'utf8'));}
catch(error) {if(error.code!=='ENOENT')throw error;}
{
  for(const item of addedLexemes) {
    const shard=JSON.parse(await fs.readFile(path.join(root,`data/options/lexicon/${item.word[0].toLowerCase()}.json`),'utf8'));
    const lexeme=shard.entries[item.word]?.lexemes?.find(row=>row.word===item.word&&row.pos===item.pos&&row.zh===item.zh&&row.ja===item.ja);
    if(!lexeme)throw new Error(`Missing frozen lightweight lexeme: ${item.word}`);
    expandedVocab.add(lexeme.id);
    add('vocab','en',`${lexeme.id}/meaning`,lexeme.word,{kind:'word',pos:lexeme.pos});
    add('vocab','ja',`${lexeme.id}/meaning`,lexeme.ja,{kind:'meaning'});
  }
}
// Completed duel sentences and authored distinctions share the vocab audio bank.
let confusableData;
try {confusableData=JSON.parse(await fs.readFile(path.join(root,'data/confusables.json'),'utf8'));}
catch(error) {if(error.code!=='ENOENT')throw error;}
if(confusableData) {
  const japanese=JSON.parse(await fs.readFile(path.join(root,'data/i18n/ja/confusables.json'),'utf8')).entries;
  for(const u of sourceUnits('confusables',confusableData)) {
    if(typeof japanese[u.key]!=='string'||!japanese[u.key].trim())throw new Error(`Missing confusable Japanese source: ${u.key}`);
    for(const language of ['en','ja']) {
      const token=`${language}:vocab:${u.key}`;
      if(seen.has(token))throw new Error(`Duplicate confusable audio key: ${token}`);
      const extra={group:u.id,kind:u.kind};
      if(language==='en'&&u.kind==='meaning'&&u.pos)extra.pos=u.pos;
      add('vocab',language,u.key,language==='en'?u.text:japanese[u.key],extra);
      addedRequired.add(token);
    }
  }
}
// Morphology forms are spelling audio; complete example words keep their old keys.
let morphology;
try {morphology=JSON.parse(await fs.readFile(path.join(root,'data/morphemes.json'),'utf8'));}
catch(error) {if(error.code!=='ENOENT')throw error;}
if(morphology) {
  const {morphologyAudioUnits}=await import('../js/word-enrichment.js');
  const vocab=JSON.parse(await fs.readFile(path.join(root,'data/vocab.json'),'utf8'));
  for(const {language,key,text,...extra} of morphologyAudioUnits(morphology,vocab)) {
    const token=`${language}:vocab:${key}`;
    if(seen.has(token))throw new Error(`Duplicate morphology audio key: ${token}`);
    add('vocab',language,key,text,extra);addedRequired.add(token);
  }
}
const terms=JSON.parse(await fs.readFile(path.join(root,'data/i18n/ja/terms.json'),'utf8')).entries;
for(const [key,text] of Object.entries(terms))add('terms','ja',key,text,{kind:'term'});
for(const voiceId of voices.en)for(const letter of 'ABCD')
  add('labels','en',`labels/${voiceId}/${letter}`,`${letter}.`,{kind:'label',voiceId});
for(const u of units) {
  u.required=addedRequired.has(`${u.language}:${u.bank}:${u.key}`)||u.language==='ja'||u.bank==='labels'||
    (['part1','part2'].includes(u.bank)&&!u.key.includes('/explanation/'))||
    (u.bank==='listening'&&!u.key.includes('/explanation/')&&!u.key.includes('/graphic/'))||
    (u.bank==='vocab'&&(expandedVocab.has(u.group)||(/\/meaning$|\/example\//).test(u.key)))||
    (u.bank==='grammar'&&u.key.includes('/sentence/'))||
    (u.bank==='reading'&&/\/documents\/\d+\/text\//.test(u.key));
  u.priority=u.required?(['part1','part2','listening','labels'].includes(u.bank)?1:u.bank==='vocab'?2:3):9;
  if(/^\s*\[[1-4]\]\s*$/.test(u.text)) {
    u.nonSpoken=true;u.required=false;u.priority=9;u.reason='Visual insertion marker; never read aloud';
  }
}
const source={version:1,model:'Kokoro-82M v1.0',voices,units};
await fs.mkdir(path.dirname(output),{recursive:true});
await fs.writeFile(output,JSON.stringify(source,null,2)+'\n');
console.log(JSON.stringify({units:units.length,required:units.filter(u=>u.required).length,counts:units.reduce((n,u)=>(n[`${u.language}/${u.bank}`]=(n[`${u.language}/${u.bank}`]||0)+1,n),{}),requiredCounts:units.filter(u=>u.required).reduce((n,u)=>(n[`${u.language}/${u.bank}`]=(n[`${u.language}/${u.bank}`]||0)+1,n),{})},null,2));
