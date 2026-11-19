const packs=new Map(),pending=new Map(),cacheWrites=new Map();
let generation=0;
/** A visible retry must be able to replace a valid but obsolete cached pack. */
export function invalidateOptionDetails(){generation++;packs.clear();pending.clear();}
const staticBanks=new Set(['part1','part2','grammar','listening','reading']);
const normalize=text=>String(text).normalize('NFKC').trim().toLowerCase().replace(/\s+/gu,' ');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const nonempty=value=>typeof value==='string'&&!!value.trim();
const bankFor=mode=>mode==='dialogue'?'listening':mode;
function hash(text){let n=2166136261;for(const c of text)n=Math.imul(n^c.codePointAt(0),16777619);return(n>>>0).toString(16).padStart(8,'0');}
export const optionLexemeId=text=>'lex-'+hash(normalize(text));
export const optionLexiconBucket=text=>/^[a-z]/.test(normalize(text))?normalize(text)[0]:'other';

/** Binds stored explanations to the actual prompt/material, answer and options. */
export function optionSourceSignature(ref,q){
  if(ref.mode==='vocab')return hash(JSON.stringify([q.id,q.word,q.pos,q.zh,q.example,q.clozeDistractors]));
  const prompt=ref.mode==='part1'?q.description:ref.mode==='part2'?(typeof q.audio==='string'?q.audio:q.turns?.[0]?.text):q.prompt;
  return hash(JSON.stringify([ref.id,ref.mode,prompt,q.options,q.answer,q.evidence||'',q.zh||'',
    q.set?.turns?.map(turn=>[turn.speaker,turn.text])||null,q.set?.documents?.map(doc=>[doc.title,doc.text,doc.table||null])||null]));
}
function persistPack(name,cache,url,response,started){
  if(!cache)return Promise.resolve();
  // Keep this lane across invalidation: a started Cache.put cannot be cancelled.
  // A newer write must finish after it; stale fetches still waiting to write skip.
  const job=(cacheWrites.get(name)||Promise.resolve()).then(async()=>{
    if(started===generation)await cache.put(url,response);
  }).catch(()=>{}); // Storage failure must not discard usable older offline data.
  cacheWrites.set(name,job);
  void job.then(()=>{if(cacheWrites.get(name)===job)cacheWrites.delete(name);});
  return job;
}
async function loadPack(name){
  if(!/^(?:vocab|part1|part2|grammar|listening|reading|lexicon\/(?:[a-z]|other))$/.test(name))throw Error('无法识别选项释义题库');
  if(packs.has(name))return packs.get(name);
  if(!pending.has(name)){const started=generation;const job=(async()=>{
    const url=`./data/options/${name}.json`;let cache,pack;
    try{cache=await globalThis.caches?.open('toeic-island-option-details-v1');}catch{}
    const valid=value=>object(value)&&value.version===1&&object(value.entries);
    try{
      const response=await fetch(url,{cache:'no-cache'});if(!response.ok)throw Error('download');
      pack=await response.clone().json();if(!valid(pack))throw Error('format');
      await persistPack(name,cache,url,response,started);
    }catch{
      await cacheWrites.get(name);
      try{const saved=await cache?.match(url);pack=saved?await saved.json():null;}catch{pack=null;}
    }
    if(!valid(pack))throw Error('这部分选项释义尚未下载，请联网后重试。');
    if(started===generation)packs.set(name,pack.entries);return pack.entries;
  })().finally(()=>{if(pending.get(name)===job)pending.delete(name);});pending.set(name,job);}
  return pending.get(name);
}
async function lexical(text){
  const entries=await loadPack('lexicon/'+optionLexiconBucket(text));
  const value=Object.hasOwn(entries,normalize(text))?entries[normalize(text)]:null;
  if(!value||![value.pos,value.zh,value.ja].every(nonempty)||!Array.isArray(value.lexemes))throw Error(`词典尚未覆盖此选项：${text}`);
  return value;
}
async function japaneseMeanings(provided){
  if(provided)return provided;
  const {loadLanguage}=await import('./translations.js');
  return loadLanguage('vocab-meanings','ja');
}
const jaFor=(meanings,id)=>meanings[`${id}/meaning`]??meanings[id];
function wordLexeme(word,meanings){
  const ja=jaFor(meanings,word.id);
  if(!nonempty(ja))throw Error(`日语词义尚未下载：${word.word}`);
  return {id:word.id,wordId:word.id,word:word.word,pos:word.pos,zh:word.zh,ja,
    ...(word.sense?{sense:word.sense}:{}),...(word.ipa?{ipa:word.ipa}:{}),...(word.example?{example:word.example}:{})};
}
const compactMeanings=lexemes=>[...new Set(lexemes.map(item=>item.zh))].join('；');
const compactJapanese=lexemes=>[...new Set(lexemes.map(item=>item.ja))].join('；');
const compactPOS=lexemes=>[...new Set(lexemes.map(item=>item.pos))].join(' / ');
const lexemeDefinition=lexemes=>({pos:compactPOS(lexemes),zh:compactMeanings(lexemes),ja:compactJapanese(lexemes),lexemes});
const partsOfSpeech=pos=>[...String(pos).matchAll(/(?:^|[^A-Za-z])(adj|adv|prep|n|v)\./g)].map(match=>match[1]);
async function clozeDefinition(option,target,canonical){
  const required=partsOfSpeech(target.pos);
  const compatible=lexeme=>partsOfSpeech(lexeme.pos).some(pos=>required.includes(pos));
  const matching=canonical.filter(compatible);
  if(matching.length)return lexemeDefinition(matching);
  const surface=await lexical(option),dictionary=surface.lexemes.filter(compatible);
  if(dictionary.length){
    // Keep derived-form labels when every underlying sense already fits.
    return dictionary.length===surface.lexemes.length?surface:lexemeDefinition(dictionary);
  }
  // A participle can act as an adjective, and a gerund as a noun. Without an
  // explicit compatible sense, retain the known surface form and base card.
  return canonical.length?lexemeDefinition(canonical):surface;
}
const refCopy=ref=>({id:ref.id,mode:ref.mode,...(ref.format?{format:ref.format}:{})});

