import {gradeError,responseRating} from './review-scheduler.js';
import {bank,catalog} from './bank.js';
import {speak,hush} from './audio.js';
import {buildExam,examIds,readingIds,listeningScript,listeningStepSentences} from './exam.js';
import {duration} from './exam-ui.js';

export function examController({state,page,show,redraw,save,notify,confirm,onGrade}) {
  let timer=0, waitUntil=0, activeSince=0, ticket=0, live=false;
  let preparation=null, preparationController=null;
  const current=()=>state().exam;
  function cancelPreparation(){preparationController?.abort();preparationController=null;preparation=null;}
  async function beginResume(){
    const e=current();if(!e)return;
    if(e.phase!=='listening'||state().settings.audioMode==='system'){cancelPreparation();resume();return;}
    cancelPreparation();const controller=new AbortController();preparationController=controller;
    preparation={status:'loading',done:0,total:0,message:'正在检查本套听力音频…'};show('examPrepare');
    try{
      const {prepareExamAudio}=await import('./audio-downloads.js');
      await prepareExamAudio(e,catalog,{signal:controller.signal,onProgress:p=>{
        if(preparationController!==controller||page()!=='examPrepare')return;
        preparation={...p,status:'loading',message:`正在准备本套听力：${p.done} / ${p.total}`};redraw();
      }});
      if(controller.signal.aborted||current()!==e||page()!=='examPrepare')return;
      preparation={...preparation,status:'ready',message:'本套听力音频已下载。点击下面的按钮开始，听力将连续播放。'};redraw();
    }catch(error){
      if(controller.signal.aborted||current()!==e||page()!=='examPrepare')return;
      preparation={...preparation,status:'error',message:error.code==='AUDIO_QUOTA'?'本机空间不足。可到设置删除部分音频后重试。':'本套音频未能全部准备好，已下载部分保留。请联网重试，或在设置中选择系统语音。'};redraw();
    }
  }
  function clear(){
    ticket++;clearTimeout(timer);clearInterval(timer);timer=0;hush();live=false;
  }
  function account(){
    const e=current();if(!e||!activeSince)return;
    const now=Date.now(),start=activeSince;
    const elapsed=Math.max(0,(e.phase==='reading'&&e.deadline?Math.min(now,e.deadline):now)-start);
    const ids=e.phase==='reading'?[readingIds(e)[e.cursor]]:e.focus?[e.focus]:e.units[e.unit].ids;
    ids.forEach((id,i)=>{e.times[id]=(e.times[id]||0)+Math.floor(elapsed/ids.length)+Number(i<elapsed%ids.length);});
    activeSince=now;
  }
  function suspend(){
    const e=current();
    if(!live||!e)return;
    account();activeSince=0;
    if(e.phase==='reading'&&e.deadline){e.remaining=Math.max(0,e.deadline-Date.now());e.deadline=0;}
    if(waitUntil){e.wait=Math.max(0,waitUntil-Date.now());waitUntil=0;}
    clear();save();
  }
  function finish(){
    const e=current();if(!e||e.phase==='done')return;
    account();activeSince=0;clear();waitUntil=0;
    e.remaining=e.deadline?Math.max(0,e.deadline-Date.now()):e.remaining;e.deadline=0;e.phase='done';e.finishedAt=Date.now();e.focus=null;
    const s=state();e.keys={};
    for(const id of examIds(e)){
      const {ref,data}=catalog.get(id), ok=e.answers[id]===data.answer;
      e.keys[id]=data.answer;
      const answered=Object.hasOwn(e.answers,id);
      if(answered)s.seen[id]=(s.seen[id]||0)+1;
      gradeError(s,ref,ok,responseRating(ok,e.reviewMs?.[id]??0),e.finishedAt);
      if(answered)onGrade?.(ref,data,ok,e.answeredAt[id]);
    }
    s.examForms ||= [0,0,0,0];s.examForms[e.form]++;
    if(save()){show('exam');}
  }
  function readingTimer(){
    const e=current();e.phase='reading';
    e.deadline=Math.min(e.deadline||Infinity,Date.now()+e.remaining);
    const update=()=>{
      if(!live||current()!==e||page()!=='exam')return;
      const left=e.deadline-Date.now();if(left<=0){finish();return;}
      const clock=document.querySelector('#exam-clock');if(clock)clock.textContent=duration(left);
    };
    timer=setInterval(update,400);save();update();
  }
  function audioError(message){
    // Cancel only playback from this still-live session; never advance an unseen item on a voice error.
    if(!live)return;suspend();show('examLobby');notify(message+' 已保存到最近的播放位置。');
  }
  function pump(){
    const e=current();if(!live||!e||page()!=='exam')return;
    if(e.wait>0){
      waitUntil=Date.now()+e.wait;timer=setTimeout(()=>{if(!live||current()!==e)return;waitUntil=0;e.wait=0;save();pump();},e.wait);
      return;
    }
    const u=e.units[e.unit], script=listeningScript(u,catalog);
    if(e.step>=script.length){
      account();e.unit++;e.step=0;e.sentence=0;e.focus=null;
      if(e.units[e.unit].part>=5){readingTimer();redraw();return;}
      if(!save() && current()!==e)return;redraw();window.scrollTo(0,0);pump();return;
    }
    const step=script[e.step];
    if(step.item&&e.focus!==step.item){account();e.focus=step.item;}
    if(step.delay){e.step++;e.sentence=0;e.wait=step.delay;save();pump();return;}
    const sentences=listeningStepSentences(step),sentence=e.sentence??0;
    const seq=++ticket,i=e.step;
    // Checkpoint the sentence that actually started, while retaining the old
    // whole-turn step index so existing exam archives resume without replay.
    const advance=()=>{if(e.step===i&&(e.sentence??0)===sentence){
      if(sentence+1<sentences.length)e.sentence=sentence+1;
      else{e.step++;e.sentence=0;}
      save();
    }};
    const seed=catalog.get(u.ids[0]).data.set?.id || u.ids[0];
    speak([{...step,text:sentences[sentence]}],state().settings,message=>{if(live&&current()===e&&ticket===seq)audioError(message);},{seed,noFallbackAfterStart:true,castTurns:script.filter(t=>t.speaker),onStart:()=>{if(live&&ticket===seq)advance();},
      onEnd:()=>{if(!live||ticket!==seq)return;advance();
        const gap=Number(state().settings.audioGapMs);
        e.wait=Math.min(1500,Math.max(0,Number.isFinite(gap)?gap:200));save();pump();}});
  }
  function resume(){
    const e=current();if(!e)return;show('exam');if(e.phase==='done')return;
    clear();live=true;activeSince=Date.now();
    if(e.phase==='reading')readingTimer();else pump();
  }
  function jump(i){
    const e=current();if(!e||e.phase!=='reading'||!live)return;
    if(Date.now()>=e.deadline){finish();return;}
    const ids=readingIds(e);
    if(!Number.isInteger(i)||i<0||i>=ids.length)return;
    account();e.cursor=i;if(!save()&&current()!==e)return;redraw();window.scrollTo(0,0);
  }
  function action(name,el){
    const s=state(),e=s.exam;
    if(name==='exam-lobby'){suspend();show('examLobby');}
    if(name==='exam-start'&&(!e||e.phase==='done')){
      try{s.exam=buildExam(bank,s,el.dataset.size);if(save())beginResume();}catch(err){notify(err.message);}
    }
    if(name==='exam-resume'||name==='exam-result'||name==='exam-download-retry')beginResume();
    if(name==='exam-prepare-cancel'){cancelPreparation();show('examLobby');}
    if(name==='exam-listen-ready'&&page()==='examPrepare'&&preparation?.status==='ready'){cancelPreparation();resume();}
    if(name==='exam-leave'){suspend();show('examLobby');}
    if(name==='exam-prev')jump(e.cursor-1);
    if(name==='exam-next')jump(e.cursor+1);
    if(name==='exam-submit'&&e?.phase==='reading'){
      const left=examIds(e).length-Object.keys(e.answers).length;
      confirm('确认交卷？',left?'还有 '+left+' 道未答，交卷后会列入复习。':'全部题目已作答。','exam-confirm','确认交卷');
    }
    if(name==='exam-confirm'&&e?.phase==='reading')finish();
    if(name==='exam-choice'&&live&&e?.phase!=='done'){
      if(e.phase==='reading'&&Date.now()>=e.deadline){finish();return;}
      const id=el.dataset.id,options=catalog.get(id)?.data.options;
      const visible=e.phase==='reading'?[readingIds(e)[e.cursor]]:e.units[e.unit].ids;
      if(!visible.includes(id)||!options?.[Number(el.dataset.i)])return;
      account();e.reviewMs??={};
      if(!Object.hasOwn(e.answers,id))e.reviewMs[id]=e.times[id]||0;
      e.focus=id;e.answers[id]=options[Number(el.dataset.i)];e.answeredAt[id]=Date.now();if(!save()&&current()!==e)return;
      const group=el.closest('.lesson-choices');
      for(const b of group.querySelectorAll('button')){b.classList.toggle('exam-chosen',b===el);b.setAttribute('aria-pressed',String(b===el));}
      const selected=document.querySelector('#exam-jump option:checked');if(selected)selected.textContent=(e.cursor+1)+' · 已答';
    }
  }
  return {action,jump,suspend,cancelPreparation,stop(){cancelPreparation();activeSince=0;waitUntil=0;clear();},get preparation(){return preparation;},get live(){return live;}};
}
