import { difficulty } from './state.js';
const bank = {},
  catalog = new Map(),
  entry = (ref, data) => catalog.set(ref.id, { ref, data });
export async function loadBank(files) {
  await Promise.all(
    files.map(async (key) => {
      const r = await fetch('./data/' + key + '.json');
      if (!r.ok) throw Error('无法读取题库 ' + key);
      bank[key] = await r.json();
    }),
  );
  for (const w of bank.vocab) entry({ id: w.id, mode: 'vocab' }, w);
  for (const q of bank.part2) entry({ id: q.id, mode: 'part2' }, q);
  for (const t of bank.grammar || [])
    for (const q of t.questions) entry({ id: q.id, mode: 'grammar' }, { ...q, topic: t });
  for (const set of bank.listening || []) {
    for (const q of set.questions)
      entry({ id: q.id, mode: 'dialogue' }, { ...q, level: set.level, set });
    const d = set.dictation;
    entry({ id: d.id, mode: 'dictation' }, { ...d, level: set.level, set });
  }
  for (const set of bank.reading || [])
    for (const q of set.questions)
      entry({ id: q.id, mode: 'reading' }, { ...q, level: set.level, set });
}
export { bank, catalog };
export const skillFor = (mode) =>
  ({ vocab: 'vocab', grammar: 'grammar', reading: 'reading' })[mode] || 'listening';
export const formats = ['meaning', 'english', 'sound', 'cloze', 'match'];
function hash(str) {
  let n = 2166136261;
  for (const c of str) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return n >>> 0;
}
const seedSort = (a, seed) => a.slice().sort((x, y) => hash(seed + x) - hash(seed + y));
const normalize = text => text.normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ');
const senses = text => normalize(text).split(/[；;、]/u).map(s => s.trim()).filter(Boolean);
const conflictingSound = [
  ['stationary','stationery'], ['complement','compliment'], ['principal','principle'],
  ['site','sight','cite'], ['sale','sail'], ['fare','fair'], ['mail','male'], ['serial','cereal'],
  ['aisle','isle'], ['board','bored'], ['break','brake'], ['capital','capitol'], ['course','coarse'],
  ['council','counsel'], ['discreet','discrete'], ['dual','duel'], ['flour','flower'], ['loan','lone'],
  ['meet','meat'], ['morning','mourning'], ['peak','peek','pique'], ['profit','prophet'],
  ['raise','rays','raze'], ['role','roll'], ['sole','soul'], ['suite','sweet'], ['waist','waste'],
  ['wait','weight'], ['ware','wear','where'], ['weather','whether'], ['write','right','rite'],
  ['pallet','palette','palate'], ['berth','birth'], ['die','dye'], ['sensor','censor'],
  ['timber','timbre'], ['draft','draught'], ['meter','metre'],
  ['hire','higher'], ['route','root'], ['weigh','way','whey'],
  ['pair','pear','pare'], ['steel','steal'], ['tail','tale'], ['waive','wave'], ['led','lead']
];
function sameSound(a,b) {
  return conflictingSound.some(group => group.includes(a) && group.includes(b));
}

// Used both by the lesson and by the bank validator. Seeds keep a question stable on resume.
export function vocabularyOptions(word, format, words) {
  const key = format === 'meaning' ? 'zh' : format === 'match' ? 'paraphrase' : 'word';
  const answer = word[key], seed = word.id + ':' + format;
  if (format === 'cloze' && word.clozeDistractors?.length === 3) {
    return seedSort([answer, ...word.clozeDistractors], seed);
  }
  const options = new Map([[normalize(answer), answer]]);
  const known = new Set(senses(word.zh));
  const spelling = normalize(word.word);
  const ipa = word.ipa.replace(/[ˈˌ.\s]/gu, '');
  const byWord = new Map(words.map(w => [normalize(w.word), w]));
  function add(text, other) {
    if (options.size >= 4 || options.has(normalize(text))) return;
    if (word.avoidWith?.some(w => normalize(w) === normalize(other?.word || text)) || other?.avoidWith?.some(w => normalize(w) === spelling)) return;
    if (other && (senses(other.zh).some(s => known.has(s)) || normalize(other.paraphrase) === normalize(word.paraphrase))) return;
    if (format === 'sound' && (sameSound(spelling,normalize(text)) || other?.ipa.replace(/[ˈˌ.\s]/gu,'') === ipa)) return;
    options.set(normalize(text),text);
  }
  if (format === 'sound' || format === 'english') {
    for (const text of seedSort(word.confusables || [], seed)) add(text, byWord.get(normalize(text)));
  }
  if (options.size < 4) {
    const candidates = words.filter(w => w.id !== word.id).map(w => ({
      word:w,
      rank: (w.pos === word.pos ? 0 : 2) + (w.theme === word.theme ? 0 : 1),
      tie:hash(seed+w.id),
    })).sort((a,b) => a.rank-b.rank || a.tie-b.tie);
    for (const {word:other} of candidates) {
      add(other[key],other);
      if (options.size === 4) break;
    }
  }
  return seedSort([...options.values()],seed);
}
export const blank = (text, word) =>
  text.replace(
    new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'),
    '_____',
  );
