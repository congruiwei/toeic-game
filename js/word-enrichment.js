// Stable, lightweight slots shared by vocabulary detail and answered-question views.
// Later optional word features can attach here without widening answer permissions.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const vocabArtSlot=(id,small=false)=>id?`<span class="vocab-art${small?' vocab-art-small':''}" data-vocab-art="${esc(id)}"></span>`:'';
export const wordDetailsSlot=(word,{study=false}={})=>`<section data-word-details-id="${esc(word.id)}"${study?' data-word-details-study':''}></section>`;
export const answerDetailsSlot=id=>`<section data-answer-details-id="${esc(id)}"></section>`;

/** Stable English units and paired meanings. Explanatory Chinese/Japanese prose
 * lives in the authored data; isolated spelling chunks are not new word audio. */
export function morphemeSourceUnits(data){
 return data.entries.flatMap(m=>m.forms.map((text,i)=>({id:'morph-'+m.id,bank:'morphemes',key:`morph-${m.id}/forms/${i}`,text,kind:'morpheme',zh:m.zh,ja:m.ja})));
}
export const morphemeSpelling = form => [...String(form).replace(/[^A-Za-z]/g,'')].map(c=>c.toUpperCase()+'.').join(' ');
export function morphologyAudioUnits(data,vocab){
 const units=morphemeSourceUnits(data).flatMap(u=>[
  {key:u.key,text:u.text,spoken:morphemeSpelling(u.text),language:'en',kind:'morpheme-spelling',group:u.id},
  {key:u.key,text:u.ja,language:'ja',kind:'meaning',group:u.id}
 ]);
 for(const m of data.entries){units.push({key:`morph-${m.id}/meaning`,text:m.ja,language:'ja',kind:'meaning',group:'morph-'+m.id});if(m.noteJa)units.push({key:`morph-${m.id}/note`,text:m.noteJa,language:'ja',kind:'sentence',group:'morph-'+m.id});}
 for(const w of vocab)for(const [field,suffix]of [['partsNote','parts-note'],['partsTrap','parts-trap']])if(w[field]?.ja)units.push({key:`${w.id}/${suffix}`,text:w[field].ja,language:'ja',kind:'sentence',group:w.id});
 return units;
}
