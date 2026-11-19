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
