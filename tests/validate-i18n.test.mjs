import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  TRANSLATION_BANKS, validateTranslationPacks, validateJapaneseMeanings,
  validateJapaneseTerms, loadI18nInputs, validateI18nInputs,
} from '../scripts/validate-i18n.mjs';

const live = loadI18nInputs();
const codes = errors => errors.map(error => error.code);
const pack = entries => ({ version: 1, entries });
function fixture() {
  return {
    unitsByBank: Object.fromEntries(TRANSLATION_BANKS.map(bank => [bank, []])),
    packs: Object.fromEntries(['zh', 'ja'].map(lang => [lang, Object.fromEntries(TRANSLATION_BANKS.map(bank => [bank, pack({})]))])),
  };
}
function add(f, bank, unit, zh, ja) {
  f.unitsByBank[bank].push(unit);
  f.packs.zh[bank].entries[unit.key] = zh;
  f.packs.ja[bank].entries[unit.key] = ja;
}

test('the complete committed data passes coverage, glossary, derived meanings, and 39 Japanese titles', () => {
  const result = validateI18nInputs(live);
  assert.deepEqual(result.errors, []);
  assert.equal(result.total, Object.values(live.unitsByBank).reduce((sum, units) => sum + units.length, 0));
  assert.equal(result.terminology.stats.units.zh, result.total);
  assert.equal(result.terminology.stats.units.ja, result.total);
  assert.equal(Object.keys(live.meanings.entries).length, live.sources.vocab.length);
  assert.equal(Object.keys(live.terms.entries).length, 39);
  assert(result.summaries.some(line => line.includes('17 grammar + 22 methods')));
});

test('missing, empty, and extra translation keys identify the affected bank, language, and key', () => {
  const f = fixture();
  add(f, 'part2', { key: 'p/audio/0', text: 'When does the workshop begin?' }, '工作坊何时开始？', 'ワークショップはいつ始まりますか。');
  delete f.packs.zh.part2.entries['p/audio/0'];
  f.packs.ja.part2.entries['p/audio/0'] = '  ';
  f.packs.ja.part2.entries['retired/audio/0'] = '旧訳';
  const result = validateTranslationPacks(f.unitsByBank, f.packs);
  assert.equal(result.errors.length, 3);
  assert.deepEqual(result.errors.filter(e => e.code === 'translation-missing').map(e => [e.bank, e.lang, e.key]), [
    ['part2', 'zh', 'p/audio/0'], ['part2', 'ja', 'p/audio/0'],
  ]);
  assert(result.errors.some(e => e.code === 'translation-extra' && e.key === 'retired/audio/0'));
});

test('malformed translation pack shapes fail without throwing', () => {
  for (const bad of [null, [], 'text', { version: 2, entries: {} }, pack(null), pack([]), pack('text')]) {
    const f = fixture();
    f.packs.ja.reading = bad;
    assert(codes(validateTranslationPacks(f.unitsByBank, f.packs).errors).includes('pack-format'));
  }
  const f = fixture();
  assert(codes(validateTranslationPacks(f.unitsByBank, f.packs, []).errors).includes('literals-format'));
});

test('only literal tokens or an exact current source allow an unchanged English translation', () => {
  const f = fixture();
  add(f, 'reading', { key: 'r/prompt/0', text: 'Garden Walks' }, 'Garden Walks', 'Garden Walks');
  add(f, 'reading', { key: 'r/options/0/0', text: '9:30 AM' }, '9:30 AM', '9:30 AM');
  add(f, 'reading', { key: 'r/options/1/0', text: '[2]' }, '[2]', '[2]');
  assert.equal(validateTranslationPacks(f.unitsByBank, f.packs).errors.length, 2);
  const allowed = { 'r/prompt/0': { source: 'Garden Walks', reason: 'Publication title.' } };
  assert.deepEqual(validateTranslationPacks(f.unitsByBank, f.packs, allowed).errors, []);
  allowed['r/prompt/0'].source = 'Garden Walks, second edition';
  assert.equal(validateTranslationPacks(f.unitsByBank, f.packs, allowed).errors.filter(e => e.code === 'translation-unchanged').length, 2);
});

test('one source sentence cannot be translated into two complete sentences', () => {
  const f = fixture();
  add(f, 'part2', { key: 'p/audio/0', text: 'Please confirm the delivery time.', kind: 'sentence' },
    '请确认送货时间。我们明天需要货物。', '配達時刻をご確認ください。明日までに必要です。');
  const result = validateTranslationPacks(f.unitsByBank, f.packs);
  assert.deepEqual(codes(result.errors), ['translation-sentence-count', 'translation-sentence-count']);
  assert.deepEqual(result.errors.map(e => [e.bank, e.lang, e.key]), [
    ['part2', 'zh', 'p/audio/0'], ['part2', 'ja', 'p/audio/0'],
  ]);
});

