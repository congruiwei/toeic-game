import {predictionView,predictAnswer,predictionSummary} from './prediction.js';
let predictionRange='30',predictionSeries='total';
import {startDiagnosis,skipDiagnosis,answerDiagnosis} from './diagnosis.js';
import {diagnosisHome,diagnosisView,diagnosisHistory,unknownDiagnosisView} from './diagnosis-ui.js';
import {replayView,playLine,stopReplay,stopClosedReplay} from './replay.js';
import {reviewTools,answerText,issueForm,issueSettings,issuesText,reasons,copyText} from './question-tools.js';
import {screenController,screenView} from './screen-view.js';
import {UNKNOWN} from './answers.js';
import {recordStudy,reportView} from './report.js';
import {examController} from './exam-controller.js';
import {examView,examLobby} from './exam-ui.js';
import { practiceView } from './practice.js';
import { libraryView } from './library.js';
import { learnView, configureView } from './training.js';
import { icon } from './icons.js';
import { creature, landscape } from './art.js';
import { tileArt } from './tiles.js';
import {
  KEY,
  fresh,
  decode,
  levelOf,
  titleOf,
  skills,
  labels,
  forms,
  thresholds,
  reward,
} from './state.js';
import { bank, catalog, loadBank, select, question, formats } from './bank.js';
import { hush, speak, tone, voices, quality, voiceKey } from './audio.js';
const $ = (s) => document.querySelector(s),
  root = $('#app'),
  dialog = $('#modal');
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const icons = { vocab: 'cards', grammar: 'grammar', listening: 'headphones', reading: 'reading' };
const navs = [
  ['home', 'island', '小岛'],
  ['learn', 'compass', '练习'],
  ['library', 'cards', '图鉴'],
  ['report','chart','报告'],
];
const names = {
  vocab: '单词采集',
  part2: '听音寻迹',
  part1: '看图听句',
  grammar: '语法工坊',
  dialogue: '情景听力',
  dictation: '听写手记',
  reading: '阅读探访',
  errors: '错题复习',
};
const taskInfo = {
  vocab: ['单词', '收集商务词卡', 'vocab'],
  part2: ['听力', '捕捉问句线索', 'part2'],
  grammar: ['语法', '破解句子结构', 'grammar'],
  reading: ['阅读', '探索文中的线索', 'reading'],
};
let lastRaw = null;
let answerClock = null;
let s = fresh(),
  page = 'home',
  tab = 'words',
  themeFilter = '',
  tasks = [],
  clockStart = 0,
  tick = 0,
  toastTimer = 0,
  returnBonus = false,
  storageBroken = false,
  offlineReady = false;
const exam = examController({
  state:()=>s, page:()=>page, show:go, redraw:render, save, notify:toast,
  onGrade:(ref,data,ok,at)=>{
    recordStudy(s,ref,data,ok,at);
    predictAnswer(s,ref,data,ok,Date.now(),{sourceType:'exam',previouslySeen:Math.max(0,(s.seen[ref.id]||0)-1)});
  },
  confirm:(title,detail,action,label)=>modal(`<h2>${esc(title)}</h2><p>${esc(detail)}</p>${act(action,esc(label),'primary')}`)
});
const screening=screenController({state:()=>s,go,render,save,toast,study:()=>start('vocab','screen-queue')});
root.addEventListener('pointerdown',screening.pointerDown);
root.addEventListener('pointerup',screening.pointerUp);
root.addEventListener('pointercancel',screening.cancel);
function toast(t) {
  const el = dialog.open ? dialog.querySelector('.dialog-notice') || $('#toast') : $('#toast');
  el.textContent = t;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}
