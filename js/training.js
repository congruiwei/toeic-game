import { icon } from './icons.js';
import { tileArt } from './tiles.js';
import { bank } from './bank.js';
import { difficulty } from './state.js';
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const routes = [
  ['vocab', 'vocab', '单词采集', '商务词卡 · 间隔复习'],
  ['part1','reading','看图听句','Part 1 · 看原创插画，听四句描述'],
  ['part2', 'part2', '听音寻迹', 'Part 2 · 首词与情景回应'],
  ['grammar', 'grammar', '语法工坊', 'Part 5 · 图解与句子填空'],
  ['dialogue', 'part2', '情景听力', 'Part 3 / 4 · 对话与独白'],
  ['reading', 'reading', '阅读探访', 'Part 6 / 7 · 单篇与多篇'],
  ['dictation', 'part2', '听写手记', '听原句 · 补全单词'],
];
export function learnView(state) {
  return `<div class="page-title"><div class="eyebrow"><i></i> TRAINING MAP</div><h1>练习地图</h1></div><div class="learn-grid"><button class="learn-card panel" data-act="exam-lobby">${tileArt('reading')}<strong>模拟考试<small>完整 200 题 · 半套 100 题</small></strong>${icon('chev',17)}</button>${routes.map(([mode, art, name, detail]) => `<button class="learn-card panel" data-act="configure" data-mode="${mode}">${tileArt(art)}<strong>${name}<small>${detail}</small></strong>${icon('chev', 17)}</button>`).join('')}</div>${state.session && state.session.index < state.session.items.length ? '<button class="primary resume-training" data-act="resume">继续上次练习 ' + icon('arrow', 16) + '</button>' : ''}`;
}
function field(id, label, values) {
  return `<label class="setting">${label}<select id="${id}">${values.map(([k, title]) => `<option value="${esc(k)}">${esc(title)}</option>`).join('')}</select></label>`;
}
export function configureView(mode, state) {
  const route = routes.find((x) => x[0] === mode);
  if (!route) return '';
  const all = ['', '自动选择'],
    skill = { vocab: 'vocab', grammar: 'grammar', reading: 'reading' }[mode] || 'listening';
  let fields = '';
  if (mode === 'vocab')
    fields =
      field('mode-filter', '词汇主题', [
        ['', '全部主题'],
        ...[...new Set(bank.vocab.map((w) => w.theme))].map((t) => [t, t]),
      ]) +
      field('vocab-format', '题型', [
        ['', '混合练习'],
        ['meaning', '英文选中文'],
        ['english', '中文选英文'],
        ['sound', '听音辨词'],
        ['cloze', '例句填空'],
        ['match', '同义替换'],
      ]);
  if (mode === 'grammar')
    fields = field(
      'mode-filter',
      '语法关卡',
      bank.grammar.map((t) => [t.id, t.title]),
    );
  if (mode === 'part2')
    fields = field('mode-filter', '练习重点', [
      ['first', '听清第一个词'],
      ['response', '选择合适的回应'],
      ['', '混合练习'],
    ]);
  if (mode === 'dialogue')
    fields = field('mode-filter', '听力材料', [
      all,
      ['3', 'Part 3 · 对话'],
      ['4', 'Part 4 · 独白'],
    ]);
  if (mode === 'reading')
    fields =
      field('mode-filter', '阅读材料', [
        all,
        ['6', 'Part 6 · 短文填空'],
        ['7', 'Part 7 · 阅读理解'],
      ]) +
      `<label class="setting">本轮计时<input type="checkbox" id="run-timed" ${state.settings.timed ? 'checked' : ''}></label>`;
  return `<div class="eyebrow">TRAINING</div><h2>${route[2]}</h2><p class="muted">${route[3]} · 当前适应难度 ${difficulty(state, skill)} 级</p>${fields}<button class="primary modal-start" data-act="configured" data-mode="${mode}">开始练习 ${icon('arrow', 16)}</button>`;
}
