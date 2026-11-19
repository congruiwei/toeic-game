const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const nonempty=x=>typeof x==='string'&&Boolean(x.trim());
const types={prefix:'前缀',root:'词根 / 基础词',suffix:'后缀'};
const posNames={'n.':'名词 · 名詞','v.':'动词 · 動詞','adj.':'形容词 · 形容詞','adv.':'副词 · 副詞'};
let loaded,pending;
export function validMorphemes(data){
 if(!object(data)||data.version!==1||!object(data.sources)||!Array.isArray(data.entries)||!data.entries.length)return false;
 const ids=new Set();
 return data.entries.every(m=>object(m)&&/^(pre|root|suf)-[a-z-]+$/.test(m.id)&&!ids.has(m.id)&&Boolean(ids.add(m.id))&&Object.hasOwn(types,m.type)&&Array.isArray(m.forms)&&m.forms.length>0&&m.forms.every(nonempty)&&nonempty(m.zh)&&nonempty(m.ja)&&Array.isArray(m.examples)&&m.examples.length>=2&&m.examples.length<=6&&new Set(m.examples).size===m.examples.length&&m.examples.every(nonempty)&&Array.isArray(m.sources)&&m.sources.length>0&&m.sources.every(id=>object(data.sources[id])&&/^https:\/\//.test(data.sources[id].url))&&(m.type!=='suffix'||Array.isArray(m.pos)&&m.pos.length>0&&m.pos.every(p=>Object.hasOwn(posNames,p))));
}
export async function loadMorphemes({refresh=false}={}){
 if(refresh)loaded=undefined;
 if(loaded)return loaded;
 if(!pending)pending=(async()=>{
  const url='./data/morphemes.json';let cache,value;
  try{cache=await globalThis.caches?.open('toeic-island-morphemes-v1');}catch{}
  try{const response=await fetch(url,{cache:'no-cache'});if(!response.ok)throw Error('network');value=await response.clone().json();if(!validMorphemes(value))throw Error('format');try{await cache?.put(url,response);}catch{}}
  catch{try{value=await(await cache?.match(url))?.json();}catch{value=null;}}
  if(!validMorphemes(value))throw Error('词根图鉴尚未下载，请联网后重试。');
  loaded=value;return value;
 })().finally(()=>pending=undefined);
 return pending;
}
const indexed=data=>new Map(data.entries.map(m=>[m.id,m]));
export function familyWords(morphemeId,vocab){return vocab.filter(word=>word.parts?.some(part=>part.morpheme===morphemeId));}
export function encountered(word,state){return (state.seen?.[word.id]||0)>0||(state.words?.[word.id]?.tries||0)>0||(state.words?.[word.id]?.right||0)>0||['learn','unconfirmed','verified','studied'].includes(state.screening?.marks?.[word.id]);}
export function unlockedMorphemes(data,vocab,state){return new Set(data.entries.filter(m=>familyWords(m.id,vocab).some(word=>encountered(word,state))).map(m=>m.id));}
function sourceLinks(ids,data){return `<details class="morph-sources"><summary>词源与构词依据</summary>${[...new Set(ids||[])].map(id=>data.sources[id]).filter(Boolean).map(s=>`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>`).join('')}</details>`;}
const jaAudio=(key,text)=>`<button type="button" class="secondary morph-ja" data-act="morpheme-ja" data-morpheme-key="${esc(key)}" data-text="${esc(text)}" aria-label="朗读日语解释">听日语</button>`;
export function wordPartsView(word,data,{heading='词根词缀'}={}){
 if(!word?.parts?.length&&!word?.partsTrap)return '';
 const index=indexed(data),refs=word.parts?.filter(p=>p.morpheme).map(p=>index.get(p.morpheme)).filter(Boolean)||[];
 const parts=word.parts?.length?`<div class="morph-parts" aria-label="${esc(word.word)} 的拆分">${word.parts.map(p=>{const m=index.get(p.morpheme);return m?`<button type="button" data-act="morpheme-family" data-morpheme-id="${esc(m.id)}" class="morph-part ${m.type}"><b lang="en">${esc(p.text)}</b><small>${esc(m.zh)}</small><span class="sr-only">查看同一家族</span></button>`:`<span class="morph-base"><b lang="en">${esc(p.text)}</b><small>词干 / 其余部分</small></span>`;}).join('<span class="morph-plus" aria-hidden="true">＋</span>')}</div>`:'';
 return `<section class="morph-word" data-morph-word="${esc(word.id)}"><h4>${esc(heading)} · <span lang="en">${esc(word.word)}</span></h4>${parts}${word.partsNote?`<p>${esc(word.partsNote.zh)}</p><p lang="ja">${esc(word.partsNote.ja)}</p>${jaAudio(word.id+'/parts-note',word.partsNote.ja)}`:''}${word.partsTrap?`<div class="morph-trap"><strong>拆词陷阱</strong><p>${esc(word.partsTrap.zh)}</p><p lang="ja">${esc(word.partsTrap.ja)}</p>${jaAudio(word.id+'/parts-trap',word.partsTrap.ja)}</div>`:''}${sourceLinks([...(word.partsSources||[]),...refs.flatMap(m=>m.sources),...(word.partsTrap?.sources||[])],data)}</section>`;
}
function selectedWords(ref,q,selected,correct,vocab,jaMeaning){
 const targetId=ref.mode==='vocab'?ref.id:ref.mode==='confusable'?q.wordId:null;
 const target=targetId?vocab.find(w=>w.id===targetId):null;
 const found=[];if(target)found.push({word:target,label:'正确答案'});
 function matches(value){
  if(!nonempty(value)||value==='__isle_unknown__')return[];
  if(ref.mode==='confusable')return vocab.filter(w=>w.id===q.optionWordIds?.[q.options.indexOf(value)]);
  if(ref.mode!=='vocab')return vocab.filter(w=>w.word.toLowerCase()===value.toLowerCase());
  const f=ref.format||'meaning';return vocab.filter(w=>f==='meaning'?w.zh===value:f==='meaning-ja'?jaMeaning?.(w.id)===value:f==='match'?w.paraphrase===value:w.word.toLowerCase()===value.toLowerCase());
 }
 if(!target)for(const w of matches(correct??q.answer))found.push({word:w,label:'正确答案'});
 if(selected!==(correct??q.answer))for(const w of matches(selected))found.push({word:w,label:'你的选择'});
 const ids=new Set();return found.filter(x=>!ids.has(x.word.id)&&Boolean(ids.add(x.word.id)));
}
export function answerPartsView(ref,q,selected,correct,vocab,data,jaMeaning){
 if(selected==null&&correct===undefined)return '';
 const rows=selectedWords(ref,q,selected,correct,vocab,jaMeaning);
 const words=rows.map(({word,label})=>wordPartsView(word,data,{heading:label+' · 拆分'})).join('');
 const hints=ref.mode==='grammar'?grammarSuffixView(q,data):'';
 return words+hints;
}
export function grammarSuffixView(q,data){
 const rows=data.grammarHints?.[q.id];if(!Array.isArray(rows)||rows.some(r=>!q.options.includes(r.text)))return '';
 return `<section class="morph-grammar"><h4>词尾与词性</h4><p class="fine muted">先看句子需要的成分，再用词尾核对；词形变化不等于词性变化。</p><dl>${rows.map(row=>`<div><dt lang="en">${row.ending&&row.text.endsWith(row.ending)?esc(row.text.slice(0,-row.ending.length))+'<mark>'+esc(row.ending)+'</mark>':esc(row.text)}</dt><dd>${esc(row.label)}${row.morpheme?` <button type="button" class="secondary" data-act="morpheme-family" data-morpheme-id="${esc(row.morpheme)}">看词缀</button>`:''}</dd></div>`).join('')}</dl></section>`;
}
export function morphemeFamilyView(id,data,vocab,state){
 const m=data.entries.find(x=>x.id===id);if(!m)return '<p>这个词根条目不存在。</p>';
 const words=familyWords(id,vocab),unlocked=words.some(w=>encountered(w,state));
 return `<section class="morph-family" data-morpheme-family="${esc(id)}"><p class="eyebrow">${types[m.type]} · ${unlocked?'已点亮':'家族预览'}</p><h2 lang="en">${esc(m.forms.join(' / '))}</h2><div class="morph-filters">${m.forms.map((form,i)=>`<button type="button" class="secondary" data-act="morpheme-en" data-morpheme-key="morph-${esc(m.id)}/forms/${i}" data-text="${esc(form)}">听拼写 <span lang="en">${esc(form)}</span></button>`).join('')}</div><p>${esc(m.zh)}${m.kanji?` <span class="morph-kanji">${esc(m.kanji)}</span>`:''}</p><p lang="ja">${esc(m.ja)}</p>${jaAudio('morph-'+m.id+'/meaning',m.ja)}${m.pos?`<p class="morph-pos">${m.pos.map(p=>esc(p)+' · '+posNames[p]).join(' / ')}</p>`:''}${m.noteZh?`<p>${esc(m.noteZh)}</p><p lang="ja">${esc(m.noteJa)}</p>${jaAudio('morph-'+m.id+'/note',m.noteJa)}`:''}<h3>同一家族</h3><p class="fine muted">见过相关单词就会点亮；浏览家族不会改变分数或复习时间。</p><p class="fine muted">词缀按钮读字母拼写；完整例词示范实际词内发音。</p><div class="morph-family-words">${words.map(w=>`<div class="morph-family-row"><button type="button" class="secondary" data-act="morpheme-word" data-word-id="${esc(w.id)}"><span lang="en">${esc(w.word)}</span><span>${esc(w.zh)}</span><small>${encountered(w,state)?'见过':'未遇到'}</small></button><button type="button" class="secondary morph-example-audio" data-act="morpheme-example" data-word-id="${esc(w.id)}" aria-label="听例词 ${esc(w.word)} 的发音">听发音</button></div>`).join('')}</div>${sourceLinks(m.sources,data)}<button type="button" class="secondary" data-act="report-morpheme" data-morpheme-id="${esc(m.id)}">报告词根问题</button></section>`;
}
export function morphemesView(data,vocab,state,filter='all'){
 const unlocked=unlockedMorphemes(data,vocab,state),entries=data.entries.filter(m=>filter==='all'||m.type===filter);
 return `<section class="morph-index"><h2>词根图鉴</h2><p>已点亮 ${unlocked.size} / ${data.entries.length} · 遇到相关单词就会留下发现记录。</p><div class="morph-filters" role="group" aria-label="词根类型">${[['all','全部'],['prefix','前缀'],['root','词根'],['suffix','后缀']].map(([key,label])=>`<button type="button" class="secondary" data-act="morpheme-filter" data-filter="${key}" aria-pressed="${filter===key}">${label}</button>`).join('')}</div><div class="morph-grid">${entries.map(m=>`<button type="button" class="morph-card ${unlocked.has(m.id)?'is-lit':''}" data-act="morpheme-family" data-morpheme-id="${esc(m.id)}"><small>${types[m.type]} · ${unlocked.has(m.id)?'已点亮':'待发现'}</small><strong lang="en">${esc(m.forms.join(' / '))}</strong><span>${esc(m.zh)}</span>${m.kanji?`<span class="morph-kanji">${esc(m.kanji)}</span>`:''}</button>`).join('')}</div></section>`;
}
const mounted=new WeakMap();
export async function mountWordEnrichment(scope,{vocab,state,resolveAnswer,allowedStudy,jaMeaning,filter='all'}={}){
 const nodes=[...scope.querySelectorAll('[data-word-details-id],[data-answer-details-id],[data-morpheme-index]')].filter(node=>!node.closest('details:not([open])'));
 if(!nodes.length)return;
 const data=await loadMorphemes();
 for(const node of nodes){
  if(!node.isConnected)continue;
  if(node.hasAttribute('data-morpheme-index')){node.innerHTML=morphemesView(data,vocab,state,filter);continue;}
  if(node.dataset.wordDetailsId){
   const word=vocab.find(w=>w.id===node.dataset.wordDetailsId);
   const allowed=node.hasAttribute('data-word-details-study')?allowedStudy?.(node):Boolean(resolveAnswer?.(word?.id));
   if(!word||!allowed){node.replaceChildren();continue;}
   if(mounted.get(node)===word.id)continue;
   node.innerHTML=wordPartsView(word,data);mounted.set(node,word.id);
  }else{
   const context=resolveAnswer?.(node.dataset.answerDetailsId);
   if(!context){node.replaceChildren();continue;}
   node.innerHTML=answerPartsView(context.ref,context.q,context.selected,context.correct,vocab,data,jaMeaning);
  }
 }
 return data;
}

export function morphemeIssueText(id,data,vocab){
 const m=data.entries.find(row=>row.id===id);if(!m)return '';
 return ['词根 ID　morph-'+m.id,'形式　'+m.forms.join(' / '),'类型　'+types[m.type],'中文　'+m.zh,'日语　'+m.ja,m.pos&&'词性　'+m.pos.join(' / '),m.kanji&&'汉字线索　'+m.kanji,m.noteZh&&'说明\n'+m.noteZh+'\n'+m.noteJa,'例词\n'+m.examples.map(id=>{const w=vocab.find(w=>w.id===id);return id+' · '+(w?.word||'')+' · '+(w?.zh||'');}).join('\n'),'来源\n'+m.sources.map(id=>data.sources[id].url).join('\n')].filter(Boolean).join('\n\n');
}
