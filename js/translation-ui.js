import {methodById} from './methods.js';
import {sourceUnits} from './translation-source.js';
import {catalog,question} from './bank.js';
import {translated,loadTranslations,questionUnits,bankFor} from './translations.js';
import {replayRows} from './replay.js';
const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export const translationPanel = (id, study=false) => `<section class="translations" data-translation-id="${esc(id)}" ${study?'data-study-translation':''}><button type="button" class="secondary translation-toggle" data-act="translate" aria-expanded="false">显示翻译</button><div class="translation-content" hidden></div></section>`;
export function languageButtons(language) {
  return `<div class="translation-languages" role="group" aria-label="翻译语言">${[['zh','中'],['ja','日'],['both','中日']].map(([key,label])=>`<button type="button" data-act="translation-language" data-language="${key}" aria-pressed="${language===key}">${label}</button>`).join('')}</div>`;
}
export function bilingualLine(unit, {includeEnglish=true}={}) {
  const zh=translated(unit.bank,unit.key,'zh'), ja=translated(unit.bank,unit.key,'ja');
  if(!zh || !ja) return '<p class="muted">本句译文尚未下载。</p>';
  const cells = text => unit.kind==='table' ? `<div class="translation-table-row" style="--columns:${unit.columns}">${text.split(' | ').map(cell=>`<span>${esc(cell)}</span>`).join('')}</div>` : esc(text);
  return `<div class="translation-line" data-translation-key="${esc(unit.key)}" data-translation-bank="${esc(unit.bank)}">${includeEnglish?`<div lang="en">${cells(unit.text)}</div>`:''}<div lang="zh-CN">${cells(zh)}</div><div lang="ja">${cells(ja)}</div>${unit.kind==='sentence'?`<button type="button" class="secondary expression-collect" data-act="collect-expression" data-key="${esc(unit.key)}" data-bank="${esc(unit.bank)}">收藏</button>`:''}</div>`;
}
export function unitsForPanel(panel) {
  const id=panel.dataset.translationId;
  if(panel.hasAttribute('data-translation-method')){const card=methodById(id);return card?sourceUnits('methods',[card]):[];}
  const entry=catalog.get(id);
  if(!entry)return [];
  const units=questionUnits(entry.ref,entry.data);
  return panel.dataset.translationKey ? units.filter(u=>u.key===panel.dataset.translationKey) : units.filter(u=>u.kind!=='meaning'&&(!panel.hasAttribute('data-defer-passage')||u.id===id));
}
export function applyTranslationLanguage(scope, language) {
  scope.querySelectorAll('.translations').forEach(panel=>panel.dataset.language=language);
  scope.querySelectorAll('[data-act=translation-language]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.language===language)));
}
export async function expandTranslation(panel, settings, notify, collected=[]) {
  const button=panel.querySelector('[data-act=translate]'), content=panel.querySelector('.translation-content');
  if(!button || !content)return;
  if(button.getAttribute('aria-expanded')==='true'){
    button.setAttribute('aria-expanded','false');button.textContent='显示翻译';content.hidden=true;return;
  }
  const units=unitsForPanel(panel),deferred=panel.hasAttribute('data-defer-passage');if(!units.length&&!deferred)return;
  button.disabled=true;button.setAttribute('aria-busy','true');
  try {
    if(units.length)await loadTranslations(units[0].bank);
    if(!panel.isConnected)return;
    content.innerHTML=(deferred?'<p class="translation-wait">本篇还有未答题目，答完本篇后会显示填好答案的整篇中日对照。</p>':'')+languageButtons(settings.translationLanguage||'both')+units.map(unit=>{
      const label=unit.option===undefined?'':`<small>选项 ${String.fromCharCode(65+unit.option)}</small>`;
      return label+bilingualLine(unit);
    }).join('');
    markCollected(panel,collected);
    panel.dataset.language=settings.translationLanguage||'both';content.hidden=false;
    button.setAttribute('aria-expanded','true');button.textContent='收起翻译';
  } catch(error) { notify(error.message); }
  finally { button.disabled=false;button.removeAttribute('aria-busy'); }
}
export function mountTranslations(scope, settings, notify, collected=[]) {
  // Only answered views call reviewTools; live exams contain no translation hosts.
  scope.querySelectorAll('[data-replay-id]').forEach(replay=>{
    const entry=catalog.get(replay.dataset.replayId);if(!entry)return;
    const q=question(entry.ref),units=questionUnits(entry.ref,entry.data),rows=replayRows(q,entry.ref.mode);
    replay.querySelectorAll('[data-act=sentence-play]').forEach((button,i)=>{
      if(button.nextElementSibling?.classList.contains('translations'))return;
      const unit=units.find(u=>u.text===rows[i]?.text);if(!unit)return;
      button.insertAdjacentHTML('afterend',translationPanel(entry.ref.id));
      button.nextElementSibling.dataset.translationKey=unit.key;
    });
  });
  applyTranslationLanguage(scope,settings.translationLanguage||'both');
  if(settings.translationExpanded) scope.querySelectorAll('.translations:not([data-translation-key])').forEach(panel=>{
    // Expanding a full mock review eagerly would download every section. Wait for its details to open.
    const closed=panel.closest('details:not([open])');
    if(!closed && panel.querySelector('[aria-expanded=false]'))expandTranslation(panel,settings,notify,collected);
  });
}

export function markCollected(scope,items=[]) {
  const keys=new Set(items.map(item=>item.key));
  for(const button of scope.querySelectorAll('[data-act=collect-expression]'))if(keys.has(button.dataset.key)){
    button.textContent='已收藏';button.disabled=true;
  }
}
