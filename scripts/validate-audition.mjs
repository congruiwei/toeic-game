import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {sourceUnits} from '../js/translation-source.js';

const defaultRoot=fileURLToPath(new URL('../',import.meta.url));
const banks=['vocab','part1','part2','grammar','listening','reading','methods'];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'&&value.trim().length>0;
const id=value=>typeof value==='string'&&/^[a-z][a-z0-9_-]{0,99}$/i.test(value)&&!['constructor','prototype','__proto__'].includes(value);
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
// This audition shortlist follows the linked Kokoro v1.0 VOICES.md ratings.
const voiceGrades={af_heart:'A',af_bella:'A-',af_nicole:'B-',am_fenrir:'C+',am_michael:'C+',am_puck:'C+',
  bf_emma:'B-',bf_isabella:'C',bm_fable:'C',bm_george:'C',jf_alpha:'C+',jf_tebukuro:'C',jm_kumo:'C-'};
const voiceGroups={af:['en-US','us-female','female'],am:['en-US','us-male','male'],
  bf:['en-GB','uk-female','female'],bm:['en-GB','uk-male','male'],
  jf:['ja-JP','ja','female'],jm:['ja-JP','ja','male']};

export async function loadAuditionInputs(root=defaultRoot) {
  const read=async relative=>JSON.parse(await fs.readFile(path.join(root,relative),'utf8'));
  const reference=new Map();
  for(const bank of banks) {
    const [rows,ja]=await Promise.all([read(`data/${bank}.json`),read(`data/i18n/ja/${bank}.json`)]);
    for(const unit of sourceUnits(bank,rows)) {
      if(reference.has(unit.key))throw Error('Duplicate source unit: '+unit.key);
      reference.set(unit.key,{en:unit.text,ja:ja.entries[unit.key],bank});
    }
  }
  const sourceBytes=await fs.readFile(path.join(root,'data/audio-audition-source.json'));
  return {root,source:JSON.parse(sourceBytes.toString('utf8')),sourceSha256:createHash('sha256').update(sourceBytes).digest('hex'),
    manifest:await read('data/audio-audition-manifest.json'),reference};
}

