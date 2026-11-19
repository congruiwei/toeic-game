import {readable} from './readable.js';
import {languageButtons} from './translation-ui.js';

const escape = value => String(value).replace(/[&<>"']/g, character => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
})[character]);
const packs = new Map();

async function pack(language) {
  if (!packs.has(language)) {
    const path = language === 'en' ? 'data/vocab-humor.json' : `data/i18n/${language}/vocab-humor.json`;
    packs.set(language, fetch(new URL('../'+path, import.meta.url)).then(async response => {
      if (!response.ok) throw Error('例句暂时无法下载');
      const data = await response.json();
      if (data.version !== 1 || !data.entries || typeof data.entries !== 'object') throw Error('例句文件有误');
      return data.entries;
    }).catch(error => { packs.delete(language); throw error; }));
  }
  return packs.get(language);
}
export async function humorFor(id) {
  const key = id + '/humor/0';
  const [en,zh,ja] = await Promise.all(['en','zh','ja'].map(language => pack(language).then(data => data[key])));
  if (![en,zh,ja].every(value => typeof value === 'string' && value.trim())) throw Error('这张词卡的例句尚未载入');
  return {id,key,en,zh,ja};
}
function languageRows(row, state) {
  const mode=state.settings.translationLanguage||'both', saved=state.expressions?.items.some(item=>item.key===row.key);
  return languageButtons(mode)+`<div class="humor-translation" data-language="${mode}"><p lang="zh-CN">${escape(row.zh)}</p>
    <button type="button" class="humor-ja" lang="ja" data-act="humor-ja" aria-label="朗读日语：${escape(row.ja)}">${escape(row.ja)} <span aria-hidden="true">◖))</span></button>
    <button type="button" class="secondary" data-act="humor-collect" ${saved?'disabled':''}>${saved?'已收藏':'收藏到表达本'}</button></div>`;
}
export async function mountHumor(host, state, beforeMutation=()=>Promise.resolve()) {
  if(host.dataset.loaded || host.closest('details:not([open])'))return;
  host.dataset.loaded='pending';
  try {
    const id=host.dataset.humorId,key=id+'/humor/0',en=(await pack('en'))[key];
    if(!en)throw Error('例句尚未载入');
    await beforeMutation();
    if(!host.isConnected)return;
    host.innerHTML=`<h3>职场趣句</h3><blockquote lang="en">${readable(en,{id,bank:'vocab',key,study:true})}</blockquote>
      <details class="humor-reveal" ${state.settings.translationExpanded?'open':''}><summary>趣句翻译</summary><div class="humor-lines"></div></details>`;
    const reveal=host.querySelector('details'), lines=host.querySelector('.humor-lines');
    let loading=false;
    async function translate() {
      if(!reveal.open||host.humorRow||loading)return;
      loading=true;
      try {
        const row=await humorFor(id);
        await beforeMutation();
        if(!host.isConnected)return;
        host.humorRow=row;
        lines.innerHTML=languageRows(row,state);
      } catch {
        await beforeMutation();
        if(host.isConnected)lines.textContent='译文尚未下载，联网后收起并重新展开即可重试。';
      } finally {loading=false;}
    }
    reveal.addEventListener('toggle',translate);
    if(reveal.open)translate();
    host.dataset.loaded='ready';
  } catch {
    await beforeMutation();
    if(!host.isConnected)return;
    host.dataset.loaded='failed';
    host.innerHTML='<button type="button" class="secondary" data-act="humor-retry">重新载入职场趣句</button>';
  }
}
