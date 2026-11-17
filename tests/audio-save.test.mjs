import test from 'node:test';
import assert from 'node:assert/strict';
import {fresh,decode,VERSION} from '../js/state.js';

test('old backups gain audio defaults while preserving all earned progress',()=>{
  for(const version of [1,2,3,4]){
    const old=fresh();old.version=version;old.stage=5;old.xp=4800;
    old.settings.voiceSlots={A:'previous-voice'};
    delete old.settings.audioMode;delete old.settings.audioGapMs;
    const restored=decode(JSON.stringify(old));
    assert.equal(restored.version,VERSION);assert.equal(restored.stage,5);assert.equal(restored.xp,4800);
    assert.equal(restored.settings.audioMode,'recorded');assert.equal(restored.settings.audioGapMs,200);
    assert.equal(restored.settings.voiceSlots.A,'previous-voice');
  }
});
test('audio preferences survive export and import and reject corrupt fields',()=>{
  const s=fresh();s.settings.audioMode='system';s.settings.audioGapMs=400;
  assert.equal(decode(JSON.stringify(s)).settings.audioMode,'system');
  for(const [name,value]of [['audioMode','cloud'],['audioGapMs',-1],['audioGapMs',1e9],['audioGapMs','200']]){
    const bad=fresh();bad.settings[name]=value;assert.throws(()=>decode(JSON.stringify(bad)),/音频/);
  }
});
