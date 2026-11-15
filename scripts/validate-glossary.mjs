import fs from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sourceUnits } from '../js/translation-source.js';

export const GLOSSARY_BANKS = ['vocab', 'part1', 'part2', 'listening', 'grammar', 'reading', 'methods'];
const languages = ['zh', 'ja'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const identity = value => JSON.stringify([value.bank, value.lang, value.key, value.term.toLowerCase()]);

function quotes(text) {
  const result = [];
  const pattern = /"([^"\n]+)"|“([^”\n]+)”|'([^'\n]+)'|‘([^’\n]+)’|「([^」\n]+)」|『([^』\n]+)』/gu;
  for (const match of text.matchAll(pattern)) {
    const content = match.slice(1).find(value => value !== undefined);
    result.push({ start: match.index, end: match.index + match[0].length, content });
  }
  return result;
}

// Only the quoted expression being asked about can remain English. Ordinary
// quotations, table cells, options, and other terms in the question still count.
function retainedReferences(unit, source, translation) {
  if (!unit.key.includes('/prompt/') || unit.kind === 'table') return [];
  const retained = quotes(translation).map(q => q.content.toLowerCase());
  return quotes(source).filter(q => {
    const before = source.slice(0, q.start).trim();
    const after = source.slice(q.end);
    const closest = /^\s*(?:(?:in|of|from|on)\b[^?.;!]*?\s*,?\s*)?(?:is|are)\s+closest\s+in\s+meaning\b/i.test(after);
    const meaning = /\bwhat\s+(?:does|do|did)\s*(?:(?:the\s+)?(?:word|term|phrase|expression)\s*)?$/i.test(before)
      && /^\s*(?:(?:in|of|from|on)\b[^?.;!]*?\s*)?(?:mean|refer\s+to)\b/i.test(after);
    const position = retained.indexOf(q.content.toLowerCase());
    if (!(closest || meaning) || position < 0) return false;
    retained.splice(position, 1);
    return true;
  });
}

/**
 * Pure validation, including empty banks: unitsByBank[bank] is sourceUnits(...),
 * packs[lang][bank] is {version:1, entries:{key:translation}}. No files are read.
 * Returns structured errors and counts; callers decide how to report failures.
 */
