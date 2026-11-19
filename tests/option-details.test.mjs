import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolve} from 'node:path';
import {validateOptions,validateOptionsFiles,OPTION_BANKS} from '../scripts/validate-options.mjs';
import {loadOptionDetails,renderOptionDetails,optionSourceSignature} from '../js/option-details.js';
import {bank,catalog,loadBank,question,vocabularyFormats,ensureVocabMeanings} from '../js/bank.js';
const read=p=>JSON.parse(fs.readFileSync(resolve(p),'utf8'));
const sourceData=()=>({vocab:read('data/vocab.json'),records:Object.fromEntries(OPTION_BANKS.map(b=>[b,read(`data/${b}.json`)])),packs:Object.fromEntries([...OPTION_BANKS,'vocab'].map(b=>[b,read(`data/options/${b}.json`)])),lexicons:Object.fromEntries([...Array.from({length:26},(_,i)=>String.fromCharCode(97+i)),'other'].map(b=>[b,read(`data/options/lexicon/${b}.json`)])),translations:Object.fromEntries(['zh','ja'].map(l=>[l,Object.fromEntries([...OPTION_BANKS,...(l==='ja'?['vocab-meanings']:[])].map(b=>[b,read(`data/i18n/${l}/${b}.json`)]))]))});
const requests=[];
globalThis.fetch=async url=>{requests.push(String(url));try{return new Response(fs.readFileSync(resolve(String(url).replace(/^\.\//,'')),'utf8'),{status:200,headers:{'Content-Type':'application/json'}});}catch{return new Response('missing',{status:404});}};
await loadBank(['vocab',...OPTION_BANKS]);await ensureVocabMeanings();

test('all production option packs and exact canonical senses pass complete coverage validation',()=>{
 const result=validateOptionsFiles();assert.deepEqual(result.errors,[]);assert.equal(result.questionCount,1162);assert.equal(result.optionCount,4448);assert(result.lexicalCount>3000);
 const reading=read('data/options/reading.json');assert(reading.entries['read-plants-03'].options.every(x=>x.kind==='phrase'));
 const context=reading.entries['read-samples-01'].context;assert(context.includes('before'));for(const marker of ['[2]','[3]','[4]'])assert(context.includes(marker),'collection context must retain ungraded blanks: '+marker);
 assert.equal(reading.entries['read-badge-02'].context,'Thank you for returning yours.');
 const listening=read('data/options/listening.json');assert.equal(listening.entries['p4-g03-q3'].options.find(x=>x.text.startsWith('Repair equipment')).kind,'sentence');
 assert.equal(listening.entries['p3-g01-q2'].options.find(x=>x.text==='Name badges').pos,'名词短语');
 const lex=Object.assign({},...Object.values(sourceData().lexicons).map(p=>p.entries));
 for(const q of read('data/grammar.json').flatMap(t=>t.questions).filter(q=>q.id.startsWith('gram-lexis-'))){const n=+q.id.split('-').at(-1),expected=n<=35?'v':n<=65?'n':n<=90?'adj':'adv';for(const word of q.options){if(q.id==='gram-lexis-82'&&word==='priority')continue;assert(new RegExp('(?:^|[^A-Za-z])'+expected+'\\.').test(lex[word].pos),q.id+' '+word+' needs '+expected);}}
 for(const word of ['owns','owned','will own','is owning'])assert(!lex[word].zh.includes('自己的'),word+' must use only the verb sense in derived forms');
 for(const [phrase,base]of [['to applying','apply'],['to enrolling','enroll'],['to trying','try']]){
  assert(lex[phrase].ja.includes('前置詞'),'the option retains its grammar restriction');
  assert(lex[phrase].lexemes.length&&lex[phrase].lexemes.every(item=>item.word===base),'collect the underlying verb instead of grammar commentary');
  assert(lex[phrase].lexemes.every(item=>!item.ja.includes('不定詞の to')),'personal card fronts must contain the word meaning');
 }
});

test('the validator rejects missing whole packs, a missing distractor, changed source, wrong gloss mapping and placeholders',()=>{
 const complete=sourceData();const checks=[
  [d=>{delete d.packs.part2;},'option-pack'],
  [d=>{d.packs.grammar.entries['gram-time-01'].options.pop();},'options-coverage'],
  [d=>{d.records.grammar[0].questions[0].prompt+=' Changed.';},'signature-mismatch'],
  [d=>{d.lexicons.a.entries.available.lexemes[0].zh='错误映射';},'lexeme-canonical'],
  [d=>{d.packs.grammar.entries['gram-time-01'].options[0].reasonZh='TODO 待补';},'reason-missing'],
  [d=>{delete d.packs.vocab.entries['v-available'];},'cloze-missing'],
  [d=>{delete d.lexicons.a;},'lexicon-pack']
 ];for(const[mutate,code]of checks){const data=structuredClone(complete);mutate(data);assert(validateOptions(data).errors.some(e=>e.code===code),code);}
});

test('all actual static questions and all seven dynamic vocabulary formats resolve every selectable option',async()=>{
 let staticCount=0,vocabCount=0;for(const {ref}of catalog.values()){
  if(ref.mode==='dictation')continue;
  for(const format of ref.mode==='vocab'?vocabularyFormats:[null]){
   const r=format?{...ref,format}:ref,q=question(r),details=await loadOptionDetails(r,q,{vocab:bank.vocab});
   assert.equal(details.options.length,q.options.length,r.id+':'+format);assert.equal(details.options.filter(o=>o.correct).length,1);
   assert.equal(details.sourceSignature,optionSourceSignature(r,q));
   for(const [i,option]of details.options.entries()){
    assert.equal(option.text,q.options[i]);assert(option.zh&&option.ja&&option.reasonZh&&option.spokenEnglish);assert(!/TODO|待补|不符合语境/.test(option.reasonZh));
    if(['word','phrase'].includes(option.kind))assert(option.pos);
    for(const lex of option.lexemes)assert(lex.id&&lex.word&&lex.zh&&lex.ja&&lex.pos);
   }
   if(ref.mode==='vocab')vocabCount++;else staticCount++;
  }
 }
 assert.equal(staticCount,1162);assert.equal(vocabCount,bank.vocab.length*vocabularyFormats.length);
 const receiving=await loadOptionDetails({id:'read-receiving-01',mode:'reading'},question({id:'read-receiving-01',mode:'reading'}));
 const moving=receiving.options.find(x=>x.text==='moving');assert(moving.pos.includes('动名词'));assert(moving.reasonZh.includes('不是形容词'));
 const phrasals=await loadOptionDetails({id:'read-print-03',mode:'reading'},question({id:'read-print-03',mode:'reading'}));assert(phrasals.options.every(x=>x.pos==='动词短语'));
 const receipt=await loadOptionDetails({id:'read-receipt-01',mode:'reading'},question({id:'read-receipt-01',mode:'reading'}));assert(receipt.options.find(x=>x.text==='Approve').lexemes.some(x=>x.wordId),'exact existing vocabulary options retain the full-card/FSRS link');
 assert(!requests.some(x=>/i18n\/(?:zh|ja)\/vocab\.json$/.test(x)),'option meanings must never fetch the full vocabulary example pack');
});

test('polysemous words preserve exact target senses, and translated options expose English speech rather than Chinese text',async()=>{
 for(const word of bank.vocab.filter(w=>w.word==='charge')){
  const ref={id:word.id,mode:'vocab',format:'meaning-ja'},q=question(ref),d=await loadOptionDetails(ref,q,{vocab:bank.vocab});
  const correct=d.options.find(o=>o.correct);assert.equal(correct.lexemes.length,1);assert.equal(correct.lexemes[0].wordId,word.id);assert.equal(correct.spokenEnglish,'charge');
 }
 const ref={id:'v-available',mode:'vocab',format:'meaning'};const d=await loadOptionDetails(ref,question(ref),{vocab:bank.vocab});assert.equal(d.options.find(x=>x.correct).spokenEnglish,'available');
});

test('cloze distractors use compatible verb senses rather than same-spelling noun cards',async()=>{
 const optionFor=async(id,text)=>{const ref={id,mode:'vocab',format:'cloze'};const detail=await loadOptionDetails(ref,question(ref),{vocab:bank.vocab});return detail.options.find(option=>option.text===text);};
 const transfer=await optionFor('v-redeem','transfer');
 assert.equal(transfer.pos,'v.');assert.equal(transfer.zh,'调动；转移；转接');assert.equal(transfer.ja,'異動させる；移す；転送する');
 assert.equal(transfer.lexemes.length,1);assert.equal(transfer.lexemes[0].id,'lex-86b30500');assert(!transfer.lexemes[0].wordId,'a verb must not collect the unrelated noun card');
 assert(transfer.reasonZh.includes('转移'));assert(transfer.reasonZh.includes('兑换'));
 const survey=await optionFor('v-landscape','survey');
 assert.equal(survey.pos,'v.');assert.equal(survey.zh,'勘测；调查');assert.equal(survey.ja,'測量する；調査する');
 assert.equal(survey.lexemes.length,1);assert.equal(survey.lexemes[0].word,'survey');assert(!survey.lexemes[0].wordId);assert(survey.reasonZh.includes('铺草皮'));
 const record=await optionFor('v-reduce','record');
 assert.equal(record.pos,'v.');assert.deepEqual(record.lexemes.map(x=>x.wordId),['v-record-enter']);assert.equal(record.zh,'将信息记录保存');
});

test('cloze keeps legitimate participle and gerund surface explanations and underlying collectible verbs',async()=>{
 for(const [id,text,base,form]of [['v-tentative','confirmed','confirm','过去式／过去分词'],['v-correspondence','advertising','advertise','现在分词／动名词']]){
  const ref={id,mode:'vocab',format:'cloze'},details=await loadOptionDetails(ref,question(ref),{vocab:bank.vocab});
  const option=details.options.find(item=>item.text===text);
  assert(option.pos.includes(form),text+' retains the inflection label rather than inventing a new POS sense');
  assert(option.zh.includes(base));assert(option.ja.includes(base));assert(option.lexemes.length>0);
  assert(option.lexemes.every(item=>item.word===base),text+' still collects its underlying verb');
 }
});

test('the other six vocabulary formats retain the exact original canonical target senses',async()=>{
 const ja=read('data/i18n/ja/vocab-meanings.json').entries;
 for(const id of ['v-survey','v-transfer','v-record-stored','v-record-enter']){
  const word=bank.vocab.find(item=>item.id===id);
  for(const format of vocabularyFormats.filter(value=>value!=='cloze')){
   const ref={id,mode:'vocab',format},q=question(ref),details=await loadOptionDetails(ref,q,{vocab:bank.vocab});
   const correct=details.options.find(option=>option.correct);
   assert.equal(correct.pos,word.pos,id+':'+format);assert.equal(correct.zh,word.zh);assert.equal(correct.ja,ja[id+'/meaning']);
   assert.deepEqual(correct.lexemes.map(item=>item.wordId),[id]);
  }
 }
});

test('a loaded bank is cached offline; failed first loads retry; changed signatures and unrecognized options fail explicitly',async()=>{
 const ref={id:'gram-time-01',mode:'grammar'},q=question(ref);let calls=0;const savedFetch=globalThis.fetch;
 const fakeCache=new Map();globalThis.caches={open:async()=>({put:async(k,v)=>fakeCache.set(k,v.clone()),match:async k=>fakeCache.get(k)?.clone()})};
 try{
  const online=await import('../js/option-details.js?offline-first');await online.loadOptionDetails(ref,q,{vocab:bank.vocab});
  globalThis.fetch=async()=>{calls++;throw Error('offline');};
  const offline=await import('../js/option-details.js?offline-reload');const result=await offline.loadOptionDetails(ref,q,{vocab:bank.vocab});assert.equal(result.options.length,4);assert(calls>0);
  await assert.rejects(offline.loadOptionDetails(ref,{...q,prompt:q.prompt+' changed'}),/当前题目不同/);
  await assert.rejects(offline.loadOptionDetails(ref,{...q,options:['unrecognized',...q.options.slice(1)]}),/当前题目不同/);
  const obsolete=read('data/options/grammar.json');obsolete.entries[ref.id].signature='obsolete';
  fakeCache.set('./data/options/grammar.json',new Response(JSON.stringify(obsolete)));
  const stale=await import('../js/option-details.js?valid-but-obsolete');
  await assert.rejects(stale.loadOptionDetails(ref,q),/当前题目不同/);
  globalThis.fetch=savedFetch;
  await assert.rejects(stale.loadOptionDetails(ref,q),/当前题目不同/,'an explicit refresh is required to replace already loaded stale content');
  assert.equal((await stale.loadOptionDetails(ref,q,{refresh:true})).options.length,4);
  globalThis.fetch=async()=>{throw Error('offline');};
  fakeCache.clear();const first=await import('../js/option-details.js?retry-empty');await assert.rejects(first.loadOptionDetails(ref,q),/尚未下载/);
  globalThis.fetch=savedFetch;assert.equal((await first.loadOptionDetails(ref,q)).options.length,4);
 }finally{globalThis.fetch=savedFetch;delete globalThis.caches;}
});

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function cacheRaceFixture(){
 const ref={id:'read-bench-01',mode:'reading'},current=question(ref),previous={...current,prompt:current.prompt+' Former wording.'};
 const currentPack=read('data/options/reading.json'),previousPack=structuredClone(currentPack);
 previousPack.entries[ref.id].signature=optionSourceSignature(ref,previous);
 return {ref,current,previous,currentPack,previousPack,url:'./data/options/reading.json'};
}

test('a superseded fetch finishing last cannot replace a refreshed offline pack',async()=>{
 const f=cacheRaceFixture(),disk=new Map(),oldRequested=deferred(),oldResponse=deferred(),writes=[];
 const savedFetch=globalThis.fetch,savedCaches=globalThis.caches;let calls=0;
 globalThis.caches={open:async()=>({put:async(k,v)=>{writes.push(k);disk.set(k,v.clone());},match:async k=>disk.get(k)?.clone()})};
 globalThis.fetch=async url=>{assert.equal(url,f.url);if(++calls===1){oldRequested.resolve();return oldResponse.promise;}return new Response(JSON.stringify(f.currentPack));};
 try{
  const api=await import('../js/option-details.js?reverse-fetch');
  const older=api.loadOptionDetails(f.ref,f.previous);await oldRequested.promise;
  api.invalidateOptionDetails();await api.loadOptionDetails(f.ref,f.current);
  oldResponse.resolve(new Response(JSON.stringify(f.previousPack)));await older;
  assert.equal(writes.length,1,'a stale fetch never enters Cache.put');
  assert.equal((await disk.get(f.url).clone().json()).entries[f.ref.id].signature,optionSourceSignature(f.ref,f.current));
  globalThis.fetch=async()=>{throw Error('offline');};
  const cold=await import('../js/option-details.js?reverse-fetch-offline');
  assert.equal((await cold.loadOptionDetails(f.ref,f.current)).options.length,4,'cold offline reload must use the refreshed pack');
  await assert.rejects(cold.loadOptionDetails(f.ref,f.previous),/当前题目不同/,'the signature check remains strict');
 }finally{globalThis.fetch=savedFetch;if(savedCaches===undefined)delete globalThis.caches;else globalThis.caches=savedCaches;}
});

test('invalidation during Cache.put keeps newer writes behind the active write without deleting useful cache',async()=>{
 const f=cacheRaceFixture(),disk=new Map(),oldPutStarted=deferred(),finishOldPut=deferred(),newParsed=deferred(),events=[];
 const savedFetch=globalThis.fetch,savedCaches=globalThis.caches;let fetches=0,puts=0;
 globalThis.caches={open:async()=>({
  put:async(k,v)=>{const index=++puts;events.push(`start-${index}`);if(index===1){oldPutStarted.resolve();await finishOldPut.promise;}disk.set(k,v.clone());events.push(`finish-${index}`);},
  match:async k=>disk.get(k)?.clone(),delete:()=>{assert.fail('refresh must not delete a possibly newer offline entry');}
 })};
 globalThis.fetch=async url=>{
  assert.equal(url,f.url);const response=new Response(JSON.stringify(++fetches===1?f.previousPack:f.currentPack));
  if(fetches===2){const clone=response.clone.bind(response);response.clone=()=>{const result=clone(),json=result.json.bind(result);result.json=async()=>{const pack=await json();newParsed.resolve();return pack;};return result;};}
  return response;
 };
 try{
  const api=await import('../js/option-details.js?invalidate-during-put');
  const older=api.loadOptionDetails(f.ref,f.previous);await oldPutStarted.promise;
  api.invalidateOptionDetails();const newer=api.loadOptionDetails(f.ref,f.current);await newParsed.promise;
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(puts,1,'new bytes are ready, but no overlapping put may start');
  finishOldPut.resolve();await Promise.all([older,newer]);
  assert.deepEqual(events,['start-1','finish-1','start-2','finish-2']);
  assert.equal((await disk.get(f.url).clone().json()).entries[f.ref.id].signature,optionSourceSignature(f.ref,f.current));
  globalThis.fetch=async()=>{throw Error('offline');};
  const cold=await import('../js/option-details.js?invalidate-during-put-offline');
  assert.equal((await cold.loadOptionDetails(f.ref,f.current)).options.length,4);
 }finally{finishOldPut.resolve();globalThis.fetch=savedFetch;if(savedCaches===undefined)delete globalThis.caches;else globalThis.caches=savedCaches;}
});

test('failed persistent writes retain the old offline copy and do not poison the next write',async()=>{
 const f=cacheRaceFixture(),original=new Response(JSON.stringify(f.currentPack)),disk=new Map([[f.url,original]]);
 const savedFetch=globalThis.fetch,savedCaches=globalThis.caches;let puts=0;
 globalThis.caches={open:async()=>({put:async(k,v)=>{if(++puts===1)throw new DOMException('full','QuotaExceededError');disk.set(k,v.clone());},match:async k=>disk.get(k)?.clone()})};
 globalThis.fetch=async()=>new Response(JSON.stringify(f.currentPack));
 try{
  const api=await import('../js/option-details.js?put-failure');await api.loadOptionDetails(f.ref,f.current);
  assert.equal(disk.get(f.url),original,'a write failure must preserve existing offline bytes');
  api.invalidateOptionDetails();globalThis.fetch=async()=>{throw Error('offline');};
  assert.equal((await api.loadOptionDetails(f.ref,f.current)).options.length,4);
  api.invalidateOptionDetails();globalThis.fetch=async()=>new Response(JSON.stringify(f.currentPack));
  assert.equal((await api.loadOptionDetails(f.ref,f.current)).options.length,4);assert.equal(puts,2,'a rejected put cannot block later writes');
 }finally{globalThis.fetch=savedFetch;if(savedCaches===undefined)delete globalThis.caches;else globalThis.caches=savedCaches;}
});

test('option UI opens every explanation, offers exact-word cards and speaks without unsafe text interpolation',async()=>{
 const ref={id:'v-available',mode:'vocab',format:'cloze'},d=await loadOptionDetails(ref,question(ref),{vocab:bank.vocab});
 const html=renderOptionDetails(d);assert.equal((html.match(/<details open/g)||[]).length,4);assert(html.includes('data-act="option-word"'));assert(html.includes('data-act="option-en"'));assert(html.includes('data-act="option-ja"'));
 const malicious=structuredClone(d);malicious.options[0].text='<img src=x onerror=alert(1)>';assert(!renderOptionDetails(malicious).includes('<img'));
 const canonical=d.options.find(x=>x.correct).lexemes[0];const saved=renderOptionDetails(d,{personalVocab:{items:[{key:canonical.wordId}]}});assert(saved.includes('已收藏'));
 const positionRef={id:'read-bench-01',mode:'reading'},positions=await loadOptionDetails(positionRef,question(positionRef));
 assert(positions.options.every(option=>option.kind==='position'));
 assert(!renderOptionDetails(positions).includes('data-act="option-en"'),'visual insertion markers must not offer a dead playback button');
 assert(!renderOptionDetails(positions).includes('data-act="option-ja"'));
});
