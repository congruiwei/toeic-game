import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {sourceUnits} from '../js/translation-source.js';
import {loadBank,bank,catalog} from '../js/bank.js';
import {buildExam,examValid,listeningScript,listeningStepSentences,passagePools} from '../js/exam.js';
import {examController} from '../js/exam-controller.js';
import {fresh,decode} from '../js/state.js';

// Real controller, resolver, downloader and archive decoder; only media/HTTP are
// deterministic fixtures. Each distinct sentence retains its own URL and text.
const sha=value=>createHash('sha256').update(value).digest('hex');
const rows={},packs=[],audio=new Map(),byURL=new Map(),sourceSha256='1'.repeat(64);
for(const name of ['vocab','part1','part2','listening','grammar','reading'])
 rows[name]=JSON.parse(await readFile(new URL('../data/'+name+'.json',import.meta.url)));
function clip(text,key,voiceId='af_heart',speaker){
 const bytes=Buffer.concat([Buffer.from('00000018667479704d3441200000000069736f6d6d703432','hex'),Buffer.from(text)]),digest=sha(bytes);
 const src=`./audio/generated/en/${voiceId}/${digest.slice(0,32)}.m4a`;
 audio.set(src,bytes);byURL.set(new URL('../'+src.slice(2),import.meta.url).href,key);
 return {text,voiceId,speaker,src,duration:1,bytes:bytes.length,sha256:digest,language:'en'};
}
for(const name of ['part1','part2','listening']){
 const clips=Object.fromEntries(sourceUnits(name,rows[name]).map(u=>[u.key,clip(u.text,u.key,u.speaker==='B'?'am_puck':'af_heart',u.speaker)]));
 packs.push({version:1,sourceSha256,bank:name,language:'en',complete:true,clips});
}
packs.push({version:1,sourceSha256,bank:'labels',language:'en',complete:true,clips:Object.fromEntries(
 ['af_heart','am_puck'].flatMap(voice=>'ABCD'.split('').map(letter=>{const key=`labels/${voice}/${letter}`;return[key,clip(letter+'.',key,voice)];})))});
// Identical sentences legitimately share one file across scenes. Report that
// file using this test's scene rather than whichever source alias was last.
for(const [key,value] of Object.entries(packs.find(p=>p.bank==='listening').clips))
 if(key.startsWith('p3-g01/turns/'))byURL.set(new URL('../'+value.src.slice(2),import.meta.url).href,key);
const index={version:1,complete:true,sourceSha256,packs:packs.map(p=>({bank:p.bank,language:'en',complete:true,count:Object.keys(p.clips).length,
 src:`./data/audio/en/${p.bank}.json`,bytes:Buffer.byteLength(JSON.stringify(p)),sha256:sha(JSON.stringify(p))}))};
const stores=new Map();
globalThis.caches={async open(name){if(!stores.has(name))stores.set(name,new Map());const store=stores.get(name);return {
 async match(key){return store.get(String(key))?.clone();},async put(key,response){store.set(String(key),response.clone());},async delete(key){return store.delete(String(key));}
};}};
globalThis.fetch=async input=>{
 const url=String(input);
 if(url.endsWith('/data/audio/manifest.json'))return Response.json(index);
 for(const p of packs)if(url.endsWith(`/data/audio/en/${p.bank}.json`))return Response.json(p);
 for(const [src,bytes] of audio)if(url.endsWith(src.slice(1)))return new Response(bytes,{headers:{'Content-Type':'audio/mp4'}});
 for(const [name,data] of Object.entries(rows))if(url.endsWith('/data/'+name+'.json'))return Response.json(data);
 throw Error('Unexpected fixture request '+url);
};
let media,failBeforeStart=false;
const played=[],spoken=[];
globalThis.document={querySelector(){return null;},body:{append(){}},createElement(){return media={src:'',paused:true,ended:false,
 setAttribute(){},removeAttribute(){this.src='';},load(){this.ended=false;},pause(){this.paused=true;},
 play(){if(failBeforeStart)return Promise.reject(Error('fixture media failure'));this.paused=false;played.push(this.src);this.onplaying?.();return Promise.resolve();}
};}};
globalThis.window={scrollTo(){},SpeechSynthesisUtterance:class{constructor(text){this.text=text;}},speechSynthesis:{
 getVoices(){return[];},cancel(){},speak(utterance){if(failBeforeStart){utterance.onerror?.({error:'audio-busy'});return;}spoken.push(utterance);utterance.onstart?.();}
}};
await loadBank(Object.keys(rows));
const group=rows.listening.find(g=>g.id==='p3-g01'),form=passagePools(rows.listening.filter(g=>g.part===3)).findIndex(pool=>pool.includes(group));
function createState(){
 const state=fresh();state.settings.audioGapMs=0;state.examForms=[1,1,1,1];state.examForms[form]=0;
 state.exam=buildExam(bank,state,'full','sentence-checkpoint');
 state.exam.unit=state.exam.units.findIndex(u=>u.ids.some(id=>catalog.get(id).data.set?.id===group.id));
 assert(state.exam.unit>=0);assert(examValid(state.exam,catalog));return state;
}
function harness(initial=createState()){
 let state=initial,page='examLobby';const notices=[];
 const controller=examController({state:()=>state,page:()=>page,show:p=>{page=p;},redraw(){},save(){return true;},notify:message=>notices.push(message),confirm(){}});
 return {controller,notices,get state(){return state;},get page(){return page;},restore(){state=decode(JSON.stringify(state),catalog);}};
}
const until=async predicate=>{for(let i=0;i<500;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}assert.fail('fixture condition did not become ready');};
async function start(h){
 h.controller.action('exam-resume');
 if(h.state.settings.audioMode!=='system'){await until(()=>h.controller.preparation?.status==='ready');h.controller.action('exam-listen-ready');}
}
const lastKey=()=>byURL.get(played.at(-1));
const finishSentence=()=>{media.ended=true;media.paused=true;media.onended?.();};

