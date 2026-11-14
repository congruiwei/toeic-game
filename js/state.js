import {validDiagnosis,reconcileDiagnosis,diagnosedDifficulty,diagnosisPractice} from './diagnosis.js';
import {validateScreen} from './screening.js';
import {validIssues} from './question-tools.js';
import {validReport} from './report.js';
import {examValid} from './exam.js';
export const KEY = 'sprout-isle.save',
  VERSION = 2;
export const skills = ['vocab', 'grammar', 'listening', 'reading'];
export const labels = { vocab: '单词', grammar: '语法', listening: '听力', reading: '阅读' };
export const forms = ['芽团', '双叶芽', '蕨羽灵', '铃花灵', '云冠灵', '星冠灵'];
export const thresholds = [0, 36, 90, 165, 260, 380];
export function fresh() {
  return {
    version: VERSION,
    stats: { vocab: 0, grammar: 0, listening: 0, reading: 0 },
    xp: 0,
    stage: 0,
    branch: 'vocab',
    history: [],
    words: {},
    errors: {},
    seen: {},
    session: null,
    lastVisit: 0,
    settings: { theme: 'auto', motion: true, sound: true, rate: 1, accent: 'auto', timed: false },
  };
}
const record = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const number = (x, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(x) && x >= 0 && x <= max;
const safeKey = (x) =>
  typeof x === 'string' &&
  /^[a-zA-Z0-9_-]{1,100}$/.test(x) &&
  !['__proto__', 'constructor', 'prototype'].includes(x);
function mapOk(m, fn) {
  return record(m) && Object.entries(m).every(([k, v]) => safeKey(k) && fn(v));
}
export function decode(raw, catalog) {
  const x = JSON.parse(raw);
  // Version 1 stored every missed answer together. Its existing verdicts stay intact.
  if (record(x) && x.version === 1) x.version = 2;
  if (!record(x) || x.version !== VERSION) throw Error('存档版本无法识别');
  if (
    !number(x.xp) ||
    !number(x.stage, 5) ||
    !skills.includes(x.branch) ||
    !record(x.stats) ||
    !skills.every((k) => number(x.stats[k])) ||
    !number(x.lastVisit)
  )
    throw Error('角色记录不完整');
  if (
    !Array.isArray(x.history) ||
    x.history.length > 120 ||
    !x.history.every(
      (h) =>
        record(h) &&
        skills.includes(h.skill) &&
        [400, 500, 600, 700, 800, 900].includes(h.level) &&
        typeof h.ok === 'boolean',
    )
  )
    throw Error('答题历史有误');
  if (
    !mapOk(
      x.words,
      (v) => record(v) && number(v.box, 5) && number(v.due) && number(v.right) && number(v.tries),
    ) ||
    !mapOk(x.seen, (v) => number(v)) ||
    !mapOk(
      x.errors,
      (v) =>
        record(v) &&
        number(v.misses) &&
        number(v.at) &&
        record(v.ref) &&
        safeKey(v.ref.id) &&
        safeKey(v.ref.mode),
    )
  )
    throw Error('复习记录有误');
  if (
    !record(x.settings) ||
    !['auto', 'light', 'dark'].includes(x.settings.theme) ||
    !['auto', 'en-US', 'en-GB', 'en-AU','en-CA'].includes(x.settings.accent) ||
    (x.settings.voiceSlots !== undefined && (!record(x.settings.voiceSlots) || !Object.entries(x.settings.voiceSlots).every(([k,v])=>['A','B','C'].includes(k)&&typeof v==='string'&&v.length<1000))) ||
    !Number.isFinite(x.settings.rate) ||
    x.settings.rate < 0.75 ||
    x.settings.rate > 1.2 ||
    !['sound', 'motion', 'timed'].every((k) => typeof x.settings[k] === 'boolean')
  )
    throw Error('设置值有误');
  if (x.session !== null) {
    const s = x.session;
    if (
      !record(s) ||
      !safeKey(s.mode) ||
      typeof s.title !== 'string' ||
      !Array.isArray(s.items) ||
      !s.items.length ||
      s.items.length > 30 ||
      !s.items.every(
        (r) => record(r) && safeKey(r.id) && safeKey(r.mode) && (!r.format || safeKey(r.format)),
      ) ||
      !number(s.index, s.items.length) ||
      !number(s.retiredAnswered ?? 0, 30 - s.items.length) ||
      !number(s.right, s.items.length + (s.retiredAnswered ?? 0)) ||
      !number(s.gain) ||
      !number(s.elapsed) ||
      !(s.selected === null || typeof s.selected === 'string') ||
      typeof s.intro !== 'boolean' ||
      typeof s.timed !== 'boolean'
    )
      throw Error('练习进度有误');
  }
  validateScreen(x,catalog);
  if(!validDiagnosis(x.diagnosis))throw Error('诊断记录有误');
  if(catalog)reconcileDiagnosis(x,catalog);
  if(!validIssues(x.issues))throw Error('问题报告记录有误');
  if(!validReport(x.report))throw Error('学习报告记录有误');
  if(x.examForms!==undefined && (!Array.isArray(x.examForms)||x.examForms.length!==4||!x.examForms.every(n=>number(n))))throw Error('模考记录有误');
  if(x.exam) {
    if(!examValid(x.exam))throw Error('模考试卷记录无效');
    // A retired exam item should not make a player's whole backup unusable.
    if(catalog && x.exam.units.some(unit=>unit.ids.some(id=>!catalog.has(id)))) x.exam=null;
    else if(catalog && !examValid(x.exam,catalog))throw Error('模考试卷题型与题库不符');
  }
  if (catalog) reconcileBank(x, catalog);
  return x;
}

// Resolve persisted IDs after the current bank is loaded. An absent ID is a retired question.
function reconcileBank(state, catalog) {
  function available(ref) {
    const current = catalog.get(ref.id);
    if (current && current.ref.mode !== ref.mode) throw Error('题目模式与存档不符');
    return Boolean(current);
  }
  for (const [id, err] of Object.entries(state.errors)) {
    if (id !== err.ref.id) throw Error('错题引用不一致');
    if (!available(err.ref)) delete state.errors[id];
  }
  for (const id of Object.keys(state.words)) {
    if (catalog.get(id)?.ref.mode !== 'vocab') delete state.words[id];
  }
  for (const id of Object.keys(state.seen)) {
    if (!catalog.has(id)) delete state.seen[id];
  }

  const run = state.session;
  if (!run) return;
  const previous = run.items;
  const current = previous[run.index];
  const item = current && catalog.get(current.id)?.data;
  if (run.selected !== null && item?.options && !item.options.includes(run.selected)) {
    // Older insertion exercises displayed "At [3]" instead of "[3]".
    const mark = /^At (\[[1-4]\])$/.exec(run.selected)?.[1];
    const last = state.history.at(-1);
    if (item.kind === 'insertion' && item.options.includes(mark)) run.selected = mark;
    else if (last?.ok && last.level === item.level &&
      last.skill === ({grammar:'grammar', reading:'reading', part2:'listening', dialogue:'listening'})[current.mode]) {
      // An active answered item is the most recent answer. Keep its earned verdict if its wording changed.
      run.selected = item.answer;
    }
  }
  const kept = previous.filter(available);
  if (!kept.length) {
    state.session = null;
    return;
  }
  if (kept.length === previous.length) return;
  const keptBefore = previous.slice(0, run.index).filter(available).length;
  const lostCurrent = current && !available(current);
  const retiredAnswered = run.index - keptBefore + Number(Boolean(lostCurrent && run.selected !== null));
  if (retiredAnswered) run.retiredAnswered = (run.retiredAnswered || 0) + retiredAnswered;
  run.items = kept;
  run.index = keptBefore;
  if (lostCurrent) {
    run.selected = null;
    run.intro = kept[keptBefore]?.mode === 'grammar';
  }
}
export function estimate(s) {
  const recent = s.history.slice(-32);
  if (!recent.length) return 400;
  const weight = recent.reduce((a, h, i) => a + (i + 1), 0);
  const value =
    recent.reduce((a, h, i) => a + (i + 1) * (h.level + (h.ok ? 145 : -175)), 0) / weight;
  const confidence = Math.min(1, recent.length / 8);
  return Math.max(400, Math.min(900, Math.round((400 + (value - 400) * confidence) / 5) * 5));
}
export function difficulty(s, skill) {
  const recent = s.history.filter((h) => h.skill === skill).slice(-12);
  const placement=diagnosedDifficulty(s,skill,recent);
  if(placement!==null)return placement;
  if (recent.length < 4) return 400;
  const base = recent.reduce((a, h) => a + h.level, 0) / recent.length;
  const acc = recent.filter((h) => h.ok).length / recent.length;
  return Math.max(
    400,
    Math.min(900, 100 * Math.round(base / 100) + (acc >= 0.75 ? 100 : acc < 0.45 ? -100 : 0)),
  );
}
export const levelOf = (xp) => 1 + Math.floor(xp / 100);
export const titleOf = (xp) =>
  ['初遇旅人', '词卡收藏家', '林间探索者', '浮岛领航员', '星海学者'][
    Math.min(4, Math.floor(xp / 400))
  ];
export function reward(s, q, ref, ok, now = Date.now(), {screenCheck=false}={}) {
  const xp = ok ? 12 : 4,
    oldLv = levelOf(s.xp),
    oldStage = s.stage;
  diagnosisPractice(s,q.skill);
  s.xp += xp;
  s.stats[q.skill] += xp;
  s.history.push({ skill: q.skill, level: q.level, ok });
  s.history = s.history.slice(-120);
  s.seen[q.id] = (s.seen[q.id] || 0) + 1;
  if (ok) delete s.errors[q.id];
  else s.errors[q.id] = { misses: (s.errors[q.id]?.misses || 0) + 1, at: now, ref: { ...ref } };
  if (q.skill === 'vocab') {
    if(!screenCheck && ok && s.screening?.marks[q.id]) s.screening.marks[q.id]='studied';
    const w = s.words[q.id] || { box: 0, due: 0, right: 0, tries: 0 };
    w.box = ok ? Math.min(w.box + 1, 5) : 0;
    w.right += Number(ok);
    w.tries++;
    w.due =
      now + [2 * 60000, 86400000, 3 * 86400000, 7 * 86400000, 14 * 86400000, 30 * 86400000][w.box];
    s.words[q.id] = w;
  }
  const score = estimate(s);
  if (
    s.stage < 5 &&
    score >= 500 + s.stage * 100 &&
    skills.every((k) => s.stats[k] >= thresholds[s.stage + 1])
  )
    s.stage++;
  if (s.stage > oldStage)
    s.branch = skills.reduce((a, k) => (s.stats[k] > s.stats[a] ? k : a), skills[0]);
  return { xp, evolved: s.stage > oldStage, leveled: levelOf(s.xp) > oldLv };
}
