// Standalone audition preferences deliberately use a separate storage key.
const STORAGE_KEY = 'toeic-island-audition-v1';
const audio = document.querySelector('#audition-audio');
const content = document.querySelector('#audition-content');
const status = document.querySelector('#audition-status');
const groupNames = { 'us-female':'美式 · 女声', 'us-male':'美式 · 男声', 'uk-female':'英式 · 女声', 'uk-male':'英式 · 男声', ja:'日语 · Kokoro' };
const groups = ['us-female','us-male','uk-female','uk-male'];
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const clampRate = value => Number.isFinite(Number(value)) ? Math.min(1.2, Math.max(.75, Number(value))) : 1;
let source, manifest, tab = 'en', generation = 0, run = null, lastPlayback = null, loadTimer;
let systemVoices = [], utterance = null;
let selected = { enVoice:'', enSample:'', jaVoice:'', jaSample:'', system:'', pairA:'', pairB:'' };
let preferences = { version:1, english:[], japanese:null, rate:1 };
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  if (saved?.version === 1) {
    preferences.english = Array.isArray(saved.english) ? [...new Set(saved.english.filter(id => typeof id === 'string'))].slice(0,4) : [];
    if (saved.japanese?.kind === 'kokoro' && typeof saved.japanese.voiceId === 'string') preferences.japanese = { kind:'kokoro', voiceId:saved.japanese.voiceId };
    if (saved.japanese?.kind === 'system' && typeof saved.japanese.voiceURI === 'string') preferences.japanese = { kind:'system', voiceURI:saved.japanese.voiceURI, name:String(saved.japanese.name || ''), lang:'ja-JP' };
    preferences.rate = clampRate(saved.rate ?? 1);
  }
} catch { /* Browsing and listening also work when storage is unavailable. */ }
const voice = id => source?.voices.find(item => item.id === id);
const sample = id => source?.samples.find(item => item.id === id);
const languageOf = item => item?.group === 'ja' || /^ja/i.test(item?.lang || '') ? 'ja' : 'en';
const samplesFor = language => source.samples.filter(item => item.language === language);
const voicesFor = language => source.voices.filter(item => languageOf(item) === language);
const voiceKey = item => item.voiceURI || `${item.name}|${item.lang}`;
const nameOf = item => item?.name || item?.id || '未选择';
function notice(message = '') { document.querySelector('#audition-notice').textContent = message; }
function savePreferences() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)); }
  catch { notice('浏览器暂时无法保存选择，请用下方复制按钮留存。'); }
}
function setStatus(state, message) {
  status.dataset.state = state;
  status.textContent = message;
  const pause = document.querySelector('#audition-pause');
  pause.disabled = !run || !['playing','loading','paused'].includes(state);
  pause.textContent = state === 'paused' ? '继续' : '暂停';
  document.querySelector('#audition-replay').disabled = !lastPlayback;
}
function highlight(key = '') {
  for (const line of document.querySelectorAll('[data-segment-key]')) line.classList.toggle('is-speaking', line.dataset.segmentKey === key);
}
function stopAll({ forget = false, message = '已停止，点击开始试听' } = {}) {
  generation++;
  clearTimeout(loadTimer);
  run = null;
  utterance = null;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  window.speechSynthesis?.cancel();
  if (forget) lastPlayback = null;
  highlight();
  setStatus('idle', message);
}
function playbackError(message) {
  stopAll({ message });
  setStatus('error', message);
}
function mediaURL(value) {
  if (typeof value !== 'string') throw Error('这个样本的音频尚未准备好，请稍后重试。');
  const url = new URL(value, location.href);
  const base = new URL('./audio/audition/', location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith(base.pathname) || !/\.m4a$/i.test(url.pathname)) throw Error('音频路径有误，请重新读取试听清单。');
  return url.href;
}
function clipFor(voiceId, sampleId, key) {
  const clip = manifest?.clips?.[voiceId]?.[sampleId];
  return key === undefined ? clip : clip?.segments?.find(segment => segment.key === key);
}
function configureRate() {
  audio.playbackRate = preferences.rate;
  audio.preservesPitch = true;
  if ('webkitPreservesPitch' in audio) audio.webkitPreservesPitch = true;
}
function playAudioItem(current) {
  if (run !== current || current.token !== generation) return;
  const item = current.queue[current.index];
  try {
    audio.src = mediaURL(item.clip?.src);
    audio.preload = 'none';
    audio.load();
    configureRate();
    highlight(item.key);
    setStatus('loading', `正在加载 · ${current.label}${current.queue.length > 1 ? ` · ${current.index + 1}/${current.queue.length}` : ''}`);
    clearTimeout(loadTimer);
    loadTimer = setTimeout(() => {
      if (run === current && status.dataset.state === 'loading') playbackError('音频加载较慢，请检查网络后点重播。');
    }, 20000);
    // Called in the click stack for the first clip. Subsequent dialogue clips
    // reuse this same, already-unlocked audio element on iOS.
    const result = audio.play();
    result?.then(() => {
      if (run !== current || current.token !== generation) return;
      clearTimeout(loadTimer);
      if (current.paused) return;
      setStatus('playing', `正在播放 · ${current.label}${current.queue.length > 1 ? ` · ${current.index + 1}/${current.queue.length}` : ''}`);
    }).catch(error => {
      if (run !== current || current.token !== generation || current.paused) return;
      playbackError(error?.name === 'NotAllowedError' ? '浏览器需要再次点击播放，请点重播。' : '音频未能播放，请检查网络后点重播。');
    });
  } catch (error) { playbackError(error.message || '音频未能播放，请点重播。'); }
}
function syncVoiceSelection(language, id) {
  selected[language + 'Voice'] = id;
  const select = document.querySelector(`#audition-${language}-voice`);
  if (select) select.value = id;
  for (const card of document.querySelectorAll(`.voice-card[data-language="${language}"]`)) card.classList.toggle('is-current', card.dataset.voice === id);
  const note = document.querySelector(`#audition-${language}-current-voice`);
  if (note) note.textContent = `当前：${nameOf(voice(id))}`;
}
function playClip(voiceId, sampleId, index) {
  stopAll();
  const v = voice(voiceId), s = sample(sampleId);
  if (!v || !s || languageOf(v) !== s.language) { playbackError('声音与样本不匹配，请重新选择。'); return; }
  syncVoiceSelection(s.language, voiceId);
  const segment = Number.isInteger(index) ? s.segments[index] : null;
  if (Number.isInteger(index) && !segment) { playbackError('未找到这句样本，请重新选择。'); return; }
  lastPlayback = { kind:'clip', voiceId, sampleId, ...(segment ? { index } : {}) };
  const label = `${nameOf(v)} · ${s.title}${segment ? ` · 第${index + 1}句` : ''}`;
  run = { token:generation, kind:'audio', label, index:0, queue:[{ clip:clipFor(voiceId,sampleId,segment?.key), key:segment?.key }] };
  playAudioItem(run);
}
function pairSample() {
  return samplesFor('en').find(s => /part\s*3|conversation|dialogue/i.test(s.kind || '') && new Set(s.segments.map(t => t.speaker).filter(Boolean)).size === 2)
    || samplesFor('en').find(s => new Set(s.segments.map(t => t.speaker).filter(Boolean)).size === 2);
}
function playPair() {
  stopAll();
  const s = pairSample(), first = voice(selected.pairA), second = voice(selected.pairB);
  if (!s || !first || !second || first.id === second.id) { playbackError('请为两位说话人选择不同的英语声音。'); return; }
  const speakers = [...new Set(s.segments.map(t => t.speaker).filter(Boolean))];
  const ids = [first.id,second.id];
  const queue = s.segments.map(segment => ({ key:segment.key, clip:clipFor(ids[Math.max(0,speakers.indexOf(segment.speaker))], s.id, segment.key) }));
  if (queue.some(item => !item.clip?.src)) { playbackError('这段对话的逐句音频尚未准备好，请先试听完整样本。'); return; }
  selected.enSample = s.id;
  document.querySelector('#audition-en-sample').value = s.id;
  renderTranscript('en');
  lastPlayback = { kind:'pair', a:first.id, b:second.id };
  run = { token:generation, kind:'audio', label:`双人试配 · ${nameOf(first)} / ${nameOf(second)}`, index:0, queue };
  playAudioItem(run);
}
const novelty = /\b(albert|bad news|bells|boing|bubbles|jester|trinoids|whisper|zarvox|good news|cellos|deranged|hysterical|pipe organ|wobble|bahh)\b|おもしろ|面白|ロボット|ささやき|趣味声/i;
const traits = item => `${item.name} ${item.voiceURI}`.replace(/[_-]/g,' ');
const quality = item => /premium|高级|高級/i.test(traits(item)) ? 2 : /enhanced|增强|增強/i.test(traits(item)) ? 1 : 0;
function refreshSystemVoices() {
  const all = window.speechSynthesis?.getVoices() || [];
  systemVoices = [...new Map(all.filter(v => /^ja(?:[-_]|$)/i.test(v.lang) && !novelty.test(traits(v))).map(v => [voiceKey(v),v])).values()]
    .sort((a,b) => quality(b)-quality(a) || Number(/kyoko|otoya/i.test(traits(b)))-Number(/kyoko|otoya/i.test(traits(a))) || a.name.localeCompare(b.name,'ja'));
  const picker = document.querySelector('#audition-system-voice');
  if (!picker) return;
  const wanted = selected.system || (preferences.japanese?.kind === 'system' ? preferences.japanese.voiceURI : '');
  selected.system = systemVoices.some(v => voiceKey(v) === wanted) ? wanted : systemVoices[0] ? voiceKey(systemVoices[0]) : '';
  picker.innerHTML = systemVoices.length ? systemVoices.map(v => `<option value="${escape(voiceKey(v))}">${escape(v.name)}${quality(v) === 2 ? ' · 高级' : quality(v) === 1 ? ' · 增强' : ''}</option>`).join('') : '<option value="">尚未发现可用日语声音</option>';
  picker.value = selected.system;
  picker.disabled = !systemVoices.length;
  document.querySelector('#audition-system-play').disabled = !systemVoices.length;
  document.querySelector('#audition-system-pick').disabled = !systemVoices.length;
  document.querySelector('#audition-system-note').textContent = systemVoices.length ? `此设备可用 ${systemVoices.length} 个日语声音，已过滤趣味声，并优先排列增强或高级版本。` : '此页仅列出浏览器实际提供的日语声音。请先刷新列表；若仍无声音，可在 Safari 重新打开试听页。';
  updatePreferencesUI();
}
function speakSystem() {
  stopAll();
  const synthesis = window.speechSynthesis, v = systemVoices.find(item => voiceKey(item) === selected.system), s = sample(selected.jaSample);
  if (!synthesis || !window.SpeechSynthesisUtterance || !v || !s) { playbackError('此设备尚无可用日语声音，请刷新声音列表后再试。'); return; }
  const current = new SpeechSynthesisUtterance(s.segments.map(segment => segment.spoken || segment.text).join('\n'));
  current.voice = v;
  current.lang = v.lang || 'ja-JP';
  current.rate = preferences.rate;
  utterance = current;
  lastPlayback = { kind:'system', sampleId:s.id, voiceURI:voiceKey(v), name:v.name };
  const active = run = { token:generation, kind:'system', label:`系统日语 · ${v.name} · ${s.title}` };
  setStatus('loading', `准备朗读 · ${active.label}`);
  current.onstart = () => { if (run === active) { clearTimeout(loadTimer); if (!active.paused) setStatus('playing', `正在朗读 · ${active.label}`); } };
  current.onend = () => { if (run === active) { clearTimeout(loadTimer); utterance = null; run = null; setStatus('ended', `已播完 · ${active.label}`); } };
  current.onerror = event => { if (run === active && !['canceled','interrupted'].includes(event.error)) playbackError('系统日语朗读失败，请重新点击试听或选择另一个声音。'); };
  loadTimer = setTimeout(() => { if (run === active && status.dataset.state === 'loading') playbackError('系统声音没有开始朗读，请换一个声音或重新点击试听。'); }, 15000);
  // No fetch/await before speak(): this is always a direct user gesture.
  try { synthesis.speak(current); }
  catch { playbackError('系统朗读未能启动，请重新点击试听。'); }
}
function pauseOrResume() {
  if (!run) return;
  if (status.dataset.state === 'paused') {
    run.paused = false;
    if (run.kind === 'system') { window.speechSynthesis?.resume(); setStatus('playing', `正在朗读 · ${run.label}`); }
    else {
      const current = run;
      try { audio.play()?.then(() => { if (run === current) setStatus('playing', `正在播放 · ${current.label}`); }).catch(() => { if (run === current) playbackError('继续播放失败，请点重播。'); }); }
      catch { playbackError('继续播放失败，请点重播。'); }
    }
  } else {
    run.paused = true;
    clearTimeout(loadTimer);
    if (run.kind === 'system') window.speechSynthesis?.pause(); else audio.pause();
    setStatus('paused', `已暂停 · ${run.label}`);
  }
}
function replay() {
  const last = lastPlayback;
  if (!last) return;
  if (last.kind === 'pair') { selected.pairA=last.a; selected.pairB=last.b; playPair(); }
  else if (last.kind === 'system') { selected.jaSample=last.sampleId; selected.system=last.voiceURI; speakSystem(); }
  else playClip(last.voiceId,last.sampleId,last.index);
}
function pickJapanese(kind, id) {
  if (kind === 'system') {
    const v = systemVoices.find(item => voiceKey(item) === selected.system);
    if (!v) { notice('先选择一个设备上可用的日语声音。'); return; }
    preferences.japanese = { kind:'system', voiceURI:voiceKey(v), name:v.name, lang:v.lang };
  } else {
    if (languageOf(voice(id)) !== 'ja') return;
    preferences.japanese = { kind:'kokoro', voiceId:id };
  }
  savePreferences(); updatePreferencesUI(); notice('日语方案已记下，可在「我的选择」复制。');
}
function toggleFavorite(id) {
  if (!voice(id) || languageOf(voice(id)) !== 'en') return;
  const index = preferences.english.indexOf(id);
  if (index >= 0) preferences.english.splice(index,1);
  else if (preferences.english.length >= 4) { notice('英语最多保留4个候选，请先取消一个再加入新声音。'); return; }
  else preferences.english.push(id);
  savePreferences(); updatePreferencesUI(); notice(`已选择 ${preferences.english.length}/4 个英语候选。`);
}
function japaneseChoiceText() {
  const choice = preferences.japanese;
  return !choice ? '还没选择日语方案' : choice.kind === 'system' ? `设备系统声 · ${choice.name || choice.voiceURI}${systemVoices.some(v => voiceKey(v) === choice.voiceURI) ? '' : '（当前设备尚未找到）'}` : `Kokoro · ${nameOf(voice(choice.voiceId))}`;
}
function selectionText() {
  const model = typeof source.model === 'string' ? source.model : 'Kokoro';
  return [`Kokoro 本地合成试听选择`, `模型：${model}`, `英语候选（${preferences.english.length}个）：`, ...preferences.english.map(id => {
    const v=voice(id);return `- ${nameOf(v)} (${id}) · ${groupNames[v.group] || v.group}`;
  }), `日语：${japaneseChoiceText()}${preferences.japanese?.kind === 'kokoro' ? ` (${preferences.japanese.voiceId})` : preferences.japanese?.kind === 'system' ? ` [${preferences.japanese.voiceURI}]` : ''}`, `试听语速：${preferences.rate.toFixed(2)}×`].join('\n');
}
function copyFallback(text) {
  const box = document.querySelector('#audition-copy-fallback');
  const wrap = document.querySelector('#audition-copy-fallback-wrap');
  wrap.hidden = false;
  box.value = text;
  box.focus({preventScroll:true});
  box.select();
  box.setSelectionRange(0,text.length);
  document.querySelector('#audition-copy-result').textContent = '自动复制未成功，文字已全选。请长按并选择「拷贝」，再自行粘贴回对话。';
  wrap.scrollIntoView({block:'nearest',behavior:'smooth'});
}
function copySelection() {
  const text = selectionText();
  try {
    const result = navigator.clipboard?.writeText(text);
    if (!result) { copyFallback(text); return; }
    result.then(() => { document.querySelector('#audition-copy-result').textContent = '已复制。请自行粘贴回对话，页面不会自动发送。'; document.querySelector('#audition-copy-fallback-wrap').hidden = true; }).catch(() => copyFallback(text));
  } catch { copyFallback(text); }
}
function updatePreferencesUI() {
  if (!source) return;
  for (const button of document.querySelectorAll('[data-act="audition-favorite"]')) {
    const picked = preferences.english.includes(button.dataset.voice);
    button.setAttribute('aria-pressed',String(picked));
    button.textContent = picked ? '♥ 已收藏' : '♡ 加入候选';
  }
  for (const button of document.querySelectorAll('[data-act="audition-ja-pick"]')) {
    const picked = button.dataset.kind === 'system' ? preferences.japanese?.kind === 'system' && preferences.japanese.voiceURI === selected.system : preferences.japanese?.kind === 'kokoro' && preferences.japanese.voiceId === button.dataset.voice;
    button.setAttribute('aria-pressed',String(picked));
    button.textContent = picked ? '✓ 已选日语方案' : '选作日语方案';
  }
  const summary = document.querySelector('#audition-selections');
  if (!summary) return;
  summary.innerHTML = `<p class="selection-count">英语候选 ${preferences.english.length}/4 · 建议选择3–4个</p>${preferences.english.length ? `<ul class="selection-list">${preferences.english.map(id => {
    const v=voice(id);return `<li><span><strong>${escape(nameOf(v))}</strong><br><span class="small-note">${escape(groupNames[v.group])} · ${escape(id)}</span></span><button class="remove" data-act="audition-remove" data-voice="${escape(id)}" aria-label="取消 ${escape(nameOf(v))}">×</button></li>`;
  }).join('')}</ul>` : '<p class="empty-note">在英语候选卡片上点「加入候选」，选出你愿意继续听的声音。</p>'}<h3 style="margin-top:20px">日语方案</h3><p class="chosen-japanese">${escape(japaneseChoiceText())}</p>`;
  const complete = preferences.english.length >= 3 && preferences.english.length <= 4 && !!preferences.japanese;
  document.querySelector('#audition-copy').disabled = !complete;
  document.querySelector('#audition-choice-hint').textContent = complete ? '选择已准备好。复制后粘贴回对话即可，也可以继续调整。' : `先选择3–4个英语候选，再选一个日语方案。当前英语 ${preferences.english.length} 个${preferences.japanese ? '，日语已选择。' : '，日语待选择。'}`;
}
function voiceOptions(language) {
  return voicesFor(language).map(v => `<option value="${escape(v.id)}">${escape(nameOf(v))}${language === 'en' ? ` · ${escape(groupNames[v.group])}` : ''}</option>`).join('');
}
function sampleOptions(language) { return samplesFor(language).map(s => `<option value="${escape(s.id)}">${escape(s.title)}</option>`).join(''); }
function renderTranscript(language) {
  const s=sample(selected[language+'Sample']);
  const holder=document.querySelector(`#audition-${language}-transcript`);
  if (!holder || !s) return;
  holder.innerHTML = `<div class="transcript-heading"><h3>样本原文</h3><span id="audition-${language}-current-voice">当前：${escape(nameOf(voice(selected[language+'Voice'])))}</span></div>${s.segments.map((segment,index) => `<div class="sample-line" data-segment-key="${escape(segment.key)}"><div class="line-top"><span class="speaker-label">${segment.speaker ? `说话人 ${escape(segment.speaker)}` : '朗读者'} · ${index+1}</span><button class="line-play" data-act="audition-segment" data-language="${language}" data-index="${index}">听这一句</button></div><p class="line-text" lang="${language}">${escape(segment.text)}</p></div>`).join('')}`;
}
function attributionHTML(attribution) {
  if (typeof attribution === 'string' && attribution) return `<p class="voice-attribution">${escape(attribution)}</p>`;
  if (!attribution || typeof attribution !== 'object') return '';
  const link = /^https?:\/\//i.test(attribution.url || '')
    ? `<a href="${escape(attribution.url)}" target="_blank" rel="noopener noreferrer">原始朗读来源</a>` : '';
  return `<p class="voice-attribution">训练语音署名：<span lang="ja">${escape(attribution.name || '')}</span><br>${escape(attribution.license || '')}${link ? ` · ${link}` : ''}</p>`;
}
function cards(language) {
  return (language === 'en' ? groups : ['ja']).map(group => {
    const items = voicesFor(language).filter(v => v.group === group);
    if (!items.length) return '';
    return `<section class="voice-group" aria-label="${escape(groupNames[group])}"><div class="group-heading"><h3>${escape(groupNames[group])}</h3><span>${items.length} 个声音</span></div><div class="voice-grid">${items.map(v => `<article class="voice-card${selected[language+'Voice'] === v.id ? ' is-current' : ''}" data-voice="${escape(v.id)}" data-language="${language}"><div class="voice-name">${escape(nameOf(v))}</div><div class="voice-id">${escape(v.id)}</div><span class="voice-grade">官方训练评级 ${escape(v.grade || '未标注')}</span>${attributionHTML(v.attribution)}<button class="button primary" data-act="audition-play" data-voice="${escape(v.id)}">▶ 试听当前样本</button>${language === 'en' ? `<button id="favorite-${escape(v.id)}" class="button quiet favorite" data-act="audition-favorite" data-voice="${escape(v.id)}" aria-pressed="false">♡ 加入候选</button>` : `<button class="button quiet japanese-pick" data-act="audition-ja-pick" data-kind="kokoro" data-voice="${escape(v.id)}" aria-pressed="false">选作日语方案</button>`}</article>`).join('')}</div></section>`;
  }).join('');
}
function changeTab(next) {
  if (!['en','ja','selection'].includes(next)) return;
  stopAll({forget:true,message:'选一个样本，点击开始试听'});
  tab = next;
  for (const button of document.querySelectorAll('[data-act="audition-tab"]')) { const active=button.dataset.tab===tab;button.setAttribute('aria-selected',String(active)); }
  for (const panel of document.querySelectorAll('[data-tab-panel]')) panel.hidden=panel.dataset.tabPanel!==tab;
  document.querySelector('#audition-play-current').disabled = tab === 'selection';
}
function renderPage() {
  content.innerHTML = `<nav class="tabs" aria-label="试听分类" role="tablist">${[['en','英语候选'],['ja','日语对比'],['selection','我的选择']].map(([id,label]) => `<button id="audition-tab-${id}" role="tab" data-act="audition-tab" data-tab="${id}" aria-selected="${tab===id}" aria-controls="audition-panel-${id}">${label}</button>`).join('')}</nav>
  <section id="audition-panel-en" role="tabpanel" aria-labelledby="audition-tab-en" data-tab-panel="en"><section class="panel"><h2>找一个听得舒服的声音</h2><p class="panel-intro">${voicesFor('en').length} 个候选共用 ${samplesFor('en').length} 段样本。先选同一段，再逐个点击候选卡片试听。</p><label class="field" for="audition-en-sample"><span>对比样本</span><select id="audition-en-sample">${sampleOptions('en')}</select></label><label class="field" for="audition-en-voice"><span>当前声音 · 单句试听也使用此声</span><select id="audition-en-voice">${voiceOptions('en')}</select></label><p class="small-note">单声版中，所有说话人的台词都由当前候选朗读，便于公平比较音色；正式对话后续会按所选声音分配。</p><div class="transcript" id="audition-en-transcript"></div></section>${cards('en')}<section class="panel"><h2>双人试配</h2><p class="panel-intro">用同一段 Part 3 对话，听两种声音轮流说话的感觉。</p><div class="pair-fields"><label class="field" for="audition-pair-a"><span>第一位说话人</span><select id="audition-pair-a">${voiceOptions('en')}</select></label><label class="field" for="audition-pair-b"><span>第二位说话人</span><select id="audition-pair-b">${voiceOptions('en')}</select></label></div><p class="pair-note" id="audition-pair-note">${escape(pairSample()?.title || '暂未提供双人对话样本')}</p><button id="audition-pair-play" class="button secondary wide" data-act="audition-pair" ${pairSample() ? '' : 'disabled'}>▶ 试听双人对话</button></section></section>
  <section id="audition-panel-ja" role="tabpanel" aria-labelledby="audition-tab-ja" data-tab-panel="ja" hidden><section class="panel"><h2>日语：合成声与系统声</h2><p class="panel-intro">${voicesFor('ja').length} 个 Kokoro 候选与这台设备的日语声音，共用下方 ${samplesFor('ja').length} 段样本。</p><label class="field" for="audition-ja-sample"><span>对比样本</span><select id="audition-ja-sample">${sampleOptions('ja')}</select></label><label class="field" for="audition-ja-voice"><span>当前 Kokoro 声音</span><select id="audition-ja-voice">${voiceOptions('ja')}</select></label><div class="transcript" id="audition-ja-transcript"></div></section>${cards('ja')}<section class="panel"><h2>设备上的日语声音</h2><p class="panel-intro">点击后使用这台设备向浏览器提供的日语声音，朗读同一句样本。</p><label class="field" for="audition-system-voice"><span>系统声音</span><select id="audition-system-voice"><option>正在读取…</option></select></label><p class="small-note" id="audition-system-note"></p><button id="audition-system-refresh" class="text-button" data-act="audition-system-refresh">刷新声音列表</button><div class="system-actions"><button id="audition-system-play" class="button primary" data-act="audition-system-play">▶ 试听系统日语</button><button id="audition-system-pick" class="button secondary japanese-pick" data-act="audition-ja-pick" data-kind="system" aria-pressed="false">选作日语方案</button></div></section></section>
  <section id="audition-panel-selection" role="tabpanel" aria-labelledby="audition-tab-selection" data-tab-panel="selection" hidden><section class="panel"><h2>留下你的选择</h2><p class="panel-intro">选择3–4个英语候选，以及一个日语方案。可以边听边调整，不需要马上决定。</p><div id="audition-selections"></div><p class="small-note" id="audition-choice-hint"></p><button id="audition-copy" class="button primary wide" data-act="audition-copy">复制我的选择</button><p class="copy-result" id="audition-copy-result" role="status"></p><div id="audition-copy-fallback-wrap" hidden><label class="copy-fallback-label" for="audition-copy-fallback">手动复制下面的文字</label><textarea id="audition-copy-fallback" readonly spellcheck="false"></textarea></div></section></section>`;
  for (const language of ['en','ja']) {
    document.querySelector(`#audition-${language}-voice`).value = selected[language+'Voice'];
    document.querySelector(`#audition-${language}-sample`).value = selected[language+'Sample'];
    renderTranscript(language);
  }
  document.querySelector('#audition-pair-a').value=selected.pairA;
  document.querySelector('#audition-pair-b').value=selected.pairB;
  refreshSystemVoices();
  updatePreferencesUI();
  content.setAttribute('aria-busy','false');
  document.querySelector('#audition-play-current').disabled=false;
  const links=(source.sources || []).filter(item => /^https?:\/\//i.test(item.url || '')).map(item => `<a href="${escape(item.url)}" target="_blank" rel="noopener noreferrer">${escape(item.label || '模型来源')}</a>`).join('');
  document.querySelector('#audition-sources').innerHTML=`<p>评级来自官方声音列表，反映训练数据条件，不是听感或学习效果的保证。声音好不好听、是否清楚，请以本页实际试听为准。</p>${links}`;
}
async function loadData() {
  content.setAttribute('aria-busy','true');
  try {
    const responses=await Promise.all(['./data/audio-audition-source.json','./data/audio-audition-manifest.json'].map(url => fetch(url,{cache:'no-cache'})));
    if(responses.some(response=>!response.ok))throw Error('试听清单还未准备好，请稍后重试。');
    [source,manifest]=await Promise.all(responses.map(response=>response.json()));
    if(source?.version!==1 || manifest?.version!==1 || manifest.complete!==true || !Array.isArray(source.voices) || !Array.isArray(source.samples) || !manifest.clips || !source.samples.every(s=>Array.isArray(s.segments)&&s.segments.every(t=>typeof t.key==='string'&&typeof t.text==='string')))throw Error('试听清单格式不完整，请更新后重试。');
    if(!voicesFor('en').length||!voicesFor('ja').length||!samplesFor('en').length||!samplesFor('ja').length)throw Error('英语或日语样本尚未准备好，请稍后重试。');
    preferences.english=preferences.english.filter(id=>voice(id)&&languageOf(voice(id))==='en');
    if(preferences.japanese?.kind==='kokoro'&&(!voice(preferences.japanese.voiceId)||languageOf(voice(preferences.japanese.voiceId))!=='ja'))preferences.japanese=null;
    selected.enVoice=preferences.english[0]||voicesFor('en')[0].id;
    selected.jaVoice=preferences.japanese?.kind==='kokoro'?preferences.japanese.voiceId:voicesFor('ja')[0].id;
    selected.enSample=samplesFor('en')[0].id;
    selected.jaSample=samplesFor('ja')[0].id;
    selected.pairA=selected.enVoice;
    selected.pairB=preferences.english.find(id=>id!==selected.pairA)||voicesFor('en').find(v=>v.id!==selected.pairA&&v.gender!==voice(selected.pairA)?.gender)?.id||voicesFor('en').find(v=>v.id!==selected.pairA)?.id||selected.pairA;
    renderPage();
  } catch(error) {
    source=null;manifest=null;
    content.innerHTML=`<section class="panel"><h2>暂时无法打开试听</h2><p class="panel-intro">${escape(error.message || '请检查网络后再试。')}</p><button class="button primary wide" data-act="audition-retry">重新读取清单</button></section>`;
    content.setAttribute('aria-busy','false');
    setStatus('error','试听清单未载入，尚未播放音频');
  }
}
document.addEventListener('click',event=>{
  const button=event.target.closest('button[data-act]');
  if(!button||button.disabled)return;
  const action=button.dataset.act;
  if(action==='audition-retry'){loadData();return;}
  if(!source)return;
  if(action==='audition-tab')changeTab(button.dataset.tab);
  else if(action==='audition-play'){const v=voice(button.dataset.voice);if(v)playClip(v.id,selected[languageOf(v)+'Sample']);}
  else if(action==='audition-current'){const language=tab==='ja'?'ja':'en';playClip(selected[language+'Voice'],selected[language+'Sample']);}
  else if(action==='audition-segment'){const language=button.dataset.language;playClip(selected[language+'Voice'],selected[language+'Sample'],Number(button.dataset.index));}
  else if(action==='audition-pause')pauseOrResume();
  else if(action==='audition-replay')replay();
  else if(action==='audition-favorite'||action==='audition-remove')toggleFavorite(button.dataset.voice);
  else if(action==='audition-ja-pick')pickJapanese(button.dataset.kind,button.dataset.voice);
  else if(action==='audition-system-refresh')refreshSystemVoices();
  else if(action==='audition-system-play')speakSystem();
  else if(action==='audition-pair')playPair();
  else if(action==='audition-copy')copySelection();
});
document.addEventListener('change',event=>{
  if(!source)return;
  const id=event.target.id,value=event.target.value;
  const field={ 'audition-en-voice':'enVoice','audition-ja-voice':'jaVoice','audition-en-sample':'enSample','audition-ja-sample':'jaSample','audition-system-voice':'system','audition-pair-a':'pairA','audition-pair-b':'pairB' }[id];
  if(!field)return;
  stopAll({forget:true,message:'选择已切换，点击开始试听'});
  selected[field]=value;
  if(field==='enVoice'||field==='jaVoice')syncVoiceSelection(field.slice(0,2),value);
  if(field==='enSample'||field==='jaSample')renderTranscript(field.slice(0,2));
  if(field==='system')updatePreferencesUI();
});
document.querySelector('#audition-rate').value=String(preferences.rate);
document.querySelector('#audition-rate-value').value=`${preferences.rate.toFixed(2)}×`;
document.querySelector('#audition-rate').addEventListener('input',event=>{
  preferences.rate=clampRate(event.target.value);
  document.querySelector('#audition-rate-value').value=`${preferences.rate.toFixed(2)}×`;
  configureRate();savePreferences();
  if(run?.kind==='system')stopAll({message:'语速已调整，请重新点击试听系统日语'});
});
audio.addEventListener('playing',()=>{if(run?.kind==='audio'){clearTimeout(loadTimer);if(run.paused){audio.pause();return;}setStatus('playing',`正在播放 · ${run.label}${run.queue.length>1?` · ${run.index+1}/${run.queue.length}`:''}`);}});
audio.addEventListener('waiting',()=>{if(run?.kind==='audio'&&!audio.paused)setStatus('loading',`正在缓冲 · ${run.label}`);});
audio.addEventListener('pause',()=>{if(run?.kind==='audio'&&status.dataset.state==='playing'&&audio.paused&&!audio.ended)setStatus('paused',`已暂停 · ${run.label}`);});
audio.addEventListener('error',()=>{if(run?.kind==='audio')playbackError('音频未能载入，请检查网络后点重播。');});
audio.addEventListener('ended',()=>{
  const current=run;if(current?.kind!=='audio'||!audio.ended)return;
  if(current.index+1<current.queue.length){current.index++;playAudioItem(current);}
  else{clearTimeout(loadTimer);run=null;highlight();setStatus('ended',`已播完 · ${current.label}`);}
});
window.speechSynthesis?.addEventListener?.('voiceschanged',refreshSystemVoices);
window.addEventListener('pagehide',()=>stopAll());
loadData();
