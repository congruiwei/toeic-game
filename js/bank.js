import { japaneseMeaning, conflictingJapaneseMeanings, vocabularyFormatAt, selectVocabularyFormat, semanticSlotsBefore } from './vocabulary-language.js';
export { ensureVocabLanguage, ensureVocabMeanings, japaneseMeaning } from './vocabulary-language.js';
import {errorDue} from './review-scheduler.js';
import {screenedQueue} from './screening.js';
import { difficulty } from './state.js';
import { splitSentences } from './replay.js';
import {installConfusables,installConfusableCandidates,confusableCandidates,confusableQuestion,overlapsCuratedMeaning} from './confusables.js';
const bank = {},
  catalog = new Map(),
  entry = (ref, data) => catalog.set(ref.id, { ref, data });
const pending = new Map();
export async function loadBank(files) {
  if(files.includes('vocab')&&!files.includes('confusable-candidates'))files=[...files,'confusable-candidates'];
  await Promise.all(files.map(file => {
    if(bank[file])return;
    if(!pending.has(file)){
      const job=fetch('./data/'+file+'.json').then(async response=>{
        if(!response.ok)throw Error('无法读取题库 '+file);
        const rows=await response.json();
        if(file==='confusable-candidates'){installConfusableCandidates(rows);bank[file]=rows;return;}
        if(file==='confusables'){
          installConfusables(rows);
          for(const q of rows.questions)entry({id:q.id,mode:'confusable'},q);
          bank[file]=rows;return;
        }
        for(const row of rows){
          if(file==='vocab'||file==='part1'||file==='part2')entry({id:row.id,mode:file},row);
          else if(file==='grammar')for(const q of row.questions)entry({id:q.id,mode:'grammar'},{...q,topic:row});
          else{
            const mode=file==='reading'?'reading':'dialogue';
            for(const q of row.questions)entry({id:q.id,mode},{...q,level:row.level,set:row});
            if(row.dictation)entry({id:row.dictation.id,mode:'dictation'},{...row.dictation,level:row.level,set:row});
          }
        }
        bank[file]=rows;
      }).finally(()=>pending.delete(file));
      pending.set(file,job);
    }
    return pending.get(file);
  }));
}
export { bank, catalog };
export const skillFor = (mode) =>
  ({ vocab: 'vocab', confusable:'vocab', grammar: 'grammar', reading: 'reading' })[mode] || 'listening';
export const formats = ['meaning', 'english', 'sound', 'cloze', 'match'];
export const vocabularyFormats = [...formats, 'meaning-ja', 'english-ja'];
function hash(str) {
  let n = 2166136261;
  for (const c of str) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return n >>> 0;
}
const seedSort = (a, seed) => a.slice().sort((x, y) => hash(seed + x) - hash(seed + y));
const normalize = text => text.normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ');
const senses = text => normalize(text).split(/[；;、]/u).map(s => s.trim()).filter(Boolean);
const conflictingSound = [
  ['stairs','stares'], ['flyer','flier'], ['assistance','assistants'],
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
  const japanese = ['meaning-ja', 'english-ja'].includes(format);
  const baseFormat = japanese ? format.slice(0, -3) : format;
  const key = baseFormat === 'meaning' ? 'zh' : baseFormat === 'match' ? 'paraphrase' : 'word';
  const value = item => format === 'meaning-ja' ? japaneseMeaning(item.id) : item[key];
  const answer = value(word), seed = word.id + ':' + format;
  const targetMeaning = japanese ? japaneseMeaning(word.id) : null;
  if (format === 'cloze' && word.clozeDistractors?.length === 3) {
    return seedSort([answer, ...word.clozeDistractors], seed);
  }
  const options = new Map([[normalize(answer), answer]]);
  const known = new Set(senses(word.zh));
  const spelling = normalize(word.word);
  const ipa = word.ipa.replace(/[ˈˌ.\s]/gu, '');
  const byWord = new Map(words.map(w => [normalize(w.word), w]));
  const allSenses = new Map();
  if (japanese) for (const other of words) {
    const head = normalize(other.word);
    if (!allSenses.has(head)) allSenses.set(head, []);
    allSenses.get(head).push(other);
  }
  function add(text, other) {
    if (options.size >= 4 || options.has(normalize(text)) || (other && normalize(other.word) === spelling)) return;
    if(format!=='sound'&&overlapsCuratedMeaning(spelling,normalize(other?.word||text)))return;
    if (word.avoidWith?.some(w => normalize(w) === normalize(other?.word || text)) || other?.avoidWith?.some(w => normalize(w) === spelling)) return;
    if (other && (senses(other.zh).some(s => known.has(s)) || normalize(other.paraphrase) === normalize(word.paraphrase))) return;
    if (japanese) {
      // A spelling option can denote any of its senses, not only the final
      // record in byWord. Unknown external confusables cannot be vetted.
      if (!other) return;
      const meanings = format === 'english-ja' ? allSenses.get(normalize(other.word)) : [other];
      if (meanings.some(candidate => conflictingJapaneseMeanings(targetMeaning, japaneseMeaning(candidate.id)))) return;
    }
    if (format === 'sound' && (sameSound(spelling,normalize(text)) || other?.ipa.replace(/[ˈˌ.\s]/gu,'') === ipa)) return;
    options.set(normalize(text),text);
  }
  if (format === 'sound' || baseFormat === 'english') {
    for (const text of seedSort(confusableCandidates(word.id), seed)) add(text, byWord.get(normalize(text)));
  }
  if (options.size < 4) {
    const candidates = words.filter(w => normalize(w.word) !== spelling).map(w => ({
      word:w,
      rank: (w.pos === word.pos ? 0 : 2) + (w.theme === word.theme ? 0 : 1),
      tie:hash(seed+w.id),
    })).sort((a,b) => a.rank-b.rank || a.tie-b.tie);
    for (const {word:other} of candidates) {
      add(value(other),other);
      if (options.size === 4) break;
    }
  }
  if (japanese && options.size !== 4) throw new Error('日语词义题缺少三个无歧义干扰项：' + word.id);
  return seedSort([...options.values()],seed);
}
export const blank = (text, word) =>
  text.replace(
    new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'),
    '_____',
  );
