import {loadAudioIndex} from './recorded-audio.js';
import {downloadAudioPack,audioCacheUsage,deleteAudioCache} from './audio-downloads.js';

const groups={
  listening:{label:'全部听力音频',language:'en',banks:['part1','part2','listening','labels']},
  vocab:{label:'单词音频',language:'en',banks:['vocab']},
  reading:{label:'阅读音频',language:'en',banks:['grammar','reading']},
  japanese:{label:'日语录音',language:'ja',banks:['part1','part2','listening','vocab','grammar','reading','methods','terms']},
};
const size=bytes=>(bytes/1048576).toFixed(1)+' MB';
let task=null,status='播放过的音频会自动保存在本机。',index=null,usageController=null;
export function audioSettingsView(){
  return `<section class="backup" id="audio-downloads"><h3>离线音频</h3>
    <p class="fine muted">英语：Heart / Puck / Bella（美式） · 日语：Alpha / 设备日语语音。仅在播放或主动下载时获取音频；音频不包含在进度备份里。</p>
    <p data-audio-usage role="status">正在读取已下载空间…</p>
    <p class="fine muted" data-audio-fallbacks>日语系统语音：正在读取清单…</p>
    ${Object.entries(groups).map(([id,g])=>`<p><button type="button" class="secondary" data-act="audio-download" data-group="${id}">下载${g.label}</button> <small data-audio-size="${id}"></small></p>`).join('')}
    <p data-audio-progress role="status"></p><progress data-audio-progress-bar max="1" value="0" hidden aria-label="音频下载进度"></progress>
    <button type="button" class="secondary" data-act="audio-cancel" ${task?'':'hidden'}>取消下载</button>
    <button type="button" class="secondary" data-act="audio-delete">删除已下载音频</button>
    <p class="fine muted">下载期间请保持页面打开。取消或网络中断会保留已完成部分，下次下载可接着补齐。删除音频不会删除学习进度、词卡或翻译。</p></section>`;
}
function redraw(){
  const host=document.querySelector('#audio-downloads');if(!host)return;
  host.querySelector('[data-audio-progress]').textContent=status;
  host.querySelector('[data-act=audio-cancel]').hidden=!task;
  host.querySelectorAll('[data-act=audio-download]').forEach(b=>b.disabled=Boolean(task));
  if(index){
    const count=index.packs.filter(p=>p.language==='ja').reduce((sum,p)=>sum+(p.fallbackCount||0),0);
    host.querySelector('[data-audio-fallbacks]').textContent=`日语系统语音：${count} 句。${count?'这些句子使用设备日语声音，不包含在录音下载中；请先在设置中试听设备日语语音。':'当前已发布清单没有指定系统后备句子。'}`;
  }
  if(index)for(const [id,g]of Object.entries(groups)){
    const bytes=index.packs.filter(p=>p.language===g.language&&g.banks.includes(p.bank)).reduce((sum,p)=>sum+p.audioBytes,0);
    host.querySelector(`[data-audio-size="${id}"]`).textContent='约 '+size(bytes);
  }
  const bar=host.querySelector('progress');bar.hidden=!task;bar.max=task?.total||1;bar.value=task?.done||0;
}
async function usage(){
  usageController?.abort();
  const el=document.querySelector('[data-audio-usage]');if(!el)return;
  const controller=new AbortController();usageController=controller;
  try{const n=await audioCacheUsage({signal:controller.signal});if(!controller.signal.aborted&&el.isConnected)el.textContent=`本机已下载 ${n.files} 个文件 · ${size(n.bytes)}`;}
  catch(error){if(error.name!=='AbortError'&&!controller.signal.aborted&&el.isConnected)el.textContent='当前浏览器无法读取音频缓存空间。';}
  finally{if(usageController===controller)usageController=null;}
}
export async function mountAudioSettings(){
  redraw();
  await Promise.all([usage(),(async()=>{
    try{index=await loadAudioIndex();redraw();}
    catch{status='音频清单尚未下载，请联网后重新打开设置。';redraw();}
  })()]);
}
export async function audioSettingsAction(action,element,notify){
  if(action==='audio-cancel'){task?.controller.abort();return;}
  if(action==='audio-delete'){
    usageController?.abort();
    const running=task;running?.controller.abort();
    if(running)await running.finished;
    try{await deleteAudioCache();status='已删除下载的音频。需要时可重新下载。';notify('已删除音频，学习进度保留');}
    catch{status='音频未能完全删除，请重新打开设置后重试。';}
    redraw();await usage();return;
  }
  const group=groups[element.dataset.group];if(action!=='audio-download'||!group||task)return;
  const current={controller:new AbortController(),done:0,total:1};
  current.finished=new Promise(resolve=>current.resolve=resolve);task=current;
  status='正在检查音频清单…';redraw();
  try{
    index=await loadAudioIndex();
    const packs=index.packs.filter(p=>p.language===group.language&&group.banks.includes(p.bank));
    if(packs.length!==group.banks.length||packs.some(p=>!p.complete&&!p.requiredComplete&&!p.requiredPlaybackComplete))throw Error('本组音频尚未完整发布，请稍后重试。');
    let completed=0;current.total=packs.length*100;
    for(const pack of packs){
      current.controller.signal.throwIfAborted();
      await downloadAudioPack(pack.bank,pack.language,{signal:current.controller.signal,onProgress:p=>{
        current.done=completed+(p.total?100*p.done/p.total:100);status=`下载${group.label}：${Math.floor(current.done/current.total*100)}% · 当前分类 ${p.done} / ${p.total} 个文件`;redraw();
      }});
      completed+=100;current.done=completed;
    }
    const fallbackCount=packs.reduce((sum,p)=>sum+(p.fallbackCount||0),0);
    status=group.label+'已下载，可离线播放。'+(fallbackCount?`另有 ${fallbackCount} 句使用设备日语语音，不包含在下载中；设备声音可用性请先试听确认。`:'');notify(status);
  }catch(error){
    status=error.name==='AbortError'?'已取消，已下载部分保留。':error.code==='AUDIO_QUOTA'?'本机可用空间不足，已下载部分保留。可删除一些音频后重试。':(error.message||'下载中断，已完成部分保留，请重试。');
    notify(status);
  }finally{if(task===current)task=null;current.resolve();redraw();await usage();}
}