export function question(ref) {
  const d = catalog.get(ref.id)?.data;
  if (!d) return null;
  if (ref.mode === 'vocab') {
    const f = ref.format || 'meaning',
      key = f === 'meaning' ? 'zh' : f === 'match' ? 'paraphrase' : 'word';
    return {
      ...d,
      skill: 'vocab',
      answer: d[key],
      options: vocabularyOptions(d, f, bank.vocab),
      prompt: {
        meaning: d.word,
        english: d.zh,
        sound: '听发音，选出对应的单词。',
        cloze: blank(d.example, d.word),
        match: d.word,
      }[f],
      instruction: {
        meaning: '选择正确的中文释义',
        english: '选择对应的英文单词',
        sound: '听音辨词',
        cloze: '为例句选择合适的单词',
        match: '选择意思相近的表达',
      }[f],
      turns: [{ text: d.word, speaker: 'A' }],
      audio: f === 'sound',
    };
  }
  if (ref.mode === 'dictation')
    return {
      ...d,
      skill: 'listening',
      prompt: blank(d.text, d.answer),
      instruction: '听写 · 填入缺失的单词',
      audio: true,
      turns: [{ text: d.text, speaker: 'A' }],
      evidence: d.answer,
      en: d.text,
      zh: '对照原句，留意空格处单词的拼写。',
    };
  return {
    ...d,
    skill: skillFor(ref.mode),
    instruction: {
      part2: 'Part 2 · 问答',
      grammar: 'Part 5 · 句子填空',
      reading: 'Part ' + d.set?.part + ' · 阅读理解',
      dialogue: 'Part ' + d.set?.part + ' · 听力理解',
    }[ref.mode],
    audio: ['part2', 'dialogue'].includes(ref.mode),
    turns:
      ref.mode === 'part2'
        ? [
            { speaker: 'A', text: d.audio },
            ...(d.type === 'response'
              ? d.options.map((opt, i) => ({
                  speaker: 'B',
                  text: String.fromCharCode(65 + i) + '. ' + opt,
                }))
              : []),
          ]
        : d.set?.turns,
  };
}
export function select(s, mode, count = 5, filter = '') {
  if (mode === 'errors')
    return Object.values(s.errors)
      .filter((e) => catalog.has(e.ref.id))
      .sort((a, b) => b.misses - a.misses || a.at - b.at)
      .slice(0, count)
      .map((e) => ({ ...e.ref }));
  const target = difficulty(s, skillFor(mode)),
    now = Date.now();
  let pool = [...catalog.values()].filter(
    (o) =>
      o.ref.mode === mode &&
      (!filter ||
        [o.data.theme, o.data.topic?.id, String(o.data.set?.part), o.data.type].includes(filter)),
  );
  const rank = (o) => {
    const { data: d, ref: r } = o,
      w = s.words[r.id];
    if (s.errors[r.id]) return -10000;
    if (w && w.due <= now) return -5000;
    return (
      (w && w.due > now ? 9000 : 0) +
      Math.abs(d.level - target) * 4 +
      Math.min(6, s.seen[r.id] || 0) * 60
    );
  };
  pool = pool
    .map((o) => ({ o, n: rank(o) + Math.random() * 12 }))
    .sort((a, b) => a.n - b.n)
    .map((v) => v.o);
  if ((mode === 'reading' || mode === 'dialogue') && pool.length) {
    return pool[0].data.set.questions.map((q) => ({ id: q.id, mode }));
  }
  if (mode === 'grammar' && pool.length) {
    const topic = pool[0].data.topic.id;
    pool = pool.filter((o) => o.data.topic.id === topic);
  }
  const shift = Object.values(s.words).reduce((n, w) => n + w.tries, 0);
  return pool
    .slice(0, count)
    .map((o, i) => ({
      ...o.ref,
      ...(mode === 'vocab' ? { format: formats[(i + shift) % formats.length] } : {}),
    }));
}
