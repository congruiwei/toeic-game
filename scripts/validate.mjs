// Run from any directory: node scripts/validate.mjs
import { readFile } from 'node:fs/promises';
import { vocabularyOptions, formats } from '../js/bank.js';

const dataDirectory = new URL('../data/', import.meta.url);
const levels = [400, 500, 600, 700, 800, 900];
const seenIds = new Map();
const presentLevels = new Set();
const issues = [];
const counts = {};
const distributions = new Map(), warnings = [];
const normalize = text => text.normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase();
const optionLength = text => [...normalize(text)].length;
function measure(type, q) {
  if (!Array.isArray(q.options) || !q.options.every(o => typeof o === 'string') || !q.options.includes(q.answer)) return;
  const report = distributions.get(type) || {
    total: 0, longest: 0, varied: 0, shortestOnly: 0, longestOnly: 0, positions: [], expected: [],
  };
  const lengths = q.options.map(optionLength);
  const key = q.options.indexOf(q.answer);
  const length = lengths[key];
  const lo = Math.min(...lengths), hi = Math.max(...lengths);
  report.total++;
  if (length === hi) report.longest++;
  if (lo !== hi) {
    report.varied++;
    if (lengths.filter(n => n === length).length === 1) {
      if (length === lo) report.shortestOnly++;
      if (length === hi) report.longestOnly++;
    }
  }
  if (q.kind !== 'insertion') q.options.forEach((_, i) => {
    report.positions[i] = (report.positions[i] || 0) + Number(i === key);
    report.expected[i] = (report.expected[i] || 0) + 1 / q.options.length;
  });
  distributions.set(type, report);
}

function fraction(count, total) {
  return total ? count+'/'+total+' ('+(100*count/total).toFixed(1)+'%)' : '—';
}

function reportDistributions() {
  console.log('题型 | 最长（含并列） | 唯一最短¹ | 唯一最长¹ | 正确位置 A/B/C/D');
  for (const [type,r] of distributions) {
    console.log([type, fraction(r.longest,r.total), fraction(r.shortestOnly,r.varied),
      fraction(r.longestOnly,r.varied), r.positions.join('/')].join(' | '));
    expect(r.longest <= .4*r.total, type, '正确答案为最长选项的比例超过 40%');
    expect(r.shortestOnly <= .35*r.varied, type, '正确答案为唯一最短选项的比例超过 35%');
    const chi = r.positions.reduce((sum,n,i) => sum + (n-r.expected[i])**2/r.expected[i],0);
    const positioned = r.positions.reduce((a,b) => a+b,0);
    if (positioned && (r.positions.some((n,i) => Math.abs(n-r.expected[i])/positioned > .12)
      || chi > (r.positions.length===3?9.21:11.35)))
      warnings.push(type+' 答案位置分布偏离均匀值，实际 '+r.positions.join('/'));
  }
  console.log('¹ 唯一最短、唯一最长的分母均排除所有选项等长的题。');
  for (const warning of warnings) console.warn('警告：'+warning);
}

function expect(condition, location, message) {
  if (!condition) issues.push(`${location}: ${message}`);
}

function record(value, location) {
  const valid = value !== null && typeof value === 'object' && !Array.isArray(value);
  expect(valid, location, '应为对象');
  return valid;
}

function items(value, location, minimum = 1) {
  if (!Array.isArray(value)) {
    issues.push(`${location}: 应为数组`);
    return [];
  }
  expect(value.length >= minimum, location, `至少需要 ${minimum} 项，实际 ${value.length} 项`);
  return value;
}

function string(value, location) {
  const valid = typeof value === 'string' && value.trim().length > 0;
  expect(valid, location, '应为非空字符串');
  return valid;
}

function strings(entry, location, keys) {
  for (const key of keys) string(entry[key], `${location}.${key}`);
}

