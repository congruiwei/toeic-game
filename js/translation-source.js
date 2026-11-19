import {morphemeSourceUnits} from './word-enrichment.js';
import { splitSentences } from './replay.js';

// Keys describe immutable source fields, rather than depending on translated text.
export function sourceUnits(bank, records) {
  if(bank==='morphemes')return morphemeSourceUnits(records);
  const units = [];
  function add(id, field, text, kind = 'sentence', extra = {}) {
    if (text?.trim()) units.push({ key:`${id}/${field}`, id, bank, text, kind, ...extra });
  }
  function sentences(id, field, text, extra = {}) {
    splitSentences(text || '').forEach((line, i) => add(id, `${field}/${i}`, line, 'sentence', extra));
  }
  function table(id, field, value) {
    if (!value) return;
    add(id, `${field}/title`, value.title, 'title');
    add(id, `${field}/headers`, value.headers.join(' | '), 'table', { columns:value.headers.length });
    value.rows.forEach((row,i) => add(id, `${field}/rows/${i}`, row.join(' | '), 'table', { columns:row.length }));
  }
  function question(q) {
    sentences(q.id, 'prompt', q.prompt);
    q.options?.forEach((option,i) => sentences(q.id, `options/${i}`, option, { option:i }));
  }
  if(bank==='confusables'){
    for(const group of records.groups)sentences(group.id,'difference',group.difference.en);
    for(const word of Object.values(records.words))if(!word.wordId){
      add(word.id,'meaning',word.word,'meaning',{zh:word.zh,pos:word.pos});sentences(word.id,'example',word.example);
    }
    for(const q of records.questions)sentences(q.id,'sentence',q.sentence);
    return units;
  }
  for (const item of records) {
    if (bank === 'vocab') {
      add(item.id, 'meaning', item.word, 'meaning', { zh:item.zh, pos:item.pos });
      sentences(item.id, 'example', item.example);
      if (item.i18nDetails === true) {
        sentences(item.id, 'collocation', item.collocation);
        sentences(item.id, 'paraphrase', item.paraphrase);
      }
    } else if (bank === 'part1') {
      item.options.forEach((option,i) => sentences(item.id, `options/${i}`, option, { option:i }));
    } else if (bank === 'part2') {
      sentences(item.id, 'audio', item.audio);
      item.options.forEach((option,i) => sentences(item.id, `options/${i}`, option, { option:i }));
    } else if (bank === 'listening') {
      item.turns.forEach((turn,i) => sentences(item.id, `turns/${i}`, turn.text, { speaker:turn.speaker }));
      table(item.id, 'graphic', item.graphic);
      item.questions.forEach(question);
      sentences(item.dictation.id, 'text', item.dictation.text);
    } else if (bank === 'grammar') {
      item.questions.forEach(q => sentences(q.id, 'sentence', q.prompt.replace(/_{3,}/g, q.answer)));
    } else if (bank === 'reading') {
      item.documents.forEach((doc,i) => {
        add(item.id, `documents/${i}/title`, doc.title, 'title');
        let text = doc.text;
        if (item.part === 6) for (const q of item.questions) {
          const slot = q.prompt.match(/\[\d+\]/)?.[0];
          if (slot) text = text.replace(slot, q.answer);
        }
        sentences(item.id, `documents/${i}/text`, text);
        table(item.id, `documents/${i}/table`, doc.table);
      });
      item.questions.forEach(q => {
        if (item.part === 7) question(q);
        else if (q.kind === 'sentence') q.options.forEach((option,i) => sentences(q.id, `options/${i}`, option, { option:i }));
      });
    } else if (bank === 'methods') {
      item.steps.forEach((step,i) => sentences(item.id, `steps/${i}`, step.text));
    }
  }
  return units;
}