test('optional sentence checkpoints validate against the current unchanged script step',()=>{
 const state=createState(),e=state.exam,script=listeningScript(e.units[e.unit],catalog);
 assert.equal(listeningStepSentences(script[0]).length,3);
 assert.deepEqual(listeningStepSentences({text:'A. At noon. Please arrive early.'}),['A. At noon.','Please arrive early.']);
 assert(examValid(e,catalog),'legacy missing sentence is valid');
 for(const value of [0,1,2]){e.sentence=value;assert(examValid(e,catalog));}
 for(const value of [-1,3,1.5,null,'1',101]){e.sentence=value;assert.equal(examValid(e,catalog),false,String(value));}
 e.step=script.findIndex(step=>step.delay);e.sentence=1;assert.equal(examValid(e,catalog),false);
 e.sentence=0;assert(examValid(e,catalog));e.step=script.length;e.sentence=1;assert.equal(examValid(e,catalog),false);
 e.sentence=0;assert(examValid(e,catalog));e.phase='reading';e.sentence=1;assert.equal(examValid(e,catalog),false);
});

test('recorded first sentence -> leave -> export/decode resumes the second, then third and next speaker',async()=>{
 const h=harness();played.length=0;
 try{
  await start(h);assert.equal(lastKey(),'p3-g01/turns/0/0');assert.equal(h.state.exam.step,0);assert.equal(h.state.exam.sentence,1);
  h.controller.action('exam-leave');h.restore();await start(h);
  assert.equal(lastKey(),'p3-g01/turns/0/1');assert.equal(h.state.exam.step,0);assert.equal(h.state.exam.sentence,2);
  finishSentence();assert.equal(lastKey(),'p3-g01/turns/0/2');assert.equal(h.state.exam.step,1);assert.equal(h.state.exam.sentence,0);
  h.controller.action('exam-leave');h.restore();await start(h);assert.equal(lastKey(),'p3-g01/turns/1/0');
  assert.deepEqual(played.map(url=>byURL.get(url)),['p3-g01/turns/0/0','p3-g01/turns/0/1','p3-g01/turns/0/2','p3-g01/turns/1/0']);
 }finally{h.controller.stop();}
});

test('media and fallback failure before onStart preserves the unstarted sentence',async()=>{
 const h=harness();
 try{
  failBeforeStart=true;await start(h);await until(()=>h.page==='examLobby');
  assert.equal(h.state.exam.step,0);assert.equal(h.state.exam.sentence??0,0);assert.equal(h.notices.length,1);
  h.restore();failBeforeStart=false;await start(h);assert.equal(lastKey(),'p3-g01/turns/0/0');
 }finally{failBeforeStart=false;h.controller.stop();}
});

test('switching to system voice after export resumes the next unstarted sentence',async()=>{
 const h=harness();spoken.length=0;
 try{
  await start(h);h.controller.action('exam-leave');h.restore();h.state.settings.audioMode='system';const before=played.length;
  await start(h);assert.equal(spoken.at(-1).text,"I'm here for the safety workshop.");assert.equal(played.length,before);
  assert.equal(h.state.exam.step,0);assert.equal(h.state.exam.sentence,2);
 }finally{h.controller.stop();}
});

test('old archives keep their already-advanced whole-turn step without replay',async()=>{
 const state=createState();state.exam.step=1;delete state.exam.sentence;const h=harness(decode(JSON.stringify(state),catalog));
 try{await start(h);assert.equal(lastKey(),'p3-g01/turns/1/0');}finally{h.controller.stop();}
});

test('a natural sentence gap is persisted separately from the original 5500 ms answer window',async()=>{
 const state=createState(),script=listeningScript(state.exam.units[state.exam.unit],catalog);state.exam.step=script.findIndex(s=>s.delay)-1;state.settings.audioGapMs=25;
 const h=harness(state);
 try{
  await start(h);finishSentence();assert.equal(h.state.exam.wait,25);
  await until(()=>h.state.exam.wait===5500);assert.equal(h.state.exam.sentence,0);
  h.controller.action('exam-leave');assert(h.state.exam.wait>0&&h.state.exam.wait<=5500);h.restore();assert(examValid(h.state.exam,catalog));
 }finally{h.controller.stop();}
});
