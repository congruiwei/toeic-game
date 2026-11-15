import fs from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sourceUnits } from '../js/translation-source.js';
import { GLOSSARY_BANKS, validateGlossary, glossarySummary } from './validate-glossary.mjs';

export const TRANSLATION_BANKS = GLOSSARY_BANKS;
const languages = ['zh', 'ja'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const validPack = pack => object(pack) && pack.version === 1 && object(pack.entries);
// Numbers, clock times, insertion positions and identifiers have no translatable words.
const literal = text => !/[A-Za-z]{2}/.test(text.replace(/\b(?:mm|cm|kg|km|AM|PM)\b/g, ''));
// Quoted speech may contain its own sentences; only the surrounding unit counts.
// Grouped punctuation (？！) is one boundary, and a final unpunctuated clause counts.
function translatedSentenceCount(text, source) {
  let prose = text.trim();
  // A source explicitly consisting of a closing + newline + name is a sign-off,
  // not an extra sentence. Only its exact retained trailing name is excluded.
  const signature = source.match(/^(?:Best(?: regards)?|Kind regards|Regards|Sincerely|Thanks|Thank you),[ \t]*\n[ \t]*([A-Z][\p{L} .'-]{0,79})$/u)?.[1].trim();
  if (signature && prose.endsWith(signature)) {
    const prefix = prose.slice(0, -signature.length);
    if (!prefix || /[\s\p{P}]$/u.test(prefix)) prose = prefix;
  }
  return prose.replace(/「[^」]*」|『[^』]*』|“[^”]*”|"(?:\\.|[^"\\])*"/gu, '')
    .split(/[。！？!?]+/u).filter(part => part.trim()).length;
}

/** Pure coverage/alignment checks; never rewrites source or translation data. */
export function validateTranslationPacks(unitsByBank, packs, literals = {}) {
  const errors = [], summaries = [];
  let total = 0;
  const fail = (code, message, details = {}) => errors.push({ code, message, ...details });
  if (!object(literals)) fail('literals-format', '原样保留清单须为对象');
  for (const bank of TRANSLATION_BANKS) {
    const units = unitsByBank?.[bank];
    if (!Array.isArray(units)) { fail('bank-missing', '缺少源翻译单位数组', { bank }); continue; }
    total += units.length;
    const expected = new Set();
    for (const unit of units) {
      if (!object(unit) || !nonempty(unit.key) || !nonempty(unit.text)) {
        fail('unit-format', '源单位须包含非空 key/text', { bank }); continue;
      }
      if (expected.has(unit.key)) fail('duplicate-unit', '源翻译键重复', { bank, key: unit.key });
      expected.add(unit.key);
    }
    for (const lang of languages) {
      const pack = packs?.[lang]?.[bank];
      if (!validPack(pack)) { fail('pack-format', '须为版本 1，entries 须为对象', { bank, lang }); continue; }
      for (const key of Object.keys(pack.entries)) {
        if (!expected.has(key)) fail('translation-extra', '多余的翻译键', { bank, lang, key });
      }
      for (const unit of units) {
        if (!object(unit) || !nonempty(unit.key) || !nonempty(unit.text)) continue;
        const text = Object.hasOwn(pack.entries, unit.key) ? pack.entries[unit.key] : undefined;
        const details = { bank, lang, key: unit.key };
        if (!nonempty(text)) { fail('translation-missing', '缺少非空译文', details); continue; }
        if (text.trim() === unit.text.trim() && !literal(unit.text) && literals?.[unit.key]?.source !== unit.text) {
          fail('translation-unchanged', '译文与英文相同，且没有绑定当前源文的原样保留记录', details);
        }
        if (unit.kind === 'table' && text.split(' | ').length !== unit.columns) {
          fail('table-columns', '表格列数不一致', details);
        }
        if (unit.kind === 'sentence' && translatedSentenceCount(text, unit.text) > 1) {
          fail('translation-sentence-count', '一个源句的译文不能拆成多个句子（引语内部标点不计）', details);
        }
        if (bank === 'vocab' && lang === 'zh' && unit.kind === 'meaning' && text !== unit.zh) {
          fail('meaning-zh-mismatch', '中文词义须与原词卡释义一致', details);
        }
      }
      summaries.push(`i18n ${lang}/${bank}: ${Object.keys(pack.entries).length}/${units.length} units`);
    }
  }
  return { errors, total, summaries };
}

/** The small pack is exactly the meaning projection, never an alternative translation. */
export function validateJapaneseMeanings(vocab, full, small) {
  const errors = [];
  const fail = (code, message, key) => errors.push({ code, message, bank: 'vocab-meanings', lang: 'ja', ...(key ? { key } : {}) });
  if (!Array.isArray(vocab)) fail('meaning-source', '词义派生源须为词卡数组');
  if (!validPack(full)) fail('meaning-full-format', '完整日文词汇译包格式错误');
  if (!validPack(small)) fail('meaning-pack-format', '词义小包须为版本 1，entries 须为对象');
  if (errors.length) return errors;
  const expected = new Set();
  for (const word of vocab) {
    if (!nonempty(word?.id)) { fail('meaning-source-id', '源词卡缺少 ID'); continue; }
    const key = `${word.id}/meaning`;
    if (expected.has(key)) fail('meaning-source-duplicate', '源词卡 ID 重复', key);
    expected.add(key);
    const source = Object.hasOwn(full.entries, key) ? full.entries[key] : undefined;
    const derived = Object.hasOwn(small.entries, key) ? small.entries[key] : undefined;
    if (!nonempty(source)) fail('meaning-full-missing', '完整译包缺少日文词义', key);
    if (!nonempty(derived)) fail('meaning-derived-missing', '词义小包缺少非空词义', key);
    else if (derived !== source) fail('meaning-derived-mismatch', '词义小包与完整日文词汇译包不一致，请运行 node scripts/build-vocab-meanings.mjs', key);
  }
  for (const key of Object.keys(small.entries)) {
    if (!expected.has(key)) fail('meaning-derived-extra', '词义小包含多余键或例句', key);
  }
  return errors;
}

/** Japanese script detection allows ordinary kanji-only terms such as 受動態. */
export function validateJapaneseTerms(grammar, methods, pack) {
  const errors = [];
  const fail = (code, message, key) => errors.push({ code, message, bank: 'terms', lang: 'ja', ...(key ? { key } : {}) });
  if (!Array.isArray(grammar) || grammar.length !== 17) fail('terms-grammar-count', '日语标题源应包含全部 17 个语法主题');
  if (!Array.isArray(methods) || methods.length !== 22) fail('terms-method-count', '日语标题源应包含全部 22 张方法卡');
  if (!validPack(pack)) fail('terms-pack-format', '日语标题包须为版本 1，entries 须为对象');
  if (!Array.isArray(grammar) || !Array.isArray(methods) || !validPack(pack)) return errors;
  const expected = new Set();
  for (const item of [...grammar, ...methods]) {
    if (!nonempty(item?.id)) { fail('terms-source-id', '标题源缺少 ID'); continue; }
    if (expected.has(item.id)) fail('terms-source-duplicate', '标题源 ID 重复', item.id);
    expected.add(item.id);
    const text = Object.hasOwn(pack.entries, item.id) ? pack.entries[item.id] : undefined;
    if (!nonempty(text)) { fail('term-missing', '缺少非空日语标题', item.id); continue; }
    if (text !== text.trim()) fail('term-whitespace', '日语标题不能带首尾空白', item.id);
    if (!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) fail('term-not-japanese', '标题须包含日文字符', item.id);
  }
  for (const key of Object.keys(pack.entries)) {
    if (!expected.has(key)) fail('term-extra', '日语标题含多余键', key);
  }
  return errors;
}

export function loadI18nInputs(dataDirectory = new URL('../data/', import.meta.url)) {
  const sources = {}, unitsByBank = {}, packs = { zh: {}, ja: {} }, errors = [];
  const read = path => {
    try { return JSON.parse(fs.readFileSync(new URL(path, dataDirectory), 'utf8')); }
    catch (error) { errors.push({ code: 'file-read', message: `文件缺失或不是有效 JSON：${error.message}`, path }); }
  };
  for (const bank of TRANSLATION_BANKS) {
    sources[bank] = read(`${bank}.json`);
    try { unitsByBank[bank] = sourceUnits(bank, sources[bank]); }
    catch (error) { errors.push({ code: 'source-units', message: `无法构造源翻译单位：${error.message}`, bank }); }
    for (const lang of languages) packs[lang][bank] = read(`i18n/${lang}/${bank}.json`);
  }
  return {
    sources, unitsByBank, packs, errors,
    literals: read('i18n/literals.json'), glossary: read('i18n/glossary.json'),
    meanings: read('i18n/ja/vocab-meanings.json'), terms: read('i18n/ja/terms.json'),
  };
}

export function validateI18nInputs(inputs) {
  const { sources, unitsByBank, packs, literals, glossary, meanings, terms } = inputs;
  const translations = validateTranslationPacks(unitsByBank, packs, literals);
  const terminology = validateGlossary(unitsByBank, packs, glossary);
  const errors = [
    ...(inputs.errors || []), ...translations.errors,
    ...validateJapaneseMeanings(sources?.vocab, packs?.ja?.vocab, meanings),
    ...validateJapaneseTerms(sources?.grammar, sources?.methods, terms),
    ...terminology.errors.map(error => ({ ...error, check: 'glossary' })),
  ];
  const summaries = [...translations.summaries, glossarySummary(terminology)];
  if (!errors.length) summaries.push(
    `Translation validation passed: ${translations.total} Chinese + ${translations.total} Japanese units; aligned keys and table columns.`,
    `Japanese derived meanings: ${sources.vocab.length} exact entries; Japanese titles: ${sources.grammar.length} grammar + ${sources.methods.length} methods.`,
  );
  return { errors, summaries, total: translations.total, terminology };
}

export function validateI18nFiles(dataDirectory) {
  return validateI18nInputs(loadI18nInputs(dataDirectory));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = validateI18nFiles();
  for (const summary of result.summaries) console.log(summary);
  for (const error of result.errors) console.error(JSON.stringify(error));
  if (result.errors.length) process.exitCode = 1;
}
