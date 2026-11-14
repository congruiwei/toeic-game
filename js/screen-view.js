import {UNKNOWN} from './answers.js';
import {bank,catalog,question} from './bank.js';
import {beginScreen,selfAssess,markSpotCheck,screenedQueue} from './screening.js';
import {recordStudy} from './report.js';
import {reward} from './state.js';
import {speak} from './audio.js';

const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function screenView(s) {
  const r=s.screening?.run;
  if(!r)return '<section class="lesson-shell"><h1>单词快筛</h1><p>目前的词卡都已筛选。</p><button class="lesson-primary" data-act="nav" data-page="learn">回到练习</button></section>';
  const w=catalog.get(r.ids[r.index])?.data;
  if(r.feedback){
    const {id,selected}=r.feedback, ref={id,mode:'vocab',format:'meaning'}, q=question(ref);
    return `<section class="lesson-shell"><h1>抽查反馈</h1><div class="lesson-panel" data-screen-feedback data-id="${esc(id)}">
      <h2>${selected===q.answer?'答对了':'已加入待学词'}</h2><strong lang="en">${esc(q.word)}</strong><p>${esc(q.zh)}</p><blockquote lang="en">${esc(q.example)}</blockquote>
      </div><button class="lesson-primary" data-act="screen-next">继续快筛</button></section>`;
  }
  if(!w){
    const pct=r.checks?Math.round(100*r.correct/r.checks)+'%':'—';
    return `<section class="lesson-shell"><h1>本轮快筛完成</h1><div class="lesson-panel"><p>认识 ${r.known} · 不认识 ${r.unknown}</p><p>抽查正确率 ${pct}（${r.correct} / ${r.checks}）</p></div>
      ${screenedQueue(s).length?'<button class="lesson-primary" data-act="screen-learn">练习待学词</button>':''}<button class="secondary" data-act="screen-open">下一批</button><button class="secondary" data-act="nav" data-page="learn">回到练习</button></section>`;
  }
  const q=question({id:w.id,mode:'vocab',format:'meaning'});
  return `<section class="lesson-shell screen-session"><header class="lesson-header"><h1>${r.pending?'快筛抽查':'单词快筛'}</h1><button class="plain" data-act="nav" data-page="learn">保存离开</button></header>
  <div class="lesson-meta"><span>${r.index+1} / ${r.ids.length}</span><span>${w.level} 级</span></div>
  <div class="lesson-panel screen-card" data-word="${esc(w.id)}"><h2 lang="en">${esc(w.word)}</h2><p lang="en">${esc(w.ipa)} · ${esc(w.pos)}</p>
  ${w.sense?`<blockquote lang="en">${esc(w.example)}</blockquote>`:''}</div>
  ${r.pending?`<p>选出这个用法的中文意思</p><div class="lesson-choices">${q.options.map((text,i)=>`<button class="lesson-option" data-act="screen-check" data-i="${i}" data-id="${esc(w.id)}">${esc(text)}</button>`).join('')}</div><button class="secondary lesson-unknown" data-act="screen-unknown" data-id="${esc(w.id)}">不知道</button>`:
    `<p class="muted screen-hint">左滑不认识 · 右滑认识</p><div class="screen-actions"><button class="secondary" data-act="screen-no" data-id="${esc(w.id)}">← 不认识</button><button class="primary" data-act="screen-yes" data-id="${esc(w.id)}">认识 →</button></div>`}
  </section>`;
}
export function screenController({state,go,render,save,toast,study}) {
  let pointer;
  function pronounce() {
    const s=state(),r=s.screening?.run,w=catalog.get(r?.ids[r.index])?.data;
    if(w && !r.pending && !r.feedback)speak([{speaker:'A',text:w.word}],s.settings,toast,{seed:w.id});
  }
  function choose(id,knows) {
    const s=state();
    if(!selfAssess(s,id,knows))return;
    if(save()){render();pronounce();}
  }
  function action(a,el) {
    const s=state();
    if(a==='screen-open'){
      const r=beginScreen(s,bank.vocab);
      if(!r && s.screening) s.screening.run=null;
      if(save()){go('screen');pronounce();}
    }else if(a==='screen-next'){
      if(!s.screening?.run?.feedback)return;
      delete s.screening.run.feedback;
      if(save()){render();pronounce();}
    }else if(a==='screen-learn'){
      study();
    }else if(a==='screen-no'||a==='screen-yes'){
      choose(el.dataset.id,a==='screen-yes');
    }else if(a==='screen-check'||a==='screen-unknown'){
      const id=el.dataset.id,ref={id,mode:'vocab',format:'meaning'},q=question(ref);
      if(!q)return;
      const selected=a==='screen-unknown'?UNKNOWN:q.options[Number(el.dataset.i)];
      if(!selected)return;
      const ok=selected===q.answer;
      if(!markSpotCheck(s,id,ok))return;
      s.screening.run.feedback={id,selected};
      reward(s,q,ref,ok,Date.now(),{screenCheck:true});
      recordStudy(s,ref,q,ok,Date.now(),selected===UNKNOWN?'unknown':undefined);
      if(ok) s.words[id].due=Date.now()+7*86400000;
      if(save())render();
    }
  }
  function pointerDown(e){
    const card=e.target.closest('.screen-card');
    if(!card||state().screening?.run?.pending||!e.isPrimary)return;
    pointer={id:e.pointerId,x:e.clientX,y:e.clientY,word:card.dataset.word};
    card.setPointerCapture(e.pointerId);
  }
  function pointerUp(e){
    const p=pointer;pointer=null;
    if(!p||e.pointerId!==p.id)return;
    const dx=e.clientX-p.x,dy=e.clientY-p.y;
    if(Math.abs(dx)>=48 && Math.abs(dx)>Math.abs(dy)*1.35)choose(p.word,dx>0);
  }
  return {action,pointerDown,pointerUp,cancel:()=>{pointer=null;}};
}