export function question(ref) {
  if(ref.mode==='confusable')return confusableQuestion(ref);
  const d = catalog.get(ref.id)?.data;
  if (!d) return null;
  if (ref.mode === 'vocab') {
    const f = ref.format || 'meaning',
      key = f === 'meaning' ? 'zh' : f === 'match' ? 'paraphrase' : 'word',
      ja = ['meaning-ja', 'english-ja'].includes(f) ? japaneseMeaning(d.id) : null;
    return {
      ...d,
      context: d.sense && ['meaning','meaning-ja','match'].includes(f) ? d.example : '',
      skill: 'vocab',
      answer: f === 'meaning-ja' ? ja : d[key],
      ...(ja ? {meaningJa: ja} : {}),
      options: vocabularyOptions(d, f, bank.vocab),
      prompt: {
        meaning: d.word,
        english: d.zh,
        'meaning-ja': d.word,
        'english-ja': ja,
        sound: '听发音，选出对应的单词。',
        cloze: blank(d.example, d.word),
        match: d.word,
      }[f],
      instruction: {
        meaning: '选择正确的中文释义',
        english: '选择对应的英文单词',
        'meaning-ja': '选择正确的日语释义',
        'english-ja': '根据日语释义选择英文单词',
        sound: '听音辨词',
        cloze: '为例句选择合适的单词',
        match: '选择意思相近的表达',
      }[f],
      turns: [{ text: d.word, speaker: 'A' }],
      audio: f === 'sound',
    };
  }
  if(ref.mode==='part1')return {...d,skill:'listening',instruction:'Part 1 · 看图听句',prompt:'哪一句最符合插画？',audio:true,
    turns:d.options.map((text,i)=>({speaker:'A',text:String.fromCharCode(65+i)+'. '+text}))};
  if (ref.mode === 'dictation')
    return {
      ...d,
      skill: 'listening',
      prompt: blank(d.text, d.answer),
      instruction: '听写 · 填入缺失的单词',
      audio: true,
      turns: [{ text: d.text, speaker: d.set.turns.find(turn=>turn.text.includes(d.text))?.speaker||'A', bank:'listening', keys:splitSentences(d.text).map((_,i)=>`${d.id}/text/${i}`) }],
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
  const shift = Object.values(s.words).reduce((n, w) => n + w.tries, 0);
  const preference = s.settings?.vocabLanguage || 'both';
  if(mode==='vocab' && filter==='screen-queue'){
    return screenedQueue(s).filter(id=>catalog.has(id)).slice(0,count).map((id,i)=>({mode:'vocab',id,format:selectVocabularyFormat('meaning',preference,semanticSlotsBefore(shift)+i)}));
  }
  if (mode === 'errors')
    return Object.values(s.errors)
      .filter((e) => catalog.has(e.ref.id) && errorDue(s,e)<=Date.now())
      .sort((a,b) => errorDue(s,a)-errorDue(s,b) || b.misses-a.misses)
      .slice(0, count)
      .map((e) => ({ ...e.ref }));
  const target = difficulty(s, skillFor(mode)),
    now = Date.now();
  let pool = [...catalog.values()].filter(
    (o) =>
      o.ref.mode === mode &&
      (!filter ||
        [o.data.theme, o.data.topic?.id, String(o.data.set?.part), o.data.type,o.data.groupId].includes(filter)),
  );
  const rank = (o) => {
    const { data: d, ref: r } = o,
      w = s.words[r.id];
    if (s.errors[r.id]) return errorDue(s,s.errors[r.id])<=now ? -10000 : 10000;
    if (mode==='vocab' && ['learn','unconfirmed'].includes(s.screening?.marks[r.id])) return -4000;
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
  return pool
    .slice(0, count)
    .map((o, i) => ({
      ...o.ref,
      ...(mode === 'vocab' ? { format: vocabularyFormatAt(formats, i + shift, preference) } : {}),
    }));
}
