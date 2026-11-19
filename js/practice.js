import {replayView} from './replay.js';
import {reviewTools} from './question-tools.js';
import {UNKNOWN} from './answers.js';
import {question} from './bank.js';
import {icon} from './icons.js';
import {readable,readButton} from './readable.js';
import {splitSentences} from './replay.js';

const entities = {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'};
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => entities[char]);
const letter = index => String.fromCharCode(65 + index);
const clock = ms => {
  const seconds = Math.floor(ms / 1000);
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
};

// Match in the source text before escaping it. Only authored markup reaches the page.
function mark(text, evidence) {
  const index = evidence ? text.toLowerCase().indexOf(evidence.toLowerCase()) : -1;
  if (index < 0) return esc(text);
  return esc(text.slice(0, index)) + '<mark>' + esc(text.slice(index, index + evidence.length)) + '</mark>' +
    esc(text.slice(index + evidence.length));
}

function header(run) {
  const progress = run.index + Number(run.selected !== null);
  const position = Math.min(run.index + 1, run.items.length);
  return `<header class="lesson-header">
    <button type="button" class="lesson-back" data-act="leave" aria-label="保存进度并离开练习">${icon('back', 22)}</button>
    <div><h1>${esc(run.title)}</h1><div class="lesson-track" role="progressbar" aria-label="本轮进度" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="${run.items.length}"><span style="width:${100 * progress / run.items.length}%"></span></div></div>
    <span class="lesson-counter">${position} / ${run.items.length}</span>
  </header>`;
}

function diagram(topic) {
  const {kind, steps, caption} = topic.diagram;
  return `<section class="lesson-panel lesson-brief">
    <div class="lesson-meta"><span>${icon('grammar', 17)} 语法图解</span><span>${icon('clock', 15)} 约 30 秒</span></div>
    <h2 data-ja-term="${esc(topic.id)}">${esc(topic.title)}</h2>
    <ol class="lesson-diagram ${kind === 'timeline' ? 'is-timeline' : 'is-flow'}">
      ${steps.map(step => `<li><span class="diagram-point" aria-hidden="true"></span><b>${esc(step.label)}</b><span>${esc(step.detail)}</span></li>`).join('')}
    </ol>
    <p class="lesson-caption">${esc(caption)}</p>
  </section><button type="button" class="lesson-primary" data-act="begin">开始答题 ${icon('arrow',18)}</button>`;
}

function player(q, ref, answered) {
  const waveform = [8,14,20,10,25,32,17,24,10,17,30,21,12,17,8]
    .map(height => `<i style="height:${height}px"></i>`).join('');
  return `<button type="button" class="lesson-player" data-act="play">
    <span class="lesson-play-icon">${icon('play',19)}</span>
    <span class="lesson-play-copy"><b data-play-label>${answered ? '再次播放' : '点击开始'}</b><small>${ref.mode === 'vocab' ? '播放单词发音' : '播放录音 · 可重复收听'}</small></span>
    <span class="lesson-wave" aria-hidden="true">${waveform}</span></button>`;
}

export function graphic(table, evidence = '',readOptions=null) {
  const cells = row => row.map(cell => `<td>${mark(cell,evidence)}</td>`).join('')+(readOptions?`<td>${readButton(row.join(' | '),readOptions)}</td>`:'');
  return `<div class="lesson-graphic" tabindex="0" role="region" aria-label="题目附表"><table lang="en">
    <caption>${esc(table.title || 'Reference table')}</caption>
    <thead><tr>${table.headers.map(h => `<th scope="col">${esc(h)}</th>`).join('')}${readOptions?`<th scope="col">${readButton(table.headers.join(' | '),readOptions)}</th>`:''}</tr></thead>
    <tbody>${table.rows.map(row => `<tr>${cells(row)}</tr>`).join('')}</tbody>
  </table></div>`;
}

export function passages(q, answered, readablePassage=answered) {
  return `<div class="lesson-sources">${q.set.documents.map((doc,docIndex) => {
    let text=doc.text;
    if(readablePassage && q.set.part===6)for(const item of q.set.questions){const slot=item.prompt.match(/\[\d+\]/)?.[0];if(slot)text=text.replace(slot,item.answer);}
    const body=readablePassage?splitSentences(text).map((sentence,i)=>`<span class="read-sentence">${readable(sentence,{id:q.id,bank:'reading',seed:q.set.id,key:`${q.set.id}/documents/${docIndex}/text/${i}`,html:mark(sentence,q.evidence)})}</span>`).join(''):mark(text,answered?q.evidence:null);
    return `
    <article class="lesson-document"><header>${icon('note',17)} ${esc(doc.type)}</header>
    <h3 lang="en">${esc(doc.title)}${readablePassage?readButton(doc.title,{id:q.id,bank:'reading',seed:q.set.id,key:`${q.set.id}/documents/${docIndex}/title`}):''}</h3>
    <div lang="en" class="lesson-source-text">${body}</div>${doc.table ? graphic({...doc.table, title:doc.title},answered ? q.evidence : '',readablePassage?{id:q.id,bank:'reading',seed:q.set.id}:null) : ''}</article>`;}).join('')}${answered&&!readablePassage?'<p class="fine muted">本篇还有未答空格，答完本篇后可点读填好答案的原文。</p>':''}</div>`;
}

