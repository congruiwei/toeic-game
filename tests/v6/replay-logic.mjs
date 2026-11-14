import assert from 'node:assert/strict';
import { splitSentences, replayRows } from '../../js/replay.js';
assert.deepEqual(splitSentences('Mr. Green met Ms. Roy at 9:30 a.m. on Friday. She paid $1.50. “Ready?” Yes!'),[
  'Mr. Green met Ms. Roy at 9:30 a.m. on Friday.','She paid $1.50.','“Ready?”','Yes!']);
assert.deepEqual(splitSentences('The shop closes at 5 p.m. Please arrive before then.'),['The shop closes at 5 p.m.','Please arrive before then.']);
const turns=[{speaker:'A',text:'When is the tour?'},{speaker:'B',text:'A. At nine. Meet me there.'},{speaker:'B',text:'B. On the desk.'}];
assert.deepEqual(replayRows({turns},'part2').map(r=>[r.text,r.label,r.speaker]),[['When is the tour?','Q','A'],['At nine.','A','B'],['Meet me there.','A','B'],['On the desk.','B','B']]);
assert.deepEqual(replayRows({turns},'reading'),[]);
console.log('Sentence boundaries, options, speakers and time abbreviations passed.');