test('a second translated sentence is rejected even without its final punctuation', () => {
  const f = fixture();
  add(f, 'part2', { key: 'p/audio/0', text: 'Please confirm the delivery time.', kind: 'sentence' },
    '请确认送货时间。我们明天需要货物', '配達時刻をご確認ください。明日までに必要です');
  assert.deepEqual(codes(validateTranslationPacks(f.unitsByBank, f.packs).errors),
    ['translation-sentence-count', 'translation-sentence-count']);
});

test('punctuation inside Japanese, Chinese, or ASCII quotation marks does not split the outer sentence', () => {
  for (const [open, close] of [['「','」'], ['『','』'], ['“','”'], ['"','"']]) {
    const f = fixture();
    add(f, 'listening', { key: 'l/turns/0/0', text: 'The manager asked about delivery.', kind: 'sentence' },
      `经理问${open}货物到了吗？今天能发货吗？${close}。`,
      `部長は${open}荷物は着きましたか？今日発送できますか？${close}と尋ねました。`);
    assert.deepEqual(validateTranslationPacks(f.unitsByBank, f.packs).errors, [], open + close);
  }
});

test('a group of consecutive sentence-ending punctuation represents just one boundary', () => {
  const f = fixture();
  add(f, 'part2', { key: 'p/audio/0', text: 'Has the work already been finished?', kind: 'sentence' },
    '工作已经完成了？！', '作業はもう終わったのですか!?');
  assert.deepEqual(validateTranslationPacks(f.unitsByBank, f.packs).errors, []);
});

test('fragment options without sentence punctuation remain valid', () => {
  const f = fixture();
  add(f, 'reading', { key: 'r/options/0/0', text: 'The next train', kind: 'sentence' }, '下一班列车', '次の電車');
  add(f, 'reading', { key: 'r/options/1/0', text: '9:30 AM', kind: 'sentence' }, '9:30 AM', '9:30 AM');
  assert.deepEqual(validateTranslationPacks(f.unitsByBank, f.packs).errors, []);
});

test('only an exact retained signature in an explicit source sign-off is excluded from sentence counting', () => {
  const f = fixture(), key = 'r/documents/0/text/0';
  add(f, 'reading', { key, text: 'Best,\nIrene', kind: 'sentence' }, '祝好，Irene', 'よろしくお願いします。Irene');
  assert.deepEqual(validateTranslationPacks(f.unitsByBank, f.packs).errors, []);
  for (const translation of ['よろしくお願いします。明日ご連絡します。Irene', 'よろしくお願いします。Nora', 'よろしくお願いします。NoraIrene']) {
    f.packs.ja.reading.entries[key] = translation;
    assert.deepEqual(codes(validateTranslationPacks(f.unitsByBank, f.packs).errors), ['translation-sentence-count']);
  }
  f.packs.ja.reading.entries[key] = 'よろしくお願いします。Irene';
  f.unitsByBank.reading[0].text = 'Please contact Irene.';
  assert.deepEqual(codes(validateTranslationPacks(f.unitsByBank, f.packs).errors), ['translation-sentence-count'],
    'a trailing name is not exempt unless the source itself is an explicit sign-off');
});

test('table alignment and duplicate source units remain enforced', () => {
  const f = fixture();
  const row = { key: 'r/table/rows/0', text: 'Invoice | Due date', kind: 'table', columns: 2 };
  add(f, 'reading', row, '发票 | 截止日期', '請求書 | 締め切り');
  assert.deepEqual(validateTranslationPacks(f.unitsByBank, f.packs).errors, []);
  f.packs.ja.reading.entries[row.key] = '請求書、締め切り';
  assert(codes(validateTranslationPacks(f.unitsByBank, f.packs).errors).includes('table-columns'));
  f.unitsByBank.reading.push({ ...row });
  assert(codes(validateTranslationPacks(f.unitsByBank, f.packs).errors).includes('duplicate-unit'));
});

test('Chinese meaning translations preserve the source card definition exactly', () => {
  const f = fixture();
  add(f, 'vocab', { key: 'v-charge/meaning', text: 'charge', kind: 'meaning', zh: '收取费用' }, '收取费用', '料金を請求する');
  assert.deepEqual(validateTranslationPacks(f.unitsByBank, f.packs).errors, []);
  f.packs.zh.vocab.entries['v-charge/meaning'] = '充电';
  assert(codes(validateTranslationPacks(f.unitsByBank, f.packs).errors).includes('meaning-zh-mismatch'));
});

