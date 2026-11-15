import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { bank, loadBank, question, vocabularyOptions, formats, vocabularyFormats, select } from '../js/bank.js';
import { fresh } from '../js/state.js';
import { ensureVocabLanguage, ensureVocabMeanings, japaneseMeaning, conflictingJapaneseMeanings,
  vocabularyFormatAt, selectVocabularyFormat, semanticSlotsBefore } from '../js/vocabulary-language.js';

const root = new URL('../', import.meta.url);
const words = JSON.parse(await fs.readFile(new URL('data/vocab.json', root), 'utf8'));
const small = JSON.parse(await fs.readFile(new URL('data/i18n/ja/vocab-meanings.json', root), 'utf8'));
const full = JSON.parse(await fs.readFile(new URL('data/i18n/ja/vocab.json', root), 'utf8'));
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async url => {
  calls.push(String(url));
  if (url === './data/vocab.json') return Response.json(words);
  if (url === './data/i18n/ja/vocab-meanings.json') return Response.json(small);
  throw Error(`Unexpected fetch: ${url}`);
};
test.after(() => {globalThis.fetch = realFetch;});
const meaning = id => small.entries[`${id}/meaning`];
const word = id => words.find(w => w.id === id);
const normalize = text => text.normalize('NFKC').toLowerCase().replace(/\s+/gu, '');

await loadBank(['vocab']);

test('Chinese questions need no translation; Japanese synchronous questions fail clearly until loaded', async () => {
  assert.deepEqual(formats, ['meaning','english','sound','cloze','match']);
  assert.deepEqual(vocabularyFormats, [...formats,'meaning-ja','english-ja']);
  const oldRef = {id:words[0].id, mode:'vocab', format:'meaning'};
  const before = question(oldRef);
  assert.equal(before.answer,words[0].zh);
  await ensureVocabLanguage(oldRef);
  assert.deepEqual(calls,['./data/vocab.json']);
  assert.throws(() => question({...oldRef,format:'meaning-ja'}), {code:'VOCAB_JA_NOT_READY'});
  assert.throws(() => question({...oldRef,format:'english-ja'}), {code:'VOCAB_JA_NOT_READY'});
  await Promise.all([
    ensureVocabLanguage({...oldRef,format:'meaning-ja'}),
    ensureVocabLanguage({...oldRef,format:'english-ja'}),
    ensureVocabMeanings(),
  ]);
  assert.deepEqual(calls,['./data/vocab.json','./data/i18n/ja/vocab-meanings.json']);
  assert.deepEqual(question(oldRef),before);
  assert.equal(japaneseMeaning(words[0].id),meaning(words[0].id));
  assert.throws(() => japaneseMeaning('missing-id'), {code:'VOCAB_JA_NOT_READY'});
});

test('derived pack contains only all canonical meanings and matches the full translation exactly', () => {
  assert.equal(small.version,1);
  assert.deepEqual(Object.keys(small.entries), words.map(w=>`${w.id}/meaning`));
  for (const [key,value] of Object.entries(small.entries)) {
    assert.equal(value,full.entries[key],key);
    assert.ok(value.trim());
    assert.ok(!key.includes('/example/'));
  }
});

test('fifteen default slots alternate semantic language and cover both directions without moving the other three formats', () => {
  const expected = ['meaning','english-ja','sound','cloze','match',
    'english','meaning-ja','sound','cloze','match',
    'meaning','english-ja','sound','cloze','match'];
  assert.deepEqual(Array.from({length:15},(_,n)=>vocabularyFormatAt(formats,n)),expected);
  assert.deepEqual(Array.from({length:10},(_,n)=>vocabularyFormatAt(formats,n,'zh')),[...formats,...formats]);
  assert.deepEqual(Array.from({length:10},(_,n)=>vocabularyFormatAt(formats,n,'ja')),
    ['meaning-ja','english-ja','sound','cloze','match','meaning-ja','english-ja','sound','cloze','match']);
  assert.equal(semanticSlotsBefore(0),0);assert.equal(semanticSlotsBefore(4),2);assert.equal(semanticSlotsBefore(6),3);
  for(const f of ['sound','cloze','match'])assert.equal(selectVocabularyFormat(f,'ja',1),f);
  const state=fresh();state.settings.vocabLanguage='both';
  assert.deepEqual(select(state,'vocab',15).map(r=>r.format),expected);
  state.words[words[0].id]={tries:5};
  assert.deepEqual(select(state,'vocab',5).map(r=>r.format),expected.slice(5,10));
  state.settings.vocabLanguage='ja';
  const saved={id:words[0].id,mode:'vocab',format:'meaning'};
  assert.equal(question(saved).answer,words[0].zh);
  assert.equal(saved.format,'meaning');
});

