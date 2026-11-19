import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
async function fixture(){
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'vocab-audio-source-'));
 await fs.cp(path.join(root,'js'),path.join(temp,'js'),{recursive:true});
 await fs.mkdir(path.join(temp,'scripts'));await fs.copyFile(path.join(root,'scripts/build-audio-source.mjs'),path.join(temp,'scripts/build-audio-source.mjs'));
 const save=async(p,v)=>{await fs.mkdir(path.dirname(path.join(temp,p)),{recursive:true});await fs.writeFile(path.join(temp,p),JSON.stringify(v));};
 for(const bank of ['part1','part2','listening','vocab','reading','grammar','methods']){await save(`data/${bank}.json`,[]);await save(`data/i18n/ja/${bank}.json`,{entries:{}});}
 await save('data/i18n/ja/terms.json',{entries:{}});
 const base={id:'v-original',word:'desk',pos:'n.',ipa:'/desk/',example:'We moved the desk.',collocation:'a large desk',paraphrase:'a writing table',clozeDistractors:['chair','shelf','cabinet']};
 const added={...base,id:'v-new',i18nDetails:true};await save('data/vocab.json',[base,added]);
 await save('data/i18n/ja/vocab.json',{entries:{'v-original/meaning':'机','v-original/example/0':'机を動かしました。','v-new/meaning':'机','v-new/example/0':'机を動かしました。','v-new/collocation/0':'大きな机','v-new/paraphrase/0':'筆記用の机'}});
 return {temp,save,run:()=>spawnSync(process.execPath,['scripts/build-audio-source.mjs'],{cwd:temp,encoding:'utf8'}),load:async()=>JSON.parse(await fs.readFile(path.join(temp,'data/audio/source.json'),'utf8'))};
}
test('new detail-bearing cards add bilingual speech while old optional coverage stays unchanged',async()=>{
 const f=await fixture();try{const r=f.run();assert.equal(r.status,0,r.stderr);const units=(await f.load()).units;const get=(language,key)=>units.find(u=>u.language===language&&u.key===key);
 assert.equal(get('en','v-original/collocation/0').required,false);assert.equal(get('ja','v-original/collocation/0'),undefined);
 for(const field of ['meaning','example/0','collocation/0','paraphrase/0'])for(const language of ['en','ja'])assert.equal(get(language,`v-new/${field}`).required,true);
 for(let i=0;i<3;i++)assert.equal(get('en',`v-new/clozeDistractors/${i}/0`).required,true);
 assert.equal(new Set(units.map(u=>`${u.language}:${u.bank}:${u.key}`)).size,units.length);
 }finally{await fs.rm(f.temp,{recursive:true,force:true});}
});
test('new lightweight option sense uses the exact compiled ID and two language meanings',async()=>{
 const f=await fixture();try{const lex={id:'lex-precise',word:'secure',pos:'adj.',zh:'固定牢靠的',ja:'固定された'};await f.save('data/options/authoring/lexemes-word-upgrade.json',[lex]);await f.save('data/options/lexicon/s.json',{entries:{secure:{lexemes:[{...lex,id:'lex-verb',pos:'v.'},lex]}}});
 const r=f.run();assert.equal(r.status,0,r.stderr);const got=(await f.load()).units.filter(u=>u.group==='lex-precise');assert.deepEqual(got.map(u=>[u.language,u.key,u.text,u.required]),[['en','lex-precise/meaning','secure',true],['ja','lex-precise/meaning','固定された',true]]);
 }finally{await fs.rm(f.temp,{recursive:true,force:true});}
});
test('missing lightweight sense cannot silently disappear from the audio source',async()=>{
 const f=await fixture();try{await f.save('data/options/authoring/lexemes-word-upgrade.json',[{word:'secure',pos:'adj.',zh:'稳固',ja:'固定された'}]);assert.notEqual(f.run().status,0);
 await f.save('data/options/lexicon/s.json',{entries:{secure:{lexemes:[{id:'lex-other',word:'secure',pos:'v.',zh:'取得',ja:'確保する'}]}}});const r=f.run();assert.notEqual(r.status,0);assert.match(r.stderr,/Missing frozen lightweight lexeme/);
 }finally{await fs.rm(f.temp,{recursive:true,force:true});}
});
test('source preflight can target an external file without changing published metadata',async()=>{
 const f=await fixture();try{
  await f.save('data/audio/source.json',{published:'unchanged'});const before=await fs.readFile(path.join(f.temp,'data/audio/source.json'));
  const output=path.join(f.temp,'private/source-check.json');const r=spawnSync(process.execPath,['scripts/build-audio-source.mjs','--output',output],{cwd:f.temp,encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);assert.ok(JSON.parse(await fs.readFile(output,'utf8')).units.length>0);
  assert.deepEqual(await fs.readFile(path.join(f.temp,'data/audio/source.json')),before);
 }finally{await fs.rm(f.temp,{recursive:true,force:true});}
});
test('morphology adds explicit spelling and Japanese notes without widening old optional coverage',async()=>{
 const f=await fixture();try{
  await f.save('data/morphemes.json',{version:1,entries:[{id:'pre-re',forms:['re-'],zh:'再次',ja:'再び',noteJa:'動詞に付けます。'}]});
  const words=JSON.parse(await fs.readFile(path.join(f.temp,'data/vocab.json'),'utf8'));
  words[0].partsNote={zh:'词形说明',ja:'元の語を確認します。'};
  await f.save('data/vocab.json',words);
  const r=f.run();assert.equal(r.status,0,r.stderr);const units=(await f.load()).units;
  const added=units.filter(u=>u.key.startsWith('morph-pre-re/')||u.key==='v-original/parts-note');
  assert.equal(added.length,5);assert.ok(added.every(u=>u.required&&u.bank==='vocab'));
  const en=added.find(u=>u.language==='en');assert.equal(en.text,'re-');assert.equal(en.spoken,'R. E.');assert.equal(en.kind,'morpheme-spelling');
  assert.equal(units.find(u=>u.language==='en'&&u.key==='v-original/collocation/0').required,false);
  assert.equal(units.find(u=>u.language==='en'&&u.key==='v-original/clozeDistractors/0/0').required,false);
 }finally{await fs.rm(f.temp,{recursive:true,force:true});}
});

test('confusable audio covers completed examples and distinctions while reusing existing member audio',async()=>{
 const f=await fixture();try{
  await f.save('data/confusables.json',{groups:[{id:'cg-pair',difference:{en:'The two words have different uses.'}}],words:{old:{id:'v-original',wordId:'v-original',word:'desk',example:'Old example.'},fresh:{id:'lex-conf-new',word:'wave',pos:'v.',zh:'挥手',example:'Please wave to the driver.'}},questions:[{id:'cf-new',sentence:'Please wave to the visitor.'}]});
  await f.save('data/i18n/ja/confusables.json',{entries:{'cg-pair/difference/0':'二つの語は使い方が異なります。','lex-conf-new/meaning':'手を振る','lex-conf-new/example/0':'運転手に手を振ってください。','cf-new/sentence/0':'来客に手を振ってください。'}});
  const r=f.run();assert.equal(r.status,0,r.stderr);const units=(await f.load()).units;
  const fresh=units.filter(u=>/^(?:cg-pair|lex-conf-new|cf-new)\//.test(u.key));assert.equal(fresh.length,8);assert.ok(fresh.every(u=>u.bank==='vocab'&&u.required));
  assert.equal(units.filter(u=>u.language==='en'&&u.key==='v-original/meaning').length,1);
  assert.equal(units.find(u=>u.language==='en'&&u.key==='v-original/collocation/0').required,false);
  assert.equal(fresh.find(u=>u.language==='en'&&u.key==='lex-conf-new/meaning').pos,'v.');
  assert.equal(fresh.find(u=>u.key==='cf-new/sentence/0'&&u.language==='en').text,'Please wave to the visitor.');
 }finally{await fs.rm(f.temp,{recursive:true,force:true});}
});
test('confusable source refuses missing Japanese text or a collision with an existing audio key',async()=>{
 const f=await fixture();try{
  const data={groups:[],words:{fresh:{id:'lex-conf-new',word:'wave',pos:'v.',zh:'挥手',example:'Please wave.'}},questions:[]};
  await f.save('data/confusables.json',data);await f.save('data/i18n/ja/confusables.json',{entries:{}});
  const missing=f.run();assert.notEqual(missing.status,0);assert.match(missing.stderr,/Missing confusable Japanese source/);
  data.words.fresh.id='v-original';await f.save('data/confusables.json',data);await f.save('data/i18n/ja/confusables.json',{entries:{'v-original/meaning':'机','v-original/example/0':'手を振ってください。'}});
  const duplicate=f.run();assert.notEqual(duplicate.status,0);assert.match(duplicate.stderr,/Duplicate confusable audio key/);
 }finally{await fs.rm(f.temp,{recursive:true,force:true});}
});

test('humor audio uses the authored bilingual key without making older optional fields required',async()=>{
 const f=await fixture();try{
  await f.save('data/vocab-humor.json',{version:1,entries:{'v-original/humor/0':'The desk has more visitors than our manager.'}});
  await f.save('data/i18n/ja/vocab-humor.json',{version:1,entries:{'v-original/humor/0':'机のほうが上司より来客が多い。'}});
  const r=f.run();assert.equal(r.status,0,r.stderr);const units=(await f.load()).units,humor=units.filter(u=>u.key==='v-original/humor/0');
  assert.equal(humor.length,2);assert.ok(humor.every(u=>u.required&&u.bank==='vocab'&&u.group==='v-original'));
  assert.equal(humor.find(u=>u.language==='en').text,'The desk has more visitors than our manager.');
  assert.equal(units.find(u=>u.language==='en'&&u.key==='v-original/collocation/0').required,false);
 }finally{await fs.rm(f.temp,{recursive:true,force:true});}
});
test('humor audio rejects missing or extra Japanese keys instead of silently losing content',async()=>{
 const f=await fixture();try{
  await f.save('data/vocab-humor.json',{version:1,entries:{'v-original/humor/0':'The desk has more visitors than our manager.'}});
  for(const entries of [{},{'v-original/humor/0':'机のほうが上司より来客が多い。','v-other/humor/0':'別の文。'}]){
   await f.save('data/i18n/ja/vocab-humor.json',{version:1,entries});const r=f.run();assert.notEqual(r.status,0);assert.match(r.stderr,/Humor translation keys differ/);
  }
 }finally{await fs.rm(f.temp,{recursive:true,force:true});}
});