test('the small Japanese pack uses every sense ID, matches exact full-pack strings, and contains no examples', () => {
  const vocab = [{ id: 'v-charge' }, { id: 'v-charge-power' }];
  const full = pack({ 'v-charge/meaning': '料金を請求する', 'v-charge-power/meaning': '充電する', 'v-charge/example/0': '料金は翌月に請求されます。' });
  const small = pack({ 'v-charge-power/meaning': '充電する', 'v-charge/meaning': '料金を請求する' });
  assert.deepEqual(validateJapaneseMeanings(vocab, full, small), [], 'JSON key order is immaterial');
  small.entries['v-charge/meaning'] += ' ';
  delete small.entries['v-charge-power/meaning'];
  small.entries['v-charge/example/0'] = full.entries['v-charge/example/0'];
  small.entries['retired/meaning'] = '旧訳';
  const result = validateJapaneseMeanings(vocab, full, small);
  assert.deepEqual(codes(result), ['meaning-derived-mismatch', 'meaning-derived-missing', 'meaning-derived-extra', 'meaning-derived-extra']);
  assert(result.every(e => e.lang === 'ja' && e.bank === 'vocab-meanings'));
});

test('a broken full pack, duplicate word ID, or malformed derived pack cannot pass by matching each other', () => {
  const vocab = [{ id: 'v-test' }];
  const empty = pack({ 'v-test/meaning': '' });
  assert.deepEqual(codes(validateJapaneseMeanings(vocab, empty, empty)), ['meaning-full-missing', 'meaning-derived-missing']);
  const valid = pack({ 'v-test/meaning': '試験' });
  assert(codes(validateJapaneseMeanings([...vocab, ...vocab], valid, valid)).includes('meaning-source-duplicate'));
  for (const bad of [null, [], pack([]), { version: 2, entries: valid.entries }]) {
    assert(codes(validateJapaneseMeanings(vocab, valid, bad)).includes('meaning-pack-format'));
  }
});

test('Japanese titles reject omissions, extras, whitespace, empty strings, and English-only values', () => {
  const terms = structuredClone(live.terms);
  delete terms.entries['gram-time'];
  terms.entries['gram-conditional'] = '  ';
  terms.entries.photo = 'Photo descriptions';
  terms.entries['photo-state'] = ' 状態の描写 ';
  terms.entries.retired = '古い項目';
  const result = validateJapaneseTerms(live.sources.grammar, live.sources.methods, terms);
  assert.deepEqual(codes(result).sort(), ['term-missing', 'term-missing', 'term-not-japanese', 'term-whitespace', 'term-extra'].sort());
  assert(result.every(e => e.lang === 'ja' && e.bank === 'terms'));
  assert.deepEqual(validateJapaneseTerms(live.sources.grammar, live.sources.methods, live.terms), [], 'kanji-only Japanese titles are valid');
});

test('title coverage depends on the source IDs as well as the required 17/22 counts', () => {
  const grammar = structuredClone(live.sources.grammar), methods = structuredClone(live.sources.methods);
  grammar[0].id = 'gram-replaced';
  const result = validateJapaneseTerms(grammar, methods, live.terms);
  assert(result.some(e => e.code === 'term-missing' && e.key === 'gram-replaced'));
  assert(result.some(e => e.code === 'term-extra' && e.key === 'gram-time'));
  assert(codes(validateJapaneseTerms(grammar.slice(1), methods.slice(1), live.terms)).includes('terms-grammar-count'));
  assert(codes(validateJapaneseTerms(grammar.slice(1), methods.slice(1), live.terms)).includes('terms-method-count'));
  grammar[0].id = grammar[1].id;
  assert(codes(validateJapaneseTerms(grammar, methods, live.terms)).includes('terms-source-duplicate'));
  assert(codes(validateJapaneseTerms(grammar, methods, pack([]))).includes('terms-pack-format'));
});

test('the integrated validator reports glossary failures even when a separate derived pack is stale', () => {
  const inputs = structuredClone(live);
  const key = Object.keys(inputs.meanings.entries)[0];
  inputs.meanings.entries[key] += '変更';
  inputs.glossary.version = 2;
  const result = validateI18nInputs(inputs);
  assert(codes(result.errors).includes('meaning-derived-mismatch'));
  assert(result.errors.some(e => e.check === 'glossary' && e.code === 'glossary-format'));
  assert(!result.summaries.some(line => line.includes('validation passed')));
});

test('the file loader identifies malformed JSON and missing paths rather than silently omitting checks', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'isle-i18n-validation-'));
  try {
    fs.writeFileSync(path.join(directory, 'vocab.json'), '{"broken":');
    const inputs = loadI18nInputs(pathToFileURL(directory + path.sep));
    const result = validateI18nInputs(inputs);
    assert(result.errors.some(e => e.code === 'file-read' && e.path === 'vocab.json'));
    assert(result.errors.some(e => e.code === 'file-read' && e.path === 'i18n/ja/vocab-meanings.json'));
    assert(result.errors.some(e => e.code === 'file-read' && e.path === 'i18n/ja/terms.json'));
    assert(codes(result.errors).includes('source-units'));
    assert(codes(result.errors).includes('bank-missing'));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
