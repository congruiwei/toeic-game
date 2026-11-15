import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GLOSSARY_BANKS, loadGlossaryInputs, validateGlossary,
} from '../scripts/validate-glossary.mjs';

const actual = loadGlossaryInputs();
const dictionary = { ...actual.glossary, exceptions: [] };
function fixture(rows, glossary = dictionary) {
  const unitsByBank = Object.fromEntries(GLOSSARY_BANKS.map(bank => [bank, []]));
  const packs = Object.fromEntries(['zh', 'ja'].map(lang => [lang,
    Object.fromEntries(GLOSSARY_BANKS.map(bank => [bank, { version: 1, entries: {} }]))]));
  for (const { bank = 'reading', key, text, zh, ja, kind = 'sentence', columns } of rows) {
    unitsByBank[bank].push({ bank, key, text, kind, ...(columns ? { columns } : {}) });
    packs.zh[bank].entries[key] = zh;
    packs.ja[bank].entries[key] = ja;
  }
  return { unitsByBank, packs, glossary };
}
const run = ({ unitsByBank, packs, glossary }) => validateGlossary(unitsByBank, packs, glossary);
const missing = result => result.errors.filter(error => error.code === 'term-missing');

test('the full seven banks and both languages pass with exactly two reviewed omissions', () => {
  const result = run(actual);
  assert.deepEqual(result.errors, []);
  const count = GLOSSARY_BANKS.reduce((n, bank) => n + actual.unitsByBank[bank].length, 0);
  assert.deepEqual(result.stats.units, { zh: count, ja: count });
  assert.equal(result.stats.rules, 49);
  assert(result.stats.hits.zh > 600 && result.stats.hits.ja > 600);
  assert.equal(result.stats.exceptions, 2);
});

test('invoice and receipt mistranslations identify the exact unit and language', () => {
  const result = run(fixture([
    { bank: 'vocab', key: 'v-invoice/meaning', text: 'invoice', zh: '收据', ja: '請求書' },
    { bank: 'vocab', key: 'v-receipt/meaning', text: 'receipt', zh: '发票', ja: '請求書' },
  ]));
  assert.deepEqual(missing(result).map(({ lang, key, term }) => [lang, key, term]), [
    ['zh', 'v-invoice/meaning', 'invoice'],
    ['zh', 'v-receipt/meaning', 'receipt'],
    ['ja', 'v-receipt/meaning', 'receipt'],
  ]);
});

test('English inflections and Japanese verb stems are accepted without matching partial English words', () => {
  const result = run(fixture([
    { key: 'inflection/documents/0/text/0', text: 'We reimbursed expenses and postponed the review of itineraries and warranties.',
      zh: '我们报销了费用，并推迟审核行程与保修。', ja: '経費を精算し、旅程と保証の確認を延期しました。' },
    { key: 'boundary/documents/0/text/0', text: 'The preinvoice and receiptless files were saved.',
      zh: '相关文件已保存。', ja: '関連ファイルを保存しました。' },
  ]));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.stats.hits, { zh: 5, ja: 5 });
});

test('table cells cannot borrow the correct translation from the next column', () => {
  const result = run(fixture([{ key: 'table/documents/0/table/headers', kind: 'table', columns: 2,
    text: 'Invoice | Receipt', zh: '收据 | 发票', ja: '請求書 | 領収書' }]));
  assert.deepEqual(missing(result).map(({ lang, term, column }) => [lang, term, column]), [
    ['zh', 'invoice', 1], ['zh', 'receipt', 2],
  ]);
  const broken = run(fixture([{ key: 'table/documents/0/table/headers', kind: 'table', columns: 2,
    text: 'Invoice | Receipt', zh: '发票', ja: '請求書 | 領収書' }]));
  assert(broken.errors.some(error => error.code === 'table-columns' && error.lang === 'zh'));
});

test('only a retained quoted expression in an explicit vocabulary question is exempt', () => {
  const rows = [
    { key: 'quote/prompt/0', text: 'In the message, “invoice” is closest in meaning to which option?',
      zh: '消息中的“invoice”最接近哪个意思？', ja: '「invoice」に最も近い意味はどれですか。' },
    { key: 'quote/prompt/1', text: 'What does "receipt" in the second line mean?',
      zh: '第二行的“receipt”是什么意思？', ja: '2行目の「receipt」は何を意味しますか。' },
  ];
  const result = run(fixture(rows));
  assert.deepEqual(result.errors, []);
  assert.equal(result.stats.references, 4);
  for (const key of ['quote/options/0/0', 'quote/turns/0/0', 'quote/example/0', 'quote/documents/0/table/headers']) {
    const wrongField = run(fixture([{ ...rows[0], key,
      ...(key.includes('/table/') ? { kind: 'table', columns: 1 } : {}) }]));
    assert.equal(missing(wrongField).length, 2, key);
  }
  const ordinaryQuote = run(fixture([{ key: 'quote/prompt/0', text: 'Why did she say “invoice” yesterday?',
    zh: '她昨天为什么说“invoice”？', ja: 'なぜ昨日「invoice」と言ったのですか。' }]));
  assert.equal(missing(ordinaryQuote).length, 2);
  const absentWord = run(fixture([{ ...rows[0], zh: '该词是什么意思？' }]));
  assert.equal(missing(absentWord).length, 1);
});