function id(entry, location) {
  if (!string(entry.id, `${location}.id`)) return;
  expect(/^[a-zA-Z0-9_-]{1,100}$/.test(entry.id) && !(entry.id in Object.prototype) && entry.id !== 'prototype',
    location, 'ID 需为 1–100 位字母、数字、下划线或短横线，且不能与对象保留键同名');
  if (seenIds.has(entry.id)) {
    issues.push(`${location}: ID「${entry.id}」和 ${seenIds.get(entry.id)} 重复`);
  } else {
    seenIds.set(entry.id, location);
  }
}

function level(entry, location) {
  expect(levels.includes(entry.level), `${location}.level`, '难度须为 400 至 900 的整百数值');
  presentLevels.add(entry.level);
}

function answers(question, location) {
  strings(question, location, ['prompt', 'answer', 'en', 'zh']);
  const options = items(question.options, `${location}.options`, 2);
  const normalized = options.flatMap((option, i) => string(option, `${location}.options[${i}]`) ? [option.trim().toLowerCase()] : []);
  expect(new Set(normalized).size === normalized.length, location, '选项重复');
  expect(options.includes(question.answer), location, 'answer 必须和某一选项逐字一致');
}

function cite(question, sources, location) {
  strings(question, location, ['evidence', 'paraphrase']);
  expect(sources.some(text => typeof text === 'string' && text.includes(question.evidence)), location, 'evidence 必须逐字出现在一段原文内');
}

function wordsIn(word, sentence) {
  if (typeof word !== 'string' || typeof sentence !== 'string' || !word.trim()) return [];
  // Escape punctuation so a multiword expression or a hyphenated headword is literal.
  const literal = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return sentence.match(new RegExp(`\\b${literal}\\b`, 'gi')) || [];
}

function scan(entries, location, minimum, visit) {
  items(entries, location, minimum).forEach((entry, index) => {
    const at = `${location}[${index}]`;
    if (record(entry, at)) visit(entry, at);
  });
}

function vocabulary(entries) {
  const words = new Set(), uses = new Map();
  let confused=0;
  scan(entries, 'vocab', 1000, (entry, at) => {
    id(entry, at);
    level(entry, at);
    strings(entry, at, ['word', 'ipa', 'zh', 'pos', 'theme', 'example', 'collocation', 'paraphrase']);
    if (typeof entry.word !== 'string') return;
    const key = entry.word.trim().toLowerCase();
    expect(!words.has(key), at, `重复词条「${entry.word}」`);
    words.add(key);
    expect(wordsIn(entry.word, entry.example).length === 1, at, 'example 应含一次可用于填空的完整词头');
    if('avoidWith' in entry){
      const list=items(entry.avoidWith,at+'.avoidWith').filter(x=>string(x,at+'.avoidWith')).map(normalize);
      expect(!list.includes(key)&&new Set(list).size===list.length,at,'避配词不能重复或等于词头');
    }
    if ('confusables' in entry) {
      const list=items(entry.confusables, at+'.confusables');
      const unique=new Set();
      for (const value of list) {
        if (!string(value,at+'.confusables')) continue;
        const norm=normalize(value);
        expect(norm!==key&&!unique.has(norm),at,'易混词不得重复或等于词头');unique.add(norm);
      }
      if(unique.size)confused++;
    }
    {
      const path = `${at}.clozeDistractors`;
      const distractors = items(entry.clozeDistractors, path, 3);
      expect(distractors.length === 3, path, '需要恰好三个干扰项');
      const normalized = distractors.flatMap((word, i) => string(word, `${path}[${i}]`) ? [normalize(word)] : []);
      expect(new Set(normalized).size === normalized.length, path, '三个干扰项须互不相同');
      expect(!normalized.includes(key), path, '干扰项不能是词头本身');
      for (const other of normalized) {
        expect(other.split(' ').length === normalize(entry.word).split(' ').length,path,'干扰项词数不同：'+other);
        uses.set(other,(uses.get(other)||0)+1);
      }
    }
  });
  for (const required of ['available', 'valuable', 'postpone', 'itinerary', 'reimburse', 'tentative', 'inadvertently', 'deadline', 'invoice']) {
    expect(words.has(required), 'vocab', `缺少指定词 ${required}`);
  }
  expect(confused>=80,'vocab','至少 80 个词条需提供易混词');
  for(const [word,n] of uses) expect(n<=3,'vocab.clozeDistractors',word+' 使用 '+n+' 次（上限 3）');
  for (const [a,b] of [['available','valuable'],['valuable','available']]) expect(entries.find(w=>w.word===a)?.confusables?.includes(b),a,'缺少互列易混词 '+b);
  if(!issues.length)for(const w of entries)for(const f of formats){
    const options=vocabularyOptions(w,f,entries),answer=f==='meaning'?w.zh:f==='match'?w.paraphrase:w.word;
    expect(options.length===4&&options.includes(answer)&&new Set(options.map(normalize)).size===4,w.id,'生成的 '+f+' 选项无效');
    measure('Vocab '+f,{answer,options});
  }
  counts['单词'] = words.size;
}

