// A full form keeps its passages intact. Four disjoint passage pools survive reloads and reordering of the bank.
export const fullCounts=[6,25,39,30,30,16,54], halfCounts=[3,12,20,15,15,8,27];
const keyOf=g=>g.id;
function hash(s){let h=2166136261;for(const c of s)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;}
function choose(pool,n,seen,seed){
  if(pool.length<n)throw Error('题库不足，无法生成这套模拟卷。');
  const cost=x=>x.questions?x.questions.reduce((a,q)=>a+(seen[q.id]||0),0)/x.questions.length:(seen[x.id]||0);
  return [...pool].sort((a,b)=>cost(a)-cost(b)||hash(seed+a.id)-hash(seed+b.id)).slice(0,n);
}
export function passagePools(groups){
  const buckets=Array.from({length:4},()=>[]);
  const tag=g=>[Boolean(g.graphic),new Set((g.turns||[]).map(t=>t.speaker)).size===3,
    (g.questions||[]).some(q=>q.type==='intent')].map(Number);
  const order=[...groups].sort((a,b)=>(a.part===7?b.questions.length-a.questions.length:0)||tag(b).reduce((v,n)=>v+n,0)-tag(a).reduce((v,n)=>v+n,0)||a.id.localeCompare(b.id));
  for(const g of order){
    const score=b=>tag(g).reduce((v,on,k)=>v+(on?b.filter(x=>tag(x)[k]).length:0)*8,0)
      + b.filter(x=>x.level===g.level).length*1.5 + b.length
      + (g.part===7?b.reduce((sum,x)=>sum+x.questions.length,0)*2:0);
    const open=buckets.filter(b=>b.length<Math.ceil(order.length/4));
    open.sort((a,b)=>score(a)-score(b))[0].push(g);
  }
  return buckets;
}

