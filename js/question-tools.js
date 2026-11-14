import {UNKNOWN} from './answers.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'})[c]);
export const reasons = ['答案可能错了','有两个答案都对','解析不对','声音或显示有问题','其他'];
const kindNames = {sentence:'句子插入',insertion:'句子插入位置',vocab:'词义',vocabulary:'词义',detail:'细节',inference:'推断',purpose:'主旨',negative:'排除题',intent:'意图',graphic:'图表',first:'听清首词',response:'选择回应'};
const letter = i => String.fromCharCode(65+i);
const tableText = table => table ? [table.title,table.headers.join(' | '),...table.rows.map(r=>r.join(' | '))].filter(Boolean).join('\n') : '';
function annotated(value, options) {
  if(value === UNKNOWN)return '不知道';
  if(value == null)return '未作答';
  const pos=options?.indexOf(value) ?? -1;
  return pos>=0 ? letter(pos)+'. '+value : value;
}

// Freeze the material and option order the player actually saw, including across bank updates.
export function answerText(ref,q,selected,correct=q.answer) {
  const detail=q.topic?.title || kindNames[q.kind || q.type] || q.kind || '';
  const heading = (ref.mode === 'vocab'?'单词 · ':ref.mode === 'dictation'?'Part '+q.set.part+' · ':'')+q.instruction;
  const sections = ['题目 ID　'+ref.id,'题型　'+heading+(detail?' · '+detail:''),'题干\n'+q.prompt];
  if(q.set?.documents)sections.push('阅读材料\n'+q.set.documents.map(d=>[d.title,d.text,tableText(d.table)].filter(Boolean).join('\n')).join('\n\n'));
  if(q.set?.graphic)sections.push('附图表\n'+tableText(q.set.graphic));
  if(q.description)sections.push('插画说明\n'+q.description);
  if(q.turns?.length && ref.mode!=='vocab')sections.push('听力原文\n'+q.turns.map(t=>t.speaker+'　'+t.text).join('\n'));
  if(q.options?.length)sections.push('选项\n'+q.options.map((v,i)=>letter(i)+'. '+v).join('\n'));
  sections.push('我的答案　'+annotated(selected,q.options),'正确答案　'+annotated(correct,q.options));
  const explanation = ref.mode==='vocab' ? [q.word+' · '+q.pos+' · '+q.zh,q.example,'搭配　'+q.collocation,'同义替换　'+q.paraphrase] :
    [q.en,q.zh,q.evidence && '原文依据　'+q.evidence,q.paraphrase && '同义替换　'+q.paraphrase];
  sections.push('现有解析\n'+explanation.filter(Boolean).join('\n'));
  return sections.join('\n\n');
}
export function claudeText(ref, q, selected, correct = q.answer) {
  const correctChoice = selected != null && selected !== UNKNOWN && (ref.mode === 'dictation'
    ? selected.trim().toLowerCase() === correct.trim().toLowerCase()
    : selected === correct);
  const request = correctChoice
    ? '请用中文解释这道题的考点，确认我的理解是否正确。'
    : '请用中文解释为什么选这个答案，以及我错在哪里。';
  return answerText(ref, q, selected, correct) + '\n\n' + request;
}
export function reviewTools(id) {
  return '<div class="review-tools"><button type="button" class="secondary" data-act="report-issue" data-id="'+esc(id)+'">这题有问题</button><button type="button" class="secondary" data-act="copy-claude" data-id="'+esc(id)+'">复制问 Claude</button></div>';
}
export function validIssues(rows) {
  return rows===undefined || (Array.isArray(rows) && rows.every(r=>r && typeof r.id==='string' && /^[\w-]{1,100}$/.test(r.id) && reasons.includes(r.reason) && typeof r.note==='string' && r.note.length<=1000 && typeof r.text==='string' && r.text.length>0));
}
export function issueForm(id) {
  return '<h2>报告这道题</h2><p>'+esc(id)+'</p><label class="setting">原因<select id="issue-reason">'+reasons.map(r=>'<option>'+r+'</option>').join('')+'</select></label><label class="issue-field">备注（选填）<textarea id="issue-note" rows="3" maxlength="1000"></textarea></label><button class="primary" data-act="save-issue" data-id="'+esc(id)+'">保存在本机</button>';
}
export function issueSettings(rows=[]) {
  return '<section class="backup"><h3>问题报告（'+rows.length+'）</h3><p class="fine muted">保存在本机，导出进度时一并备份。</p>'+
    (rows.length?'<button class="secondary" data-act="copy-issues">复制全部报告</button> <button class="secondary" data-act="clear-issues">清空报告</button>':'')+'</section>';
}
export function issuesText(rows) {
  return rows.map((r,i)=>'问题报告 '+(i+1)+'\n原因　'+r.reason+'\n备注　'+(r.note||'无')+'\n\n'+r.text).join('\n\n──────────\n\n');
}
export async function copyText(text,modal,toast,success) {
  try {
    await navigator.clipboard.writeText(text);
    toast(success);
  } catch {
    modal('<h2>手动复制</h2><label class="issue-field">文字已选中，可用系统菜单复制。<textarea readonly id="copy-fallback" rows="9">'+esc(text)+'</textarea></label>');
    const area=document.querySelector('#copy-fallback');
    area.focus();area.select();area.setSelectionRange(0,area.value.length);
  }
}
