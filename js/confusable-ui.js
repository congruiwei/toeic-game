import {confusableData,groupsForWord} from './confusables.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const types={spelling:'形近',sound:'音近',meaning:'义近'};
export function comparisonCard({group,target,chosen,trap,selected},context={}){
 const d=confusableData(),members=group.members.map(id=>d.words[id]);
 const mixed=target&&chosen&&target.id!==chosen.id;
 return `<section class="confusable-card" data-confusable-group="${esc(group.id)}" ${context.wordId?`data-confusable-study="${esc(context.wordId)}"`:`data-confusable-review="${esc(context.id)}"`}>
 <header><span class="chip">${types[group.type]}对比</span><h3>${members.map(w=>esc(w.word)).join(' / ')}</h3></header>
 ${mixed?`<p class="confusable-mistake">你选了 <b lang="en">${esc(chosen.word)}</b>（${esc(chosen.zh)}），本题需要 <b lang="en">${esc(target.word)}</b>（${esc(target.zh)}）。</p>`:''}
 ${trap?`<p class="confusable-trap"><strong>音近陷阱${selected===trap.option?' · 你选中了这一项':''}</strong> ${esc(trap.reasonZh)}</p>`:''}
 <div class="confusable-difference"><p lang="en">${esc(group.difference.en)}</p><p lang="zh-CN">${esc(group.difference.zh)}</p><p lang="ja">${esc(group.difference.ja)}</p><div class="confusable-actions"><button class="secondary" data-act="confusable-difference" data-language="en">读英语区别</button><button class="secondary" data-act="confusable-difference" data-language="ja">读日语区别</button></div></div>
 <div class="confusable-words">${members.map(w=>`<article data-confusable-word="${esc(w.id)}"><h4 lang="en">${esc(w.word)}${w.sense?`<small>${esc(w.sense)}</small>`:''}</h4><p class="fine" lang="en">${esc(w.ipa)} · ${esc(w.pos)}</p><p lang="zh-CN">${esc(w.zh)}</p><p lang="ja">${esc(w.ja)}</p><p lang="en">${esc(w.example)}</p><p class="fine" lang="zh-CN">${esc(w.exampleZh)}</p><p class="fine" lang="ja">${esc(w.exampleJa)}</p><div class="confusable-actions"><button class="secondary" data-act="confusable-speak" data-word="${esc(w.id)}" data-language="en">读英文</button><button class="secondary" data-act="confusable-speak" data-word="${esc(w.id)}" data-language="ja">读日语</button><button class="secondary" data-act="confusable-speak" data-word="${esc(w.id)}" data-language="en" data-field="example">读英语例句</button><button class="secondary" data-act="confusable-speak" data-word="${esc(w.id)}" data-language="ja" data-field="example">读日语例句</button></div></article>`).join('')}</div>
 <div class="confusable-pairs">${members.flatMap((first,i)=>members.slice(i+1).map(second=>`<button class="secondary" data-act="confusable-pair" data-first="${esc(first.id)}" data-second="${esc(second.id)}">连听 ${esc(first.word)} / ${esc(second.word)}</button>`)).join('')}</div>
 <button class="primary" data-act="start" data-mode="confusable" data-filter="${esc(group.id)}">练这一组</button></section>`;
}
export function wordComparisons(id){return groupsForWord(id).map(group=>comparisonCard({group},{wordId:id})).join('');}
export function standaloneTrap(id,selected){
 const trap=confusableData()?.part2Traps.find(t=>t.id===id&&!t.groupId);
 return trap?`<aside class="confusable-card confusable-trap" data-phonetic-trap="${esc(id)}"><h3>音近陷阱${selected===trap.option?' · 你选中了这一项':''}</h3><p lang="en">${esc(trap.option)}</p><p>${esc(trap.reasonZh)}</p></aside>`:'';
}
