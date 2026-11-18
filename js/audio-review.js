const STORAGE='toeic-island.audio-review.v1';
const QUEUE='./data/audio/review-queue.json';
const QUEUE_CACHE='toeic-island.audio-review.queue.v1';
const queueURL=new URL(QUEUE,location.href).href;
let loadGeneration=0,queueWrites=Promise.resolve();
const modelLabel=model=>model==='whisper-large-v3'?'完整 large-v3 识别':model==='whisper-large-v3-turbo'?'Turbo 识别':'当前自动转写';
const labels={ok:'没问题',problem:'有问题',unsure:'听不出来'};
const bankNames={part1:'Part 1',part2:'Part 2',listening:'Part 3 / 4',dictation:'听写',grammar:'语法',vocab:'单词',reading:'阅读',methods:'学习方法',terms:'术语',labels:'选项字母'};
const order={part1:0,part2:1,listening:2,dictation:2,grammar:3,vocab:4,reading:5};
const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const identity=row=>JSON.stringify([row.token,row.sha256]);
let rows=[],systemFallbackCount=0,visible=50,search='',filter='unresolved',decisions={},storageLocked=false,playing=null,generation=0;
const audio=$('review-audio');
function notice(text){$('review-notice').textContent=text;}
function safeSource(src){
  if(src==null||src==='')return '';
  if(typeof src!=='string')throw Error('录音地址格式错误');
  const url=new URL(src,location.href);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.origin!==location.origin&&url.protocol!=='https:')throw Error('录音地址格式错误');
  return url.href;
}
function parseQueue(value){
  const list=Array.isArray(value)?value:value?.version===1?value.entries:null;
  if(!Array.isArray(list))throw Error('复核清单格式错误');
  const fallbackCount=Array.isArray(value)?0:value.systemFallbackCount??0;
  if(!Number.isSafeInteger(fallbackCount)||fallbackCount<0)throw Error('系统声音统计格式错误');
  const tokens=new Set();
  const entries=list.map(item=>{
    if(!record(item)||!['en','ja'].includes(item.language)||![item.token,item.bank,item.key,item.text].every(x=>typeof x==='string'&&x.trim())||typeof item.recognized!=='string'||!sha(item.sha256)||tokens.has(item.token))throw Error('复核清单有缺失、重复或无音频指纹的条目');
    tokens.add(item.token);
    const src=safeSource(item.src);
    if(!src&&!item.systemFallback)throw Error('复核条目缺少录音地址');
    if(item.recognitionModel!==undefined&&!['whisper-large-v3-turbo','whisper-large-v3'].includes(item.recognitionModel))throw Error('当前识别模型格式错误');
    if(item.fullRecognition!==undefined&&(!record(item.fullRecognition)||item.fullRecognition.model!=='whisper-large-v3'||typeof item.fullRecognition.recognized!=='string'||!item.fullRecognition.recognized.trim()))throw Error('完整模型转写格式错误');
    return {...item,src,reason:typeof item.reason==='string'?item.reason:''};
  }).sort((a,b)=>{
    const group=x=>x.language==='ja'?10:(order[x.bank]??6);
    const urgency=x=>typeof x.priority==='number'?x.priority:x.priority==='high'?0:1;
    return group(a)-group(b)||urgency(a)-urgency(b)||a.token.localeCompare(b.token,'en');
  });
  return {entries,systemFallbackCount:fallbackCount};
}
function readSaved(){
  try{
    const raw=localStorage.getItem(STORAGE);if(!raw)return;
    const saved=JSON.parse(raw);
    if(!record(saved)||saved.version!==1||!record(saved.decisions))throw Error('bad save');
    const valid=Object.entries(saved.decisions).every(([key,item])=>record(item)&&typeof item.token==='string'&&sha(item.sha256)&&key===identity(item)&&['',...Object.keys(labels)].includes(item.label)&&typeof item.note==='string'&&item.note.length<=2000&&Number.isFinite(item.updatedAt));
    if(!valid)throw Error('bad save');
    decisions=saved.decisions;
  }catch{
    storageLocked=true;notice('原有复核记录暂时无法读取，页面不会覆盖它。本次判断仍可复制导出，请先保留导出的文字。');
  }
}
function current(row){return decisions[identity(row)];}
function write(row,change){
  const entry={token:row.token,sha256:row.sha256,label:'',note:'',...current(row),...change,updatedAt:Date.now()};
  decisions[identity(row)]=entry;
  if(!storageLocked)try{localStorage.setItem(STORAGE,JSON.stringify({version:1,decisions}));}catch{notice('本机暂时无法保存复核记录。本次判断仍在页面中，请复制导出后再离开。');}
  updateCounts();
  const article=$('review-list').querySelector(`[data-row="${rows.indexOf(row)}"]`);
  if(article){
    for(const button of article.querySelectorAll('[data-label]'))button.setAttribute('aria-pressed',String(entry.label===button.dataset.label));
    article.querySelector('.review-saved').textContent=entry.label?`当前判断：${labels[entry.label]}${storageLocked?' · 本次仅保留在页面':''}`:entry.note?'备注已记录':'尚未判断';
  }
}
function matches(row){
  const item=current(row),hasRecord=Boolean(item?.label||item?.note);
  return (filter==='all'||filter==='mine'&&hasRecord||filter==='unresolved'&&!item?.label)&&(!search||[row.text,row.recognized,row.fullRecognition?.recognized??'',row.token,row.reason,bankNames[row.bank]||row.bank].some(s=>s.toLocaleLowerCase().includes(search)));
}
function updateCounts(){
  $('review-processed').textContent=systemFallbackCount?`另有 ${systemFallbackCount} 条日语已改用设备声音，无需在此复听原录音。`:'';
  const judged=rows.filter(row=>current(row)?.label).length,problem=rows.filter(row=>current(row)?.label==='problem').length;
  $('review-counts').innerHTML=`<span><strong>${rows.length}</strong>全部条目</span><span><strong>${rows.length-judged}</strong>尚未判断</span><span><strong>${problem}</strong>标记有问题</span>`;
  $('review-export').disabled=!Object.values(decisions).some(item=>item.label||item.note);
}
function rowHTML(row){
  const index=rows.indexOf(row),saved=current(row),lang=row.language==='ja'?'ja':'en';
  const full=row.fullRecognition&&row.fullRecognition.recognized!==row.recognized;
  const transcripts=`<div class="review-copy-block"><strong>${modelLabel(row.recognitionModel)} · 可能识别有误</strong><p class="review-asr" lang="${lang}">${esc(row.recognized||'（转写为空）')}</p></div>${full?`<div class="review-copy-block"><strong>完整 large-v3 识别 · 同一段录音</strong><p class="review-asr-full" lang="${lang}">${esc(row.fullRecognition.recognized)}</p></div>`:''}`;
  return `<article class="review-row" data-row="${index}" data-token="${esc(row.token)}" data-sha256="${row.sha256}"><header class="review-row-head"><h2>${esc(bankNames[row.bank]||row.bank)} · ${row.language==='ja'?'日语':'英语'}<small class="review-key">${esc(row.key)}</small></h2><span class="review-badge">${row.systemFallback?'系统语音回退':'录音复核'}</span></header><div class="review-copy-block"><strong>原文</strong><p class="review-source" lang="${lang}">${esc(row.text)}</p></div>${transcripts}${row.reason?`<p class="review-reason">关注点：${esc(row.reason)}</p>`:''}${row.systemFallback?`<p class="review-fallback">${row.src?'游戏当前使用系统语音；下面播放的是保留供复核的录音。':'没有可访问的原录音，暂不能判断其质量。可试听设备语音并留下备注；设备声音不代表原录音。'}</p>`:''}<div class="review-play-buttons"><button class="secondary" data-act="review-play" data-rate="0.75" ${row.src?'':'disabled'}>↻ 播放 0.75×</button><button class="secondary" data-act="review-play" data-rate="1" ${row.src?'':'disabled'}>↻ 播放 1×</button>${!row.src?'<button class="secondary" data-act="review-system">听设备语音</button>':''}</div><fieldset class="review-verdicts" ${row.src?'':'disabled'}><legend>这段录音听起来怎样？</legend><div class="review-labels">${Object.entries(labels).map(([value,label])=>`<button data-act="review-label" data-label="${value}" aria-pressed="${saved?.label===value}">${label}</button>`).join('')}</div></fieldset><label>备注（选填）<textarea data-note maxlength="2000" placeholder="例如：句末听不清、数字和原文不同">${esc(saved?.note||'')}</textarea></label><p class="review-saved" role="status">${saved?.label?'当前判断：'+labels[saved.label]:saved?.note?'备注已记录':'尚未判断'}</p></article>`;
}
function render(){
  const matching=rows.filter(matches),shown=matching.slice(0,visible);
  $('review-list').innerHTML=shown.length?shown.map(rowHTML).join(''):'<p class="empty">这里暂时没有条目。可以切换筛选或清空搜索。</p>';
  $('review-result-count').textContent=`符合条件 ${matching.length} 条 · 已显示 ${shown.length} 条`;
  $('review-more').hidden=shown.length>=matching.length;
  $('review-more').textContent=`再显示 ${Math.min(50,matching.length-shown.length)} 条`;
  updateCounts();
}
function playerStatus(text,state='idle'){const el=$('review-audio-status');el.textContent=text;el.dataset.state=state;}
function stop(){
  generation++;audio.onended=null;audio.onerror=null;audio.onplaying=null;audio.pause();audio.removeAttribute('src');audio.load();
  if(playing?.system)window.speechSynthesis?.cancel();
  playing=null;$('review-stop').disabled=true;
}
function play(row,rate){
  if(!row.src)return;
  stop();const ticket=generation;playing={row,rate};$('review-stop').disabled=false;
  audio.src=row.src;audio.playbackRate=rate;audio.preservesPitch=true;audio.webkitPreservesPitch=true;audio.currentTime=0;
  playerStatus(`正在载入 · ${bankNames[row.bank]||row.bank} · ${rate}×`,'loading');
  audio.onplaying=()=>{if(ticket===generation)playerStatus(`正在播放 · ${row.key} · ${rate}×`,'playing');};
  audio.onended=()=>{if(ticket===generation){playerStatus('播放结束，可以再次点击重播');$('review-stop').disabled=true;playing=null;}};
  const failure=()=>{if(ticket===generation){stop();playerStatus('录音暂时无法播放，请检查网络后重新点击。','error');}};
  audio.onerror=failure;
  try{const result=audio.play();result?.catch(failure);}catch{failure();}
}
function system(row){
  stop();const synth=window.speechSynthesis;
  if(!synth||!window.SpeechSynthesisUtterance){playerStatus('这个浏览器未提供设备语音。','error');return;}
  const language=row.language==='ja'?'ja-JP':'en-US',utterance=new SpeechSynthesisUtterance(row.text),ticket=generation;
  const candidates=synth.getVoices().filter(voice=>voice.lang.replace('_','-').startsWith(row.language)&&!/bad news|bells|boing|whisper|trinoids|zarvox|jester/i.test(voice.name)).sort((a,b)=>Number(/premium|enhanced/i.test(b.name))-Number(/premium|enhanced/i.test(a.name))||a.name.localeCompare(b.name));
  if(candidates[0])utterance.voice=candidates[0];utterance.lang=language;utterance.rate=1;
  playing={row,system:true};$('review-stop').disabled=false;
  utterance.onstart=()=>{if(ticket===generation)playerStatus('正在试听设备声音（不是原录音）','playing');};
  utterance.onend=()=>{if(ticket===generation){playing=null;$('review-stop').disabled=true;playerStatus('设备语音试听结束，不能据此判断原录音。');}};
  utterance.onerror=()=>{if(ticket===generation){stop();playerStatus('设备声音暂不可用，请在 Safari 中重新尝试。','error');}};
  synth.speak(utterance);
}
function exportText(){
  const active=new Map(rows.map(row=>[identity(row),row]));
  const saved=Object.entries(decisions).filter(([,item])=>item.label||item.note);
  return ['芽语岛音频复核记录',`记录数量：${saved.length}（只在你复制后自行发送）`,'',...saved.flatMap(([key,item])=>{
    const row=active.get(key);
    return [`条目：${item.token}`,`音频 SHA-256：${item.sha256}`,`状态：${row?'当前队列':'旧版本或已移出队列，不能套用到新录音'}`,`判断：${labels[item.label]||'尚未判断'}`,...(row?[`原文：${row.text}`,`${modelLabel(row.recognitionModel)}：${row.recognized}`,...(row.fullRecognition&&row.fullRecognition.recognized!==row.recognized?[`完整 large-v3 转写：${row.fullRecognition.recognized}`]:[]),`播放地址：${row.src||'无原录音'}`]:[]),`备注：${item.note||'无'}`,''];
  })].join('\n');
}
function copyFallback(text){
  $('review-copy-wrap').hidden=false;const box=$('review-copy-text');box.value=text;box.focus();box.select();box.setSelectionRange(0,text.length);
  $('review-copy-status').textContent='自动复制未成功，文字已全选。请长按并选择「拷贝」，再自行粘贴；页面不会发送记录。';
}
function copy(){const text=exportText();try{const result=navigator.clipboard?.writeText(text);if(!result)return copyFallback(text);result.then(()=>{$('review-copy-wrap').hidden=true;$('review-copy-status').textContent='已复制。请自行粘贴回对话，页面不会自动发送。';}).catch(()=>copyFallback(text));}catch{copyFallback(text);}}
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-act]');if(!button||button.disabled||button.closest('fieldset:disabled'))return;
  const action=button.dataset.act,index=Number(button.closest('[data-row]')?.dataset.row),row=rows[index];
  if(action==='review-play'&&row)play(row,Number(button.dataset.rate));
  else if(action==='review-system'&&row)system(row);
  else if(action==='review-label'&&row&&row.src)write(row,{label:button.dataset.label});
  else if(action==='review-stop'){stop();playerStatus('播放已停止');}
  else if(action==='review-more'){const y=scrollY;visible+=50;render();scrollTo(0,y);}
  else if(action==='review-export')copy();
  else if(action==='review-retry')load();
});
document.addEventListener('input',event=>{
  if(event.target.matches('[data-note]')){const row=rows[Number(event.target.closest('[data-row]').dataset.row)];if(row)write(row,{note:event.target.value.slice(0,2000)});}
});
let composing=false;
const applySearch=()=>{const value=$('review-search').value.trim().toLocaleLowerCase();if(value===search)return;search=value;visible=50;render();};
$('review-search').addEventListener('compositionstart',()=>{composing=true;});
$('review-search').addEventListener('compositionend',()=>{composing=false;applySearch();});
$('review-search').addEventListener('input',event=>{if(!composing&&!event.isComposing)applySearch();});
$('review-filter').addEventListener('change',()=>{filter=$('review-filter').value;visible=50;render();});
window.addEventListener('pagehide',stop);
async function cacheQueue(value,ticket){
  // The page owns validated queue writes. Serialize puts so an older in-flight
  // write cannot complete after a newer load and replace the newer snapshot.
  const write=queueWrites.then(async()=>{
    if(ticket!==loadGeneration||!globalThis.caches)return false;
    const cache=await caches.open(QUEUE_CACHE);
    if(ticket!==loadGeneration)return false;
    await cache.put(queueURL,new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json; charset=utf-8'}}));
    return true;
  });
  queueWrites=write.catch(()=>false);
  return queueWrites;
}
async function cachedQueue(){
  if(!globalThis.caches)return null;
  try{
    const response=await(await caches.open(QUEUE_CACHE)).match(queueURL);
    if(!response)return null;
    return parseQueue(await response.json());
  }catch{return null;}
}
function queueStatus(message,source){
  const status=$('review-queue-status');status.textContent=message;status.dataset.source=source;
}
async function load(){
  const ticket=++loadGeneration;
  $('review-list').setAttribute('aria-busy','true');
  const retry=$('review-list').querySelector('[data-act="review-retry"]');if(retry)retry.disabled=true;
  try{
    const response=await fetch(queueURL,{cache:'no-cache'});if(!response.ok)throw Error('download');
    const value=await response.json(),parsed=parseQueue(value);
    const saved=await cacheQueue(value,ticket);
    if(ticket!==loadGeneration)return;
    rows=parsed.entries;systemFallbackCount=parsed.systemFallbackCount;render();
    queueStatus(saved?'清单已更新并保存在本机。录音需已缓存或联网播放。':'清单已读取；此浏览器暂未保存离线副本。','network');
  }catch{
    const fallback=await cachedQueue();
    if(ticket!==loadGeneration)return;
    if(fallback){
      rows=fallback.entries;systemFallbackCount=fallback.systemFallbackCount;render();queueStatus('当前使用本机保存的复核清单。录音需已缓存或恢复网络后播放。','cache');
    }else{
      $('review-list').innerHTML='<div class="empty"><p>复核清单暂时无法读取。请联网后重试，已有本机记录会保留。</p><button class="secondary" data-act="review-retry">重新读取</button></div>';updateCounts();
      queueStatus('还没有可用的离线清单。','error');
    }
  }
  finally{if(ticket===loadGeneration)$('review-list').setAttribute('aria-busy','false');}
}
readSaved();load();
