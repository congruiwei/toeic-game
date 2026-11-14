import {ensurePrediction} from './prediction.js';

// Practice and diagnostic answers earned per-skill XP even before the score cache existed.
// Submitted exam items, in contrast, can have zero reward XP but do have exposure/seen IDs.
function readingCameOnlyFromWords(state, catalog) {
  if (!catalog || state.prediction.R.evidence <= 0) return false;
  if (state.stats.grammar || state.stats.reading ||
      state.history.some(row => row.skill === 'grammar' || row.skill === 'reading')) return false;
  if (['5','6','7'].some(part => state.report?.parts[part]?.total > 0)) return false;

  const diagnosed = state.diagnosis;
  if (diagnosed?.results.length || diagnosed?.active?.items.some(row => row.part >= 5)) return false;
  const exam = state.exam;
  if (exam?.phase === 'done' &&
      exam.units.some(u => u.part >= 5 && u.ids.some(id => Object.hasOwn(exam.answers,id)))) return false;

  let wordEvidence = state.history.some(row => row.skill === 'vocab');
  const ids = new Set([...Object.keys(state.prediction.exposure), ...Object.keys(state.seen)]);
  for (const id of ids) {
    const mode = catalog.get(id)?.ref.mode;
    // An unrecognized or retired ID might be a scored reading item.
    if (!['vocab','dictation','part1','part2','dialogue'].includes(mode)) return false;
    if (mode === 'vocab') wordEvidence = true;
  }
  return wordEvidence;
}

export function migratePrediction(state, catalog) {
  const cache = state.prediction;
  if (!cache) {
    // Seed from the recoverable non-vocabulary events before new drills displace them
    // from the bounded history ring. The model handles the original event order.
    if (state.history.some(row => row.skill !== 'vocab')) ensurePrediction(state);
    return;
  }
  // With an as-yet unloaded bank, leave a v1 cache intact for the indexed load.
  if (cache.version !== 1 || !catalog) return;
  if (readingCameOnlyFromWords(state,catalog)) {
    cache.R = {rating:400,evidence:0};
  }
  // A mixed aggregate cannot be decomposed, so its rating, evidence and dated
  // scores carry forward unchanged. Neither path rewrites a historical chart point.
  cache.version = 2;
}
