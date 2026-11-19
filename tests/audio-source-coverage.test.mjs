import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {validateVocabularyAudioCoverage,validateAudio} from '../scripts/validate-bank-audio.mjs';

const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const id=unit=>`${unit.language}:${unit.bank}:${unit.key}`;
const clone=value=>structuredClone(value);

async function fixture(t){
  const root=await fs.mkdtemp('/private/tmp/toeic-audio-source-coverage-');
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const save=async(file,value)=>{
    await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});
    await fs.writeFile(path.join(root,file),JSON.stringify(value,null,2)+'\n');
  };
  const load=async file=>JSON.parse(await fs.readFile(path.join(root,file),'utf8'));
  const vocabulary=[
    {id:'v-desk',partsNote:{ja:'語の形を確認します。'},partsTrap:{ja:'文字だけでは判断しません。'}},
    {id:'v-chair'},
  ];
  await save('data/vocab.json',vocabulary);
  await save('data/morphemes.json',{entries:[{id:'pre-re',forms:['re-'],ja:'再び',noteJa:'動詞に付けます。'}]});
  await save('data/i18n/ja/morphemes.json',{entries:{'morph-pre-re/forms/0':'再び'}});
  await save('data/confusables.json',{
    groups:[{id:'cg-pair',difference:{en:'The two words have different uses.',ja:'二つの語の使い方は異なります。'}}],
    words:{existing:{id:'v-desk',wordId:'v-desk',word:'desk',example:'Existing example.'},
      fresh:{id:'lex-conf-wave',word:'wave',ja:'手を振る',example:'Mr. Lee waves. Please wait.',exampleJa:'Lee さんが手を振ります。 お待ちください。'}},
    questions:[{id:'cf-wave',sentence:'Wave to the driver. Then wait.',sentenceJa:'運転手に手を振ってください。それから待ちます。'}],
  });
  await save('data/i18n/ja/confusables.json',{entries:{
    'cg-pair/difference/0':'二つの語の使い方は異なります。',
    'lex-conf-wave/meaning':'手を振る','lex-conf-wave/example/0':'Lee さんが手を振ります。',
    'lex-conf-wave/example/1':'お待ちください。','cf-wave/sentence/0':'運転手に手を振ってください。',
    'cf-wave/sentence/1':'それから待ちます。',
  }});
  await save('data/vocab-humor.json',{entries:{'v-desk/humor/0':'Our desk has an appointment.','v-chair/humor/0':'The chair needs a holiday.'}});
  await save('data/i18n/ja/vocab-humor.json',{entries:{'v-desk/humor/0':'机には予定があります。','v-chair/humor/0':'椅子には休暇が必要です。'}});

  // These explicit expectations deliberately do not call the source builder or
  // either source/morphology export helper under test.
  const rows=[
    ['en','morph-pre-re/forms/0','re-','R. E.'],['ja','morph-pre-re/forms/0','再び'],
    ['ja','morph-pre-re/meaning','再び'],['ja','morph-pre-re/note','動詞に付けます。'],
    ['ja','v-desk/parts-note','語の形を確認します。'],['ja','v-desk/parts-trap','文字だけでは判断しません。'],
    ['en','cg-pair/difference/0','The two words have different uses.'],['ja','cg-pair/difference/0','二つの語の使い方は異なります。'],
    ['en','lex-conf-wave/meaning','wave'],['ja','lex-conf-wave/meaning','手を振る'],
    ['en','lex-conf-wave/example/0','Mr. Lee waves.'],['ja','lex-conf-wave/example/0','Lee さんが手を振ります。'],
    ['en','lex-conf-wave/example/1','Please wait.'],['ja','lex-conf-wave/example/1','お待ちください。'],
    ['en','cf-wave/sentence/0','Wave to the driver.'],['ja','cf-wave/sentence/0','運転手に手を振ってください。'],
    ['en','cf-wave/sentence/1','Then wait.'],['ja','cf-wave/sentence/1','それから待ちます。'],
    ['en','v-desk/humor/0','Our desk has an appointment.'],['ja','v-desk/humor/0','机には予定があります。'],
    ['en','v-chair/humor/0','The chair needs a holiday.'],['ja','v-chair/humor/0','椅子には休暇が必要です。'],
  ];
  const source={units:rows.map(([language,key,text,spoken])=>({language,bank:'vocab',key,text,required:true,...(spoken?{spoken}:{})}))};
  source.units.push({language:'en',bank:'vocab',key:'v-desk/collocation/0',text:'old optional content',required:false});
  return {root,save,load,vocabulary,source,check:source=>validateVocabularyAudioCoverage(root,source)};
}

