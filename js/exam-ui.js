import {question,catalog} from './bank.js';
import {examIds,readingIds,examScores} from './exam.js';
import {passages,graphic} from './practice.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const duration=ms=>{const n=Math.ceil(Math.max(0,ms)/1000);return Math.floor(n/60)+':'+String(n%60).padStart(2,'0');};
const action=(name,text,extra='')=>`<button class="secondary" data-act="${name}" ${extra}>${text}</button>`;
function choices(q,e,part){
 const hide=part<=2;
 return `<div class="lesson-choices">${q.options.map((o,i)=>`<button class="lesson-option ${e.answers[q.id]===o?'exam-chosen':''}" data-act="exam-choice" data-id="${esc(q.id)}" data-i="${i}" aria-pressed="${e.answers[q.id]===o}"><b>${'ABCD'[i]}</b>${hide?'选择 '+ 'ABCD'[i]:esc(o)}</button>`).join('')}</div>`;
}
export function examLobby(e){
 const ongoing=e&&e.phase!=='done';
 return `<section class="lesson-shell"><h1>模拟考试</h1>${ongoing?`<section class="lesson-panel"><h2>未完成的${e.size==='half'?'半套':'完整'}模拟</h2><p>已答 ${Object.keys(e.answers).length} 题 · ${e.phase==='listening'?'听力':'阅读'}</p>${action('exam-resume','继续考试')}</section>`:`
 <section class="lesson-panel"><h2>完整模拟</h2><p>听力 100 题 · 阅读 100 题 / 75 分钟</p>${action('exam-start','开始完整模拟','data-size="full"')}</section>
 <section class="lesson-panel"><h2>半套模拟</h2><p>听力 50 题 · 阅读 50 题 / 38 分钟</p>${action('exam-start','开始半套模拟','data-size="half"')}</section>${e?action('exam-result','查看上次成绩'):''}`}
 <p class="muted">请先在设置里试听。听力按顺序自动播放，每段一次。保存离开后，从下一条未开始的语句继续。阅读可自由跳题，保存离开时计时停止。</p></section>`;
}
export function examView(e){
 if(e.phase==='done')return resultView(e);
 const listening=e.phase==='listening', unit=e.units[e.unit], ids=readingIds(e);
 const ref=listening?unit.ids[0]:ids[e.cursor],q=question(catalog.get(ref).ref);
 const part=listening?unit.part:(q.set?.part||5);
 const ui=`<header class="lesson-header"><h1>模拟考试 · Part ${part}</h1>${action('exam-leave','保存离开')}</header>`;
 if(listening){
   const first=examIds(e).indexOf(ref)+1;
   return `<section class="lesson-shell">${ui}<p class="lesson-meta">听力 · 第 ${first}${unit.ids.length>1?'–'+(first+unit.ids.length-1):''} 题</p>
   ${part===1?`<figure class="lesson-photo"><img src="./${esc(q.image)}" alt="本题原创场景插画"><figcaption>原创场景插画</figcaption></figure>`:''}
   ${q.set?.graphic?graphic(q.set.graphic):''}
   ${unit.ids.map((id,i)=>{const item=question(catalog.get(id).ref);return `<div class="lesson-panel"><h2>${part<=2?'选择听到的最佳选项':(first+i)+'. '+esc(item.prompt)}</h2>${choices(item,e,part)}</div>`;}).join('')}
   <div id="exam-audio-status" class="fine muted" role="status">听力进行中</div></section>`;
 }
 return `<section class="lesson-shell">${ui}<div class="lesson-meta">阅读 ${e.cursor+1} / ${ids.length} · 剩余 <strong id="exam-clock">${duration(e.deadline?e.deadline-Date.now():e.remaining)}</strong></div>
   <label class="setting">跳到阅读题<select id="exam-jump">${ids.map((id,i)=>`<option value="${i}" ${i===e.cursor?'selected':''}>${i+1} · ${Object.hasOwn(e.answers,id)?'已答':'未答'}</option>`).join('')}</select></label>
   ${q.set?passages(q,false):''}<div class="lesson-panel"><h2>${esc(q.prompt)}</h2>${choices(q,e,part)}</div>
   <div class="exam-pager">${action('exam-prev','上一题',e.cursor?'':'disabled')}${action('exam-next','下一题',e.cursor<ids.length-1?'':'disabled')}${action('exam-submit','交卷')}</div></section>`;
}
function resultView(e){
 const scores=examScores(e,catalog);
 return `<section class="lesson-shell"><h1>模考成绩</h1><div class="lesson-panel"><h2>${scores.listening+scores.reading} <small>分 · 仅供参考</small></h2><p>听力 ${scores.listening} / 495　阅读 ${scores.reading} / 495</p><p class="fine muted">按本套答对比例线性估算。官方换算与试卷难度有关。</p></div>
 <div class="lesson-panel">${scores.parts.map((p,i)=>`<p>Part ${i+1}　${p.correct} / ${p.total}　${Math.round(100*p.correct/p.total)}%</p>`).join('')}</div>
 <details class="lesson-panel"><summary>逐题用时与作答</summary><p class="fine muted">组内共听材料的时间均摊，选择后停留的时间计入当前题。</p>${examIds(e).map((id,i)=>{const d=catalog.get(id).data;return `<p>${i+1}. ${esc(id)} · ${duration(e.times[id]||0)} · ${e.answers[id]===(e.keys[id]??d.answer)?'正确':e.answers[id]?'错误':'未答'}</p>`;}).join('')}</details>
 <div class="lesson-panel"><h2>错题与未答题</h2>${examIds(e).filter(id=>e.keys[id]!==e.answers[id]).map(id=>{const {ref,data}=catalog.get(id);return `<details><summary>${esc(id)} · ${esc(data.prompt||data.set?.title||'看图听句')}</summary><p>你的选择：${esc(e.answers[id]||'未答')}</p><p>答案：${esc(e.keys[id])}</p><p lang="en">${esc(data.en)}</p><p>${esc(data.zh)}</p></details>`}).join('')||'本套全部答对。'}</div>
 ${action('exam-lobby','返回模拟考试')}</section>`;
}
