import {expressionStats} from './expressions.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
function say(item,lang){return `<button type="button" class="secondary" data-act="expression-speak" data-key="${esc(item.key)}" data-language="${lang}">朗读${lang==='en'?'英文':'日语'}</button>`;}
function card(item){return `<article class="panel expression-entry"><div class="translation-line"><p lang="en">${esc(item.en)}</p><p lang="zh-CN">${esc(item.zh)}</p><p lang="ja">${esc(item.ja)}</p></div><div class="expression-actions">${say(item,'en')}${say(item,'ja')}</div><small class="muted">${esc(item.sourceId)}${item.fsrs?' · 下次 '+new Date(item.fsrs.due).toLocaleDateString('zh-CN'):''}</small></article>`;}
export function expressionView(s,practice=false){
  const items=s.expressions?.items||[],r=s.expressions?.run,stats=expressionStats(s);
  if(practice&&r){
    const item=items.find(i=>i.key===r.keys[r.index]);
    if(!item)return `<section class="lesson-shell"><h1>本轮表达复习完成</h1><p>复习时间已安排好，想继续时再来。</p><button class="primary" data-act="expression-open">回到表达本</button></section>`;
    const source=r.direction==='ja-en'?'ja':'en';
    return `<section class="lesson-shell"><header class="lesson-header"><h1>${source==='ja'?'看日语 → 说英文':'看英文 → 说日语'}</h1><button class="secondary" data-act="expression-open">保存离开</button></header><p>${r.index+1} / ${r.keys.length}</p>${r.flipped?card(item):`<article class="panel expression-entry"><p class="expression-prompt" lang="${source}">${esc(item[source])}</p>${say(item,source)}</article>`}
      ${r.flipped?`<div class="expression-ratings">${['不会','模糊','会了','很熟'].map((label,i)=>`<button type="button" class="secondary" data-act="expression-rate" data-grade="${i+1}">${label}</button>`).join('')}</div>`:'<button class="lesson-primary" data-act="expression-flip">翻开对照</button>'}</section>`;
  }
  return `<section class="lesson-shell"><h1>职场三语表达本</h1><p>收藏 ${stats.total} · 已掌握 ${stats.mastered} · 到期 ${stats.due}</p><p class="muted">答题后展开翻译，点句子旁的「收藏」即可收进这里。表达与复习记录随进度备份保存。</p>
    ${r&&r.index<r.keys.length?'<button class="primary" data-act="expression-resume">继续表达复习</button>':''}
    ${items.length?`<div class="expression-actions"><button class="secondary" data-act="expression-start" data-direction="ja-en">看日语 → 说英文</button><button class="secondary" data-act="expression-start" data-direction="en-ja">看英文 → 说日语</button></div><p class="fine muted">优先复习到期句子；没有到期句子时可以自由温习。</p><div class="expression-list">${items.map(card).join('')}</div>`:'<div class="panel expression-entry">表达本还是空的。先收藏一句你想在工作中用到的表达。</div>'}</section>`;
}
export function expressionReport(s){const stats=expressionStats(s);return `<section class="panel report-section"><h2>三语表达</h2><p>收藏 ${stats.total} · 已掌握 ${stats.mastered}</p><p class="fine muted">记忆稳定度达到 7 天的表达计为已掌握。</p><button class="secondary" data-act="expression-open">打开表达本</button></section>`;}
