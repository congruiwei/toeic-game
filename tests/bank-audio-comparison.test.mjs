import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validASREvidence,validComparisonEvidence} from '../scripts/validate-bank-audio.mjs';
const digest=text=>createHash('sha256').update(text).digest('hex');
const clip={language:'en',text:'The gray worktable.',spoken:'The gray worktable.',sha256:'a'.repeat(64)};
const original={sha256:clip.sha256,expected:clip.text,spoken:clip.spoken,recognized:'The grey work table.',status:'review',
  recognitionMethod:'individual-beam5',singleFileVerification:true,
  recognitionGeneration:{model:'whisper-small',modelSha256:'b'.repeat(64),device:'cpu',computeType:'int8',beamSize:5,conditionOnPreviousText:false,prompt:null,vadFilter:false}};
const comparison={ruleVersion:'strict-audio-equivalence-1',audioSha256:clip.sha256,language:'en',expectedSpoken:clip.spoken,
  recognized:original.recognized,equivalent:true,reasons:['us-uk-spelling','reviewed-compound-boundary'],
  proofExpected:'gray | work | table',proofRecognized:'gray | work | table',provenance:{sourceTextSha256:digest(clip.text),ruleFileSha256:'d'.repeat(64),normalizerFileSha256:'e'.repeat(64)}};
const matched={...original,status:'matched',comparison};
test('comparison preserves actual recognition evidence while requiring an equal nonempty proof',()=>{
  assert(validASREvidence(clip,original));assert(validASREvidence(clip,matched));
  assert.equal(matched.recognized,original.recognized);assert.equal(matched.recognitionGeneration,original.recognitionGeneration);
  for(const change of [{proofRecognized:'different'},{proofExpected:'',proofRecognized:''},{equivalent:false},{reasons:[]},{reasons:[null]},{ruleVersion:'fuzzy-distance'},{provenance:{sourceTextSha256:'c'.repeat(64)}},{provenance:{...comparison.provenance,ruleFileSha256:''}}]){
    assert.equal(validASREvidence(clip,{...matched,comparison:{...comparison,...change}}),false);
  }
});
test('an equivalence cannot be copied onto another media, sentence, language or transcript',()=>{
  for(const change of [{audioSha256:'c'.repeat(64)},{expectedSpoken:'Different.'},{recognized:'Different.'},{language:'ja'}]){
    assert.equal(validComparisonEvidence(clip,{...matched,comparison:{...comparison,...change}}),false);
  }
});
test('non-equivalent comparisons remain reviews and cannot be promoted by changing only status',()=>{
  const review={...original,comparison:{...comparison,equivalent:false,proofExpected:null,proofRecognized:null,reasons:['non-equivalent-segments-remain']}};
  assert(validASREvidence(clip,review));assert.equal(validASREvidence(clip,{...review,status:'matched'}),false);
  assert.equal(validASREvidence(clip,{...matched,status:'review'}),false);
});
test('legacy archives remain valid and an equivalence proof cannot replace missing actual ASR',()=>{
  assert(validASREvidence(clip,original));
  for(const change of [{recognitionGeneration:{...original.recognitionGeneration,prompt:clip.text}},{recognized:''},{recognitionMethod:'text-only'},{sha256:'f'.repeat(64)}]){
    assert.equal(validASREvidence(clip,{...matched,...change}),false);
  }
});