function choices(q, ref, run) {
  const answered = run.selected !== null;
  if (ref.mode === 'dictation') {
    return `<div class="lesson-write"><label for="dict-input">补全单词</label>
      <input id="dict-input" type="text" lang="en" inputmode="text" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="done"
        placeholder="输入听到的单词" ${answered ? 'readonly' : ''} value="${esc(run.selected)}">
      ${answered ? '' : '<button type="button" data-act="submit-dict" class="lesson-primary">提交答案</button>'}</div>`;
  }
  const audioOnly = (ref.mode==='part1'||(ref.mode === 'part2' && q.type === 'response')) && !answered;
  return `<div class="lesson-choices" role="group" aria-label="答案选项">${q.options.map((option, i) => {
    const correct = answered && option === q.answer;
    const wrong = answered && option === run.selected && !correct;
    const status = correct ? '正确答案' : wrong ? '你的选择' : '';
    return `<button type="button" class="lesson-option ${correct ? 'is-correct' : wrong ? 'is-wrong' : ''}" data-act="answer" data-i="${i}" ${answered ? 'disabled' : ''} aria-label="${esc([letter(i),(!audioOnly ? option : ''),status].filter(Boolean).join(' '))}">
      <span class="lesson-letter">${letter(i)}</span><span lang="${ref.format==='meaning-ja'?'ja':ref.format==='meaning'?'zh-CN':'en'}">${audioOnly ? '选择 ' + letter(i) : esc(option)}</span>
      ${status ? '<span class="lesson-option-mark">' + icon(correct ? 'check' : 'close',18) + '</span>' : ''}</button>${answered&&!['meaning','meaning-ja'].includes(ref.format)?`<div class="option-read">${readButton(option,{id:q.id,bank:({dialogue:'listening',dictation:'listening',confusable:'vocab'})[ref.mode]||ref.mode,seed:q.set?.id||q.id,key:ref.mode==='vocab'?'':ref.mode==='confusable'?q.optionWordIds[i]+'/meaning':`${q.id}/options/${i}/0`})}</div>`:''}`;
  }).join('')}</div>${answered ? '' : '<button type="button" class="secondary lesson-unknown" data-act="unknown">不知道</button>'}`;
}

function vocabNote(q) {
  return `<section class="lesson-panel lesson-word-note">
    <div class="lesson-meta"><span>${icon('cards', 16)} 词卡</span><span>${esc(q.theme)}</span></div>
    <div class="lesson-word-line"><h3 lang="en">${esc(q.word)}</h3><button type="button" data-act="play" class="lesson-speaker" aria-label="播放单词发音">${icon('sound',20)}</button></div>
    <p class="lesson-ipa" lang="en">${esc(q.ipa)} · ${esc(q.pos)}</p><p lang="zh-CN">${esc(q.zh)}</p><p lang="ja" role="button" tabindex="0" data-act="meaning-ja-speak" data-vocab-ja="${esc(q.id)}">正在载入日语释义…</p>
    <section class="word-humor" data-humor-id="${esc(q.id)}"></section><h3 class="word-business-label">商务例句</h3><blockquote lang="en">${readable(q.example,{id:q.id,bank:'vocab',key:`${q.id}/example/0`,html:mark(q.example,q.word)})}</blockquote>
    <dl class="lesson-terms"><dt>常见搭配</dt><dd lang="en">${readable(q.collocation,{id:q.id,bank:'vocab',seed:q.id})}</dd><dt>同义替换</dt><dd lang="en">${readable(q.paraphrase,{id:q.id,bank:'vocab',seed:q.id})}</dd></dl>
  </section>`;
}

function feedback(q, ref, run) {
  const normalize = value => value.trim().toLowerCase();
  const correct = ref.mode === 'dictation'
    ? normalize(run.selected) === normalize(q.answer) : run.selected === q.answer;
  return `<section class="lesson-feedback ${correct ? 'is-right' : 'is-miss'}" aria-label="答题反馈">
    <h2>${icon(correct ? 'check' : 'note',19)} ${correct ? '答对了' : run.selected === UNKNOWN ? '不知道 · 已加入复习' : '再记一次'}</h2>
    <p><b>正确答案</b> <span>${esc(q.answer)}</span></p>
    ${ref.mode === 'vocab' ? vocabNote(q) : ''}
    ${ref.mode==='grammar'?`<div class="lesson-complete-sentence">${readable(q.prompt.replace(/_{3,}/g,q.answer),{id:q.id,bank:'grammar',seed:q.id,key:`${q.id}/sentence/0`})}</div>`:''}
    ${ref.mode==='confusable'?`<div class="lesson-complete-sentence">${readable(q.sentence,{id:q.id,bank:'vocab',seed:q.id,key:`${q.id}/sentence/0`})}</div>`:''}
    ${ref.mode==='part1'?`<p><b>画面说明</b> ${esc(q.description)}</p>`:''}
    ${ref.mode === 'vocab' ? '' : `<div class="lesson-reason"><p lang="en">${readable(q.en,{id:q.id,seed:q.id,...(ref.mode==='confusable'?{bank:'vocab',key:q.groupId+'/difference/0'}:{})})}</p><p lang="zh-CN">${esc(q.zh)}</p></div>`}
    ${q.paraphrase && ref.mode !== 'vocab' ? `<dl class="lesson-terms"><dt>同义替换</dt><dd lang="en">${readable(q.paraphrase,{id:q.id,seed:q.id})}</dd></dl>` : ''}
    ${replayView(q,ref)}
    ${reviewTools(ref.id)}
  </section>
    <button type="button" data-act="next" class="lesson-primary">${run.index === run.items.length - 1 ? '查看本轮成果' : '下一题'} ${icon('arrow',18)}</button>`;
}

