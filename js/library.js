import { bank, catalog, question } from './bank.js';
import { icon } from './icons.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);

function herbarium() {
  return `<svg class="lib-botanical" viewBox="0 0 120 112" fill="none" aria-hidden="true">
    <g transform="rotate(-12 59 66)" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="24" y="21" width="58" height="74" rx="6" fill="var(--paper)"/>
      <rect x="30" y="16" width="59" height="75" rx="6" fill="var(--lilac)"/>
      <rect x="36" y="22" width="47" height="63" rx="3" stroke-dasharray="2 3"/>
      <path d="M49 75c9-13 12-25 13-41m-5 24c-10-1-12-7-12-13 8 2 12 7 12 13Zm3-10c0-9 4-15 10-18 1 9-2 14-10 18Zm-7 17c7-8 13-10 19-10-3 7-10 11-19 10Z" fill="#a9c6a8"/>
      <path d="m47 71 11 4-1 4-12-5Z" fill="#ebcb91"/>
    </g>
    <path d="m99 21 1.3 3.7L104 26l-3.7 1.3L99 31l-1.3-3.7L94 26l3.7-1.3ZM13 58l.9 2.5 2.6 1-2.6.9L13 65l-.9-2.6-2.6-.9 2.6-1Z" fill="currentColor"/>
  </svg>`;
}

function cardBody(word) {
  return `<div class="lib-card-body">
    <p class="lib-phonetic" lang="en">${escape(word.ipa)} · ${escape(word.pos)}</p>
    <p>${escape(word.zh)}</p>
    <blockquote lang="en">${escape(word.example)}</blockquote>
    <dl><dt>常见搭配</dt><dd lang="en">${escape(word.collocation)}</dd>
      <dt>同义替换</dt><dd lang="en">${escape(word.paraphrase)}</dd></dl>
  </div>`;
}

function wordCard(word, opened = false) {
  return `<details class="lib-card"${opened ? ' open' : ''}>
    <summary><span class="lib-mark">${icon('leaf',18)}</span>
      <strong lang="en">${escape(word.word)}</strong>
      <span class="lib-level">${escape(word.theme)} · ${word.level}</span>
      <span class="lib-fold">${icon('chev',16)}</span></summary>
    ${cardBody(word)}
  </details>`;
}

function themeSelect(words, filter) {
  return `<label class="lib-filter">主题
    <select id="library-theme"><option value="">全部主题</option>
    ${[...new Set(words.map(word => word.theme))].map(theme => `<option value="${escape(theme)}"${theme === filter ? ' selected' : ''}>${escape(theme)}</option>`).join('')}
    </select></label>`;
}

const startVocab = '<button type="button" class="lib-button" data-act="start" data-mode="vocab">去学单词 ' + icon('arrow',17) + '</button>';

function wordsView(s, filter) {
  const words = bank.vocab || [];
  const learned = words.filter(word => s.words[word.id]?.right > 0);
  const filtered = learned.filter(word => !filter || word.theme === filter);
  const preview = words.find(word => !filter || word.theme === filter);
  return `<section class="lib-overview">
    <div><span>已收藏词卡</span><p><strong>${learned.length}</strong><small> / ${words.length} 张</small></p>
      <progress value="${learned.length}" max="${Math.max(words.length,1)}" aria-label="词卡收藏进度"></progress>
    </div>${herbarium()}</section>
    <div class="lib-heading"><h2>${learned.length ? '我的词卡' : '词卡预览'}</h2>${themeSelect(words, filter)}</div>
    ${!filtered.length ? `<div class="lib-empty"><p>${learned.length ? '这个主题暂时还没有收藏。' : '答对一个单词，就能收下它的词卡。'}</p>${startVocab}</div>
      ${preview ? wordCard(preview,true) : ''}` : `<div class="lib-cards">${filtered.map(word => wordCard(word)).join('')}</div>`}`;
}

const errorLabels = {
  vocab: '单词', grammar: 'Part 5 · 语法', part2: 'Part 2 · 问答',
  dictation: '听写', dialogue: '听力理解', reading: '阅读理解'
};

function errorsView(errors) {
  if (!errors.length) {
    return `<section class="lib-no-errors"><span class="lib-empty-icon">${icon('check',26)}</span>
      <h2>错题本是空的</h2><p>答错的题会自动收在这里，复习答对后移出。</p>
      ${startVocab}</section>`;
  }
  return `<section class="lib-error-intro"><div><h2>待复习 <b>${errors.length}</b></h2>
    <p>从错得最多的题开始。</p></div>
    <button type="button" class="lib-button" data-act="start" data-mode="errors">开始复习 ${icon('play',15)}</button></section>
    <div class="lib-cards">${errors.map(err => {
      const {ref,data} = catalog.get(err.ref.id);
      const q = question({...err.ref, mode:ref.mode});
      const name = ref.mode === 'vocab' ? data.word : ref.mode === 'part2' ? data.audio : q.prompt;
      return `<button type="button" class="lib-error-row" data-act="review-one" data-id="${escape(ref.id)}">
        <span><small>${escape(errorLabels[ref.mode])} · ${q.level} 级</small>
        <strong lang="en">${escape(name)}</strong><small>答错 ${err.misses} 次</small></span>${icon('chev',17)}</button>`;
    }).join('')}</div>`;
}

export function libraryView(s, tab = 'words', filter = '') {
  const errors = Object.values(s.errors).filter(error => catalog.has(error.ref.id))
    .sort((a,b) => b.misses - a.misses || a.at - b.at);
  const tabs = [['words','单词图鉴','cards'], ['errors','错题本','note']];
  return `<div class="lib-page"><h1>学习图鉴</h1>
    <div class="lib-tabs" aria-label="图鉴分类">${tabs.map(([key,label,symbol]) =>
      `<button type="button" data-act="library-tab" data-tab="${key}" aria-pressed="${tab === key}">
        ${icon(symbol,18)}${label}${key === 'errors' && errors.length ? `<small>${errors.length}</small>` : ''}
      </button>`).join('')}</div>
    ${tab === 'errors' ? errorsView(errors) : wordsView(s,filter)}</div>`;
}