async function vocabularyDetails(ref,q,{vocab,jaMeanings}={}){
  if(!Array.isArray(vocab)||!vocab.length)throw Error('请先加载单词题库，再查看选项释义。');
  const target=vocab.find(word=>word.id===ref.id);
  if(!target||!Array.isArray(q.options))throw Error('当前词卡不存在，无法查看释义。');
  const format=ref.format||'meaning';
  if(!['meaning','english','sound','cloze','match','meaning-ja','english-ja'].includes(format))throw Error('无法识别单词题型');
  const meanings=await japaneseMeanings(jaMeanings),targetLexeme=wordLexeme(target,meanings);
  let cloze;
  if(format==='cloze'){
    const entries=await loadPack('vocab');cloze=entries[ref.id];
    if(!cloze||cloze.signature!==optionSourceSignature(ref,q))throw Error('这张词卡的选项解析已更新，请联网重新打开。');
  }
  const options=await Promise.all(q.options.map(async option=>{
    const correct=option===q.answer;
    let candidates=[];
    if(correct)candidates=[target];
    else if(format==='meaning')candidates=vocab.filter(word=>word.zh===option);
    else if(format==='meaning-ja')candidates=vocab.filter(word=>jaFor(meanings,word.id)===option);
    else if(format==='match')candidates=vocab.filter(word=>word.paraphrase===option);
    else candidates=vocab.filter(word=>normalize(word.word)===normalize(option));
    const lexemes=candidates.map(word=>wordLexeme(word,meanings));
    if(!lexemes.length&&['english','sound'].includes(format)){
      const curated=await (await import('./confusables.js')).curatedOptionLexeme(target.id,option).catch(()=>null);
      if(curated)lexemes.push({...curated});
    }
    const definition=format==='cloze'&&!correct?await clozeDefinition(option,target,lexemes):lexemes.length?lexemeDefinition(lexemes):await lexical(option);
    let reasonZh;
    if(format==='cloze'){
      reasonZh=cloze.reasons?.[option];
      if(!nonempty(reasonZh))throw Error(`填空解析缺少这个选项：${option}`);
    }else if(correct){
      reasonZh=format==='sound'?`本次朗读的是 ${target.word} ${target.ipa}，拼写与这个选项一致，意思是“${target.zh}”。`
        :format==='match'?`“${option}”是在解释 ${target.word}${target.sense?` 的“${target.sense}”义项`:''}，对应“${target.zh}”。`
        :`${target.word}${target.sense?` 在本题的“${target.sense}”义项中`:''}表示“${target.zh}”，日语可表达为“${targetLexeme.ja}”，所以这一组词与释义相对应。`;
    }else if(format==='sound'){
      reasonZh=`${option} 表示“${definition.zh}”；本次发音是 ${target.word} ${target.ipa}，需要选择它的拼写，词义为“${target.zh}”。`;
    }else if(['meaning','meaning-ja','match'].includes(format)){
      const heads=[...new Set(definition.lexemes.map(item=>item.word))].join(' / ');
      reasonZh=`这一选项表达“${definition.zh}”${heads?`，对应 ${heads}`:''}；题干的 ${target.word}${target.sense?` 此处取“${target.sense}”义`:''}表示“${target.zh}”，两者的词义不同。`;
    }else{
      reasonZh=`${option} 表示“${definition.zh}”；题干要求“${target.zh}”${format==='english-ja'?`（${targetLexeme.ja}）`:''}，应与 ${target.word} 对应。`;
    }
    const spokenEnglish=['meaning','meaning-ja'].includes(format)?[...new Set(definition.lexemes.map(item=>item.word))].join(', '):option;
    return {text:option,spokenEnglish,kind:format==='match'?'phrase':'word',correct,reasonZh,...definition,collectible:definition.lexemes.length>0};
  }));
  return {id:ref.id,ref:refCopy(ref),sourceSignature:optionSourceSignature(ref,q),context:target.example,options};
}

