// Curated sense IDs are authoritative; spelling alone never changes a card's meaning.
let data = null;
let candidates = {};
let semanticAvoid = [];
let part2TrapIds = null;
let byMember = new Map();

export function installConfusables(value) {
  const invalid = () => new Error('易混词数据格式有误');
  if (value?.version !== 1 || !Array.isArray(value.groups) || !value.groups.length ||
      !value.words || typeof value.words !== 'object' || Array.isArray(value.words) ||
      !Array.isArray(value.questions) || !value.questions.length || !Array.isArray(value.part2Traps)) throw invalid();

  // A first visit may fetch before the service worker takes control. Publish the
  // lookup only after every group and question has a valid target in this pack.
  const members = new Map();
  const groups = new Map();
  for (const group of value.groups) {
    if (!group?.id || groups.has(group.id) || !Array.isArray(group.members) ||
        group.members.length < 2 || group.members.length > 4) throw invalid();
    groups.set(group.id, group);
    for (const id of group.members) {
      if (!Object.hasOwn(value.words, id) || value.words[id]?.id !== id) throw invalid();
      if (!members.has(id)) members.set(id, []);
      members.get(id).push(group);
    }
  }
  for (const question of value.questions) {
    const group = groups.get(question?.groupId);
    if (!group?.members.includes(question.wordId) || !Array.isArray(question.options) ||
        !question.options.includes(question.answer) || value.words[question.wordId].word !== question.answer) throw invalid();
  }
  data = value;
  byMember = members;
}
export const confusableData=()=>data;
export const groupsForWord=id=>byMember.get(id)||[];
export function installConfusableCandidates(pack){
  if(pack?.version!==1||!pack.entries||typeof pack.entries!=='object'||Array.isArray(pack.entries)||!Object.keys(pack.entries).length||!Object.values(pack.entries).every(a=>Array.isArray(a)&&a.length&&a.every(w=>typeof w==='string'&&w.trim())))throw Error('易混词候选索引有误');
  if(pack.semanticAvoid!==undefined&&(!Array.isArray(pack.semanticAvoid)||!pack.semanticAvoid.every(pair=>Array.isArray(pair)&&pair.length===2&&pair.every(w=>typeof w==='string'&&w.trim())&&pair[0]!==pair[1])))throw Error('易混词语义排除索引有误');
  if(pack.part2TrapIds!==undefined&&(!Array.isArray(pack.part2TrapIds)||new Set(pack.part2TrapIds).size!==pack.part2TrapIds.length||!pack.part2TrapIds.every(id=>/^p2-[a-zA-Z0-9_-]+$/.test(id))))throw Error('易混词听力索引有误');
  candidates=pack.entries;
  part2TrapIds=pack.part2TrapIds||null;
  semanticAvoid=pack.semanticAvoid||[];
}
export const confusableCandidates=id=>candidates[id]||[];
export const mayHaveWordComparison=id=>data?byMember.has(id):Object.hasOwn(candidates,id);
function answerWordIds(ref,q,selected,details){
  const ids=new Set();
  if(ref.mode==='vocab')ids.add(ref.id);
  if(ref.mode==='confusable')ids.add(q.wordId);
  for(const option of details?.options||[])if(option.correct||option.text===selected)
    for(const lexeme of option.lexemes)ids.add(lexeme.wordId||lexeme.id);
  return ids;
}
export function mayHaveAnswerComparison(ref,q,selected,details){
  if(ref.mode==='confusable')return true;
  if(ref.mode==='part2'&&(data?data.part2Traps.some(t=>t.id===ref.id):!part2TrapIds||part2TrapIds.includes(ref.id)))return true;
  return [...answerWordIds(ref,q,selected,details)].some(mayHaveWordComparison);
}
export const overlapsCuratedMeaning=(a,b)=>semanticAvoid.some(pair=>pair.includes(a)&&pair.includes(b));
export async function curatedOptionLexeme(targetId,text){
  if(!confusableCandidates(targetId).includes(text))return null;
  if(!data)await (await import('./bank.js')).loadBank(['confusables']);
  const id=groupsForWord(targetId).flatMap(g=>g.members).find(id=>data.words[id].word===text);
  return id?data.words[id]:null;
}
export function confusableQuestion(ref){
  const q=data?.questions.find(q=>q.id===ref.id);
  const group=q&&data.groups.find(g=>g.id===q.groupId);
  return q?{...q,optionWordIds:q.options.map(text=>group.members.find(id=>data.words[id].word===text)),skill:'vocab',instruction:'易混词对决 · 根据句意选词',audio:false}:null;
}
export function confusableOptionDetails(ref,q){
  const group=data?.groups.find(g=>g.id===q.groupId);if(!group)throw Error('易混词对比尚未加载');
  const words=group.members.map(id=>data.words[id]);
  return {id:q.id,ref:{...ref},context:q.sentence,options:q.options.map(text=>{
    const word=words.find(w=>w.word===text);if(!word)throw Error('易混词选项未对应义项');
    return {text,spokenEnglish:word.word,kind:'word',correct:text===q.answer,pos:word.pos,zh:word.zh,ja:word.ja,
      reasonZh:q.reasons?.[text]||group.difference.zh,lexemes:[{...word}],collectible:true};
  })};
}
export function comparisonsForAnswer(ref,q,selected,details){
  if(!data)return [];
  const ids=answerWordIds(ref,q,selected,details);
  const trap=data.part2Traps.find(t=>ref.mode==='part2'&&t.id===ref.id);
  if(trap?.groupId){ids.add(trap.sourceWordId);ids.add(trap.distractorWordId);}
  const groups=[...new Map([...ids].flatMap(id=>groupsForWord(id)).map(g=>[g.id,g])).values()];
  return groups.map(group=>{
    const members=group.members.map(id=>data.words[id]);
    const target=members.find(w=>w.id===(ref.mode==='vocab'?ref.id:q.wordId))||
      members.find(w=>details?.options.some(o=>o.correct&&o.lexemes.some(l=>(l.wordId||l.id)===w.id)));
    const chosen=members.find(w=>w.word===selected)||members.find(w=>details?.options.some(o=>o.text===selected&&o.lexemes.some(l=>(l.wordId||l.id)===w.id)));
    return {group,target,chosen,trap:trap?.groupId===group.id?trap:null,selected};
  });
}