/** Validate only the audition bundle. No network, writes, model loading or transcoding. */
export async function validateAudition({root=defaultRoot,source,manifest,reference,sourceSha256}) {
  const errors=[],stats={voices:0,englishVoices:0,japaneseVoices:0,samples:0,clips:0,segments:0,files:0,bytes:0};
  const fail=(location,message)=>errors.push({location,message});
  if(!object(source)||source.version!==1||!text(source.model)||!Array.isArray(source.voices)||!Array.isArray(source.samples)) {
    fail('source','Expected version 1, a model name, voices and samples arrays');return {errors,stats};
  }
  if(!object(manifest)||manifest.version!==1||manifest.model!==source.model||!object(manifest.clips)) {
    fail('manifest','Expected version 1, the same model and a clips object');return {errors,stats};
  }
  if(manifest.complete!==true)fail('manifest.complete','Audio generation is not marked complete');
  if(typeof sourceSha256!=='string'||! /^[a-f0-9]{64}$/.test(sourceSha256))fail('sourceSha256','Missing the actual source JSON byte hash from the loader');
  else if(!object(manifest.generation)||manifest.generation.sourceSha256!==sourceSha256)fail('manifest.generation.sourceSha256','Generation belongs to a different source JSON byte hash');
  if(!(reference instanceof Map)){fail('reference','Missing authoritative source/translation units');return {errors,stats};}
  if(!Array.isArray(source.sources)||!source.sources.length)fail('source.sources','At least one provenance link is required');
  const sourceURLs=new Set();
  for(const [i,entry] of (Array.isArray(source.sources)?source.sources:[]).entries()) {
    const at=`source.sources[${i}]`;
    if(!object(entry)||!text(entry.label)||!text(entry.url)){fail(at,'Expected label and URL');continue;}
    try{if(new URL(entry.url).protocol!=='https:')throw Error();}catch{fail(at,'Source URL must be absolute HTTPS');}
    if(sourceURLs.has(entry.url))fail(at,'Duplicate source URL');sourceURLs.add(entry.url);
  }
  const voices=new Map(),samples=new Map();
  for(const [i,voice] of source.voices.entries()) {
    const at=`source.voices[${i}]`;
    if(!object(voice)||!id(voice.id)){fail(at,'Invalid voice ID');continue;}
    if(voices.has(voice.id))fail(at,'Duplicate voice ID');voices.set(voice.id,voice);
    if(!text(voice.name))fail(at,'Voice name is required');
    if(!Object.hasOwn(voiceGrades,voice.id))fail(at,'Voice is not in the source-backed audition shortlist');
    else if(voice.grade!==voiceGrades[voice.id])fail(at,'Quality grade disagrees with the published voice rating');
    const expected=voiceGroups[voice.id.slice(0,2)];
    if(!/^[abj][fm]_[a-z0-9]+$/i.test(voice.id)||!expected)fail(at,'Voice ID must name a Kokoro US/UK/Japanese voice');
    else if(expected.some((value,index)=>voice[['lang','group','gender'][index]]!==value))fail(at,'Voice language, group or gender disagrees with its model ID');
    if(voice.attribution!==undefined){
      const a=voice.attribution;
      if(!object(a)||!text(a.name)||!text(a.license)||!text(a.url))fail(at,'Attribution requires name, URL and license');
      else {try{if(new URL(a.url).protocol!=='https:')throw Error();}catch{fail(at,'Attribution URL must be absolute HTTPS');}}
    }
    if(['jf_tebukuro','jm_kumo'].includes(voice.id)&&voice.attribution?.license!=='CC BY 3.0')fail(at,'This Japanese voice needs its CC BY 3.0 attribution');
  }
  for(const [i,sample] of source.samples.entries()) {
    const at=`source.samples[${i}]`;
    if(!object(sample)||!id(sample.id)){fail(at,'Invalid sample ID');continue;}
    if(samples.has(sample.id))fail(at,'Duplicate sample ID');samples.set(sample.id,sample);
    if(!text(sample.title)||!['en','ja'].includes(sample.language)||!text(sample.kind))fail(at,'Sample needs title, en/ja language and kind');
    if(!Array.isArray(sample.segments)||!sample.segments.length){fail(at,'Sample requires at least one segment');continue;}
    const keys=new Set();
    for(const [j,segment] of sample.segments.entries()) {
      const place=`${at}.segments[${j}]`;
      if(!object(segment)||!text(segment.key)||!text(segment.text)){fail(place,'Segment requires key and exact source text');continue;}
      if(keys.has(segment.key))fail(place,'Duplicate segment key');keys.add(segment.key);
      const unit=reference.get(segment.key);
      if(!unit)fail(place,'Key is not present in sourceUnits');
      else if(segment.text!==unit[sample.language])fail(place,'Text differs from the current source or Japanese translation');
      if(segment.speaker!==undefined&&!text(segment.speaker))fail(place,'Speaker must be nonempty text');
      if(segment.spoken!==undefined&&!text(segment.spoken))fail(place,'Spoken normalization must be nonempty text');
    }
  }
  const english=[...samples.values()].filter(sample=>sample.language==='en');
  const japanese=[...samples.values()].filter(sample=>sample.language==='ja');
  const counts={part2:0,part3:0,part4:0,vocab:0};
  for(const sample of english){if(Object.hasOwn(counts,sample.kind))counts[sample.kind]++;else fail(sample.id,'Unknown English audition sample kind');}
  if(english.length!==5||counts.part2!==1||counts.part3!==1||counts.part4!==1||counts.vocab!==2)fail('source.samples','English requires Part 2/3/4 once and two vocabulary samples');
  if(japanese.length!==5||japanese.some(sample=>sample.kind!=='japanese'||sample.segments?.length!==1))fail('source.samples','Japanese requires five one-sentence japanese samples');
  stats.voices=voices.size;stats.samples=samples.size;
  stats.englishVoices=[...voices.values()].filter(voice=>typeof voice.lang==='string'&&voice.lang.startsWith('en-')).length;
  stats.japaneseVoices=[...voices.values()].filter(voice=>voice.lang==='ja-JP').length;
  if(stats.japaneseVoices!==3)fail('source.voices','Exactly three generated Japanese candidates are required');
  for(const group of ['us-female','us-male','uk-female','uk-male']){
    const count=[...voices.values()].filter(voice=>voice.group===group).length;
    if(count<2||count>3)fail('source.voices','Each English group requires 2–3 candidates: '+group+' has '+count);
  }
  for(const voiceId of Object.keys(manifest.clips))if(!voices.has(voiceId))fail(`clips.${voiceId}`,'Manifest voice does not exist in the source');

  const fileChecks=new Map(), declarations=new Map();
  const audioRoot=path.join(root,'audio','audition');
  let actualAudioRoot;
  try{actualAudioRoot=await fs.realpath(audioRoot);
    const realRoot=await fs.realpath(root);
    if(!actualAudioRoot.startsWith(realRoot+path.sep)){fail('audio/audition','Audio directory escapes the repository');actualAudioRoot=null;}
  }catch{fail('audio/audition','Audio directory is missing');}
  async function checkFile(clip,at) {
    if(!object(clip)){fail(at,'Clip must be an object');return;}
    if(!positive(clip.duration)||clip.duration>3600)fail(at,'Duration must be a positive finite number of seconds');
    if(!Number.isSafeInteger(clip.bytes)||clip.bytes<=0)fail(at,'Bytes must be a positive integer');
    if(typeof clip.sha256!=='string'||! /^[a-f0-9]{64}$/.test(clip.sha256))fail(at,'SHA-256 must contain exactly 64 lowercase hexadecimal characters');
    if(typeof clip.src!=='string'||!/^\.\/audio\/audition\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.m4a$/.test(clip.src)||clip.src.split('/').slice(1).some(part=>part==='.'||part==='..')) {
      fail(at,'Audio path must remain under ./audio/audition/ and end in .m4a');return;
    }
    const previous=declarations.get(clip.src);
    if(previous&&['bytes','duration','sha256'].some(key=>previous[key]!==clip[key]))fail(at,'Repeated audio src has conflicting byte, duration or SHA-256 declarations');
    else if(!previous)declarations.set(clip.src,{bytes:clip.bytes,duration:clip.duration,sha256:clip.sha256});
    if(!actualAudioRoot)return;
    if(!fileChecks.has(clip.src))fileChecks.set(clip.src,(async()=>{
      const filename=await fs.realpath(path.resolve(root,clip.src));
      if(!filename.startsWith(actualAudioRoot+path.sep))throw Error('Audio symlink escapes the audition directory');
      const info=await fs.stat(filename);
      if(!info.isFile())throw Error('Audio path is not a file');
      const buffer=await fs.readFile(filename);
      if(buffer.toString('ascii',4,8)!=='ftyp')throw Error('File does not have an MP4/M4A container header');
      stats.files++;stats.bytes+=buffer.length;
      return {bytes:buffer.length,sha256:createHash('sha256').update(buffer).digest('hex')};
    })());
    try{
      const actual=await fileChecks.get(clip.src);
      if(actual.bytes!==clip.bytes)fail(at,'Declared bytes do not match the actual file');
      if(actual.sha256!==clip.sha256)fail(at,'Declared SHA-256 does not match the actual file');
    }
    catch(error){fail(at,error.message);}
  }
  for(const [voiceId,voice] of voices) {
    const expected=voice.lang==='ja-JP'?japanese:english, clips=manifest.clips[voiceId];
    if(!object(clips)){fail(`clips.${voiceId}`,'Missing clip map');continue;}
    const wanted=new Set(expected.map(sample=>sample.id));
    for(const sampleId of Object.keys(clips))if(!wanted.has(sampleId))fail(`clips.${voiceId}.${sampleId}`,'Sample belongs to another language or is undeclared');
    for(const sample of expected) {
      const at=`clips.${voiceId}.${sample.id}`,clip=clips[sample.id];
      if(!object(clip)){fail(at,'Missing full-sample clip');continue;}
      stats.clips++;await checkFile(clip,at);
      if(!Array.isArray(clip.segments)||clip.segments.length!==sample.segments?.length){fail(at,'Segment coverage differs from the source sample');continue;}
      for(const [index,segment] of clip.segments.entries()) {
        const place=`${at}.segments[${index}]`;
        if(segment?.key!==sample.segments[index]?.key)fail(place,'Segment key or order differs from the source sample');
        stats.segments++;await checkFile(segment,place);
      }
    }
  }
  if(manifest.totals!==undefined){
    if(!object(manifest.totals))fail('manifest.totals','Totals must be an object');
    else {
      // The generator counts voice/sample pairs here, not the ten distinct source samples.
      const expected={voices:stats.voices,samples:stats.clips,files:stats.files,bytes:stats.bytes};
      for(const [key,value] of Object.entries(expected)){
        if(!Number.isSafeInteger(manifest.totals[key])||manifest.totals[key]!==value)fail('manifest.totals.'+key,'Total disagrees with validated coverage or unique audio files');
      }
      if(manifest.totals.duration!==undefined){
        const duration=[...declarations.values()].reduce((sum,entry)=>sum+entry.duration,0);
        if(!positive(manifest.totals.duration)||!Number.isFinite(duration)||Math.abs(manifest.totals.duration-duration)>.002)fail('manifest.totals.duration','Total duration disagrees with unique file declarations');
      }
    }
  }
  return {errors,stats};
}

export const auditionSummary=({stats})=>`Audition: ${stats.voices} voices (${stats.englishVoices} EN / ${stats.japaneseVoices} JA), ${stats.samples} samples, ${stats.clips} full clips, ${stats.segments} segments, ${stats.files} M4A files, ${(stats.bytes/1048576).toFixed(2)} MiB`;
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result=await validateAudition(await loadAuditionInputs(process.argv[2]?path.resolve(process.argv[2]):defaultRoot));
    console.log(auditionSummary(result));
    for(const error of result.errors)console.error(`${error.location}: ${error.message}`);
    if(result.errors.length)process.exitCode=1;else console.log('PASS audition source, coverage and local audio integrity');
  } catch(error){console.error('Audition validation failed: '+error.message);process.exitCode=1;}
}
