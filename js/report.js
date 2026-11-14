const LEVELS = [400, 500, 600, 700, 800, 900];
const CATEGORIES = ['1', '2', '3', '4', '5', '6', '7', 'vocab', 'dictation'];
const PART_NAMES = ['照片描述', '问答', '对话', '独白', '句子填空', '短文填空', '阅读理解'];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
const count = n => Number.isSafeInteger(n) && n >= 0;
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const counter = () => ({total: 0, right: 0});
const newReport = () => ({version: 1, parts: {}, topics: {}, days: {}});
const safeId = key => /^[a-zA-Z0-9_-]{1,100}$/.test(key)
  && !Object.hasOwn(Object.prototype, key) && key !== 'prototype';

function dateKey(date) {
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return y + '-' + m + '-' + String(date.getDate()).padStart(2, '0');
}
function dayAt(date, delta) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + delta);
  return dateKey(copy);
}
function validDay(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const date = new Date(key + 'T12:00:00');
  return Number.isFinite(date.getTime()) && dateKey(date) === key;
}
function validCounters(map, keyCheck) {
  return object(map) && Object.entries(map).every(([key, c]) =>
    keyCheck(key) && object(c) && count(c.total) && count(c.right) && count(c.unknown ?? 0) && c.right + (c.unknown ?? 0) <= c.total);
}
export function validReport(report) {
  if (report === undefined) return true;
  if (!object(report) || report.version !== 1
      || !validCounters(report.parts, key => CATEGORIES.includes(key))
      || !validCounters(report.topics, safeId) || !object(report.days)) return false;
  const days = Object.entries(report.days);
  if (days.length > 370 || !days.every(([key, n]) => validDay(key) && count(n))) return false;
  const total = Object.values(report.parts).reduce((sum, c) => sum + c.total, 0);
  const dated = days.reduce((sum, [, n]) => sum + n, 0);
  const topics = Object.values(report.topics);
  const grammar = report.parts[5] || counter();
  return count(total) && dated <= total
    && topics.reduce((sum, c) => sum + c.total, 0) <= grammar.total
    && topics.reduce((sum, c) => sum + c.right, 0) <= grammar.right;
}
function category(ref, data) {
  if (ref.mode === 'vocab' || ref.mode === 'dictation') return ref.mode;
  const fixed = {part1: 1, photo: 1, part2: 2, grammar: 5};
  const part = Number(fixed[ref.mode] ?? data.set?.part ?? data.part ?? ref.part);
  if (part >= 1 && part <= 7 && Number.isInteger(part)) return String(part);
  throw Error('学习报告遇到未知题型');
}
function add(map, key, ok, outcome) {
  const c = map[key] ??= counter();
  c.total++;
  c.right += Number(ok);
  if (outcome === 'unknown' && !ok) c.unknown = (c.unknown || 0) + 1;
}

// Call once for each newly committed practice/exam verdict.
export function recordStudy(state, ref, data, ok, now = Date.now(), outcome) {
  const day = new Date(now);
  if (!Number.isFinite(day.getTime()) || typeof ok !== 'boolean') throw Error('作答记录无效');
  const part = category(ref, data);
  const report = state.report ??= newReport();
  add(report.parts, part, ok, outcome);
  const topic = data.topic?.id ?? data.topicId ?? ref.topicId;
  if (part === '5' && typeof topic === 'string' && safeId(topic)) add(report.topics, topic, ok, outcome);
  const key = dateKey(day);
  report.days[key] = (report.days[key] || 0) + 1;
  // Use the newest recorded local date when the device clock or time zone moves back.
  const keys = Object.keys(report.days).sort();
  const latest = new Date(keys[keys.length - 1] + 'T12:00:00');
  const first = dayAt(latest, -369);
  for (const k of keys) if (k < first) delete report.days[k];
}
function groupIds(bank) {
  const ids = new Map();
  for (const w of bank.vocab || []) ids.set(w.id, {part:'vocab'});
  for (const q of bank.part1 || []) ids.set(q.id, {part:'1'});
  for (const q of bank.part2 || []) ids.set(q.id, {part:'2'});
  for (const t of bank.grammar || [])
    for (const q of t.questions) ids.set(q.id, {part:'5', topic:t.id});
  for (const set of [...(bank.listening || []), ...(bank.reading || [])]) {
    for (const q of set.questions) ids.set(q.id, {part:String(set.part)});
    if (set.dictation) ids.set(set.dictation.id, {part:'dictation'});
  }
  return ids;
}
function metric(map, key, seen, oldRight) {
  const kept = map[key] || counter();
  const attempts = Math.max(seen, kept.total);
  if (attempts > kept.total && Number.isSafeInteger(oldRight) && oldRight >= kept.right && oldRight <= attempts)
    return {attempts, right:oldRight, measured:attempts, unknown:kept.unknown || 0};
  return {attempts, right:kept.right, measured:kept.total, unknown:kept.unknown || 0};
}
function rate(row) {
  return row.measured ? Math.round(100 * row.right / row.measured) + '%' : '—';
}
const modeFor = p => ['part1','part2','dialogue','dialogue','grammar','reading','reading'][Number(p)-1];
function rowView(row) {
  const label = row.measured < row.attempts
    ? '有判定 ' + row.right + '/' + row.measured + ' · 共 ' + row.attempts + ' 题次'
    : row.right + ' 对 / ' + row.attempts + ' 题次';
  return '<li><div><b>' + escape(row.name) + '</b><small>' + label + ' · 答错 ' + (row.measured - row.right - row.unknown) + ' · 不知道 ' + row.unknown + '</small></div><strong>' + rate(row) + '</strong></li>';
}
function recent(report, start, end) {
  return Object.entries(report.days).reduce((sum, [d,n]) => sum + (d >= start && d <= end ? n : 0), 0);
}