test('raw fields cover all additions while existing optional sources and files stay unchanged',async t=>{
  const f=await fixture(t),before=JSON.stringify(f.source);
  const files=['data/vocab.json','data/morphemes.json','data/confusables.json','data/vocab-humor.json'];
  const snapshots=await Promise.all(files.map(file=>fs.readFile(path.join(f.root,file),'utf8')));
  assert.deepEqual(await f.check(f.source),[]);
  assert.equal(JSON.stringify(f.source),before);
  assert.deepEqual(await Promise.all(files.map(file=>fs.readFile(path.join(f.root,file),'utf8'))),snapshots);
});

test('missing bilingual keys, changed text and required downgrades are rejected in every category',async t=>{
  const f=await fixture(t);
  for(const key of ['morph-pre-re/forms/0','cf-wave/sentence/1','v-chair/humor/0']){
    const missing=clone(f.source);missing.units=missing.units.filter(unit=>unit.key!==key);
    assert.match((await f.check(missing)).join('\n'),/Added source text\/key changed/);
    for(const language of ['en','ja'])for(const change of [{text:'Different text'},{required:false},{nonSpoken:true}]){
      const changed=clone(f.source);Object.assign(changed.units.find(unit=>unit.key===key&&unit.language===language),change);
      assert.notDeepEqual(await f.check(changed),[],`${language} ${key} ${JSON.stringify(change)}`);
    }
  }
});

test('new authored forms, notes and sentences cannot disappear from an unchanged source file',async t=>{
  const f=await fixture(t),morphology=await f.load('data/morphemes.json');
  morphology.entries[0].forms.push('again-');await f.save('data/morphemes.json',morphology);
  assert.match((await f.check(f.source)).join('\n'),/morph-pre-re\/forms\/1/);
  morphology.entries[0].forms.pop();await f.save('data/morphemes.json',morphology);
  f.vocabulary[1].partsNote={ja:'新しい説明です。'};await f.save('data/vocab.json',f.vocabulary);
  assert.match((await f.check(f.source)).join('\n'),/v-chair\/parts-note/);
  delete f.vocabulary[1].partsNote;await f.save('data/vocab.json',f.vocabulary);
  const confusables=await f.load('data/confusables.json');confusables.questions[0].sentence+=' Check the sign.';
  await f.save('data/confusables.json',confusables);
  assert.match((await f.check(f.source)).join('\n'),/cf-wave\/sentence\/2/);
});

test('removing a humor sense from both authored languages and the source cannot shrink coverage',async t=>{
  const f=await fixture(t),key='v-chair/humor/0';
  for(const file of ['data/vocab-humor.json','data/i18n/ja/vocab-humor.json']){
    const data=await f.load(file);delete data.entries[key];await f.save(file,data);
  }
  f.source.units=f.source.units.filter(unit=>unit.key!==key);
  assert.match((await f.check(f.source)).join('\n'),/every vocabulary sense exactly/);
});

test('stale reserved keys, wrong language or bank, and wrong spelling audio are rejected',async t=>{
  const f=await fixture(t);
  for(const change of [{key:'morph-removed/forms/0'},{bank:'morphemes'},{language:'zh'},{spoken:'renew'}]){
    const source=clone(f.source);Object.assign(source.units[0],change);
    assert.notDeepEqual(await f.check(source),[],JSON.stringify(change));
  }
  for(const key of ['cf-old/sentence/0','cg-old/difference/0','lex-conf-old/meaning','v-desk/humor/1','v-old/parts-note']){
    const source=clone(f.source);source.units.push({language:'en',bank:'vocab',key,text:'Old content',required:true});
    assert.match((await f.check(source)).join('\n'),/Unexpected added audio source/);
  }
});

