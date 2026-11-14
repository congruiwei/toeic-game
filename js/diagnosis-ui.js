import {abilities,abilityNames,diagnosisCount,diagnosisRanges} from './diagnosis.js';
import {question} from './bank.js';
import {graphic,passages} from './practice.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const label = r => r.part===0?'单词':'Part '+r.part;
export function diagnosisHome(s) {
  const d=s.diagnosis,done=d?.results.length, resumable=d?.active;
  const action='<button class="secondary" data-act="diag-open">'+(resumable?'继续诊断':done?'重新诊断':d?.skipped?'开始诊断':'测一测')+'</button>';
  if(d?.skipped&&!resumable&&!done)return '<div class="diag-skipped">水平诊断 '+action+'</div>';
  return '<section class="panel diag-card"><div><h2>水平诊断</h2><p>'+
    (resumable?'已完成 '+resumable.items.length+' / '+diagnosisCount+' 题':done?'上次诊断已设定四项练习起点':diagnosisCount+' 道自适应题，约 15 分钟。可分次完成。')+
    '</p></div><div>'+action+(!done&&!resumable?'<button class="secondary" data-act="diag-skip">以后再说</button>':'')+'</div></section>';
}
function results(r) {
  const ranges=r.ranges||diagnosisRanges(r.levels,r.items);
  return '<div class="diag-levels">'+abilities.map(s=>'<div><b>'+abilityNames[s]+'</b><strong>'+r.levels[s]+' 级</strong></div>').join('')+'</div><p>本次诊断的参考区间 · 听力 '+ranges.L.join('–')+' / 495，阅读 '+ranges.R.join('–')+' / 495。仅供参考。</p>';
}
export function diagnosisHistory(s){
  const rs=s.diagnosis?.results||[];
  if(!rs.length)return '';
  return '<section class="panel diag-history"><h2>水平诊断记录</h2>'+rs.slice().reverse().map((r,i)=>
    '<details'+(i===0?' open':'')+'><summary>第 '+(rs.length-i)+' 次 · '+esc(new Date(r.at).toLocaleString('zh-CN',{year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}))+'</summary>'+results(r)+'</details>').join('')+'</section>';
}
export function unknownDiagnosisView(ref,q){
  const body=ref.mode==='vocab'
    ? '<p lang="en">'+esc(q.example)+'</p><p>'+esc(q.zh)+' · '+esc(q.paraphrase)+'</p>'
    : '<p lang="en">'+esc(q.en)+'</p><p>'+esc(q.zh)+'</p>';
  return '<h2>这道题的解析</h2><p><b>正确答案</b> '+esc(q.answer)+'</p>'+body+
    '<button type="button" class="lesson-primary" data-act="diag-dismiss">继续</button>';
}
export function diagnosisView(state) {
  const d=state.diagnosis,run=d?.active;
  if(!run){const result=d?.results.at(-1);
    return '<section class="lesson-shell"><div class="lesson-panel"><h1>诊断完成</h1>'+(result?results(result):'')+
    '<p>以上为游戏内起始难度。之后的练习会继续随表现调整。</p><button class="lesson-primary" data-act="nav" data-page="report">查看学习报告</button></div></section>';}
  const ref=run.current,q=question(ref);
  const hidden=ref.part===1||ref.part===2;
  return '<section class="lesson-shell" id="diagnosis-question" data-part="'+ref.part+'" data-level="'+q.level+
    '"><header class="lesson-header"><button class="lesson-back" aria-label="保存并离开" data-act="diag-leave">‹</button><div><h1>水平诊断</h1><div class="lesson-track"><span style="width:'+
    100*run.items.length/diagnosisCount+'%"></span></div></div><b>'+ (run.items.length+1)+' / '+diagnosisCount+'</b></header>'+
    '<div class="lesson-meta">'+label(ref)+' · '+q.level+' 级</div>'+
    (ref.part===1?'<figure class="lesson-photo"><img src="./'+esc(q.image)+'" alt="本题场景插画"></figure>':'')+
    (q.set?.graphic?graphic(q.set.graphic):'')+(ref.mode==='reading'?passages(q,false):'')+
    '<div class="lesson-panel"><h2>'+esc(hidden?'听录音，选择最佳答案':q.prompt)+'</h2>'+
    (q.context?'<p lang="en">'+esc(q.context)+'</p>':'')+(q.audio?'<button class="lesson-primary" data-act="diag-audio">点击开始 · 播放录音</button>':'')+
    '</div><div class="lesson-choices">'+q.options.map((o,i)=>'<button class="lesson-option" data-act="diag-answer" data-id="'+esc(ref.id)+'" data-i="'+i+'"><b>'+String.fromCharCode(65+i)+'</b> '+(hidden?'选择 '+String.fromCharCode(65+i):esc(o))+'</button>').join('')+'</div><button type="button" class="secondary" data-act="diag-unknown" data-id="'+esc(ref.id)+'">不知道，看解析</button></section>';
}
