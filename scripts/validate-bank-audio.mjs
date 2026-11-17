// Offline authoring validator. No model or external package is required.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {sourceUnits} from '../js/translation-source.js';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const token=u=>`${u.language}:${u.bank}:${u.key}`;
const marker=t=>/^\s*\[[1-4]\]\s*$/.test(t);
const allowed={en:new Set(['af_heart','am_puck','af_bella']),ja:new Set(['jf_alpha'])};
const expect=(ok,message,errors)=>{if(!ok)errors.push(message);};

// Only named publication reports, current manifest packs/audits and content-
// addressed ASR batch evidence belong in the public audio metadata directory.
export const AUDIO_METADATA_REPORTS=Object.freeze([
  'source.json','manifest.json','overrides.json','generation-errors.json',
  'regenerations.json','retries.json','audit-summary.json','generation-run.json',
  'benchmark.json','benchmark-asr.json','benchmark-asr-batch.json',
  'normalization-review.json','pronunciation-review.json','archive.json',
  'unpublished-optional.json','validation.json','retry-coverage-error.json',
]);
export async function unexpectedAudioMetadata(root,index){
  const allowedFiles=new Set(AUDIO_METADATA_REPORTS.map(name=>'./data/audio/'+name));
  for(const meta of index.packs||[]){
    if(!/^(en|ja)$/.test(meta.language)||!/^(vocab|part1|part2|grammar|listening|reading|methods|terms|labels)$/.test(meta.bank))continue;
    const src=`./data/audio/${meta.language}/${meta.bank}.json`;
    if(meta.src!==src)continue;
    allowedFiles.add(src);allowedFiles.add(`./data/audio/audit/${meta.language}/${meta.bank}.json`);
  }
  const unexpected=[];
  async function visit(directory){
    let entries;try{entries=await fs.readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
    for(const entry of entries){
      const file=path.join(directory,entry.name);
      if(entry.isDirectory()){await visit(file);continue;}
      const src='./'+path.relative(root,file).split(path.sep).join('/');
      const allowed=allowedFiles.has(src)||/^\.\/data\/audio\/audit-batches\/[a-f0-9]{64}\.json$/.test(src);
      // Never follow a symlink into an external authoring directory.
      if(!entry.isFile()||!allowed)unexpected.push(src);
    }
  }
  await visit(path.join(root,'data/audio'));
  return unexpected.sort();
}

export function validateSource(source){
  const errors=[],seen=new Set(),groups=new Map();
  for(const u of source.units||[]){
    const id=token(u);expect(!seen.has(id),`Duplicate source ${id}`,errors);seen.add(id);
    expect(typeof u.text==='string'&&u.text.trim()&&typeof u.required==='boolean',`Invalid source ${id}`,errors);
    expect(allowed[u.language]?.has(u.voiceId),`Unexpected voice ${id}: ${u.voiceId}`,errors);
    if(marker(u.text))expect(u.nonSpoken===true&&u.required===false,`Visual marker is spoken ${id}`,errors);
    if(u.nonSpoken)expect(marker(u.text)&&!u.required,`Invalid nonSpoken ${id}`,errors);
    if(u.language==='ja'&&!u.nonSpoken)expect(u.required,`Japanese unit not required ${id}`,errors);
    if(u.language==='en'&&(['part1','part2'].includes(u.bank)&&!u.key.includes('/explanation/')||
      u.bank==='listening'&&!u.key.includes('/explanation/')&&!u.key.includes('/graphic/')||
      u.bank==='vocab'&&/\/meaning$|\/example\//.test(u.key)||u.bank==='grammar'&&u.key.includes('/sentence/')||
      u.bank==='reading'&&/\/documents\/\d+\/text\//.test(u.key)||u.bank==='labels')&&!u.nonSpoken)
      expect(u.required,`Required material omitted ${id}`,errors);
    if(u.language==='en'&&['part2','listening'].includes(u.bank)){
      const key=`${u.bank}:${u.group}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(u);
    }
  }
  for(const [key,rows] of groups){
    if(key.startsWith('part2:')){
      const q=rows.filter(r=>r.key.includes('/audio/')),a=rows.filter(r=>r.key.includes('/options/'));
      const qv=new Set(q.map(r=>r.voiceId)),av=new Set(a.map(r=>r.voiceId));
      expect(qv.size===1&&av.size===1&&q[0]?.voiceId!==a[0]?.voiceId&&[q[0]?.voiceId,a[0]?.voiceId].includes('am_puck'),`Part 2 cast must be female + male ${key}`,errors);
    }else{
      const turns=rows.filter(r=>r.key.includes('/turns/')),speakers=new Map();
      for(const r of turns){
        expect(r.speaker,`Missing speaker ${r.key}`,errors);
        if(speakers.has(r.speaker))expect(speakers.get(r.speaker)===r.voiceId,`Speaker changed voice ${r.key}`,errors);
        speakers.set(r.speaker,r.voiceId);
      }
      const voices=new Set(speakers.values());
      if(speakers.size===2)expect(voices.size===2&&voices.has('am_puck'),`Two-person cast must be female + male ${key}`,errors);
      if(speakers.size===3)expect(voices.size===3,`Three-person cast must use all selected voices ${key}`,errors);
      for(const r of rows.filter(r=>/-d\/text\//.test(r.key)))
        expect(r.speaker&&r.voiceId===speakers.get(r.speaker)&&turns.some(t=>t.speaker===r.speaker&&t.text===r.text),`Dictation cast/text differs from turn ${r.key}`,errors);
    }
  }
  return errors;
}

// Read ISO BMFF metadata directly so checking thousands of clips does not
// launch thousands of ffprobe processes. Invalid/truncated atoms are rejected.
export function m4aMetadata(buffer){
  const found={};
  const walk=(start,end)=>{
    for(let at=start;at<end;){
      if(at+8>end)throw Error('Truncated MP4 atom header');
      let size=buffer.readUInt32BE(at),header=8;const type=buffer.toString('ascii',at+4,at+8);
      if(size===1){if(at+16>end)throw Error('Truncated large atom');size=Number(buffer.readBigUInt64BE(at+8));header=16;}
      if(size===0)size=end-at;
      if(!Number.isSafeInteger(size)||size<header||at+size>end)throw Error('Invalid MP4 atom size');
      const data=at+header,stop=at+size;
      if(type==='ftyp')found.ftyp=true;
      if(type==='mdat')found.mdat=true;
      if(type==='mvhd'){
        const version=buffer[data],scaleAt=data+(version===1?20:12),durationAt=scaleAt+4;
        if(![0,1].includes(version)||durationAt+(version===1?8:4)>stop)throw Error('Invalid movie duration');
        const scale=buffer.readUInt32BE(scaleAt),duration=version===1?Number(buffer.readBigUInt64BE(durationAt)):buffer.readUInt32BE(durationAt);
        if(!scale)throw Error('Invalid movie timescale');found.duration=duration/scale;
      }
      if(type==='mp4a'){
        if(data+28>stop)throw Error('Invalid AAC sample entry');
        found.codec='aac';found.channels=buffer.readUInt16BE(data+16);found.sampleRate=buffer.readUInt32BE(data+24)/65536;
      }
      if(['moov','trak','mdia','minf','stbl'].includes(type))walk(data,stop);
      if(type==='stsd'){if(data+8>stop)throw Error('Invalid sample descriptions');walk(data+8,stop);}
      at=stop;
    }
  };
  walk(0,buffer.length);
  if(!found.ftyp||!found.mdat||found.codec!=='aac'||!Number.isFinite(found.duration))throw Error('Incomplete AAC M4A');
  return found;
}

export function validASREvidence(clip,record){
  if(!clip||!record||record.sha256!==clip.sha256||record.expected!==clip.text||record.spoken!==clip.spoken||
    typeof record.recognized!=='string'||!record.recognized.trim()||!['matched','review','accepted'].includes(record.status)||record.recognitionGeneration?.prompt!==null)return false;
  const generation=record.recognitionGeneration;
  if(!generation.model||!/^[a-f0-9]{64}$/.test(generation.modelSha256||'')||generation.device!=='cpu'||generation.computeType!=='int8'||generation.conditionOnPreviousText!==false||generation.vadFilter!==false)return false;
  if(record.recognitionMethod==='individual-beam5')return record.singleFileVerification===true&&record.recognitionGeneration.beamSize===5;
  if(record.recognitionMethod==='batch-beam1')return record.singleFileVerification===false&&record.recognitionGeneration.beamSize===1&&
    record.screening?.boundaryStable===true&&record.screening?.normalizedExact===true&&/^[a-f0-9]{64}$/.test(record.screening?.batchId||'');
  return false;
}

export function validateRetry(entry,clip){
  const versions=entry?[entry.initial,...(entry.priorRetries||[]),entry.retry]:[];
  return Boolean(entry?.complete&&entry.selectedSha256===clip.sha256&&versions.length>=2&&
    entry.synthesisAttemptCount>=2&&entry.asrAttemptCount>=2&&
    versions.every(v=>v?.clip?.sha256&&v.clip.text===clip.text&&v.clip.voiceId===clip.voiceId&&v.clip.language===clip.language&&validASREvidence(v.clip,v.asr))&&
    new Set(versions.map(v=>v.clip.sha256)).size>=2&&
    versions.some(v=>v.clip.sha256===clip.sha256&&v.clip.spoken===clip.spoken&&v.clip.inputSha256===clip.inputSha256));
}

export function validateArchivedRetry(entry){
  const versions=entry?[entry.initial,...(entry.priorRetries||[]),entry.retry]:[];
  const selected=versions.find(v=>v?.clip?.sha256===entry?.selectedSha256)?.clip;
  return Boolean(selected&&validateRetry(entry,selected));
}

export function validateRetryPredecessor(entry,archived=[]){
  const link=entry?.predecessor;
  if(!link)return true;
  const prior=Number.isInteger(link.archiveIndex)&&link.archiveIndex>=0?archived[link.archiveIndex]:null;
  return Boolean(prior&&validateArchivedRetry(prior)&&prior.token===entry.token&&prior.token===link.token&&
    prior.selectedSha256===link.selectedSha256&&prior.selectedSha256===entry.initial?.clip?.sha256);
}

export function pendingInputCorrections(review,packs,retries={records:{}}){
  const pending=[],deliveries=new Map((review.confirmedInputCorrections||[]).map(row=>[row.token,row]));
  const knownNotes=new Map((review.asrTextReviewNotes||[]).filter(row=>row.confirmedInputError===true).map(row=>[row.token,row]));
  const known=new Set(knownNotes.keys());
  for(const [id,entry] of Object.entries(retries.records||{}))if(entry.kind==='confirmed-input-correction')known.add(id);
  for(const id of new Set([...deliveries.keys(),...known])){
    const delivery=deliveries.get(id),[language,bank,...tail]=id.split(':'),key=tail.join(':');
    const loaded=packs.get(`${language}:${bank}`),clip=loaded?.pack?.clips?.[key],record=loaded?.audit?.records?.[key];
    if(!clip&&delivery?.delivery==='future-optional-only')continue;
    let reason='';
    const target=delivery?.appliedOverride,binding=delivery?.sourceBinding;
    if(knownNotes.get(id)?.disposition==='pending-reviewed-input-correction')reason='Newly observed confirmed input error still awaits reviewed delivery';
    else if(!delivery)reason='Confirmed input error has no reviewed correction delivery';
    else if(!clip)reason='Reviewed target has not been generated';
    else if(!target?.phonemes||clip.phonemeSha256!==sha(target.phonemes)||
      !binding||clip.text!==binding.text||clip.voiceId!==binding.voiceId||clip.language!==binding.language||
      clip.spoken!==(target.spoken??binding.spoken))reason='Current recording does not use the reviewed target input';
    else if(!validASREvidence(clip,record))reason='Reviewed target lacks current actual ASR';
    else if(!['future-required-generation','future-optional-only'].includes(delivery.delivery)&&
      (delivery.delivery!=='regenerated-with-both-ASR-versions'||!validateRetry(retries.records?.[id],clip)))
      reason='Existing recording correction lacks completed real before/after evidence';
    if(reason)pending.push({token:id,reason,delivery:delivery?.delivery||'not-applied'});
  }
  return pending;
}

// Review triage only. These labels never change ASR status or the acceptance
// gate: even a likely spelling/homophone difference remains a listening task.
export function reviewTriage(language,spoken,recognized,key=''){
  if(key.startsWith('p1-050/')&&/has fallen/i.test(spoken)&&/is falling/i.test(recognized))
    return {category:'meaning-tense-or-omission',priority:'high',note:'Completed action versus action in progress; listen to both actual versions.'};
  if(language==='en'){
    const words=s=>(s.toLowerCase().replaceAll('’',"'").match(/[a-z0-9]+/g)||[]);
    const a=words(spoken),b=words(recognized);
    if(a.join('')===b.join(''))return {category:'possible-spelling',priority:'normal',note:'Spacing, punctuation or compound spelling may explain the difference; listening still required.'};
    const homophones={luis:'lewis',beech:'beach'};
    const normalize=xs=>xs.map(x=>homophones[x]||x).join(' ');
    if(normalize(a)===normalize(b))return {category:'possible-homophone',priority:'normal',note:'A name or homophone may explain the transcript; confirm the intended pronunciation by listening.'};
  }
  return {category:'meaning-tense-or-omission',priority:'normal',note:'Check words, tense, numbers and omissions against the audio; the transcript alone cannot identify the cause.'};
}

export function validateClip(unit,clip,record,{allowIncomplete=false,strictQuality=false,retry}={}){
  const errors=[],id=token(unit);
  if(unit.nonSpoken){expect(!clip,`Nonspoken marker has audio ${id}`,errors);return errors;}
  if(!clip){if(unit.required&&!allowIncomplete)errors.push(`Missing required clip ${id}`);return errors;}
  for(const field of ['text','voiceId','language','required'])expect(clip[field]===unit[field],`Clip ${field} mismatch ${id}`,errors);
  if(unit.speaker)expect(clip.speaker===unit.speaker,`Clip speaker mismatch ${id}`,errors);
  expect(typeof clip.spoken==='string'&&clip.spoken.trim()&&!/[\d$]|\[[1-4]\]/.test(clip.spoken),`Unresolved spoken number/marker ${id}`,errors);
  expect(/^\.\/audio\/generated\/(en|ja)\/[a-z_]+\/[a-f0-9]{32}\.m4a$/.test(clip.src||''),`Unsafe audio path ${id}`,errors);
  expect(/^[a-f0-9]{64}$/.test(clip.sha256||'')&&clip.bytes>0&&clip.duration>.25&&clip.duration<180,`Invalid file metadata ${id}`,errors);
  expect(clip.decodedPeak>.005&&clip.decodedPeak<=.95,`Invalid decoded peak ${id}`,errors);
  expect(['pending','matched','review','error','accepted'].includes(clip.asrStatus),`Unknown ASR status ${id}`,errors);
  const actual=validASREvidence(clip,record);
  if(record?.sha256===clip.sha256&&record.expected===clip.text&&record.spoken===clip.spoken&&['matched','review','accepted'].includes(record.status))
    expect(actual,`Incomplete ASR provenance ${id}`,errors);
  if(unit.required&&!allowIncomplete){
    expect(actual,`Missing current actual ASR ${id}`,errors);
    const retried=record?.status==='review'&&validateRetry(retry,clip);
    expect(['matched','accepted'].includes(record?.status)||(!strictQuality&&retried),`Unresolved or untried ASR ${id}: ${record?.status||'pending'}`,errors);
    expect(clip.asrStatus===record?.status,`ASR status not synchronized ${id}`,errors);
  }
  if(actual){
    expect(['matched','review','accepted'].includes(record.status),`Invalid actual ASR status ${id}`,errors);
    expect(record.recognitionGeneration?.prompt===null,`ASR prompt provenance missing ${id}`,errors);
    if(record.recognitionMethod==='batch-beam1'){
      expect(record.screening?.boundaryStable===true&&record.screening?.normalizedExact===true&&record.singleFileVerification===false,`Unsafe batch acceptance ${id}`,errors);
      expect(/^[a-f0-9]{64}$/.test(record.screening?.batchId||''),`Missing batch evidence ${id}`,errors);
    }else expect(record.recognitionMethod==='individual-beam5'&&record.singleFileVerification===true,`Missing individual ASR provenance ${id}`,errors);
  }
  return errors;
}

export async function validateAudio({root=ROOT,allowIncomplete=false,strictQuality=false,ignoreOrphans=false,ignoreUnexpectedMetadata=false}={}){
  const errors=[],sourceBytes=await fs.readFile(path.join(root,'data/audio/source.json')),source=JSON.parse(sourceBytes);
  const manifestBytes=await fs.readFile(path.join(root,'data/audio/manifest.json')),index=JSON.parse(manifestBytes);
  errors.push(...validateSource(source));expect(index.sourceSha256===sha(sourceBytes),'Manifest source fingerprint mismatch',errors);
  const units=new Map(source.units.map(u=>[token(u),u])),packs=new Map(),audio=new Map();
  let retries={records:{}};try{retries=JSON.parse(await fs.readFile(path.join(root,'data/audio/retries.json')));}catch(e){if(e.code!=='ENOENT')throw e;}
  let inputReview={};try{inputReview=JSON.parse(await fs.readFile(path.join(root,'data/audio/normalization-review.json')));}catch(e){if(e.code!=='ENOENT')throw e;}
  // Bank and translation files remain the authority: full key/text coverage is
  // checked independently of the generated source's required flags.
  for(const bank of ['part1','part2','listening','vocab','reading','grammar','methods']){
    const records=JSON.parse(await fs.readFile(path.join(root,`data/${bank}.json`)));
    for(const u of sourceUnits(bank,records))expect(units.get(`en:${bank}:${u.key}`)?.text===u.text,`Source text/key changed en:${bank}:${u.key}`,errors);
    const ja=JSON.parse(await fs.readFile(path.join(root,`data/i18n/ja/${bank}.json`))).entries;
    for(const [key,text] of Object.entries(ja))expect(units.get(`ja:${bank}:${key}`)?.text===text,`Japanese source text/key changed ${bank}:${key}`,errors);
  }
  const terms=JSON.parse(await fs.readFile(path.join(root,'data/i18n/ja/terms.json'))).entries;
  for(const [key,text] of Object.entries(terms))expect(units.get(`ja:terms:${key}`)?.text===text,`Japanese term changed ${key}`,errors);
  const seen=new Set();
  for(const meta of index.packs){
    const id=`${meta.language}:${meta.bank}`;expect(!seen.has(id),`Duplicate audio pack ${id}`,errors);seen.add(id);
    const expectedSrc=`./data/audio/${meta.language}/${meta.bank}.json`;
    expect(meta.src===expectedSrc,`Unsafe pack path ${id}`,errors);if(meta.src!==expectedSrc)continue;
    const bytes=await fs.readFile(path.join(root,meta.src)),pack=JSON.parse(bytes);
    expect(bytes.length===meta.bytes&&sha(bytes)===meta.sha256,`Pack hash/bytes mismatch ${id}`,errors);
    expect(pack.sourceSha256===index.sourceSha256,`Pack source fingerprint mismatch ${id}`,errors);
    let audit={records:{}};try{audit=JSON.parse(await fs.readFile(path.join(root,`data/audio/audit/${meta.language}/${meta.bank}.json`)));}catch(e){if(e.code!=='ENOENT')throw e;}
    packs.set(id,{pack,audit});
    expect(meta.count===Object.keys(pack.clips).length,`Pack count mismatch ${id}`,errors);
    for(const [key,clip] of Object.entries(pack.clips)){
      const u=units.get(`${id}:${key}`);expect(u,`Unknown audio source ${id}:${key}`,errors);
      if(u)errors.push(...validateClip(u,clip,audit.records[key],{allowIncomplete,strictQuality,retry:retries.records[token(u)]}));
      if(!audio.has(clip.src)&&/^\.\/audio\/generated\/(en|ja)\/[a-z_]+\/[a-f0-9]{32}\.m4a$/.test(clip.src||'')){
        const bytes=await fs.readFile(path.join(root,clip.src));
        expect(bytes.length===clip.bytes&&sha(bytes)===clip.sha256,`M4A hash/bytes mismatch ${clip.src}`,errors);
        try{const m=m4aMetadata(bytes);expect(m.channels===1&&m.sampleRate===24000&&Math.abs(m.duration-clip.duration)<=.002,`M4A duration/format mismatch ${clip.src}`,errors);}catch(e){errors.push(`${clip.src}: ${e.message}`);}
        audio.set(clip.src,clip);
      }
    }
  }
  let required=0,generated=0,audited=0,unresolved=0;const unresolvedItems=[];
  for(const u of source.units){
    const p=packs.get(`${u.language}:${u.bank}`),clip=p?.pack.clips[u.key],record=p?.audit.records[u.key];
    if(!clip)errors.push(...validateClip(u,clip,record,{allowIncomplete}));
    if(u.required){required++;if(clip)generated++;if(validASREvidence(clip,record)){audited++;if(record.status==='review'){
      unresolved++;const retry=retries.records[token(u)];unresolvedItems.push({token:token(u),text:clip.text,spoken:clip.spoken,recognized:record.recognized,src:clip.src,
        triage:reviewTriage(u.language,clip.spoken,record.recognized,u.key),
        retried:validateRetry(retry,clip),synthesisAttemptCount:retry?.synthesisAttemptCount||1,asrAttemptCount:retry?.asrAttemptCount||1,
        retryRecognized:retry?.retry?.asr?.recognized,retrySha256:retry?.retry?.clip?.sha256,
        retryPublished:retry?.retry?retry.retry.archive?.published!==false:undefined,
        retrySrc:retry?.retry?.archive?.published===false?undefined:retry?.retry?.clip?.src});
    }}}
  }
  // Historical alternatives are checked while present. After an explicit
  // verified archive, a public checkout needs only hash + actual ASR evidence.
  const historical=new Set();
  const archivedCases=retries.archivedCases||[],allCases=[...Object.values(retries.records),...archivedCases];
  for(const entry of allCases)expect(validateRetryPredecessor(entry,archivedCases),`Invalid correction predecessor evidence ${entry.token}`,errors);
  for(const entry of archivedCases)if(entry.complete)expect(validateArchivedRetry(entry),`Invalid archived retry ASR evidence ${entry.token}`,errors);
  for(const entry of allCases)for(const version of [entry.initial,...(entry.priorRetries||[]),entry.retry,...(entry.failedRecognitionAttempts||[])]){
    const c=version?.clip;if(!c||audio.has(c.src)||historical.has(c.src))continue;
    if(version.archive?.published===false){
      expect(version.archive.sha256===c.sha256&&version.archive.bytes===c.bytes&&version.archive.copyVerified===true,`Invalid historical archive evidence ${entry.token}`,errors);
      historical.add(c.src);continue;
    }
    if(!/^\.\/audio\/generated\/(en|ja)\/[a-z_]+\/[a-f0-9]{32}\.m4a$/.test(c.src||'')){errors.push(`Unsafe retry file ${entry.token}`);continue;}
    try{const bytes=await fs.readFile(path.join(root,c.src)),m=m4aMetadata(bytes);
      expect(bytes.length===c.bytes&&sha(bytes)===c.sha256&&Math.abs(m.duration-c.duration)<=.002,`Retry file hash/duration mismatch ${entry.token}`,errors);
      historical.add(c.src);
    }catch(e){errors.push(`Retry file missing/invalid ${entry.token}: ${e.message}`);}
  }
  const totals=index.totals;
  const pendingCorrections=pendingInputCorrections(inputReview,packs,retries);
  if(!allowIncomplete)expect(!pendingCorrections.length,`Reviewed audio input corrections still pending: ${pendingCorrections.map(row=>row.token).join(', ')}`,errors);
  async function mediaFiles(directory){
    let entries;try{entries=await fs.readdir(directory,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return [];throw e;}
    const files=[];
    for(const entry of entries){const file=path.join(directory,entry.name);if(entry.isDirectory())files.push(...await mediaFiles(file));else if(entry.isFile()&&entry.name.endsWith('.m4a'))files.push('./'+path.relative(root,file).split(path.sep).join('/'));}
    return files;
  }
  const orphanFiles=(await mediaFiles(path.join(root,'audio/generated'))).filter(src=>!audio.has(src));
  const unexpectedMetadataFiles=await unexpectedAudioMetadata(root,index);
  if(!allowIncomplete&&!ignoreOrphans)expect(!orphanFiles.length,`Unreferenced generated M4A files: ${orphanFiles.length}; archive before publication`,errors);
  if(!allowIncomplete&&!ignoreUnexpectedMetadata)expect(!unexpectedMetadataFiles.length,`Unexpected audio metadata files: ${unexpectedMetadataFiles.length}; archive before publication: ${unexpectedMetadataFiles.join(', ')}`,errors);
  expect(totals.requiredExpected===required&&totals.requiredCount===generated,'Required totals mismatch',errors);
  expect(index.requiredComplete===(required===generated),'requiredComplete flag mismatch',errors);
  expect(totals.files===audio.size,'Unique audio count mismatch',errors);
  expect(totals.audioBytes===[...audio.values()].reduce((n,c)=>n+c.bytes,0),'Audio byte total mismatch',errors);
  expect(!index.requiredAuditComplete||audited===required,'requiredAuditComplete falsely claims actual coverage',errors);
  if(!allowIncomplete){expect(index.requiredComplete,'Required generation incomplete',errors);expect(index.requiredAuditComplete,'Required audit incomplete',errors);expect(totals.requiredAudited===audited,'Required ASR count not synchronized',errors);}
  return {ok:!errors.length,errors,required,generated,audited,unresolved,unresolvedItems,
    warnings:unresolvedItems.filter(r=>r.retried).map(r=>`WARN: remaining review after ${r.asrAttemptCount} actual ASR attempts ${r.token}`),
    uniqueFiles:audio.size,historicalFiles:historical.size,orphanFiles,unexpectedMetadataFiles,pendingInputCorrections:pendingCorrections,audioBytes:totals.audioBytes,allowIncomplete,strictQuality};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let result;
  for(let attempt=0;attempt<5;attempt++){
    result=await validateAudio({allowIncomplete:process.argv.includes('--allow-incomplete'),strictQuality:process.argv.includes('--strict-quality')});
    if(!result.errors.some(e=>/Pack hash\/bytes mismatch|Required totals mismatch|Unique audio count mismatch|Audio byte total mismatch/.test(e)))break;
    await new Promise(r=>setTimeout(r,300)); // A generator checkpoint can update packs before its index.
  }
  console.log(JSON.stringify({...result,errors:result.errors.slice(0,30),errorCount:result.errors.length},null,2));
  if(!result.ok)process.exitCode=1;
}
