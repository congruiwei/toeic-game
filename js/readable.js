const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);

// These helpers are only called by answered views or by study cards. The app
// also checks the current study/exam state before routing a playback action.
export function readButton(text,{key='',bank='',seed='',id='',study=false}={}){
  if(!String(text??'').trim()||/^\s*\[[1-4]\]\s*$/.test(text))return '';
  return `<button type="button" lang="zh-Hans" class="read-aloud" data-act="read-aloud" data-text="${esc(text)}" data-key="${esc(key)}" data-bank="${esc(bank)}" data-seed="${esc(seed)}" data-read-id="${esc(id)}" ${study?'data-read-study':''} aria-label="朗读英文：${esc(text)}" aria-pressed="false"><span aria-hidden="true">◖))</span><span class="read-label">朗读</span></button>`;
}
export function readable(text,options={}){
  return `<span class="readable-line" data-read-text="${esc(text)}"><span lang="en">${options.html??esc(text)}</span>${readButton(text,options)}</span>`;
}
