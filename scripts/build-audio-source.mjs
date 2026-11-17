// Authoring only: produce stable keys without changing a question or translation.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceUnits} from '../js/translation-source.js';
import {splitSentences} from '../js/replay.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const voices={en:['af_heart','am_puck','af_bella'],ja:['jf_alpha']};
const banks=['part1','part2','listening','vocab','reading','grammar','methods'];
const units=[], seen=new Set(), castSpeakers=new Map();
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
const terms=JSON.parse(await fs.readFile(path.join(root,'data/i18n/ja/terms.json'),'utf8')).entries;
for(const [key,text] of Object.entries(terms))add('terms','ja',key,text,{kind:'term'});
for(const voiceId of voices.en)for(const letter of 'ABCD')
  add('labels','en',`labels/${voiceId}/${letter}`,`${letter}.`,{kind:'label',voiceId});
for(const u of units) {
  u.required=u.language==='ja'||u.bank==='labels'||
    (['part1','part2'].includes(u.bank)&&!u.key.includes('/explanation/'))||
    (u.bank==='listening'&&!u.key.includes('/explanation/')&&!u.key.includes('/graphic/'))||
    (u.bank==='vocab'&&(/\/meaning$|\/example\//).test(u.key))||
    (u.bank==='grammar'&&u.key.includes('/sentence/'))||
    (u.bank==='reading'&&/\/documents\/\d+\/text\//.test(u.key));
  u.priority=u.required?(['part1','part2','listening','labels'].includes(u.bank)?1:u.bank==='vocab'?2:3):9;
  if(/^\s*\[[1-4]\]\s*$/.test(u.text)) {
    u.nonSpoken=true;u.required=false;u.priority=9;u.reason='Visual insertion marker; never read aloud';
  }
}
const source={version:1,model:'Kokoro-82M v1.0',voices,units};
await fs.mkdir(path.join(root,'data/audio'),{recursive:true});
await fs.writeFile(path.join(root,'data/audio/source.json'),JSON.stringify(source,null,2)+'\n');
console.log(JSON.stringify({units:units.length,required:units.filter(u=>u.required).length,counts:units.reduce((n,u)=>(n[`${u.language}/${u.bank}`]=(n[`${u.language}/${u.bank}`]||0)+1,n),{}),requiredCounts:units.filter(u=>u.required).reduce((n,u)=>(n[`${u.language}/${u.bank}`]=(n[`${u.language}/${u.bank}`]||0)+1,n),{})},null,2));
