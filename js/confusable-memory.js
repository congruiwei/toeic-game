import {collectPersonalWord} from './personal-vocab.js';
import {advance, reviewBand} from './review-scheduler.js';
import {confusableData} from './confusables.js';

// Objective duel answers share the target sense's schedule with the word bank.
export function reviewConfusableWord(state, question, ref, correct, grade, now) {
  const word = confusableData()?.words[question.wordId];
  if (!word) throw Error('易混词目标义项缺失');

  const key = word.wordId || 'personal-' + word.id;
  let item = state.personalVocab?.items.find(saved => saved.key === key);
  if (!correct) {
    item = collectPersonalWord(state, word, {ref, context: question.sentence, option: question.answer, now}).item;
  }
  if (!word.wordId) {
    if (item) item.fsrs = advance(item.fsrs, grade, now, state.settings.retention);
    return;
  }

  const progress = state.words[word.wordId] || {box: 0, due: 0, right: 0, tries: 0};
  progress.fsrs = advance(progress.fsrs, grade, now, state.settings.retention);
  progress.due = progress.fsrs.due;
  progress.box = reviewBand(progress.fsrs);
  progress.tries++;
  progress.right += Number(correct);
  state.words[word.wordId] = progress;
  if (item) item.fsrs = {...progress.fsrs};
}