export function validateGlossary(unitsByBank, packs, glossary) {
  const errors = [];
  const stats = { rules: 0, units: { zh: 0, ja: 0 }, hits: { zh: 0, ja: 0 }, occurrences: { zh: 0, ja: 0 }, exceptions: 0, references: 0 };
  const fail = (code, message, details = {}) => errors.push({ code, message, ...details });
  if (!object(glossary) || glossary.version !== 1 || !Array.isArray(glossary.terms) || !glossary.terms.length) {
    fail('glossary-format', '词表须为版本 1，且 terms 为非空数组');
    return { errors, stats };
  }
  const rules = [], names = new Set(), patterns = new Set();
  for (const term of glossary.terms) {
    if (!object(term) || !nonempty(term.en) || term.en !== term.en.trim()) {
      fail('rule-format', '每条规则须有非空英文名称');
      continue;
    }
    const name = term.en.toLowerCase();
    if (names.has(name)) fail('duplicate-term', '英文术语重复', { term: term.en });
    names.add(name);
    for (const lang of languages) {
      const tokens = term[lang];
      if (!Array.isArray(tokens) || !tokens.length || tokens.some(t => !nonempty(t) || t !== t.trim())) {
        fail('tokens-format', '候选须为非空、无空白项的字符串数组', { term: term.en, lang });
      } else if (new Set(tokens).size !== tokens.length) {
        fail('duplicate-token', '候选词干重复', { term: term.en, lang });
      }
    }
    const pattern = term.pattern ?? `\\b${escape(term.en).replace(/\s+/g, '\\s+')}\\b`;
    if (!nonempty(pattern)) {
      fail('pattern-format', 'pattern 须为非空正则字符串', { term: term.en });
      continue;
    }
    if (patterns.has(pattern.toLowerCase())) fail('duplicate-pattern', '英文匹配正则重复', { term: term.en });
    patterns.add(pattern.toLowerCase());
    try {
      const regex = new RegExp(pattern, 'giu');
      const canonical = [...term.en.matchAll(regex)];
      if (new RegExp(pattern, 'iu').test('') || !canonical.length || canonical.some(m => !m[0].length)) {
        fail('pattern-empty', '正则须以非零长度匹配术语本身，且不能匹配空串', { term: term.en });
      }
      rules.push({ ...term, regex });
    } catch (error) {
      fail('pattern-invalid', `无效正则：${error.message}`, { term: term.en });
    }
  }
  stats.rules = rules.length;
  const exceptions = glossary.exceptions ?? [];
  const exceptionMap = new Map();
  if (!Array.isArray(exceptions)) fail('exceptions-format', 'exceptions 须为数组');
  else for (const item of exceptions) {
    if (!object(item) || !GLOSSARY_BANKS.includes(item.bank) || !languages.includes(item.lang)
      || ![item.key, item.term, item.source, item.translation, item.reason].every(nonempty)
      || !names.has(item.term.toLowerCase())) {
      fail('exception-format', '例外须绑定有效 bank/lang/key/term/source/translation/reason');
      continue;
    }
    const id = identity(item);
    if (exceptionMap.has(id)) fail('duplicate-exception', '同一术语例外重复', item);
    exceptionMap.set(id, item);
  }
  if (errors.length) return { errors, stats };

  const indexed = new Map();
  for (const bank of GLOSSARY_BANKS) {
    const units = unitsByBank?.[bank];
    if (!Array.isArray(units)) { fail('bank-missing', '缺少源题库数组', { bank }); continue; }
    const seen = new Set();
    for (const unit of units) {
      if (!object(unit) || !nonempty(unit.key) || !nonempty(unit.text)) {
        fail('unit-format', '源单位须包含非空 key/text', { bank }); continue;
      }
      if (seen.has(unit.key)) fail('duplicate-unit', '源键重复', { bank, key: unit.key });
      seen.add(unit.key);
      indexed.set(JSON.stringify([bank, unit.key]), unit);
    }
    for (const lang of languages) {
      const pack = packs?.[lang]?.[bank];
      if (!object(pack) || pack.version !== 1 || !object(pack.entries)) {
        fail('pack-format', '缺少版本 1 译文包或 entries 对象', { lang, bank });
      }
    }
  }
  if (errors.length) return { errors, stats };
  const validExceptions = new Map(), usedExceptions = new Set();
  for (const [id, item] of exceptionMap) {
    const unit = indexed.get(JSON.stringify([item.bank, item.key]));
    const text = packs[item.lang][item.bank].entries[item.key];
    const rule = rules.find(t => t.en.toLowerCase() === item.term.toLowerCase());
    if (!unit || unit.text !== item.source || text !== item.translation
      || ![...unit.text.matchAll(rule.regex)].length) {
      fail('exception-stale', '例外的源文、译文、键或术语已变化，必须重新审查', { bank: item.bank, lang: item.lang, key: item.key, term: item.term });
    } else validExceptions.set(id, item);
  }

  for (const bank of GLOSSARY_BANKS) for (const unit of unitsByBank[bank]) for (const lang of languages) {
    stats.units[lang]++;
    const translation = packs[lang][bank].entries[unit.key];
    if (!nonempty(translation)) { fail('translation-missing', '缺少译文', { bank, lang, key: unit.key }); continue; }
    const sources = unit.kind === 'table' ? unit.text.split(' | ') : [unit.text];
    const targets = unit.kind === 'table' ? translation.split(' | ') : [translation];
    if (sources.length !== targets.length || (unit.kind === 'table' && sources.length !== unit.columns)) {
      fail('table-columns', '表格源文与译文列数不一致', { bank, lang, key: unit.key });
    }
    for (let cell = 0; cell < sources.length; cell++) {
      const source = sources[cell], target = targets[cell] ?? '';
      const references = retainedReferences(unit, source, target);
      for (const rule of rules) {
        const matches = [...source.matchAll(rule.regex)];
        if (!matches.length) continue;
        const details = { bank, lang, key: unit.key, term: rule.en, ...(unit.kind === 'table' ? { column: cell + 1 } : {}) };
        if (matches.some(m => !m[0].length)) { fail('pattern-empty', '正则在源文产生零长度命中', details); continue; }
        stats.hits[lang]++;
        stats.occurrences[lang] += matches.length;
        if (rule[lang].some(token => target.includes(token))) continue;
        const remaining = matches.filter(m => !references.some(q => m.index > q.start && m.index + m[0].length < q.end));
        stats.references += matches.length - remaining.length;
        if (!remaining.length) continue;
        const id = identity(details);
        if (validExceptions.has(id)) { usedExceptions.add(id); continue; }
        fail('term-missing', `译文未匹配 ${rule.en} 的任何已审候选`, details);
      }
    }
  }
  for (const [id, item] of validExceptions) if (!usedExceptions.has(id)) {
    fail('exception-unused', '例外已不再需要，请移除或重新审查', { bank: item.bank, lang: item.lang, key: item.key, term: item.term });
  }
  stats.exceptions = usedExceptions.size;
  return { errors, stats };
}

export function loadGlossaryInputs() {
  const read = path => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
  const unitsByBank = {}, packs = { zh: {}, ja: {} };
  for (const bank of GLOSSARY_BANKS) {
    unitsByBank[bank] = sourceUnits(bank, read(`../data/${bank}.json`));
    for (const lang of languages) packs[lang][bank] = read(`../data/i18n/${lang}/${bank}.json`);
  }
  return { unitsByBank, packs, glossary: read('../data/i18n/glossary.json') };
}

export function glossarySummary({ stats }) {
  return `Glossary: ${stats.rules} rules; ${stats.units.zh} Chinese + ${stats.units.ja} Japanese units; term/cell hits ${stats.hits.zh} + ${stats.hits.ja}; exact exceptions ${stats.exceptions}; quoted references ${stats.references}.`;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { unitsByBank, packs, glossary } = loadGlossaryInputs();
    const result = validateGlossary(unitsByBank, packs, glossary);
    console.log(glossarySummary(result));
    for (const error of result.errors) console.error(JSON.stringify(error));
    if (result.errors.length) process.exitCode = 1;
  } catch (error) {
    console.error(`Glossary validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
