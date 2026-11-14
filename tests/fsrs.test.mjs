import test from 'node:test';
import assert from 'node:assert/strict';
import {responseRating,advance,gradeError,errorDue,migrateReview} from '../js/review-scheduler.js';
import {fresh,decode,reward} from '../js/state.js';
const t=Date.UTC(2026,1,4,12),D=86400000;
test('FSRS-6.0 default vectors and all four automatic grades',()=>{
 assert.deepEqual([responseRating(false,1),responseRating(true,8001),responseRating(true,8000),responseRating(true,10000,true)],[1,2,3,4]);
 const ratings=[1,2,3,4].map(g=>advance(null,g,t));
 assert.deepEqual(ratings.map(c=>c.stability),[.212,1.2931,2.3065,8.2956]);
 assert.deepEqual(ratings.map(c=>c.due-t),[60000,360000,600000,8*D]);
 const second=advance(ratings[3],3,t+8*D);
 assert.equal(second.stability,38.90515015);assert.equal(second.scheduled_days,39);
 assert(advance(null,4,t,.95).due < advance(null,4,t,.85).due);
});
test('old word boxes preserve IDs, statistics and deadlines; errors remain reviewable; migration is idempotent',()=>{
 const s=fresh();delete s.settings.retention;
 for(let b=0;b<6;b++)s.words['word-'+b]={box:b,due:t+b*D,right:b,tries:b+2};
 s.errors.grammar={at:t-4000,misses:4,ref:{id:'grammar',mode:'grammar'}};
 s.xp=124;s.seen.grammar=5;
 const first=decode(JSON.stringify(s));assert.equal(first.xp,124);assert.equal(first.seen.grammar,5);
 assert.equal(first.settings.retention,.9);assert.equal(first.errors.grammar.fsrs.due,t-4000);
 for(let b=0;b<6;b++){const w=first.words['word-'+b];assert.equal(w.due,t+b*D);assert.equal(w.box,b);assert.equal(w.fsrs.reps,b+2);assert.equal(w.fsrs.state,b?2:3);}
 assert.deepEqual(decode(JSON.stringify(first)),first);
 first.words['word-5'].fsrs.difficulty=Infinity;
 assert.throws(()=>decode(JSON.stringify(first)));
});
test('nonword error persists after one success, lapses reset the streak, two consecutive successes remove it',()=>{
 const s=fresh(),r={id:'g',mode:'grammar'};
 gradeError(s,r,false,1,t);assert.equal(s.errors.g.fsrs.reps,1);assert(errorDue(s,s.errors.g)>t);
 gradeError(s,r,true,2,t+D);assert.equal(s.errors.g.correctStreak,1);
 gradeError(s,r,false,1,t+2*D);assert.equal(s.errors.g.correctStreak,0);assert.equal(s.errors.g.misses,2);
 gradeError(s,r,true,3,t+3*D);gradeError(s,r,true,3,t+4*D);assert(!s.errors.g);
});
test('verified screen check is Easy, fast Good and delayed Hard use one bank entry',()=>{
 const s=fresh(),q={id:'v-available',skill:'vocab',level:400},r={id:q.id,mode:'vocab'};
 reward(s,q,r,true,t,{activeMs:9000});assert.equal(s.words[q.id].fsrs.lastRating,2);
 reward(s,q,r,false,t+60000);assert.equal(s.words[q.id].fsrs.lastRating,1);
 reward(s,q,r,true,t+D,{screenCheck:true});assert.equal(s.words[q.id].fsrs.lastRating,4);
 assert.equal(s.words[q.id].right,2);assert.equal(s.words[q.id].tries,3);
});