test('real Japanese aliases and the hidden first sense of a spelling cannot become a second valid answer', () => {
  assert.equal(conflictingJapaneseMeanings('知らせる','通知する'),true);
  assert.equal(conflictingJapaneseMeanings('仮の；未確定の','仮の；暫定的な'),true);
  assert.equal(conflictingJapaneseMeanings('正式に提出する','提出する'),true);
  assert.equal(conflictingJapaneseMeanings('請求書','領収書'),false);
  const plain = (id,spelling) => ({...word(id),word:spelling,zh:`unique-${id}`,paraphrase:`distinct-${id}`,avoidWith:[],confusables:[]});
  const target={...plain('v-notify','notify'),confusables:['dual','unknown-outside-bank']};
  const others=[plain('v-inform','dual'),plain('v-book-volume','dual'),plain('v-deadline','deadline'),
    plain('v-invoice','invoice'),plain('v-return-yield','yield')];
  const result=vocabularyOptions(target,'english-ja',[target,...others]);
  assert.equal(result.length,4);
  assert.ok(!result.includes('dual'),'the first sense of dual means notify, though the final record does not');
  assert.ok(!result.includes('unknown-outside-bank'),'external confusable lacks a vetted Japanese meaning');
  assert.equal(result.filter(t=>t==='notify').length,1);
  const sameHead=plain('v-account-report','notify');
  const options=vocabularyOptions(target,'meaning-ja',[target,sameHead,...others]);
  assert.ok(!options.includes(meaning('v-account-report')),'other sense of the same headword is never a distractor');
});

test('all 2174 Japanese questions have unique stable answers, safe distractors, and balanced lengths and positions', t => {
  const formats = ['meaning-ja','english-ja'];
  const distributions = Object.fromEntries(formats.map(format => [format, {
    total:0, longest:0, varied:0, shortestOnly:0, positions:[0,0,0,0],
  }]));
  // Match scripts/validate.mjs: Unicode characters after NFKC and space normalization.
  const optionLength = text => [...text.normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase()].length;
  for (const w of words) for (const format of formats) {
    const ref={id:w.id,mode:'vocab',format},q=question(ref),answer=format==='meaning-ja'?meaning(w.id):w.word;
    assert.equal(q.answer,answer,w.id);
    assert.equal(q.prompt,format==='meaning-ja'?w.word:meaning(w.id));
    assert.equal(q.options.length,4,w.id+format);
    assert.equal(new Set(q.options.map(normalize)).size,4,w.id+format);
    assert.equal(q.options.filter(o=>o===answer).length,1,w.id+format);
    assert.deepEqual(q.options,question(JSON.parse(JSON.stringify(ref))).options,'saved reference retains options');
    const r=distributions[format],at=q.options.indexOf(answer),lengths=q.options.map(optionLength);
    const length=lengths[at],lo=Math.min(...lengths),hi=Math.max(...lengths);
    r.total++;r.positions[at]++;
    if(length===hi)r.longest++;
    if(lo!==hi){
      r.varied++;
      if(length===lo && lengths.filter(n=>n===lo).length===1)r.shortestOnly++;
    }
    for(const opt of q.options.filter(o=>o!==answer)) {
      if(format==='meaning-ja')assert.equal(conflictingJapaneseMeanings(answer,opt),false,w.id+' '+opt);
      else {
        const candidates=words.filter(other=>normalize(other.word)===normalize(opt));
        assert.ok(candidates.length,'Japanese spelling options come from known cards');
        for(const other of candidates) {
          assert.notEqual(normalize(other.word),normalize(w.word));
          assert.equal(conflictingJapaneseMeanings(meaning(w.id),meaning(other.id)),false,w.id+' '+opt);
        }
      }
    }
    if(w.sense && format==='meaning-ja')assert.equal(q.context,w.example);
  }
  for(const [format,r] of Object.entries(distributions)){
    const summary=`${format}: longest ${r.longest}/${r.total}, unique shortest ${r.shortestOnly}/${r.varied}, A/B/C/D ${r.positions.join('/')}`;
    assert.equal(r.total,words.length,summary);
    assert.ok(r.longest<=.4*r.total,summary+'; longest including ties must be <=40%');
    assert.ok(r.shortestOnly<=.35*r.varied,summary+'; unique shortest must be <=35%, excluding all-equal rows');
    const expected=r.total/4;
    const chi=r.positions.reduce((sum,n)=>sum+(n-expected)**2/expected,0);
    // These are the main validator's four-option position warning thresholds.
    assert.ok(r.positions.every(n=>Math.abs(n-expected)/r.total<=.12),summary+'; position deviation exceeds 12 percentage points');
    assert.ok(chi<=11.35,summary+`; position chi-square ${chi.toFixed(3)} exceeds 11.35`);
    t.diagnostic(summary+`; position chi-square ${chi.toFixed(3)}`);
  }
  assert.ok(!calls.some(url=>url.endsWith('/ja/vocab.json')),'large example pack is never requested');
});