function singleQuestions(groups,target,seen,seed){
  const lists=groups.map(g=>choose(g.questions,g.questions.length,seen,seed));
  const take=lists.map(()=>2);
  for(let total=take.length*2;total<target;total++){
    const indices=lists.map((_,i)=>i).filter(i=>take[i]<lists[i].length);
    if(!indices.length)throw Error('单篇题量不足。');
    indices.sort((a,b)=> (seen[lists[a][take[a]].id]||0)-(seen[lists[b][take[b]].id]||0)|| take[a]-take[b]);
    take[indices[0]]++;
  }
  return groups.map((g,i)=>g.questions.filter(q=>lists[i].slice(0,take[i]).includes(q)).map(keyOf));
}
export function buildExam(bank,state,size='full',seed=String(Date.now())){
  const half=size==='half', counts=half?halfCounts:fullCounts,seen=state.seen,units=[];
  const formUses=state.examForms||[0,0,0,0];
  const sets=p=>bank.listening.filter(g=>g.part===p);
  const pools=[passagePools(sets(3)),passagePools(sets(4)),passagePools(bank.reading.filter(g=>g.part===6)),
    ...[1,2,3].map(n=>passagePools(bank.reading.filter(g=>g.part===7&&g.documents.length===n)))];
  const exposure=i=>pools.reduce((total,pool)=>total+pool[i].reduce((n,g)=>n+g.questions.reduce((v,q)=>v+(seen[q.id]||0),0),0),0);
  const form=[0,1,2,3].sort((a,b)=>formUses[a]-formUses[b]||exposure(a)-exposure(b)||hash(seed+a)-hash(seed+b))[0];
  const pool=(index,n)=>choose(pools[index][form],n,seen,seed);
  const add=(part,ids)=>units.push({part,ids});
  const privatePool=rows=>rows.slice().sort((a,b)=>hash('bank:'+a.id)-hash('bank:'+b.id)).filter((_,i)=>i%4===form);

  for(const q of choose(privatePool(bank.part1),counts[0],seen,seed))add(1,[q.id]);
  for(const q of choose(privatePool(bank.part2.filter(q=>q.type==='response')),counts[1],seen,seed))add(2,[q.id]);
  for(const part of [3,4]){
    let remaining=counts[part-1];
    for(const g of pool(part-3,Math.ceil(remaining/3))){
      const selected=choose(g.questions,Math.min(3,remaining),seen,seed);
      add(part,g.questions.filter(q=>selected.includes(q)).map(keyOf));remaining-=selected.length;
    }
  }
  const lex=bank.grammar.filter(g=>g.id==='gram-lexis').flatMap(g=>g.questions);
  const gram=bank.grammar.filter(g=>g.id!=='gram-lexis').flatMap(g=>g.questions);
  const lexicalCount=Math.floor(counts[4]/2);
  const grammarQs=[...choose(privatePool(lex),lexicalCount,seen,seed),...choose(privatePool(gram),counts[4]-lexicalCount,seen,seed)];
  grammarQs.sort((a,b)=>hash(seed+a.id)-hash(seed+b.id)).forEach(q=>add(5,[q.id]));
  for(const g of pool(2,half?2:4))add(6,g.questions.map(keyOf));
  const singles=pool(3,half?5:10);
  if(half){
    // Some five-passage subsets of a balanced full form contain fewer than 14 questions.
    const extras=pools[3][form].filter(g=>!singles.includes(g)).sort((a,b)=>b.questions.length-a.questions.length);
    while(singles.reduce((n,g)=>n+g.questions.length,0)<14){
      singles.sort((a,b)=>a.questions.length-b.questions.length);
      if(!extras.length||extras[0].questions.length<=singles[0].questions.length)throw Error('半套阅读组题量不足');
      singles[0]=extras.shift();
    }
  }
  // Use complete statements and whole documents; a half form uses 14 single-text and 13 linked-text questions.
  for(const ids of singleQuestions(singles,half?14:29,seen,seed))add(7,ids);
  for(const g of pool(4,half?1:2))add(7,g.questions.map(keyOf));
  for(const g of pool(5,half?2:3)){
    const keep=choose(g.questions,half?4:5,seen,seed);
    add(7,g.questions.filter(q=>keep.includes(q)).map(keyOf));
  }
  return {version:1,size,form,units,focus:null,phase:'listening',unit:0,step:0,wait:0,cursor:0,answers:{},times:{},answeredAt:{},
    remaining:(half?38:75)*60000,deadline:0,startedAt:Date.now(),finishedAt:0};
}
export const examIds=e=>e.units.flatMap(u=>u.ids);
export const readingIds=e=>e.units.filter(u=>u.part>=5).flatMap(u=>u.ids);
export function examValid(e,catalog){
  if(!e||e.version!==1||!['full','half'].includes(e.size)||!['listening','reading','done'].includes(e.phase)
    ||!Number.isInteger(e.form)||e.form<0||e.form>3||!Array.isArray(e.units)||!e.units.length||e.units.length>200)return false;
  const needed=e.size==='half'?halfCounts:fullCounts, counts=Array(7).fill(0),ids=new Set();
  let prev=0;
  for(const u of e.units){
    if(!u||!Number.isInteger(u.part)||u.part<1||u.part>7||u.part<prev||!Array.isArray(u.ids)||!u.ids.length||u.ids.length>5)return false;
    prev=u.part;counts[u.part-1]+=u.ids.length;
    if (([1,2,5].includes(u.part) && u.ids.length!==1) || (u.part===6&&u.ids.length!==4))return false;
    let groupId;
    for(const id of u.ids){
      const d=catalog?.get(id);
      if(typeof id!=='string'||!/^[\w-]{1,100}$/.test(id)||ids.has(id))return false;
      if(catalog&&(!d||({part1:1,part2:2,grammar:5}[d.ref.mode]||d.data.set?.part)!==u.part))return false;
      if(d && (d.ref.mode==='dictation' || (u.part===2 && d.data.type!=='response')))return false;
      if(d?.data.set){if(groupId && groupId!==d.data.set.id)return false;groupId=d.data.set.id;}
      ids.add(id);
    }
  }
  if(counts.some((n,i)=>n!==needed[i]))return false;
  if(![e.unit,e.step,e.wait,e.cursor,e.remaining,e.deadline,e.startedAt,e.finishedAt].every(v=>Number.isSafeInteger(v)&&v>=0)
    ||e.unit>=e.units.length||e.step>100||e.wait>120000||e.cursor>=needed.slice(4).reduce((n,i)=>n+i,0))return false;
  if(e.phase==='listening'&&e.units[e.unit].part>4)return false;
  if(e.remaining>(e.size==='half'?38:75)*60000)return false;
  if(e.focus!==null && !ids.has(e.focus))return false;
  if(e.phase==='listening'&&catalog&&e.step>listeningScript(e.units[e.unit],catalog).length)return false;
  if(e.phase==='done' && (!e.keys || [...ids].some(id=>typeof e.keys[id]!=='string')))return false;
  return [e.answers,e.times,e.answeredAt].every(m=>m&&typeof m==='object'&&!Array.isArray(m)&&Object.keys(m).every(id=>ids.has(id)))
    &&Object.values(e.answers).every(v=>typeof v==='string'&&v.length<=2000)&&Object.values(e.answeredAt).every(v=>Number.isSafeInteger(v)&&v>=0)
    &&Object.values(e.times).every(v=>Number.isSafeInteger(v)&&v>=0);
}
export function listeningScript(unit,catalog){
 const first=catalog.get(unit.ids[0]).data;
 const utter=(speaker,text)=>({speaker,text});
 if(unit.part<=2)return [...(unit.part===2?[utter('A',first.audio)]:[]),
   ...first.options.map((option,i)=>utter(unit.part===2?'B':'A',String.fromCharCode(65+i)+'. '+option)),{delay:5500}];
 return [...first.set.turns,...unit.ids.flatMap(id=>[{...utter('N',catalog.get(id).data.prompt),item:id},{delay:5500,item:id}])];
}
export function examScores(e,catalog){
 const parts=Array.from({length:7},()=>({correct:0,total:0}));
 for(const u of e.units)for(const id of u.ids){
   parts[u.part-1].total++;parts[u.part-1].correct+=Number(e.answers[id]===(e.keys?.[id]??catalog.get(id).data.answer));
 }
 const scale=rows=>5+5*Math.round(98*rows.reduce((n,r)=>n+r.correct,0)/rows.reduce((n,r)=>n+r.total,0));
 return {parts,listening:scale(parts.slice(0,4)),reading:scale(parts.slice(4))};
}