function part2(entries) {
  const firstWords = new Set();
  let responses = 0;
  scan(entries, 'part2', 200, (entry, at) => {
    id(entry, at);
    level(entry, at);
    answers(entry, at);
    measure('Part 2 '+entry.type,entry);
    string(entry.audio, `${at}.audio`);
    cite(entry, [entry.audio], at);
    expect(['first', 'response'].includes(entry.type), at, 'type 须为 first 或 response');
    if (entry.type === 'response') responses++;
    if (entry.type === 'first') {
      const first = typeof entry.audio === 'string' ? entry.audio.trim().split(/\s+/)[0].toLowerCase() : '';
      expect(typeof entry.answer === 'string' && entry.answer.toLowerCase() === first, at, '首词辨识的答案须为录音开头的词');
      firstWords.add(first);
    }
  });
  for (const required of ['where', 'when', 'who', 'why', 'how', 'do', 'is']) {
    expect(firstWords.has(required), 'part2', `缺少 ${required} 的首词练习`);
  }
  const indirect = entries.filter(q=>q.type==='response' && q.indirect===true).length;
  expect(indirect >= Math.ceil(entries.length/2),'part2','明确标注的间接回应须达到总题数的一半');
  const types=new Set(entries.map(q=>q.questionType));
  for(const name of ['wh','yes-no','choice','negative','tag','statement','request','suggestion'])expect(types.has(name),'part2','缺少回应类型 '+name);
  expect(responses > 0, 'part2', '须包含问答练习');
  counts['Part 2'] = Array.isArray(entries) ? entries.length : 0;
}

function grammar(lessons) {
  let total = 0;
  scan(lessons, 'grammar', 2, (lesson, at) => {
    id(lesson, at);
    string(lesson.title, `${at}.title`);
    if (record(lesson.diagram, `${at}.diagram`)) {
      const diagram = lesson.diagram;
      expect(['timeline', 'flow'].includes(diagram.kind), at, '图解类型须为 timeline 或 flow');
      string(diagram.caption, `${at}.diagram.caption`);
      scan(diagram.steps, `${at}.diagram.steps`, 2, (step, path) => strings(step, path, ['label', 'detail']));
    }
    scan(lesson.questions, `${at}.questions`, lesson.id === 'gram-lexis' ? 100 : 15, (q, path) => {
      id(q, path);
      level(q, path);
      answers(q, path);
      expect(typeof q.prompt === 'string' && q.prompt.includes('___'), path, 'Part 5 题干须标出 ___ 空位');
      measure(lesson.id==='gram-lexis'?'Part 5 词汇':'Part 5 语法',q);
      total++;
    });
  });
  const topics=new Set(lessons.map(t=>t.id));
  for(const name of ['gram-lexis','gram-pronouns','gram-nonfinite','gram-modifiers','gram-agreement','gram-quantity','gram-sequence','gram-linkers']) expect(topics.has(name),'grammar','缺少关卡 '+name);
  expect(total >= 300, 'grammar', `Part 5 至少 300 道，实际 ${total} 道`);
  counts['Part 5'] = total;
}