function summary(run) {
  return `<section class="lesson-shell lesson-summary"><div class="lesson-emblem">${icon('sprout',36)}</div>
    <h1>本轮完成</h1><p>${esc(run.title)}</p>
    <div class="lesson-results"><div><strong>${run.right}<small> / ${run.items.length + (run.retiredAnswered || 0)}</small></strong><span>答对题数</span></div>
    <div><strong>+${run.gain}</strong><span>获得经验</span></div>
    ${run.timed ? `<div><strong>${clock(run.elapsed)}</strong><span>阅读用时</span></div>` : ''}</div>
    <button type="button" class="lesson-primary" data-act="home">回到小岛 ${icon('arrow',18)}</button></section>`;
}

export function practiceView(state) {
  const run = state.session;
  if (!run) return '';
  if (run.index >= run.items.length) return summary(run);
  const ref = run.items[run.index], q = question(ref), answered = run.selected !== null;
  if (!q) return '<section class="lesson-shell"><p>这道题已更新。请回到小岛开启新练习。</p><button type="button" class="lesson-primary" data-act="home">回到小岛</button></section>';
  if (run.intro && !answered && q.topic) return `<div class="lesson-shell">${header(run)}${diagram(q.topic)}</div>`;
  const needPlayer = q.audio || ['part2','dialogue','dictation'].includes(ref.mode);
  return `<section class="lesson-shell">${header(run)}
    <div class="lesson-meta lesson-section-meta"><span>${icon(({vocab:'cards',grammar:'grammar',reading:'reading'})[ref.mode] || 'headphones',17)} ${esc(q.instruction)}</span>
    <span>${run.timed ? `${icon('clock',15)} <b id="timer">${clock(run.elapsed)}</b> · ` : ''}${q.level} 级</span></div>
    ${ref.mode==='part1'?`<figure class="lesson-photo"><img src="./${esc(q.image)}" alt="本题原创场景插画"><figcaption>原创场景插画</figcaption></figure>`:''}
    ${ref.mode === 'reading' ? passages(q, answered,answered && !(q.set.part===6 && run.items.slice(run.index+1).some(item=>question(item)?.set?.id===q.set.id))) : ''}
    ${ref.mode === 'dialogue' && q.set.graphic ? graphic(q.set.graphic,'',answered?{id:q.id,bank:'listening',seed:q.set.id}:null) : ''}
    <div class="lesson-panel lesson-question">
      ${q.set && ref.mode !== 'reading' ? `<p class="lesson-source-title">${esc(q.set.title)}</p>` : ''}
      <h2 class="${ref.mode === 'vocab' && !['cloze','sound'].includes(ref.format) ? 'lesson-word' : ''}" lang="${ref.format==='english-ja'?'ja':ref.format==='english'?'zh-CN':['reading','grammar','dialogue','dictation','vocab'].includes(ref.mode)?'en':'zh-CN'}">${esc(q.prompt)}</h2>
      ${answered&&['reading','dialogue'].includes(ref.mode)?readButton(q.prompt,{id:q.id,seed:q.id,bank:ref.mode==='dialogue'?'listening':'reading',key:q.id+'/prompt/0'}):''}
      ${ref.mode === 'vocab' && ['meaning','meaning-ja','match'].includes(ref.format) ? `<p class="lesson-ipa">${esc(q.ipa)} · ${esc(q.pos)}</p>` : ''}
      ${q.context ? `<blockquote lang="en">${mark(q.context,q.word)}</blockquote>` : ''}
      ${needPlayer ? player(q, ref, answered) : ''}
      ${answered && !needPlayer && ref.mode === 'vocab' && ['meaning','meaning-ja','match'].includes(ref.format) ? '<button type="button" class="lesson-listen" data-act="play">'+icon('sound',16)+' 听发音</button>' : ''}
    </div>
    ${choices(q, ref, run)}
    ${answered ? feedback(q, ref, run) : ''}
  </section>`;
}
