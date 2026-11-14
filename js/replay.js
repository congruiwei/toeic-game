import { hush, speak } from './audio.js';

const escape = value => String(value).replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
})[c]);

// Keep English honorifics, initials, decimals and time abbreviations inside their sentences.
export function splitSentences(text) {
  const result = [];
  let start = 0;
  for (const match of text.matchAll(/[.!?]+(?:["'”’)]*)(?=\s|$)/g)) {
    const end = match.index + match[0].length;
    const segment = text.slice(start, end).trim();
    if (match[0] === '.' && end < text.length) {
      const next = text.slice(end).trimStart();
      if (/(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|e\.g|i\.e)|\b[A-Z])\.$/.test(segment)) continue;
      if (/\b(?:[ap]\.m|U\.S|U\.K)\.$/i.test(segment) && /^[a-z0-9]/.test(next)) continue;
    }
    if (segment) result.push(segment);
    start = end;
  }
  const last = text.slice(start).trim();
  if (last) result.push(last);
  return result;
}

export function replayRows(q, mode) {
  if (!q || !['part1','part2','dialogue','dictation'].includes(mode)) return [];
  return q.turns.flatMap((turn, i) => {
    const option = mode === 'part1' || (mode === 'part2' && i > 0);
    const label = option ? String.fromCharCode(65 + i - Number(mode === 'part2')) :
      mode === 'part2' ? 'Q' : mode === 'dictation' ? '听写' : turn.speaker;
    // Letter prefixes belong to an entire choice and should not become one-letter sentences.
    const text = option ? turn.text.replace(/^[A-D]\.\s*/, '') : turn.text;
    return splitSentences(text).map(sentence => ({text:sentence, speaker:turn.speaker, label}));
  });
}

function mark(text, evidence) {
  if (!evidence) return escape(text);
  const target = text.toLowerCase(), clue = evidence.toLowerCase(), i = target.indexOf(clue);
  if (i >= 0) return escape(text.slice(0,i))+'<mark>'+escape(text.slice(i,i+clue.length))+'</mark>'+escape(text.slice(i+clue.length));
  if (clue.includes(target)) return '<mark>'+escape(text)+'</mark>';
  return escape(text);
}

export function replayView(q, ref) {
  const rows = replayRows(q, ref.mode);
  if (!rows.length) return '';
  return `<details class="lesson-transcript sentence-panel" data-replay-id="${escape(q.id)}">
    <summary>听力原文 · 逐句重听</summary>
    <label class="sentence-repeat"><input type="checkbox" data-replay-loop> 单句循环</label>
    <div>${rows.map((row,i)=>`<button type="button" class="sentence-row" data-act="sentence-play" data-line="${i}" aria-pressed="false" aria-label="播放第 ${i+1} 句，${escape(row.label)}">
      <span class="sentence-speaker">${escape(row.label)}</span>
      <span lang="en">${mark(row.text,q.evidence)}</span><span class="sentence-symbol" aria-hidden="true">▶</span>
    </button>`).join('')}</div></details>`;
}

let active = null;
function clearRow() {
  if (!active) return;
  active.button.setAttribute('aria-pressed','false');
  active.button.querySelector('.sentence-symbol').textContent = '▶';
  active = null;
}
export function stopReplay() {
  if (!active) return;
  clearRow();
  hush();
}
export function playLine(button, q, ref, prefs, notify) {
  const index = Number(button.dataset.line), row = replayRows(q,ref.mode)[index];
  const panel = button.closest('[data-replay-id]');
  if (!row || !panel?.open || panel.dataset.replayId !== ref.id) return;
  const same = active?.button === button;
  stopReplay();
  if (same) return;
  active = {button};
  button.setAttribute('aria-pressed','true');
  button.querySelector('.sentence-symbol').textContent = '■';
  const run = () => {
    if (active?.button !== button || !button.isConnected || !panel.open || document.hidden) {
      if (active?.button === button) stopReplay();
      return;
    }
    speak([row], prefs, message => { clearRow(); notify(message); }, {
      seed:q.set?.id || q.id,
      castTurns:q.turns,
      onEnd() {
        if (active?.button !== button) return;
        if (panel.querySelector('[data-replay-loop]').checked) run();
        else clearRow();
      }
    });
  };
  run();
}
export function stopClosedReplay(element) {
  if (active && element instanceof HTMLDetailsElement && !element.open && element.contains(active.button)) stopReplay();
}
