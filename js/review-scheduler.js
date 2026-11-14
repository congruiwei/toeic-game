import {createEmptyCard, default_w, fsrs, Rating, State} from '../vendor/ts-fsrs/index.js';

const DAY = 86400000;
const retainers = [0.85,0.90,0.95];
const schedulers = new Map(retainers.map(r => [r,fsrs({request_retention:r})]));
const legacyIntervals = [2/1440,1,3,7,14,30];
const timestamp = n => Number.isSafeInteger(n) && n>=0 && n<=8640000000000000;
const nonnegative = n => Number.isSafeInteger(n) && n>=0;

export function responseRating(correct, activeMs=0, verified=false) {
  return !correct ? Rating.Again : verified ? Rating.Easy : activeMs>8000 ? Rating.Hard : Rating.Good;
}

function packed(card,grade) {
  return {...card,due:card.due.getTime(),last_review:card.last_review?.getTime(),lastRating:grade};
}
function validCard(c) {
  return c && timestamp(c.due) && [0,1,2,3].includes(c.state) &&
    [c.reps,c.lapses,c.learning_steps,c.elapsed_days,c.scheduled_days].every(nonnegative) &&
    Number.isFinite(c.stability)&&c.stability>=0&&c.stability<=36500 &&
    Number.isFinite(c.difficulty)&&c.difficulty>=0&&c.difficulty<=10 &&
    (c.state===0 ? c.stability===0 && c.difficulty===0 : c.stability>0 && c.difficulty>=1 && timestamp(c.last_review)) &&
    (c.lastRating===null||[1,2,3,4].includes(c.lastRating));
}
export function advance(memory, grade, now, retention=.90) {
  // Keep event order monotonic if a device clock moves backwards.
  const time = new Date(Math.max(now,memory?.last_review||0));
  const card = memory ? {...memory,due:new Date(memory.due),last_review:memory.last_review==null?undefined:new Date(memory.last_review)} : createEmptyCard(time);
  const scheduler=schedulers.get(retention)||schedulers.get(.90);
  return packed(scheduler.next(card,time,grade).card,grade);
}
function fromLegacy(box,due,tries,right,now) {
  const interval=legacyIntervals[box];
  const last=Math.max(0,Math.min(now,Math.round(due-DAY*interval)));
  const grade=box===0 ? Rating.Again : box<2 ? Rating.Hard : box<4 ? Rating.Good : Rating.Easy;
  const initialDifficulty=Math.max(1,Math.min(10,default_w[4]-Math.exp(default_w[5]*(grade-1))+1));
  return {
    due,state:box?State.Review:State.Relearning,
    stability:box?interval:default_w[0],difficulty:initialDifficulty,
    reps:tries,lapses:Math.max(0,tries-right),learning_steps:0,
    elapsed_days:0,scheduled_days:box?interval:0,last_review:last,lastRating:null,
  };
}
// A migrated due date is preserved, never rescheduled merely by opening an older save.
export function migrateReview(state,now=Date.now()) {
  state.settings.retention ??= .90;
  if (!retainers.includes(state.settings.retention)) throw Error('目标记忆率有误');
  if(state.session?.answerMs!==undefined && !nonnegative(state.session.answerMs)) throw Error('答题用时有误');
  for(const w of Object.values(state.words)){
    if(w.fsrs===undefined)w.fsrs=fromLegacy(w.box,w.due,w.tries,w.right,now);
    if(!validCard(w.fsrs)||w.due!==w.fsrs.due)throw Error('单词复习记录有误');
  }
  for(const e of Object.values(state.errors)){
    if(e.ref.mode==='vocab')continue;
    if(e.fsrs===undefined)e.fsrs=fromLegacy(0,e.at,e.misses,0,now);
    e.correctStreak??=0;
    if(!validCard(e.fsrs)||![0,1].includes(e.correctStreak))throw Error('错题复习记录有误');
  }
}
export function gradeError(state,ref,correct,grade,now=Date.now()) {
  const prev=state.errors[ref.id];
  if(!prev && correct)return;
  if(ref.mode==='vocab'){
    if(correct)delete state.errors[ref.id];
    else state.errors[ref.id]={misses:(prev?.misses||0)+1,at:now,ref:{...ref}};
    return;
  }
  const streak=correct ? (prev?.correctStreak||0)+1 : 0;
  if(streak>=2){delete state.errors[ref.id];return;}
  state.errors[ref.id]={
    misses:(prev?.misses||0)+Number(!correct),at:correct?prev.at:now,ref:{...ref},correctStreak:streak,
    fsrs:advance(prev?.fsrs,grade,now,state.settings.retention),
  };
}
export function errorDue(state,error) {
  return error.ref.mode==='vocab' ? (state.words[error.ref.id]?.due ?? error.at) : (error.fsrs?.due ?? error.at);
}
export const ratingName=grade=>({1:'Again',2:'Hard',3:'Good',4:'Easy'})[grade];
export function reviewBand(c){
  if(c.state!==State.Review)return c.state===State.Learning?1:0;
  return c.stability>=30?5:c.stability>=14?4:c.stability>=7?3:c.stability>=3?2:1;
}