export function reportView(state, bank, now = Date.now()) {
  const report = state.report || newReport();
  const labels = groupIds(bank), seen = {}, topicSeen = {}, skillSeen = {};
  for (const [id, n] of Object.entries(state.seen || {})) {
    const item = labels.get(id);
    if (!item) continue;
    seen[item.part] = (seen[item.part] || 0) + n;
    if (item.topic) topicSeen[item.topic] = (topicSeen[item.topic] || 0) + n;
    const skill = item.part === '5' ? 'grammar' : ['6','7'].includes(item.part) ? 'reading'
      : item.part === 'vocab' ? 'vocab' : 'listening';
    skillSeen[skill] = (skillSeen[skill] || 0) + n;
  }
  // Old history stores only skill, level and correctness. Recover a part's verdicts
  // only when all of that skill's lifetime attempts belong to this one part
  // and every such verdict is still in the retained history.
  function recovered(part) {
    const skill = part === '5' ? 'grammar' : ['6','7'].includes(part) ? 'reading' : 'listening';
    const history = (state.history || []).filter(h => h.skill === skill);
    if (history.length && seen[part] === history.length && seen[part] === skillSeen[skill])
      return history.filter(h => h.ok).length;
  }
  const partRows = PART_NAMES.map((text, i) => {
    const p = String(i+1);
    return {name:'Part '+p+' · '+text, mode:modeFor(p), filter:['3','4','6','7'].includes(p)?p:'',
      available:[...labels.values()].some(v => v.part === p),
      ...metric(report.parts,p,seen[p] || 0,recovered(p))};
  });
  const grammarRows = (bank.grammar || []).map(t => ({
    name:t.title, mode:'grammar', filter:t.id, available:true,
    ...metric(report.topics,t.id,topicSeen[t.id] || 0,
      topicSeen[t.id] && topicSeen[t.id] === seen[5] ? recovered('5') : undefined)
  }));
  let wordTries=0, wordRight=0;
  const levels = new Map(LEVELS.map(level => [level,{total:0, mastered:0}]));
  for (const w of bank.vocab || []) {
    const rec = state.words?.[w.id], band = levels.get(w.level);
    if (band) {band.total++; if (rec?.box >= 3) band.mastered++;}
    if (rec) {wordTries += rec.tries; wordRight += rec.right;}
  }
  const vocab = {name:'词汇',mode:'vocab',filter:'',available:Boolean(bank.vocab?.length),
    ...metric(report.parts,'vocab',wordTries,wordRight)};
  const dictation = {name:'听写',mode:'dictation',filter:'',available:Boolean(bank.listening?.some(g=>g.dictation)),
    ...metric(report.parts,'dictation',seen.dictation || 0)};
  const candidates = [...grammarRows, ...partRows, vocab, dictation].filter(r => r.available && r.measured > 0);
  candidates.sort((a,b) => a.right/a.measured - b.right/b.measured || b.measured-a.measured);
  const recommended=candidates.filter(row=>!(row.mode==='grammar' && !row.filter && grammarRows.some(topic=>topic.measured>0))).slice(0,3);
  const t = new Date(now), today=dateKey(t), week=recent(report,dayAt(t,-6),today), month=recent(report,dayAt(t,-29),today);
  const hasLegacy = [...partRows,vocab,dictation].some(row => row.attempts > 0)
    && Object.values(seen).reduce((sum,n)=>sum+n,0) > Object.values(report.parts).reduce((sum,c)=>sum+c.total,0);
  const mastered = [...levels.values()].reduce((sum,b)=>sum+b.mastered,0);
  return `<div class="study-report"><div class="page-title"><h1>学习报告</h1></div>
    <section class="panel report-volume"><h2>近期练习</h2><div class="report-kpis">
      <div><strong>${week}</strong><span>近 7 天作答</span></div><div><strong>${month}</strong><span>近 30 天作答</span></div><div><strong>${mastered}</strong><span>已掌握词条</span></div>
    </div>${hasLegacy?'<p>旧记录没有作答日期，已知的累计次数仍保留在下方。</p>':''}</section>
    ${recommended.length?`<section class="panel report-recommend"><h2>建议再练</h2>${recommended.map(weak=>`<div class="report-target"><p>${escape(weak.name)} · 正确率 ${rate(weak)}（${weak.right}/${weak.measured}）</p><button type="button" class="secondary" data-act="start" data-mode="${weak.mode}" data-filter="${escape(weak.filter)}">练习${escape(weak.name)}</button></div>`).join('')}</section>`:
      '<section class="panel report-recommend"><h2>从单词开始</h2><p>有了作答记录后，这里会推荐正确率较低的练习。</p><button class="primary" type="button" data-act="start" data-mode="vocab">练习单词</button></section>'}
    <section class="panel"><h2>各部分正确率</h2><ul class="report-rows">${[...partRows,vocab,dictation].map(rowView).join('')}</ul></section>
    <section class="panel"><h2>语法关卡正确率</h2><ul class="report-rows">${grammarRows.map(rowView).join('')}</ul></section>
    <section class="panel"><h2>分级词汇掌握度</h2><p>进入长期复习且记忆稳定度达到 7 天的词卡计为已掌握。</p><ul class="report-rows">${[...levels].map(([level,b])=>`<li><b>${level} 级</b><span>${b.mastered} / ${b.total} 词</span></li>`).join('')}</ul></section></div>`;
}
