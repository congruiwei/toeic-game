// Self-reported familiarity is kept separate from actual answer history.
export function screenedQueue(state) {
  const marks = state.screening?.marks || {};
  return Object.keys(marks).filter(id => ['learn','unconfirmed'].includes(marks[id]));
}
export function beginScreen(state, words, random = Math.random) {
  const screen = state.screening ??= {marks: {}, run: null};
  if (screen.run && (screen.run.feedback || screen.run.index < screen.run.ids.length)) return screen.run;
  const candidates = words.filter(w => !screen.marks[w.id] && !state.words[w.id]?.tries && !state.seen[w.id])
    .map(w => ({word:w, tie:random()}))
    .sort((a,b) => a.word.level-b.word.level || a.tie-b.tie);
  const ids = [], heads = new Set();
  for (const {word} of candidates) {
    if (heads.has(word.word)) continue;
    heads.add(word.word); ids.push(word.id);
    if (ids.length === 20) break;
  }
  if (!ids.length) return null;
  screen.run = {ids, index:0, claims:0, known:0, unknown:0, checks:0, correct:0, pending:false};
  return screen.run;
}
export function selfAssess(state, id, knows) {
  const {run,marks} = state.screening;
  if (!run || run.feedback || run.pending || id !== run.ids[run.index]) return false;
  if (knows && ++run.claims % 3 === 0) {
    run.pending = true;
  } else {
    marks[id] = knows ? 'unconfirmed' : 'learn';
    if (knows) run.known++; else run.unknown++;
    run.index++;
  }
  return true;
}
export function markSpotCheck(state, id, correct) {
  const {run,marks} = state.screening;
  if (!run?.pending || id !== run.ids[run.index]) return false;
  run.pending = false; run.checks++;
  if (correct) {run.correct++; run.known++; marks[id]='verified';}
  else {run.unknown++; marks[id]='learn';}
  run.index++;
  return true;
}
export function validateScreen(state, catalog) {
  const x = state.screening;
  if (x === undefined) return;
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const idOk = id => typeof id === 'string' && /^[\w-]{1,100}$/.test(id) && !Object.hasOwn(Object.prototype,id) && id!=='prototype';
  const counter = n => Number.isInteger(n) && n>=0 && n<=20;
  if (!object(x)||!object(x.marks)||Object.entries(x.marks).some(([k,v])=>!idOk(k)||!['learn','unconfirmed','verified','studied'].includes(v))) throw Error('快筛记录有误');
  const r=x.run;
  if(r!==null) {
    if(r?.feedback && (!object(r.feedback)||typeof r.feedback.selected!=='string'||r.feedback.selected.length>2000||r.feedback.id!==r.ids?.[r.index-1]))throw Error('快筛抽查反馈有误');
    if(!object(r)||!Array.isArray(r.ids)||!r.ids.length||r.ids.length>20||r.ids.some(id=>!idOk(id))||new Set(r.ids).size!==r.ids.length||
      ![r.index,r.claims,r.known,r.unknown,r.checks,r.correct].every(counter)||r.index>r.ids.length||typeof r.pending!=='boolean'||
      r.known+r.unknown!==r.index||r.correct>r.checks||r.claims!==r.known+r.checks-r.correct+Number(r.pending)||
      r.checks+Number(r.pending)!==Math.floor(r.claims/3)||r.pending&&r.index===r.ids.length||
      r.ids.slice(0,r.index).some(id=>!x.marks[id])) throw Error('快筛进度有误');
  }
  if(catalog){
    for(const id of Object.keys(x.marks)) if(catalog.get(id)?.ref.mode!=='vocab') delete x.marks[id];
    if(r?.ids.some(id=>catalog.get(id)?.ref.mode!=='vocab')) x.run=null;
  }
}