/** Fetch only the active bank (and needed dictionary letters) after answer review opens. */
export async function loadOptionDetails(ref,q,settings={}){
  if(settings.refresh)invalidateOptionDetails();
  if(!ref||!q||!Array.isArray(q.options)||!q.options.length)return null;
  if(ref.mode==='vocab')return vocabularyDetails(ref,q,settings);
  if(ref.mode==='confusable')return (await import('./confusables.js')).confusableOptionDetails(ref,q);
  const bank=bankFor(ref.mode);if(!staticBanks.has(bank))throw Error('这类练习没有可查看的选项释义');
  const entries=await loadPack(bank),entry=entries[ref.id];
  if(!entry||entry.signature!==optionSourceSignature(ref,q)||!Array.isArray(entry.options))throw Error('本题选项解析与当前题目不同，请联网更新后重试。');
  if(entry.options.length!==q.options.length||entry.options.some(option=>!q.options.includes(option.text)))throw Error('选项解析未能与题目逐项对应。');
  let translations;
  if(entry.options.some(option=>option.translationKeys?.length)){
    const {loadLanguage}=await import('./translations.js');
    const [zh,ja]=await Promise.all(['zh','ja'].map(lang=>loadLanguage(bank,lang)));translations={zh,ja};
  }
  const options=await Promise.all(q.options.map(async text=>{
    const stored=entry.options.find(option=>option.text===text);
    if(!stored||!nonempty(stored.reasonZh)||!['word','phrase','sentence','position'].includes(stored.kind))throw Error('本题有未完成的选项解析');
    let definition;
    if(stored.lexical){definition=await lexical(stored.lexical);}
    else if(stored.translationKeys?.length){
      const translate=lang=>stored.translationKeys.map(key=>{const value=translations[lang][key];if(!nonempty(value))throw Error('选项译文没有完整下载，请联网重试。');return value;}).join('');
      definition={pos:stored.pos||'',zh:translate('zh'),ja:translate('ja'),lexemes:[]};
      if(stored.kind==='phrase'||stored.kind==='word'){
        if(!nonempty(definition.pos))throw Error('词或短语选项缺少词性说明');
        // Phrase snapshots remain useful even if their original question later retires.
        definition.lexemes=[{id:optionLexemeId([text,definition.pos,definition.zh,definition.ja].join('|')),word:text,pos:definition.pos,zh:definition.zh,ja:definition.ja}];
      }
    }else if(stored.kind==='position')definition={pos:'插入位置标记',zh:`插入位置 ${text}`,ja:`挿入位置 ${text}`,lexemes:[]};
    else throw Error('选项缺少可核对的词义或译文来源');
    return {text,spokenEnglish:text,kind:stored.kind,correct:text===q.answer,reasonZh:stored.reasonZh,...definition,collectible:definition.lexemes.length>0};
  }));
  return {id:ref.id,ref:refCopy(ref),sourceSignature:entry.signature,context:entry.context||q.prompt||'',options};
}
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderOptionDetails(details,s={}){
  if(!details?.options?.length)return '';
  const collected=new Set((s.personalVocab?.items||[]).map(item=>item.key));
  return `<section class="option-details" aria-label="逐项释义与理由"><h3>看懂每一个选项</h3>${details.options.map((option,index)=>`<details open class="option-detail" data-option-index="${index}"><summary><span>${String.fromCharCode(65+index)} · ${esc(option.text)}</span><span class="option-result${option.correct?' is-correct':''}">${option.correct?'正确':'未选用'}</span></summary><div class="option-detail-body">${option.pos?`<p class="option-pos">${esc(option.pos)}</p>`:''}<p lang="zh-CN">${esc(option.zh)}</p><p lang="ja">${esc(option.ja)}</p>${option.kind==='position'?'':`<div class="option-audio-actions"><button class="secondary" data-act="option-en" data-option-index="${index}">朗读英文</button><button class="secondary" data-act="option-ja" data-option-index="${index}">朗读日语</button></div>`}<p class="option-reason"><strong>${option.correct?'为什么正确':'为什么不能选'}</strong><br>${esc(option.reasonZh)}</p>${option.lexemes.length?`<div class="option-collect-list">${option.lexemes.map((lexeme,lexemeIndex)=>{const key=lexeme.wordId||'personal-'+lexeme.id;const saved=collected.has(key);return `<div class="option-lexeme-actions"><button class="secondary" data-act="option-collect" data-option-index="${index}" data-lexeme-index="${lexemeIndex}" ${saved?'disabled':''}>${saved?'已收藏':'＋ 加入我的单词本'} · ${esc(lexeme.word)}${lexeme.sense?'（'+esc(lexeme.sense)+'）':'（'+esc(lexeme.pos)+'）'}</button>${lexeme.wordId?`<button class="secondary" data-act="option-word" data-option-index="${index}" data-lexeme-index="${lexemeIndex}">查看词卡</button>`:''}</div>`;}).join('')}</div>`:''}</div></details>`).join('')}</section>`;
}
