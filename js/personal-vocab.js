import {createEmptyCard} from '../vendor/ts-fsrs/index.js';
import {advance, validCard, migrateReview, reviewBand} from './review-scheduler.js';

const directions = ['en-zh','zh-en','en-ja','ja-en'];
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max=20000) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const keyOK = value => text(value,180) && /^[a-zA-Z0-9_-]+$/.test(value) && !['__proto__','constructor','prototype'].includes(value);
const timeOK = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
const modes = ['vocab','part1','part2','grammar','dialogue','reading','dictation'];
const sourceOK = source => record(source) && keyOK(source.id) && modes.includes(source.mode)
  && typeof source.context === 'string' && source.context.length <= 20000
  && typeof source.option === 'string' && source.option.length <= 20000;
const itemOK = item => record(item) && keyOK(item.key) && [item.word,item.pos,item.zh,item.ja].every(value=>text(value,2000))
  && (item.wordId === null || keyOK(item.wordId) && item.key === item.wordId)
  && (!item.sense || text(item.sense,100)) && (item.ipa === undefined || typeof item.ipa === 'string' && item.ipa.length < 300)
  && (item.example === undefined || typeof item.example === 'string' && item.example.length <= 20000)
  && sourceOK(item.source) && timeOK(item.addedAt) && record(item.fsrs) && validCard(item.fsrs);
const emptyMemory = now => {
  const card=createEmptyCard(new Date(now));
  return {...card,due:card.due.getTime(),last_review:undefined,lastRating:null};
};
const copyMemory = memory => ({...memory});

/** Only an absent field is an old backup. Present but invalid data must fail import. */
export function migratePersonalVocab(s) {
  if(s.personalVocab===undefined)s.personalVocab={version:1,items:[],run:null};
  const book=s.personalVocab;
  if(!record(book)||book.version!==1||!Array.isArray(book.items)||book.items.length>10000
    ||!book.items.every(itemOK)||new Set(book.items.map(item=>item.key)).size!==book.items.length)throw Error('我的单词本记录有误');
  const run=book.run;
  if(run!==null&&(!record(run)||!directions.includes(run.direction)||!Array.isArray(run.keys)
    ||!run.keys.length||run.keys.length>20||new Set(run.keys).size!==run.keys.length
    ||!run.keys.every(key=>book.items.some(item=>item.key===key))||!Number.isInteger(run.index)
    ||run.index<0||run.index>run.keys.length||typeof run.flipped!=='boolean'
    ||run.index===run.keys.length&&run.flipped))throw Error('我的单词本复习记录有误');
  syncPersonalVocab(s);
  return book;
}

/** Call before ordinary save/export and before retired catalog IDs are reconciled. */
export function syncPersonalVocab(s) {
  for(const item of s.personalVocab?.items||[]) {
    const memory=item.wordId&&s.words?.[item.wordId]?.fsrs;
    if(memory&&validCard(memory))item.fsrs=copyMemory(memory);
  }
}

export function collectPersonalWord(s,lexeme,{ref,context='',option='',now=Date.now()}={}) {
  migratePersonalVocab(s);
  if(!record(lexeme)||!keyOK(lexeme.id)||![lexeme.word,lexeme.pos,lexeme.zh,lexeme.ja].every(value=>text(value,2000))
    ||lexeme.collectible===false||!timeOK(now))throw Error('词条信息不完整，暂时无法收藏');
  if(!record(ref)||!sourceOK({id:ref.id,mode:ref.mode,context,option}))throw Error('词条来源有误');
  const wordId=lexeme.wordId??null;
  if(wordId!==null&&!keyOK(wordId))throw Error('词卡引用有误');
  const key=wordId||`personal-${lexeme.id}`;
  if(!keyOK(key))throw Error('个人词条标识有误');
  const existing=s.personalVocab.items.find(item=>item.key===key);
  if(existing)return {added:false,item:existing};
  if(s.personalVocab.items.length>=10000)throw Error('我的单词本已达到10000条上限');
  let memory;
  if(wordId) {
    if(!record(s.words))throw Error('单词进度记录有误');
    const known=s.words[wordId];
    if(known&&known.fsrs===undefined)migrateReview(s,now);
    memory=s.words[wordId]?.fsrs||emptyMemory(now);
    if(!validCard(memory))throw Error('已有单词的复习记录有误');
  } else memory=emptyMemory(now);
  const item={key,wordId,word:lexeme.word,pos:lexeme.pos,zh:lexeme.zh,ja:lexeme.ja,
    ...(lexeme.sense?{sense:lexeme.sense}:{}),...(lexeme.ipa?{ipa:lexeme.ipa}:{}),
    ...(lexeme.example?{example:lexeme.example}:{}),source:{id:ref.id,mode:ref.mode,context,option},addedAt:now,fsrs:copyMemory(memory)};
  if(!itemOK(item))throw Error('词条内容无法保存，请重新打开选项释义');
  // Collection schedules a New card; it is not a correct answer or an Easy rating.
  if(wordId&&!s.words[wordId])s.words[wordId]={box:0,due:memory.due,right:0,tries:0,fsrs:copyMemory(memory)};
  s.personalVocab.items.push(item);
  return {added:true,item};
}