function save() {
  if (storageBroken) return false;
  try {
    const current = localStorage.getItem(KEY);
    if (current !== lastRaw && current) {
      const newer = decode(current, allBanks.every(k=>bank[k])?catalog:undefined);
      exam.stop();
      s = newer;
      lastRaw = current;
      clockStart = 0;answerClock=null;
      if (dialog.open) close();
      page = 'home';
      render();
      toast('已同步另一个窗口的进度，请从小岛继续。');
      return false;
    }
    const next = JSON.stringify(s);
    localStorage.setItem(KEY, next);
    lastRaw = next;
    return true;
  } catch {
    toast('当前浏览器未能保存进度，请在设置中导出备份。');
    return false;
  }
}
function applyPrefs() {
  document.documentElement.dataset.theme = s.settings.theme;
  document.documentElement.dataset.motion = s.settings.motion ? 'on' : 'off';
}
function act(id, txt, cls = '', attrs = '') {
  return `<button type="button" class="${cls}" data-act="${id}" ${attrs}>${txt}</button>`;
}
function sectionTitle(ico, name, extra = '') {
  return `<div class="section-head"><h2>${icon(ico, 22)}${name}</h2>${extra}</div>`;
}
function frame() {
  $('#top').innerHTML =
    `<div class="top-inner"><button data-act="nav" data-page="home" class="brand"><img src="./assets/mark.svg" alt="" width="42" height="42"><span>芽语岛<small>TOEIC ISLAND</small></span></button><nav class="desk-nav" aria-label="主导航">${navItems()}</nav><button class="gear" data-act="settings" aria-label="设置">${icon('settings', 21)}</button></div>`;
  $('#mobile-nav').innerHTML = navItems();
}
function navItems() {
  return navs
    .map(([p, i, n]) =>
      act(
        'nav',
        icon(i) + '<span>' + n + '</span>',
        (page === 'practice' ? 'learn' : page) === p ? 'active' : '',
        `data-page="${p}"`,
      ),
    )
    .join('');
}
function go(p) {
  pauseClock();
  hush();
  if(page==='exam'&&p!=='exam')exam.suspend();
  if(dialog.open)close();
  page = p;
  render();
  window.scrollTo(0, 0);
}
function meter(val, max, cl = '') {
  return `<span class="meter ${cl}"><i style="width:${Math.max(0, Math.min(100, (100 * val) / max))}%"></i></span>`;
}
function taskTile(mode) {
  const [label, desc, art] = taskInfo[mode];
  return `<button class="task ${art}" data-act="start" data-mode="${mode}"><div class="task-top"><span class="chip"><i></i>${label}</span>${tileArt(art)}</div><h3>${names[mode]}</h3><p>${desc}</p><div class="task-foot"><span>${icon('clock', 14)}${mode === 'reading' ? '约 5 分钟' : '约 3 分钟'}</span>${icon('arrow', 19)}</div></button>`;
}
function home() {
  const prediction = predictionSummary(s),
    lv = levelOf(s.xp),
    date = new Intl.DateTimeFormat('zh-CN', {
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    }).format(new Date());
  return `<div class="welcome"><div><div class="eyebrow"><i></i> ISLAND DASHBOARD</div><h1>欢迎回到小岛<span class="hello-star">✦</span></h1></div>${s.session && s.session.index < s.session.items.length ? act('resume', '继续学习 ' + icon('play', 13), 'secondary top-resume') : `<small class="date">${icon('sun', 16)}${esc(date)}</small>`}</div>
 ${diagnosisHome(s)}<div class="overview"><section class="habitat">${landscape(s.stage, s.branch)}<div class="hab-text"><span class="hab-tag">${icon('leaf', 14)} 伙伴栖息地</span><h2>${forms[s.stage]}</h2><p>第 ${String(s.stage + 1).padStart(2, '0')} 形态 <b>·</b> ${s.stage ? labels[s.branch] + '特化' : '初生之芽'}</p></div><div class="hab-bottom"><div class="level"><b>Lv. ${String(lv).padStart(2, '0')}</b><span>${titleOf(s.xp)}</span></div>${meter(s.xp % 100, 100)}<div class="xp"><span>成长经验</span><b>${s.xp % 100} / 100 XP</b></div></div>${act('evolution', icon('route', 15) + '<span>进化路线</span>', 'route')}</section>
 <section class="stats panel"><div class="stats-head"><h2>${icon('chart')} 能力面板</h2>${act('evolution', icon('chev', 16), 'soft-round', 'aria-label="查看能力与进化条件"')}</div><div class="score"><div><span>预估 TOEIC 分数</span><strong>${prediction.low}–${prediction.high}<small>分</small></strong></div><small>仅供参考</small></div><div class="skills">${skills.map((k) => `<div class="skill ${k}"><i>${icon(icons[k], 16)}</i><label>${labels[k]}</label>${meter(s.stats[k], thresholds[Math.min(5, s.stage + 1)])}<b>${s.stats[k]}</b></div>`).join('')}</div></section></div>
 <section class="tasks">${sectionTitle('flag', '探索任务', '<span class="section-note">任选一个开始</span>')}<div class="task-grid">${tasks.map(taskTile).join('')}</div></section>
 <div class="continue"><span class="continue-icon">${icon('compass', 27)}</span><div><h3>${s.session ? '上次的探险' : '自由练习'}</h3><p>${s.session ? esc(s.session.title) + ' · ' + Math.min(s.session.index + 1, s.session.items.length) + ' / ' + s.session.items.length : '按主题与题型选择练习'}</p></div>${act(s.session ? 'resume' : 'nav', s.session ? '继续学习 ' + icon('arrow', 16) : '进入练习 ' + icon('arrow', 16), 'primary', 'data-page="learn"')}</div>`;
}
function render() {
  stopReplay();
  applyPrefs();
  frame();
  root.innerHTML =
    page==='diagnosis'?diagnosisView(s):page==='screen'?screenView(s):page==='report'?reportView(s,bank)+predictionView(s,predictionRange,Date.now(),predictionSeries)+diagnosisHistory(s):page==='examLobby'?examLobby(s.exam):page==='exam'&&s.exam?examView(s.exam):page === 'home'
      ? home()
      : page === 'learn'
        ? learnView(s)
        : page === 'library'
          ? libraryView(s, tab, themeFilter)
          : practiceView(s);
  root.setAttribute('aria-busy', 'false');
  if (page === 'practice' || page === 'diagnosis') startClock();
}
function pauseClock(persist=true) {
  const current=page==='diagnosis'?s.diagnosis?.active:s.session;
  if(answerClock!==null && current){
    current.answerMs=(current.answerMs||0)+Math.max(0,Math.round(performance.now()-answerClock));
    answerClock=null;
    if(persist)save();
  }
  if (clockStart && s.session) {
    s.session.elapsed += Math.max(0, Date.now() - clockStart);
    clockStart = 0;
    if(persist)save();
  }
  clearInterval(tick);
}
function startClock() {
  if(page==='diagnosis'){
    if(s.diagnosis?.active && !document.hidden && !dialog.open && answerClock===null)answerClock=performance.now();
    return;
  }
  const a = s.session;
  if(a && !a.intro && a.index<a.items.length && a.selected===null && !document.hidden && !dialog.open && answerClock===null)
    answerClock=performance.now();
  if (
    !a?.timed ||
    a.index >= a.items.length ||
    a.selected !== null ||
    document.hidden ||
    dialog.open
  )
    return;
  if (!clockStart) clockStart = Date.now();
  const update = () => {
    const el = $('#timer');
    if (el) {
      const seconds = Math.floor((a.elapsed + Date.now() - clockStart) / 1000);
      el.textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
    }
  };
  clearInterval(tick);
  update();
  tick = setInterval(update, 500);
}
function modal(content, cls = '') {
  stopReplay();
  pauseClock();
  dialog.className = cls;
  dialog.innerHTML = `<div class="modal-body">${act('close', icon('close', 19), 'modal-close', 'aria-label="关闭"')}${content}<div class="dialog-notice" role="status"></div></div>`;
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}
function close() {
  dialog.close();
}
dialog.addEventListener('close', () => {
  if (page === 'practice' || page==='diagnosis') startClock();
});
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) close();
});
function evolution(evolved = false) {
  modal(
    `<div class="${evolved ? 'ceremony' : 'mini-pet'}"><svg viewBox="-110 -120 220 200" aria-label="${forms[s.stage]}">${creature(s.stage, s.branch)}</svg></div><div class="eyebrow">EVOLUTION</div><h2>${evolved ? '进化成功 · ' + forms[s.stage] : '伙伴进化路线'}</h2><p class="muted">同时达到预估分数与四项能力经验，即可进化。最强的能力决定新形态的特征。</p><div class="stage-list">${forms.map((f, i) => `<div class="${i === s.stage ? 'current' : ''}"><span>${icon(i < s.stage ? 'check' : i === s.stage ? 'sprout' : 'lock', 17)} ${f}</span><small>${400 + i * 100} 分 · 各 ${thresholds[i]} XP</small></div>`).join('')}</div>`,
    evolved ? 'evolved' : '',
  );
}
function accentOptions() {
  const p = s.settings,
    langs = voices();
  return [
    ['auto', '题库轮换'],
    ['en-US', '美式'],
    ['en-GB', '英式'],
    ['en-AU', '澳式'],
    ['en-CA','加拿大式'],
  ]
    .filter(
      ([k]) =>
        k === 'auto' ||
        k === p.accent ||
        langs.some((v) => v.lang.toLowerCase().replace('_', '-') === k.toLowerCase()),
    )
    .map(
      ([k, label]) => `<option value="${k}" ${k === p.accent ? 'selected' : ''}>${label}</option>`,
    )
    .join('');
}
function voiceControls(){
  const list=voices(), slots=s.settings.voiceSlots||{};
  const title=v=>esc(v.name)+' · '+esc(v.lang)+' · '+['普通','增强','高级'][quality(v)];
  return `<h3>声音</h3><label class="setting">英语口音<select data-pref="accent">${accentOptions()}</select></label>
    ${['A','B','C'].map((slot,i)=>`<label class="setting">说话人 ${i+1}<select data-voice-slot="${slot}"><option value="">自动分配</option>${list.map(v=>`<option value="${esc(voiceKey(v))}" ${voiceKey(v)===slots[slot]?'selected':''}>${title(v)}</option>`).join('')}</select></label>`).join('')}
    <details><summary>英语声音与试听（${list.length}）</summary>${list.map(v=>`<div class="setting"><span>${title(v)}</span>${act('preview-voice','试听','secondary','data-voice="'+esc(voiceKey(v))+'"')}</div>`).join('') || '<p class="muted">设备尚未列出英语声音。可先点击测试声音。</p>'}</details>
    ${act('test',icon('sound',16)+' 测试声音','secondary')}
    <p class="fine muted">iPhone 设置 → 辅助功能 → 朗读内容（部分版本为「阅读与朗读」）→ 声音 → 英语。下载标有「增强」或「高级」的声音。返回游戏后，自动分配会优先使用可用的高音质声音。</p>`;
}
function settings() {
  if(page==='exam'&&exam.live){toast('考试中如需调整设置，请先保存离开。');return;}
  const p = s.settings;
  const option = (v, n, c) => `<option value="${v}" ${v === c ? 'selected' : ''}>${n}</option>`;
  modal(`<div class="eyebrow">PREFERENCES</div><h2>小岛设置</h2><label class="setting">外观<select data-pref="theme">${[
    ['auto', '跟随系统'],
    ['light', '浅色'],
    ['dark', '深色'],
  ]
    .map(([v, n]) => option(v, n, p.theme))
    .join('')}</select></label>
 ${[
   ['sound', '答题与进化音效'],
   ['motion', '角色与进化动画'],
   ['timed', '阅读计时'],
 ]
   .map(
     ([v, n]) =>
       `<label class="setting">${n}<input type="checkbox" data-pref="${v}" ${p[v] ? 'checked' : ''}></label>`,
   )
   .join('')}
 <label class="setting">目标记忆率<select data-pref="retention">${[.85,.90,.95].map(r=>option(r,Math.round(100*r)+'%',p.retention??.90)).join('')}</select></label><p class="fine muted">目标记忆率越高，复习越频繁。</p>
 <label class="setting">朗读速度 <span><output id="rate-val">${p.rate}×</output> <input aria-label="朗读速度" type="range" min="0.75" max="1.2" step="0.05" value="${p.rate}" data-pref="rate"></span></label>
 <section id="voice-controls">${voiceControls()}</section><p id="offline-status" class="fine muted">${offlineReady ? '离线题库已就绪' : '离线题库尚未就绪，请保持联网'}</p>${issueSettings(s.issues)}<div class="backup"><h3>进度备份</h3>${act('export', '导出进度', 'secondary')} ${act('import', '导入进度', 'secondary')}<input type="file" accept=".json,application/json" id="import-file" hidden></div>`);
}
let pending = null;
function markVisit() {
  const now = Date.now();
  returnBonus = s.lastVisit > 0 && now - s.lastVisit >= 6 * 3600000;
  if (returnBonus) s.xp += 8;
  s.lastVisit = now;
  if (save() && returnBonus) toast('欢迎回来！获得 8 XP');
}
function start(mode, filter = '', only = '', force = false, format = '') {
  if (s.session && s.session.index < s.session.items.length && !force) {
    pending = { mode, filter, only, format };
    modal(
      `<h2>切换这次练习？</h2><p>「${esc(s.session.title)}」还有未答题目。已经获得的经验和词卡都会保留。</p>${act('resume', '继续上次练习', 'secondary')} ${act('replace', '开始所选练习', 'primary')}`,
    );
    return;
  }
  let items = only
    ? [s.errors[only]?.ref].filter(Boolean)
    : select(s, mode, 5, formats.includes(filter) ? '' : filter);
  if (mode === 'vocab' && formats.includes(format || filter))
    items = items.map((r) => ({ ...r, format: format || filter }));
  if (!items.length) {
    toast('这里暂时没有待复习的题目');
    return;
  }
  pauseClock();
  if (dialog.open) close();
  s.session = {
    mode,
    title: names[mode],
    items,
    index: 0,
    right: 0,
    gain: 0,
    selected: null,
    elapsed: 0,
    timed: mode === 'reading' && s.settings.timed,
    intro: items[0].mode === 'grammar',
  };
  save();
  go('practice');
}
function answer(value) {
  const a = s.session;
  if (!a || a.selected !== null || a.index >= a.items.length) return;
  const r = a.items[a.index],
    q = question(r);
  if (!value?.trim()) {
    toast('先填入一个单词');
    return;
  }
  hush();
  pauseClock(false);
  const ok = value.trim().toLowerCase() === q.answer.trim().toLowerCase(),
    result = reward(s,q,r,ok,Date.now(),{activeMs:a.answerMs||0});
  recordStudy(s,r,q,ok,Date.now(),value === UNKNOWN ? 'unknown' : undefined);
  a.selected = ok ? q.answer : value;
  a.right += Number(ok);
  a.gain += result.xp;
  if (!save() && page !== 'practice') return;
  render();
  const feedback = root.querySelector('.lesson-feedback');
  if (feedback) {
    if (ok) feedback.classList.add('answer-celebrate');
    feedback.scrollIntoView({
      behavior:
        s.settings.motion && !matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'smooth'
          : 'instant',
      block: 'nearest',
    });
  }
  if (value !== UNKNOWN && (ok || result.leveled || result.evolved))
    tone(result.evolved ? 'evolve' : result.leveled ? 'level' : 'correct', s.settings.sound);
  if (result.evolved) evolution(true);
  else if (result.leveled) {
    toast('升级啦！Lv. ' + levelOf(s.xp));
    $('#toast').classList.remove('level-pop');
    void $('#toast').offsetWidth;
    $('#toast').classList.add('level-pop');
  }
}
let diagFeedback=null;
function reviewedAnswer(id) {
  let ref, selected, correct;
  if(page==='practice' && s.session?.selected!=null) {
    ref=s.session.items[s.session.index];selected=s.session.selected;
  } else if(page==='diagnosis' && dialog.open && diagFeedback) {
    ({ref,selected}=diagFeedback);
  } else if(page==='screen' && s.screening?.run?.feedback) {
    const check=s.screening.run.feedback;
    ref={id:check.id,mode:'vocab',format:'meaning'};selected=check.selected;
  } else if(page==='exam' && s.exam?.phase==='done' && Object.hasOwn(s.exam.keys,id)) {
    ref=catalog.get(id)?.ref;selected=s.exam.answers[id];correct=s.exam.keys[id];
  }
  return ref && ref.id===id ? answerText(ref,question(ref),selected,correct) : null;
}
function exportSave() {
  const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' }),
    url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = 'toeic-island-save.json';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function refreshVoices(){const group=dialog.querySelector('#voice-controls');if(dialog.open && group)group.innerHTML=voiceControls();}
window.speechSynthesis?.addEventListener?.('voiceschanged',refreshVoices);
window.addEventListener('focus',refreshVoices);
document.addEventListener('keydown', (e) => {
  if (
    e.key === 'Enter' &&
    e.target.id === 'dict-input' &&
    !e.isComposing &&
    s.session?.selected === null
  ) {
    e.preventDefault();
    answer(e.target.value);
  }
});
let incoming = null;
document.addEventListener('change', async (e) => {
  const el = e.target,
    k = el.dataset.pref;
  if(el.dataset.voiceSlot){s.settings.voiceSlots ||= {};s.settings.voiceSlots[el.dataset.voiceSlot]=el.value;save();return;}
  if(el.id==='exam-jump'){exam.jump(Number(el.value));return;}
  if (k) {
    s.settings[k] =
      el.type === 'checkbox' ? el.checked : ['rate','retention'].includes(k) ? Number(el.value) : el.value;
    save();
    applyPrefs();
    if (k === 'rate') $('#rate-val').textContent = el.value + '×';
    return;
  }
  if (el.id === 'library-theme') {
    themeFilter = el.value;
    render();
    return;
  }
  if (el.id === 'import-file' && el.files[0]) {
    try {
      if (el.files[0].size > 5e6) throw Error('文件过大');
      const candidate = decode(await el.files[0].text(), catalog);
      incoming = candidate;
      modal(
        `<h2>恢复这份进度？</h2><p>备份中的伙伴是「${forms[incoming.stage]}」，共有 ${incoming.xp} XP。恢复后会替换当前设备的进度。</p>${act('restore', '恢复备份', 'primary')}`,
      );
    } catch (err) {
      toast('无法导入：' + err.message);
    }
    el.value = '';
  }
});
document.addEventListener('input', (e) => {
  if (e.target.dataset.pref === 'rate') $('#rate-val').textContent = e.target.value + '×';
});
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const { act: a, mode, page: p, i, filter, id } = el.dataset;
  const needed=requiredBanks(a,el).filter(k=>!bank[k]);
  if(needed.length){
    el.disabled=true;el.setAttribute('aria-busy','true');
    try{await loadBank(needed);}catch{toast('题库未能打开，请检查连接后再试。');return;}
    finally{el.disabled=false;el.removeAttribute('aria-busy');}
    if(!el.isConnected)return;
  }
  if(a==='pred-range' || a==='pred-series'){
    if(a==='pred-range')predictionRange=el.dataset.range;else predictionSeries=el.dataset.series;
    render();$('#prediction')?.scrollIntoView({block:'start'});return;
  }
  if(a==='diag-skip'){skipDiagnosis(s);save();render();return;}
  if(a==='diag-open'){startDiagnosis(s,catalog);if(save())go('diagnosis');return;}
  if(a==='diag-leave'){go('home');return;}
  if(a==='diag-audio'&&page==='diagnosis'&&s.diagnosis?.active){
    const r=s.diagnosis.active.current,q=question(r);speak(q.turns,s.settings,toast,{seed:q.set?.id||r.id});return;
  }
  if(a==='diag-dismiss'){close();return;}
  if((a==='diag-answer'||a==='diag-unknown')&&page==='diagnosis'){
    const r=s.diagnosis?.active?.current;if(!r||r.id!==id)return;
    const q=question(r),unknown=a==='diag-unknown',choice=q.options[Number(i)];if(!unknown&&!choice)return;
    hush();
    const ok=!unknown && choice===q.answer, now=Date.now();
    pauseClock(false);
    reward(s,q,r,ok,now,{sourceType:'diagnosis',activeMs:s.diagnosis.active.answerMs||0});
    s.diagnosis.active.answerMs=0;
    recordStudy(s,r,q,ok,now,unknown?'unknown':undefined);
    answerDiagnosis(s,id,ok,catalog,now,unknown);
    diagFeedback=unknown?{ref:r,selected:UNKNOWN}:null;
    if(save()){render();window.scrollTo(0,0);if(unknown)modal(unknownDiagnosisView(r,q)+replayView(q,r)+reviewTools(id));}return;
  }
  if(a==='sentence-play'){
    const id=el.closest('[data-replay-id]')?.dataset.replayId;
    const session=s.session, ref=catalog.get(id)?.ref;
    const practiceAllowed=page==='practice' && session?.selected!=null && session.items[session.index]?.id===id;
    const examAllowed=page==='exam' && s.exam?.phase==='done' && s.exam.units.some(unit=>unit.ids.includes(id));
    if(ref && (practiceAllowed || examAllowed || (page==='diagnosis' && dialog.open && diagFeedback?.ref.id===id))) playLine(el,question(ref),ref,s.settings,toast);
    return;
  }
  stopReplay();
  if(a==='copy-claude') {
    const text=reviewedAnswer(id);
    if(text)await copyText(text+'\n\n请用中文解释为什么选这个答案，以及我错在哪里。',modal,toast,'已复制，可粘贴给 Claude');
  }
  if(a==='report-issue' && reviewedAnswer(id)) modal(issueForm(id));
  if(a==='save-issue') {
    const text=reviewedAnswer(id),reason=$('#issue-reason')?.value;
    if(text && reasons.includes(reason)) {
      (s.issues??=[]).push({id,reason,note:$('#issue-note').value.trim(),text});
      if(save()){close();toast('已保存问题报告');}
    }
  }
  if(a==='copy-issues' && s.issues?.length) await copyText(issuesText(s.issues),modal,toast,'已复制全部问题报告');
  if(a==='clear-issues') modal('<h2>清空本机的问题报告？</h2><p>共 '+(s.issues?.length||0)+' 条。已复制的内容和练习进度会保留。</p>'+act('confirm-clear-issues','清空报告','primary'));
  if(a==='confirm-clear-issues'){s.issues=[];if(save()){settings();toast('已清空报告');}}
  if(a.startsWith('screen-')){screening.action(a,el);return;}
  if(a.startsWith('exam-')){exam.action(a,el);return;}
  if (a === 'nav') {
    if (dialog.open) close();
    go(p);
  }
  if (a === 'configure') modal(configureView(mode, s));
  if (a === 'configured') {
    const f = $('#mode-filter')?.value || '',
      format = $('#vocab-format')?.value || '';
    if ($('#run-timed')) {
      s.settings.timed = $('#run-timed').checked;
      save();
    }
    start(mode, f, '', false, format);
  }
  if (a === 'library-tab') {
    tab = el.dataset.tab;
    render();
  }
  if (a === 'resume') {
    if (dialog.open) close();
    go('practice');
  }
  if (a === 'replace' && pending) {
    const x = pending;
    pending = null;
    start(x.mode, x.filter, x.only, true, x.format);
  }
  if (a === 'home' || a === 'leave') {
    if (s.session?.index >= s.session?.items.length) {
      s.session = null;
      save();
    }
    go('home');
  }
  if (a === 'start') start(mode, filter);
  if (a === 'review-one') start('errors', '', id);
  if (a === 'settings') settings();
  if (a === 'evolution') evolution();
  if (a === 'close') close();
  if (a === 'begin') {
    s.session.intro = false;
    save();
    render();
    window.scrollTo(0, 0);
  }
  if (['answer', 'unknown', 'submit-dict', 'play', 'listen-choice'].includes(a)) {
    const ref = s.session?.items[s.session.index];
    if (!ref) return;
    const q = question(ref);
    if (a === 'unknown' && q.options?.length && page === 'practice') answer(UNKNOWN);
    if (a === 'answer') answer(q.options[Number(i)]);
    if (a === 'submit-dict') answer($('#dict-input').value);
    if (a === 'play' || a === 'listen-choice') {
      speak(
        a === 'play' ? q.turns : [{ text: q.options[Number(i)], speaker: 'B' }],
        s.settings,
        toast, {seed:q.set?.id || q.id},
      );
      if (a === 'play') {
        el.setAttribute('aria-label', '重新播放');
        const label = el.querySelector('[data-play-label]');
        if (label) label.textContent = '再听一次';
      }
    }
  }
  if (a === 'next' && s.session.selected !== null) {
    hush();
    const b = s.session;
    b.index++;
    b.answerMs=0;
    b.selected = null;
    const next = b.items[b.index];
    b.intro =
      !!next &&
      next.mode === 'grammar' &&
      catalog.get(next.id).data.topic.id !== catalog.get(b.items[b.index - 1].id).data.topic?.id;
    save();
    render();
    window.scrollTo(0, 0);
  }
  if(a==='preview-voice')speak([{text:'The next train leaves at nine thirty.',speaker:'A'}],s.settings,toast,{preview:el.dataset.voice});
  if (a === 'test')
    speak(
      [{ text: 'Welcome to Sprout Island. Your sound is ready.', speaker: 'A' }],
      s.settings,
      toast,
    );
  if (a === 'export') exportSave();
  if (a === 'import') $('#import-file').click();
  if (a === 'restore' && incoming) {
    pauseClock();
    answerClock=null;
    s = incoming;
    incoming = null;
    storageBroken = false;
    save();
    close();
    go('home');
    toast('已恢复进度');
  }
});
document.addEventListener('visibilitychange', () => {
  if (root.getAttribute('aria-busy') === 'true') return;
  if (document.hidden) {
  stopReplay();
    if(page==='exam'&&exam.live){exam.suspend();page='examLobby';render();}
    pauseClock();
    hush();
    s.lastVisit = Date.now();
    save();
  } else {
    markVisit();
    if (page === 'practice') startClock();
    else render();
  }
});
window.addEventListener('storage', async (e) => {
  if (e.key !== KEY || !e.newValue || e.newValue === lastRaw) return;
  try {
    await loadBank(allBanks);
    if(localStorage.getItem(KEY)!==e.newValue)return;
    const updated = decode(e.newValue, catalog);
    lastRaw = e.newValue;
    exam.stop();
    if(page==='exam')page='examLobby';
    s = updated;
    clockStart = 0;answerClock=null;
    clearInterval(tick);
    hush();
    if (dialog.open) close();
    if (page === 'practice' && !s.session) page = 'home';
    render();
  } catch {}
});
document.addEventListener('toggle', e=>stopClosedReplay(e.target), true);
window.addEventListener('pagehide',()=>{stopReplay();if(exam.live){exam.suspend();page='examLobby';render();}pauseClock();});
const allBanks=['vocab','part1','part2','grammar','listening','reading'];
const routeFiles={vocab:'vocab',part1:'part1',part2:'part2',grammar:'grammar',dictation:'listening',dialogue:'listening',reading:'reading'};
function requiredBanks(action,el){
  if(action==='diag-open')return allBanks;
  if(action.startsWith('screen-'))return ['vocab'];
  if(action==='nav' && ['library','report'].includes(el.dataset.page) || action==='import' || action==='resume' || action==='exam-start' || action==='exam-lobby')return allBanks;
  if(['start','configure','configured'].includes(action))return routeFiles[el.dataset.mode]?[routeFiles[el.dataset.mode]]:allBanks;
  return [];
}
async function boot() {
  try {
    const raw=localStorage.getItem(KEY);
    if(raw){
      // Restoring retired IDs needs a complete catalog; a new island can render immediately.
      await loadBank(allBanks);
      lastRaw=localStorage.getItem(KEY);
      if(lastRaw)s=decode(lastRaw,catalog);
    }
  } catch(error) {
    if(allBanks.some(k=>!bank[k])) {
      root.innerHTML='<h2>进度尚未载入</h2><p>请检查连接后重新打开，以恢复已保存的练习。</p>';
      return;
    }
    storageBroken=true;s=fresh();toast('原存档读取失败，已保留原始记录。可从设置导入备份。');
  }
  markVisit();
  tasks = ['vocab', 'part2', s.history.length && Math.random() < 0.5 ? 'reading' : 'grammar'];
  render();
  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator)
    navigator.serviceWorker
      .register('./sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then(() => {
        offlineReady = true;
        const status = $('#offline-status');
        if (status) status.textContent = '离线题库已就绪';
      })
      .catch(() => toast('离线资源未就绪，请联网后重开。'));
}
boot();