function comprehension(group, at, sources) {
  scan(group.questions, `${at}.questions`, 1, (q, path) => {
    id(q, path);
    answers(q, path);
    cite(q, sources, path);
    measure('Part '+group.part,q);
  });
}

function tableCells(table, at) {
  if (!record(table,at)) return [];
  const cells=[];
  const headers=items(table.headers,at+'.headers',2);
  for(const header of headers) string(header,at+'.headers');
  for(const row of items(table.rows,at+'.rows')) {
    if(!Array.isArray(row)){issues.push(at+': 表格行必须是数组');continue;}
    expect(row.length===headers.length,at,'数据行与表头列数不同');
    for(const cell of row) if(string(cell,at+'.rows'))cells.push(cell);
  }
  return cells;
}
function listening(groups) {
  const parts = new Set();
  let graphics=0,three=0,intents=0;
  scan(groups, 'listening', 12, (group, at) => {
    id(group, at);
    level(group, at);
    string(group.title, `${at}.title`);
    expect([3, 4].includes(group.part), at, 'part 须为 3 或 4');
    parts.add(group.part);
    const sources = [];
    const speakers = new Set();
    scan(group.turns, `${at}.turns`, 1, (turn, path) => {
      strings(turn, path, ['speaker', 'text']);
      speakers.add(turn.speaker);
      sources.push(turn.text);
    });
    if (group.part === 3) expect(speakers.size >= 2, at, 'Part 3 对话至少需要两位说话人');
    if (group.part === 4) expect(speakers.size === 1, at, 'Part 4 应为独白');
    expect([...speakers].every(s=>['A','B','C'].includes(s)),at,'说话人应为 A、B 或 C');
    if(group.part===3 && group.level>=600 && speakers.size===3)three++;
    if(group.graphic){string(group.graphic.title,at+'.graphic.title');tableCells(group.graphic,at+'.graphic');}
    const questions=Array.isArray(group.questions)?group.questions:[];
    expect(questions.length===3,at,'每组需要三道理解题');
    if(questions.some(q=>q.prompt?.startsWith('Look at the graphic.'))){expect(!!group.graphic,at,'联读图表缺失');graphics++;}
    if(questions.some(q=>q.type==='intent'))intents++;
    comprehension(group, at, sources);
    const path = `${at}.dictation`;
    if (record(group.dictation, path)) {
      const d = group.dictation;
      id(d, path);
      strings(d, path, ['text', 'answer']);
      expect(sources.some(text => typeof text === 'string' && text.includes(d.text)), path, '听写句子须逐字出现在录音中');
      expect(typeof d.answer === 'string' && /^\S+$/.test(d.answer) && wordsIn(d.answer, d.text).length === 1, path, '听写答案须为句中只出现一次的完整单词');
    }
  });
  for(const part of [3,4])expect(groups.filter(g=>g.part===part).length>=30,'listening','Part '+part+' 至少 30 组');
  expect(graphics>=10 && three>0 && intents>0,'listening','需要至少 10 组图表并覆盖三人对话和意图题');
  expect(parts.has(3) && parts.has(4), 'listening', '须同时包含 Part 3 和 Part 4');
  counts['Part 3/4 组'] = Array.isArray(groups) ? groups.length : 0;
}

