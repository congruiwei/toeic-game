let requested;
let cards = [];
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export function loadMethods() {
  requested ??= fetch('./data/methods.json').then(async response => {
    if (!response.ok) throw Error('方法卡未能打开');
    cards = await response.json();
  }).catch(error => { requested = undefined; throw error; });
  return requested;
}
export const methodById = id => cards.find(card => card.id === id);
export const methodParts = {
  photo:'1','photo-state':'1','first-word':'2',indirect:'2',sounds:'2',echo:'2',
  preview:'3/4',keywords:'3/4',graphic:'3/4',intent:'3/4',
  'p5-choice':'5','word-form':'5',tense:'5',link:'5',lexis:'5',
  'p6-insert':'6','p6-context':'6','p7-not':'7','p7-syn':'7','p7-position':'7','p7-multi':'7','p7-detail':'7'
};

const soundTraps = new Set(['p2-020','p2-026','p2-052']);
const echoTraps = new Set(['p2-037','p2-049','p2-079','p2-097','p2-122','p2-157','p2-175']);
const partsOfSpeech = new Set(['gram-word-form','gram-modifiers']);
const timeTopics = new Set(['gram-time','gram-sequence']);
const indirectLegacy = new Set(['p2-020','p2-024','p2-026','p2-027','p2-028','p2-030','p2-031','p2-032','p2-034','p2-035','p2-036','p2-038','p2-039','p2-040','p2-042','p2-043','p2-045','p2-046','p2-047','p2-048','p2-050','p2-051']);
const linkTopics = new Set(['gram-preposition','gram-conjunction','gram-linkers']);
export const methodBank = id => id.startsWith('photo') ? 'part1' :
  ['first-word','indirect','sounds','echo'].includes(id) ? 'part2' :
  ['preview','keywords','graphic','intent'].includes(id) ? 'listening' :
  ['p5-choice','word-form','tense','link','lexis'].includes(id) ? 'grammar' : 'reading';

// Each of these questions needs a condition, price, quantity or exception from a second document.
const crossDocument = new Set([
  'read-plants-01','read-staging-01','read-proof-01','read-proof-02','read-oven-02',
  'read-seats-01','read-seats-02','read-hours-01','read-hours-02','read-rent-credit-01',
  'read-rent-credit-02','read-film-vote-01','read-film-vote-02','read-paper-grades-01',
  'read-paper-grades-02','read-donor-match-01','read-donor-match-02'
]);
export function relevantMethods(ref, data) {
  if (!ref || !data) return [];
  switch (ref.mode) {
    case 'part1': return /\b(?:is|are) being |\b(?:has|have) been /i.test(data.answer) ? ['photo-state','photo'] : ['photo'];
    case 'part2':
      if (data.type === 'first') return ['first-word'];
      if (soundTraps.has(ref.id)) return ['sounds'];
      if (echoTraps.has(ref.id)) return ['echo'];
      return data.indirect || indirectLegacy.has(ref.id) ? ['indirect'] : ['first-word'];
    case 'dialogue':
      if (data.type==='graphic' || /look at the graphic/i.test(data.prompt)) return ['graphic','preview','keywords'];
      if (data.type==='intent' || /\b(?:mean|imply)\b|suggest in context/i.test(data.prompt)) return ['intent','preview','keywords'];
      return data.set.questions[0].id===ref.id ? ['preview','keywords'] : ['keywords','preview'];
    case 'grammar': {
      const topic=data.topic.id;
      if (partsOfSpeech.has(topic)) return ['word-form','p5-choice'];
      if (timeTopics.has(topic)) return ['tense','p5-choice'];
      if (linkTopics.has(topic)) return ['link','p5-choice'];
      if (topic==='gram-lexis') return ['lexis','p5-choice'];
      return ['p5-choice'];
    }
    case 'reading':
      if(data.set.part===6) return data.kind==='sentence' ? ['p6-insert'] : ['p6-context'];
      if(data.kind==='negative') return ['p7-not'];
      if(data.kind==='vocabulary') return ['p7-syn'];
      if(data.kind==='insertion') return ['p7-position'];
      return data.set.documents.length>1 && crossDocument.has(ref.id) ? ['p7-multi'] : ['p7-detail'];
    default:return [];
  }
}
export function newMethod(state, ref, data) {
  if (state.settings.methodHints===false || state.session?.selected!==null || ['diagnostic','diagnosis','exam','screen'].includes(state.session?.mode)) return;
  const seen=state.methodsSeen || [];
  const [id]=relevantMethods(ref,data);
  return !seen.includes(id) ? methodById(id) : undefined;
}
export function methodExample(id,catalog,state) {
  const ranked=[...catalog.values()].filter(({ref,data})=>relevantMethods(ref,data).includes(id) && (id!=='first-word' || data.type==='first'))
    .map(item=>({item,count:state.seen[item.ref.id]||0,rand:Math.random()}))
    .sort((a,b)=>a.count-b.count||a.rand-b.rand);
  return ranked[0]?.item.ref;
}
export function methodIndex() {
  return `<div class="page-title"><h1>解题方法</h1></div><section class="lesson-shell method-list">${cards.map(card=>
    `<button class="panel" data-act="method-open" data-method="${esc(card.id)}"><small>Part ${esc(card.part)}</small><b>${esc(card.title)}</b><span aria-hidden="true">›</span></button>`
  ).join('')}</section>`;
}
export function methodCard(card,automatic) {
  return `<article class="method-card" data-auto="${automatic}" data-method-card="${esc(card.id)}"><p class="method-caption">Part ${esc(card.part)} · 解题方法</p>
    <h2>${esc(card.title)}</h2><p>${esc(card.lead)}</p>
    <ol class="method-diagram">${card.steps.map(step=>`<li><b>${esc(step.label)}</b><span lang="en">${esc(step.text)}</span></li>`).join('')}</ol>
    <p>${esc(card.note)}</p><div class="method-actions">${automatic?
      '<button class="primary" data-act="method-skip">试一题 · 继续当前练习</button><button class="secondary" data-act="method-skip">跳过</button><label><input type="checkbox" data-method-disable> 关闭首次提示</label>':
      `<button class="primary" data-act="method-try" data-method="${esc(card.id)}">试一题</button>`}
    </div></article>`;
}
