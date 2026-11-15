import { sourceUnits } from './translation-source.js';

const packs = new Map(), pending = new Map();
export const bankFor = mode => ({dialogue:'listening',dictation:'listening'})[mode] || mode;
export function translated(bank, key, language) { return packs.get(`${language}/${bank}`)?.[key]; }
export async function loadTranslations(bank) {
  await Promise.all(['zh','ja'].map(language => loadLanguage(bank,language)));
}
export async function loadLanguage(bank, language) {
  const key = `${language}/${bank}`;
  if (packs.has(key)) return packs.get(key);
  if (!pending.has(key)) pending.set(key, (async()=>{
    const url=`./data/i18n/${key}.json`;
    let cache,pack;
    try { cache=await globalThis.caches?.open('toeic-island-translations-v1'); } catch {}
    try {
      const response=await fetch(url,{cache:'no-cache'});
      if(!response.ok)throw Error('无法下载译文');
      pack=await response.clone().json();
      if(pack.version!==1 || !pack.entries || Array.isArray(pack.entries))throw Error('译文格式无法识别');
      // Also cache the first visit, before a newly installed worker controls this page.
      try { await cache?.put(url,response); } catch {}
    } catch {
      const saved=await cache?.match(url);pack=saved?await saved.json():null;
    }
    if(!pack || pack.version!==1 || !pack.entries || Array.isArray(pack.entries))throw Error('译文尚未下载，请联网后重试。');
    packs.set(key,pack.entries);
    return pack.entries;
  })().finally(()=>pending.delete(key)));
  return pending.get(key);
}
export function questionUnits(ref, q) {
  const bank = bankFor(ref.mode);
  let records = [q];
  if (bank === 'grammar') records = [{questions:[q]}];
  if (bank === 'listening' || bank === 'reading') records = [q.set];
  return sourceUnits(bank,records).filter(u => u.id === ref.id || (ref.mode !== 'dictation' && u.id === q.set?.id));
}
