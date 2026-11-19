import fs from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {sourceUnits} from '../js/translation-source.js';
export function validateConfusables(data,vocab,projection,translations,part2){
 const errors=[],fail=(id,message)=>errors.push({id,message}),ids=new Set(),members=new Set(),v=new Map(vocab.map(w=>[w.id,w]));
 if(data?.version!==1||!Array.isArray(data.groups)||!data.words||!Array.isArray(data.questions))return [{id:'data',message:'Invalid shape'}];
 for(const g of data.groups){
  if(ids.has(g.id))fail(g.id,'Duplicate group');ids.add(g.id);
  if(!['spelling','sound','meaning'].includes(g.type)||g.members.length<2||g.members.length>4||new Set(g.members).size!==g.members.length)fail(g.id,'Group needs 2–4 distinct sense IDs');
  for(const lang of ['en','zh','ja'])if(!g.difference?.[lang]?.trim())fail(g.id,'Missing contrast '+lang);
  for(const id of g.members){members.add(id);const w=data.words[id];if(!w){fail(id,'Missing word');continue;}
   for(const f of ['word','pos','ipa','zh','ja','example','exampleZh','exampleJa'])if(!w[f]?.trim())fail(id,'Missing '+f);
   if(w.wordId){const card=v.get(w.wordId);if(!card||w.wordId!==id)fail(id,'Canonical sense missing');else for(const f of ['word','pos','ipa','zh','example'])if(w[f]!==card[f])fail(id,'Canonical '+f+' mismatch');}
   else if(!id.startsWith('lex-conf-')||w.wordId!==null)fail(id,'External sense ID invalid');
  }
 }
 for(const id of Object.keys(data.words))if(!members.has(id))fail(id,'Orphan word');
 const expectedProjection=Object.fromEntries([...members].filter(id=>data.words[id].wordId).map(id=>[id,[...new Set(data.groups.filter(g=>g.members.includes(id)).flatMap(g=>g.members.filter(other=>other!==id).map(other=>data.words[other].word)))]]));
 if(projection?.version!==1||JSON.stringify(projection.entries)!==JSON.stringify(expectedProjection))fail('projection','English candidate projection differs from curated groups');
 if(JSON.stringify(projection?.semanticAvoid)!==JSON.stringify(data.semanticAvoid)||!data.semanticAvoid?.every(pair=>Array.isArray(pair)&&pair.length===2&&pair.every(w=>Object.values(data.words).some(x=>x.word===w))))fail('projection','Meaning overlap guard differs from authored groups');
 for(const q of data.questions){
  if(ids.has(q.id))fail(q.id,'Duplicate ID');ids.add(q.id);const g=data.groups.find(g=>g.id===q.groupId),w=data.words[q.wordId];
  if(!g?.members.includes(q.wordId)||!w||q.answer!==w.word)fail(q.id,'Wrong target sense');
  if(q.options.length<2||q.options.length>4||new Set(q.options).size!==q.options.length||!q.options.includes(q.answer)||q.options.some(o=>!g?.members.some(id=>data.words[id].word===o)))fail(q.id,'Invalid options');
  if(q.prompt.replace('_____',q.answer).toLowerCase()!==q.sentence.toLowerCase()||(q.prompt.match(/_____/g)||[]).length!==1)fail(q.id,'Cloze mismatch');
  const length=q.sentence.match(/[A-Za-z0-9]+(?:['’.-][A-Za-z0-9]+)*/g)?.length;if(length<8||length>20)fail(q.id,'Sentence length');
  if(!q.en?.trim()||!q.zh?.trim())fail(q.id,'Missing explanation');
 }
 for(const trap of data.part2Traps){const q=part2.find(q=>q.id===trap.id);if(!q||!q.options.includes(trap.option)||q.answer===trap.option||!trap.reasonZh)fail(trap.id,'Trap must bind an actual wrong option');if(trap.groupId&&!data.groups.some(g=>g.id===trap.groupId&&g.members.includes(trap.sourceWordId)&&g.members.includes(trap.distractorWordId)))fail(trap.id,'Trap sense mismatch');}
 if(JSON.stringify(projection?.part2TrapIds)!==JSON.stringify(data.part2Traps.map(t=>t.id)))fail('projection','Part 2 trap index differs from authored annotations');
 const units=sourceUnits('confusables',data);
 for(const lang of ['zh','ja']){const entries=translations[lang]?.entries||{};if(Object.keys(entries).length!==units.length)fail(lang,'Translation key count');for(const u of units){const text=entries[u.key];if(!text?.trim())fail(u.key,'Missing '+lang);else if(u.kind==='sentence'&&text.replace(/「[^」]*」|“[^”]*”|"[^"]*"/g,'').split(/[。！？!?]+/).filter(s=>s.trim()).length>1)fail(u.key,'Split translated sentence');}}
 return errors;
}
export function validateConfusableFiles(root=new URL('../',import.meta.url)){
 const read=p=>JSON.parse(fs.readFileSync(new URL(p,root),'utf8'));
 const data=read('data/confusables.json');
 return {errors:validateConfusables(data,read('data/vocab.json'),read('data/confusable-candidates.json'),Object.fromEntries(['zh','ja'].map(l=>[l,read(`data/i18n/${l}/confusables.json`)])),read('data/part2.json')),
  summary:{groups:data.groups.length,types:Object.fromEntries(['spelling','sound','meaning'].map(t=>[t,data.groups.filter(g=>g.type===t).length])),questions:data.questions.length,light:Object.values(data.words).filter(w=>!w.wordId).length,retired:data.retiredPairs.length,family:data.removedPairs.length}};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){const r=validateConfusableFiles();console.log(r.summary);if(r.errors.length){console.error(r.errors);process.exitCode=1;}}