function reading(groups) {
  let part6 = 0, single = 0, double = 0, triple = 0;
  const kinds={vocabulary:0,negative:0,insertion:0};
  let longerSingles=0;
  const originalShortPassages=new Set(['read-badge','read-samples','read-bikes','read-labels','read-credit']);
  scan(groups, 'reading', 12, (group, at) => {
    id(group, at);
    level(group, at);
    string(group.title, `${at}.title`);
    expect([6, 7].includes(group.part), at, 'part 须为 6 或 7');
    const sources = [];
    scan(group.documents, `${at}.documents`, 1, (doc, path) => {
      strings(doc, path, ['type', 'title', 'text']);
      sources.push(doc.text);
      if(doc.table)sources.push(...tableCells(doc.table,path+'.table'));
    });
    comprehension(group, at, sources);
    if (group.part === 6) {
      part6++;
      if(!originalShortPassages.has(group.id))expect(group.questions?.length===4,at,'新增 Part 6 需要四个空位');
      const passage = sources.join('\n');
      const passageMarkers = new Set(passage.match(/\[\d+\]/g) || []);
      const questionMarkers = new Set();
      for (const q of Array.isArray(group.questions) ? group.questions : []) {
        const marker = typeof q?.prompt === 'string' && q.prompt.match(/\[\d+\]/)?.[0];
        expect(passageMarkers.has(marker), at, 'Part 6 题干标号须能在原文找到，如 [1]');
        expect(!questionMarkers.has(marker), at, `Part 6 空位 ${marker} 被重复出题`);
        questionMarkers.add(marker);
      }
      for (const marker of passageMarkers) expect(questionMarkers.has(marker), at, `Part 6 原文空位 ${marker} 没有对应问题`);
    } else if (group.part === 7) {
      const n=group.documents?.length, m=group.questions?.length;
      if(n===1){
        single++; if(m===3 || m===4)longerSingles++;
        expect(m>=2 && m<=4,at,'单篇需 2–4 题');
      }
      else {expect(n===2||n===3,at,'Part 7 每组限 1–3 篇');expect(m===5,at,'多篇组需 5 题');}
      if(n===2)double++;if(n===3)triple++;
      for (const q of group.questions || []) {
        if(!q.kind)continue;
        expect(Object.hasOwn(kinds,q.kind),q.id,'未知阅读题型');
        if(Object.hasOwn(kinds,q.kind))kinds[q.kind]++;
        if(q.kind==='vocabulary')expect(/closest in meaning to/i.test(q.prompt),q.id,'词义题应定位并询问原文中的表达');
        if(q.kind==='negative')expect(/\bNOT\b/.test(q.prompt),q.id,'否定题应突出 NOT');
        if(q.kind==='insertion'){
          const marks=['[1]','[2]','[3]','[4]'];
          expect(JSON.stringify(q.options)===JSON.stringify(marks),q.id,'插句选项必须固定为 [1]、[2]、[3]、[4]');
          expect(group.documents.some(doc=>marks.every(mark=>doc.text.split(mark).length===2)&&
            marks.every((mark,i)=>i===0||doc.text.indexOf(marks[i-1])<doc.text.indexOf(mark))),q.id,'同一文稿须按顺序各有一个插句位置');
        }
      }
    }
  });
  expect(part6 >=15 && single+double+triple>=45 && single>0 && double>=8 && triple>=6, 'reading', 'Part 6 需15组、Part 7 需45组，含至少8双篇及6三篇');
  expect(longerSingles>=Math.ceil(single/2),'reading','至少半数单篇需要 3–4 题');
  expect(kinds.vocabulary>=20 && kinds.negative>=15 && kinds.insertion>=12,'reading','Part 7 词义、NOT、插句题数量不足');
  console.log('Part 7 专项：词义 '+kinds.vocabulary+'，NOT '+kinds.negative+'，插句 '+kinds.insertion+'；3–4 题单篇 '+longerSingles+'/'+single+'。插句排除于位置统计。');
  counts['Part 6/7 组'] = Array.isArray(groups) ? groups.length : 0;
}

for (const [file, validate] of Object.entries({ vocab: vocabulary, part2, grammar, listening, reading })) {
  const name = `${file}.json`;
  try {
    validate(JSON.parse(await readFile(new URL(name, dataDirectory), 'utf8')));
  } catch (error) {
    issues.push(`${name}: ${error.message}`);
  }
}
for (const target of levels) expect(presentLevels.has(target), '题库', `未包含 ${target} 级练习`);
reportDistributions();
if (issues.length) {
  console.error(issues.join('\n'));
  process.exitCode = 1;
} else {
  console.log(Object.entries(counts).map(([name, n]) => `${name} ${n}`).join(' · '));
  console.log(`五份题库通过校验，含 ${seenIds.size} 个唯一 ID。`);
}