test('an English reference cannot exempt an unquoted repeat or another term in the question', () => {
  const result = run(fixture([
    { key: 'mixed/prompt/0', text: 'What does “invoice” mean in the invoice below?',
      zh: '下面文字中的“invoice”是什么意思？', ja: '下の請求書の「invoice」はどういう意味ですか。' },
    { key: 'mixed/prompt/1', text: 'What does “invoice” mean on the receipt?',
      zh: '“invoice”是什么意思？', ja: '領収書の「invoice」はどういう意味ですか。' },
  ]));
  assert.deepEqual(missing(result).map(({ lang, key, term }) => [lang, key, term]), [
    ['zh', 'mixed/prompt/0', 'invoice'], ['zh', 'mixed/prompt/1', 'receipt'],
  ]);
});

test('reviewed omissions are exact locks; changes to source, translation, location, language, or term invalidate them', () => {
  const exception = actual.glossary.exceptions[0];
  const sourceFixture = fixture([{ ...exception, text: exception.source,
    zh: actual.packs.zh.reading.entries[exception.key], ja: exception.translation }],
  { ...dictionary, exceptions: [exception] });
  assert.deepEqual(run(sourceFixture).errors, []);
  for (const field of ['source', 'translation', 'key', 'bank', 'lang', 'term']) {
    const input = structuredClone(sourceFixture);
    const item = input.glossary.exceptions[0];
    item[field] = ({ bank: 'vocab', lang: 'zh', term: 'invoice' })[field] ?? `${item[field]} changed`;
    assert(run(input).errors.some(error => error.code === 'exception-stale'), field);
  }
  for (const change of ['source', 'translation', 'deleted']) {
    const input = structuredClone(sourceFixture);
    if (change === 'source') input.unitsByBank.reading[0].text += ' Please check.';
    if (change === 'translation') input.packs.ja.reading.entries[exception.key] += 'ご確認ください。';
    if (change === 'deleted') input.unitsByBank.reading = [];
    assert(run(input).errors.some(error => error.code === 'exception-stale'), change);
  }
});

test('unneeded and duplicated exceptions fail instead of becoming a permanent bypass', () => {
  const exception = actual.glossary.exceptions[0];
  const input = fixture([{ ...exception, text: exception.source,
    zh: actual.packs.zh.reading.entries[exception.key], ja: exception.translation }],
  { ...dictionary, exceptions: [exception] });
  const redundant = structuredClone(input);
  redundant.glossary.terms.find(term => term.en === 'carton').ja.push(exception.translation);
  assert(run(redundant).errors.some(error => error.code === 'exception-unused'));
  const duplicate = structuredClone(input);
  duplicate.glossary.exceptions.push({ ...exception });
  assert(run(duplicate).errors.some(error => error.code === 'duplicate-exception'));
  const noReason = structuredClone(input);
  noReason.glossary.exceptions[0].reason = ' ';
  assert(run(noReason).errors.some(error => error.code === 'exception-format'));
});

test('invalid, duplicate, and empty rules are rejected before scanning', () => {
  const base = fixture([]);
  const cases = [
    [config => { config.version = 2; }, 'glossary-format'],
    [config => { config.terms = []; }, 'glossary-format'],
    [config => { config.terms.push({ ...config.terms[0] }); }, 'duplicate-term'],
    [config => { config.terms[0].pattern = '['; }, 'pattern-invalid'],
    [config => { config.terms[0].pattern = ''; }, 'pattern-format'],
    [config => { config.terms[0].pattern = '.*'; }, 'pattern-empty'],
    [config => { config.terms[0].pattern = '(?=invoice)'; }, 'pattern-empty'],
    [config => { config.terms[0].zh = ['']; }, 'tokens-format'],
    [config => { config.terms[0].ja = ['請求', '請求']; }, 'duplicate-token'],
    [config => { config.exceptions = {}; }, 'exceptions-format'],
  ];
  for (const [mutate, expected] of cases) {
    const input = structuredClone(base);
    mutate(input.glossary);
    assert(run(input).errors.some(error => error.code === expected), expected);
  }
});

test('a missing bank or language pack cannot silently shrink the scan', () => {
  const noBank = fixture([]);
  delete noBank.unitsByBank.methods;
  assert(run(noBank).errors.some(error => error.code === 'bank-missing' && error.bank === 'methods'));
  const noLanguage = fixture([]);
  delete noLanguage.packs.ja.reading;
  assert(run(noLanguage).errors.some(error => error.code === 'pack-format' && error.lang === 'ja'));
});