test('translation key sets are exact and cannot use a different morpheme meaning',async t=>{
  const f=await fixture(t);
  for(const bank of ['morphemes','confusables','vocab-humor']){
    const file=`data/i18n/ja/${bank}.json`,original=await f.load(file),missing=clone(original);
    delete missing.entries[Object.keys(missing.entries)[0]];await f.save(file,missing);
    assert.match((await f.check(f.source)).join('\n'),/Japanese audio key set differs/);
    const extra=clone(original);extra.entries['extra/key']='追加';await f.save(file,extra);
    assert.match((await f.check(f.source)).join('\n'),/Japanese audio key set differs/);
    await f.save(file,original);
  }
  await f.save('data/i18n/ja/morphemes.json',{entries:{'morph-pre-re/forms/0':'別の意味'}});
  assert.match((await f.check(f.source)).join('\n'),/Morpheme Japanese meaning differs/);
});

test('a removed category file or an empty present category is not treated as complete coverage',async t=>{
  const f=await fixture(t);
  for(const [file,empty] of [['data/morphemes.json',{entries:[]}],['data/confusables.json',{groups:[],words:{},questions:[]}],['data/vocab-humor.json',{entries:{}}]]){
    const original=await f.load(file);await fs.unlink(path.join(f.root,file));
    assert.match((await f.check(f.source)).join('\n'),/Unexpected added audio source/);
    await f.save(file,empty);assert.notDeepEqual(await f.check(f.source),[]);
    await f.save(file,original);
  }
});

test('removing raw data and audio together cannot hide a surviving Japanese translation pack',async t=>{
  for(const [bank,owns] of [
    ['morphemes',key=>key.startsWith('morph-')],
    ['confusables',key=>/^(cg-|cf-|lex-conf-)/.test(key)],
    ['vocab-humor',key=>key.includes('/humor/')],
  ]){
    const f=await fixture(t);await fs.unlink(path.join(f.root,`data/${bank}.json`));
    f.source.units=f.source.units.filter(unit=>!owns(unit.key));
    assert.match((await f.check(f.source)).join('\n'),new RegExp(`Orphan Japanese audio translation ${bank}`));
  }
});

test('raw Japanese UI fields must match their exact translated audio segments',async t=>{
  const f=await fixture(t),original=await f.load('data/confusables.json');
  for(const change of [
    data=>data.groups[0].difference.ja='別の説明です。',
    data=>data.words.fresh.ja='別の意味',
    data=>data.words.fresh.exampleJa='別の例文です。',
    data=>data.questions[0].sentenceJa='別の答えです。',
    data=>delete data.questions[0].sentenceJa,
    data=>data.words.fresh.exampleJa='Leeさんが手を振ります。お待ちください。',
  ]){
    const changed=clone(original);change(changed);await f.save('data/confusables.json',changed);
    assert.match((await f.check(f.source)).join('\n'),/Authored Japanese audio text differs/);
  }
  original.words.fresh.exampleJa='Lee さんが手を振ります。\nお待ちください。';
  await f.save('data/confusables.json',original);
  assert.deepEqual(await f.check(f.source),[],'only inter-segment whitespace may differ');
});

test('public validation calls the independent gate and still supports legacy archive fixtures',async t=>{
  const f=await fixture(t);
  for(const bank of ['part1','part2','listening','vocab','reading','grammar','methods']){
    await f.save(`data/${bank}.json`,[]);await f.save(`data/i18n/ja/${bank}.json`,{entries:{}});
  }
  await f.save('data/i18n/ja/terms.json',{entries:{}});
  for(const bank of ['morphemes','confusables','vocab-humor']){
    await fs.unlink(path.join(f.root,`data/${bank}.json`));
    await fs.unlink(path.join(f.root,`data/i18n/ja/${bank}.json`));
  }
  const source={units:[]};await f.save('data/audio/source.json',source);
  const sourceSha256=hash(await fs.readFile(path.join(f.root,'data/audio/source.json')));
  await f.save('data/audio/manifest.json',{sourceSha256,complete:true,requiredComplete:true,requiredAuditComplete:true,packs:[],totals:{requiredExpected:0,requiredCount:0,requiredAudited:0,files:0,audioBytes:0}});
  assert.equal((await validateAudio({root:f.root})).ok,true);
  await f.save('data/morphemes.json',{entries:[{id:'pre-re',forms:['re-'],ja:'再び'}]});
  const result=await validateAudio({root:f.root});
  assert.equal(result.ok,false);assert.match(result.errors.join('\n'),/Added source text\/key changed en:vocab:morph-pre-re\/forms\/0/);
});