test('the original 5435 option lists retain their exact pre-change deterministic ordering', () => {
  const bytes=JSON.stringify(words.flatMap(w=>formats.map(f=>vocabularyOptions(w,f,words))));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'0b0384276a46ae50c215c445d5c79f3a7846278c26118d3388b1251886c88ff4');
});

test('offline without a downloaded meaning pack rejects instead of falling back to Chinese', () => {
  const source=`globalThis.fetch=async()=>{throw Error('offline')};
    const m=await import('./js/vocabulary-language.js');
    try{await m.ensureVocabLanguage({mode:'vocab',id:'v-available',format:'meaning-ja'});process.exit(2)}
    catch(e){if(!e.message.includes('联网'))throw e}
    try{m.japaneseMeaning('v-available');process.exit(3)}
    catch(e){if(e.code!=='VOCAB_JA_NOT_READY')throw e}`;
  execFileSync(process.execPath,['--input-type=module','-e',source],{cwd:root,stdio:'pipe'});
});

test('offline meaning cache survives a new runtime and a failed download can be retried', () => {
  const cached=`globalThis.fetch=async url=>{if(url!=='./data/i18n/ja/vocab-meanings.json')process.exit(4);throw Error('offline')};
    globalThis.caches={open:async()=>({match:async()=>Response.json({version:1,entries:{'v-available/meaning':'利用できる'}})})};
    const m=await import('./js/vocabulary-language.js');
    await m.ensureVocabLanguage({mode:'vocab',id:'v-available',format:'meaning-ja'});
    if(m.japaneseMeaning('v-available')!=='利用できる')process.exit(5)`;
  execFileSync(process.execPath,['--input-type=module','-e',cached],{cwd:root,stdio:'pipe'});
  const retry=`let online=false,requests=0;
    globalThis.fetch=async url=>{requests++;if(!online)throw Error('offline');
      return Response.json({version:1,entries:{'v-available/meaning':'利用できる'}})};
    const m=await import('./js/vocabulary-language.js');
    try{await m.ensureVocabMeanings();process.exit(6)}catch(e){if(!e.message.includes('联网'))throw e}
    online=true;await m.ensureVocabMeanings();
    if(requests!==2||m.japaneseMeaning('v-available')!=='利用できる')process.exit(7)`;
  execFileSync(process.execPath,['--input-type=module','-e',retry],{cwd:root,stdio:'pipe'});
});
