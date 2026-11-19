import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {validMorphemes,wordPartsView,answerPartsView,grammarSuffixView,familyWords,unlockedMorphemes,morphemesView} from '../js/morphemes.js';
import {validateMorphemes} from '../scripts/validate-morphemes.mjs';
import {reasons,validIssues,answerText} from '../js/question-tools.js';
const load=n=>JSON.parse(fs.readFileSync(new URL('../data/'+n+'.json',import.meta.url),'utf8'));
const data=load('morphemes'),vocab=load('vocab'),grammar=load('grammar');
test('authored decomposition never guesses substrings, and parts round-trip',()=>{
 assert(validMorphemes(data));for(const w of vocab.filter(w=>w.parts))assert.equal(w.parts.map(p=>p.text).join(''),w.word,w.id);
 assert(!familyWords('root-port',vocab).some(w=>w.word==='portion'));assert(!familyWords('pre-in-not',vocab).some(w=>w.word==='inflammable'));
 assert(wordPartsView(vocab.find(w=>w.word==='portion'),data).includes('拆词陷阱'));
});
test('only current correct and selected word receive answer details',()=>{
 const q={...vocab.find(w=>w.id==='v-portable'),answer:'portable'},ref={id:q.id,mode:'vocab',format:'english'};
 assert.equal(answerPartsView(ref,q,null,undefined,vocab,data),'');
 const html=answerPartsView(ref,q,'shipment',undefined,vocab,data);
 assert(html.includes('data-morph-word="v-portable"'));assert(html.includes('data-morph-word="v-shipment"'));assert(!html.includes('data-morph-word="v-inspect"'));
 assert.equal((answerPartsView(ref,q,'portable',undefined,vocab,data).match(/data-morph-word/g)||[]).length,1);
});
test('Japanese and Chinese options map to the actual lexical card, not the label string',()=>{
 const q={...vocab.find(w=>w.id==='v-portable'),answer:'携帯できる'},ref={id:q.id,mode:'vocab',format:'meaning-ja'};
 const html=answerPartsView(ref,q,'出荷',undefined,vocab,data,id=>id==='v-shipment'?'出荷':id==='v-portable'?'携帯できる':'他');
 assert(html.includes('v-shipment'));assert(html.includes('v-portable'));
});
test('discovery derives from old saves without XP, migration or new counters',()=>{
 const s={seen:{'v-inspect':1},words:{},xp:0},before=JSON.stringify(s);const lit=unlockedMorphemes(data,vocab,s);
 assert(lit.has('root-spect'));assert(lit.has('pre-in-into'));assert(!lit.has('root-port'));morphemesView(data,vocab,s);assert.equal(JSON.stringify(s),before);
 assert(unlockedMorphemes(data,vocab,{words:{'v-portable':{right:1}}}).has('root-port'));
});
test('screening judgments discover roots, but a queued or pending card does not',()=>{
 const fresh={seen:{},words:{},screening:{marks:{},run:{ids:['v-portable'],index:0,pending:false}}};
 assert(!unlockedMorphemes(data,vocab,fresh).has('root-port'));
 for(const mark of ['learn','unconfirmed','verified','studied']){
  const s=structuredClone(fresh);s.screening.marks['v-portable']=mark;const before=JSON.stringify(s);
  assert(unlockedMorphemes(data,vocab,s).has('root-port'),mark);assert.equal(JSON.stringify(s),before);
 }
 for(const mark of [true,'known','',0]){const s=structuredClone(fresh);s.screening.marks['v-portable']=mark;assert(!unlockedMorphemes(data,vocab,s).has('root-port'));}
 const pending=structuredClone(fresh);pending.screening.run.pending=true;assert(!unlockedMorphemes(data,vocab,pending).has('root-port'));
});
test('all explicit word-form questions show bound POS annotations and no noun-er guess',()=>{
 for(const q of grammar.find(t=>t.id==='gram-word-form').questions){const html=grammarSuffixView(q,data);assert(html.includes('词尾与词性'));for(const r of data.grammarHints[q.id])assert(html.includes(r.label));}
 const q=grammar.find(t=>t.id==='gram-comparison').questions.find(q=>q.id==='gram-comparison-08');assert(grammarSuffixView(q,data).includes('不是表示人的'));
 assert.equal(grammarSuffixView({...q,options:['different']},data),'');
});
test('validator rejects unbound, false, or incomplete authored records',()=>{
 const bad=structuredClone(data);bad.entries[0].id=bad.entries[1].id;assert(!validMorphemes(bad));
 const empty=structuredClone(data);empty.entries=[];assert(!validMorphemes(empty));
 const changed=structuredClone(vocab);changed.find(w=>w.id==='v-portable').parts[0].text='portion';assert(validateMorphemes(data,changed,grammar).some(e=>e.includes('拼回')));
 const q=structuredClone(data);q.grammarHints['gram-word-form-01'][0].text='wrong';assert(validateMorphemes(q,vocab,grammar).some(e=>e.includes('gram-word-form-01')));
});
test('morphology issue reason is portable in existing saved reports',()=>{
 assert(reasons.includes('词根拆分有误'));assert(validIssues([{id:'v-portable',reason:'词根拆分有误',note:'port',text:'test'}]));assert(!validIssues([{id:'v-portable',reason:'unlisted',note:'',text:'test'}]));
});
test('all cards, grammar annotations, translations and new audio keys are complete',async()=>{
 const {validateMorphemeFiles}=await import('../scripts/validate-morphemes.mjs');
 const {fileURLToPath}=await import('node:url');assert.deepEqual(validateMorphemeFiles(fileURLToPath(new URL('../',import.meta.url))).errors,[]);
 const {morphemeSourceUnits,morphologyAudioUnits}=await import('../js/word-enrichment.js');
 const units=morphologyAudioUnits(data,vocab);assert.equal(new Set(units.map(u=>u.language+':'+u.key)).size,units.length);
 for(const u of morphemeSourceUnits(data))assert(units.some(x=>x.key===u.key&&x.language==='en'&&x.text===u.text));
});

 test('study-only word reports retain their own material, without inventing an answered question',async()=>{
  const {wordIssueText,issueForm,issueSettings}=await import('../js/question-tools.js');const word=vocab.find(w=>w.id==='v-portable');
  const text=wordIssueText(word,'携帯できる');assert(text.includes(word.example));assert(text.includes('携帯できる'));assert(text.includes('port [root-port]'));assert(!text.includes('我的答案'));
  const report={id:word.id,reason:'词根拆分有误',note:'check',text};assert(validIssues([report]));assert(issueSettings([report]).includes('data-saved-issue="v-portable"'));assert(issueForm(word.id,{word:true}).includes('save-word-issue'));assert(issueForm(word.id).includes('save-issue'));
 });

test('morpheme gallery reports include the actual family, notes and references',async()=>{
 const {morphemeIssueText}=await import('../js/morphemes.js');const text=morphemeIssueText('root-port',data,vocab);assert(text.includes('morph-root-port'));assert(text.includes('搬运'));assert(text.includes('来源'));assert(text.includes('transport'));assert.equal(morphemeIssueText('missing',data,vocab),'');
});
