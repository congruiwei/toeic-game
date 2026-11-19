let catalog;
const pending=new WeakSet();
function loadCatalog() {
  return catalog??=fetch(new URL('../data/vocab-art.json',import.meta.url)).then(async response=>{
    if(!response.ok)throw Error('图鉴索引未下载');
    const data=await response.json();
    if(data.version!==1||!data.entries||typeof data.entries!=='object')throw Error('图鉴索引有误');
    return data;
  }).catch(error=>{catalog=undefined;throw error;});
}
export async function mountArt(scope, prefs) {
  const slots=[...scope.querySelectorAll('[data-vocab-art]')];
  if(prefs.vocabPictures===false){slots.forEach(slot=>slot.replaceChildren());return;}
  const visible=slots.filter(slot=>!slot.firstChild&&!pending.has(slot)&&!slot.closest('details:not([open]),[hidden]'));
  if(!visible.length)return;
  visible.forEach(slot=>pending.add(slot));
  try {
    const {entries,aliases={}}=await loadCatalog();
    for(const slot of visible) {
      if(!slot.isConnected||prefs.vocabPictures===false||slot.closest('details:not([open]),[hidden]'))continue;
      const sourceId=slot.dataset.vocabArt;
      const id=Object.hasOwn(aliases,sourceId)?aliases[sourceId]:sourceId, entry=entries[id];
      if(!entry||entry.class==='C'||!/^[\w-]+$/.test(id)||!/^([a-f0-9]{12})$/.test(entry.rev))continue;
      const img=document.createElement('img');
      img.alt=entry.alt;
      img.loading='lazy';
      img.decoding='async';
      img.width=240;img.height=144;
      img.addEventListener('error',()=>img.remove(),{once:true});
      img.src=new URL('../assets/vocab/'+encodeURIComponent(id)+'.svg?v='+entry.rev,import.meta.url).href;
      slot.append(img);
    }
  } catch { /* An uncached optional illustration must never block the card. */ }
  finally {visible.forEach(slot=>pending.delete(slot));}
}