export function personalVocabStats(s,now=Date.now()) {
  const items=s.personalVocab?.items||[];
  const memory=item=>item.wordId&&s.words?.[item.wordId]?.fsrs||item.fsrs;
  return {total:items.length,linked:items.filter(item=>item.wordId).length,
    due:items.filter(item=>memory(item).due<=now).length,
    mastered:items.filter(item=>memory(item).state===2&&memory(item).stability>=7).length};
}
export function beginPersonalVocab(s,direction='en-zh',now=Date.now()) {
  migratePersonalVocab(s);
  if(!directions.includes(direction)||!timeOK(now))return false;
  const ordered=[...s.personalVocab.items].sort((a,b)=>a.fsrs.due-b.fsrs.due||a.addedAt-b.addedAt);
  const due=ordered.filter(item=>item.fsrs.due<=now);
  const keys=(due.length?due:ordered).slice(0,20).map(item=>item.key);
  if(!keys.length)return false;
  s.personalVocab.run={direction,keys,index:0,flipped:false};return true;
}
export function flipPersonalWord(s) {
  const run=s.personalVocab?.run;
  if(!run||run.index>=run.keys.length)return false;
  run.flipped=true;return true;
}
export function ratePersonalWord(s,grade,now=Date.now()) {
  const run=s.personalVocab?.run;
  if(!run?.flipped||![1,2,3,4].includes(grade)||!timeOK(now))return false;
  const item=s.personalVocab.items.find(item=>item.key===run.keys[run.index]);
  if(!item)return false;
  const shared=item.wordId&&s.words?.[item.wordId];
  const memory=advance(shared?.fsrs||item.fsrs,grade,now,s.settings?.retention);
  item.fsrs=copyMemory(memory);
  if(shared) {
    shared.fsrs=copyMemory(memory);shared.due=memory.due;shared.box=reviewBand(memory);
  }
  run.index++;run.flipped=false;
  return {item,grade};
}
export function removePersonalWord(s,key) {
  migratePersonalVocab(s);
  const at=s.personalVocab.items.findIndex(item=>item.key===key);
  if(at<0)return false;
  s.personalVocab.items.splice(at,1);
  const run=s.personalVocab.run;
  if(run) {
    const pos=run.keys.indexOf(key);
    if(pos>=0) {const currentRemoved=pos===run.index;run.keys.splice(pos,1);if(pos<run.index)run.index--;if(currentRemoved)run.flipped=false;}
    if(!run.keys.length)s.personalVocab.run=null;
    else if(run.index===run.keys.length)run.flipped=false;
  }
  // Removing a bookmark never deletes canonical vocabulary progress.
  return true;
}

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function cardHTML(item) {
  return `<article class="personal-word" data-personal-key="${esc(item.key)}"><h2 lang="en">${esc(item.word)}</h2><p class="personal-meta">${esc(item.pos)} ${esc(item.ipa||'')} ${item.sense?'· '+esc(item.sense):''}</p><p lang="zh-CN">${esc(item.zh)}</p><p lang="ja">${esc(item.ja)}</p>${item.example?`<p class="personal-example" lang="en">${esc(item.example)}</p><button class="secondary" data-act="personal-speak" data-key="${esc(item.key)}" data-field="example" data-language="en">朗读原例句</button>`:''}${item.source.context&&item.source.context!==item.example?`<div class="personal-source"><small class="muted">收藏时的来源题句</small><p lang="en">${esc(item.source.context)}</p><button class="secondary" data-act="personal-speak" data-key="${esc(item.key)}" data-field="context" data-language="en">朗读来源题句</button></div>`:''}<div class="personal-actions"><button class="secondary" data-act="personal-speak" data-key="${esc(item.key)}" data-language="en">朗读英文</button><button class="secondary" data-act="personal-speak" data-key="${esc(item.key)}" data-language="ja">朗读日语</button></div><small class="muted">${item.wordId?'与原词卡共享复习进度':'个人简卡'} · 来源 ${esc(item.source.id)}</small></article>`;
}
export function personalVocabView(s,{practice=false,filter='',limit=50}={}) {
  const book=s.personalVocab||{items:[],run:null},stats=personalVocabStats(s),run=book.run;
  if(practice&&run) {
    const item=book.items.find(item=>item.key===run.keys[run.index]);
    if(!item)return '<section class="lesson-shell"><h1>本轮单词复习完成</h1><p>下次复习时间已安排好。</p><button class="primary" data-act="personal-open">回到我的单词本</button></section>';
    const language=run.direction.split('-')[0],front=language==='en'?item.word:item[language];
    return `<section class="lesson-shell"><header class="lesson-header personal-review-header"><h1>我的单词本复习</h1><button class="secondary" data-act="personal-open">保存离开</button></header><p>${run.index+1} / ${run.keys.length}</p>${run.flipped?cardHTML(item):`<article class="personal-word"><p class="personal-prompt" lang="${language}">${esc(front)}</p>${language==='zh'?'':`<button class="secondary" data-act="personal-speak" data-key="${esc(item.key)}" data-language="${language}">朗读</button>`}</article>`}${run.flipped?`<div class="personal-ratings">${['不会','模糊','会了','很熟'].map((label,i)=>`<button class="secondary" data-act="personal-rate" data-grade="${i+1}">${label}</button>`).join('')}</div>`:'<button class="lesson-primary" data-act="personal-flip">翻开释义</button>'}</section>`;
  }
  const needle=filter.trim().toLowerCase(),items=book.items.filter(item=>[item.word,item.zh,item.ja,item.pos].some(value=>value.toLowerCase().includes(needle)));
  return `<section class="lesson-shell"><h1>我的单词本</h1><p>收藏 ${stats.total} · 到期 ${stats.due} · 已掌握 ${stats.mastered}</p><p class="muted">答题后打开选项释义，收藏想学的词或短语。已有词共享原词卡的复习进度，简卡也按FSRS安排复习。</p>${run&&run.index<run.keys.length?'<button class="primary" data-act="personal-resume">继续单词复习</button>':''}${book.items.length?`<div class="personal-actions">${[['en-zh','看英文 → 中文'],['zh-en','看中文 → 英文'],['en-ja','看英文 → 日文'],['ja-en','看日文 → 英文']].map(([direction,label])=>`<button class="secondary" data-act="personal-start" data-direction="${direction}">${label}</button>`).join('')}</div><p class="fine muted">到期词优先；没有到期词时可自由温习。</p><label class="personal-search">查找词条<input id="personal-vocab-filter" type="search" value="${esc(filter)}" placeholder="英文、中文或日语"></label><div class="personal-word-list">${items.slice(0,limit).map(item=>cardHTML(item)+`<button class="personal-remove" data-act="personal-remove" data-key="${esc(item.key)}">取消收藏 ${esc(item.word)}</button>`).join('')}</div>${items.length?`<p class="fine muted">已显示 ${Math.min(limit,items.length)} / ${items.length} 个词条</p>${items.length>limit?`<button class="secondary personal-more" data-act="personal-more">再显示 ${Math.min(50,items.length-limit)} 条</button>`:''}`:'<p class="muted">没有匹配的词条。</p>'}`:'<article class="personal-word"><p>这里还没有词条。答题后，点选项旁的释义按钮，再选择「加入我的单词本」。</p></article>'}</section>`;
}
