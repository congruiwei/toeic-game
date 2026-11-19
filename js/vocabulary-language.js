let meanings = null, pendingMeanings = null;

export const vocabLanguages = ['zh', 'ja', 'both'];
const semanticFormats = new Set(['meaning', 'english']);
export const isJapaneseVocabulary = ref => ref?.mode === 'vocab' && ['meaning-ja', 'english-ja'].includes(ref.format);

// Word-choice questions only need the short Japanese definitions.
export async function ensureVocabMeanings() {
  if (meanings) return meanings;
  if (!pendingMeanings) pendingMeanings = (async () => {
    // Keep the translation parser and source alignment off the Chinese startup path.
    const { loadLanguage } = await import('./translations.js');
    const entries = await loadLanguage('vocab-meanings', 'ja');
    if (!Object.keys(entries).length || Object.entries(entries).some(([key, value]) =>
      !key.endsWith('/meaning') || typeof value !== 'string' || !value.trim())) {
      throw new Error('日语词义包格式有误，请更新后重试。');
    }
    meanings = entries;
    return meanings;
  })().finally(() => { pendingMeanings = null; });
  return pendingMeanings;
}
export async function ensureVocabLanguage(ref) {
  if (isJapaneseVocabulary(ref)) await ensureVocabMeanings();
}
export function japaneseMeaning(id) {
  const meaning = meanings?.[`${id}/meaning`];
  if (typeof meaning !== 'string' || !meaning.trim()) {
    const error = new Error('日语词义尚未下载，请联网后重试。');
    error.code = 'VOCAB_JA_NOT_READY';
    throw error;
  }
  return meaning;
}

// A semantic ordinal counts meaning/english slots, not sound/cloze/match slots.
// The original five-format rotation has two semantic slots at its beginning.
export function semanticSlotsBefore(attempts = 0) {
  const n = Number.isSafeInteger(attempts) && attempts > 0 ? attempts : 0;
  return Math.floor(n / 5) * 2 + Math.min(n % 5, 2);
}
export function selectVocabularyFormat(baseFormat, preference = 'both', semanticIndex = 0) {
  if (!semanticFormats.has(baseFormat)) return baseFormat;
  const japanese = preference === 'ja' || (preference === 'both' && semanticIndex % 2 === 1);
  return japanese ? `${baseFormat}-ja` : baseFormat;
}

const normalize = text => text.normalize('NFKC').toLowerCase().replace(/\s+/gu, '').trim();
// Narrow equivalences for the actual business senses in the meaning pack.
// This is an exclusion list, not a translation dictionary: false positives only
// discard a distractor and never change a meaning or a correct answer.
const equivalent = [
  ['知らせる', '通知する', '告知する'],
  ['修正する', '訂正する', '是正する', '改訂する'],
  ['得る', '取得する', '獲得する'],
  ['供給する', '提供する'],
  ['入手する', '受け取る'],
  ['申請する', '申し込む', '応募する'],
  ['雇う', '採用する', '雇用する'],
  ['発送する', '出荷する'],
  ['配達する', '届ける', '配送する'],
  ['取り消す', 'キャンセルする'],
  ['説明する', '明確にする', '明らかにする'],
  ['記録する', '記録として保管する'],
  ['許可する', '承認する', '認可する'],
  ['提示する', '示す', '展示する', '陳列する'],
  ['検査する', '点検する', '検査', '点検'],
  ['保守する', '整備する', '保守', '整備'],
  ['取り置く', '確保する', '取り置きする'],
  ['先送りする', '延期する'],
  ['不十分な', '不足している'],
  ['十分な', '必要を満たす'],
  ['有効期限', '満了日'],
  ['料金', '手数料', 'サービス料'],
  ['経費', '支出', '費用', 'コスト'],
  ['返金', '払い戻し'],
  ['賃借', 'レンタル', '賃貸'],
  ['宿泊', '旅行先の宿泊'],
  ['従業員', '職員', 'スタッフ'],
  ['管理者', 'マネージャー'],
  ['会議', '会合'],
  ['改装', '修繕', '改修'],
  ['検査官', '検査員'],
  ['労働者', '作業員'],
  ['人工遺物', '工芸遺物'],
];
const aliases = new Map(equivalent.flatMap((group, index) => group.map(value => [normalize(value), `@${index}`])));
export function japaneseMeaningParts(text) {
  return text.split(/[；;、]/u).map(part => normalize(part)
    .replace(/[（(][^）)]*[）)]/gu, '')
    .replace(/^(正式に|事前に|あらかじめ)/u, ''))
    .filter(Boolean).map(part => aliases.get(part) || part);
}
export function conflictingJapaneseMeanings(a, b) {
  const known = new Set(japaneseMeaningParts(a));
  return japaneseMeaningParts(b).some(part => known.has(part));
}

export function vocabularyFormatAt(baseFormats, attempt, preference = 'both') {
  const n = Number.isSafeInteger(attempt) && attempt > 0 ? attempt : 0;
  let base = baseFormats[n % baseFormats.length];
  // Swap the two semantic directions every other cycle so both Japanese
  // directions appear, while the global language sequence stays zh, ja, zh, ja.
  if (preference === 'both' && Math.floor(n / baseFormats.length) % 2 && semanticFormats.has(base)) {
    base = base === 'meaning' ? 'english' : 'meaning';
  }
  return selectVocabularyFormat(base, preference, semanticSlotsBefore(n));
}
