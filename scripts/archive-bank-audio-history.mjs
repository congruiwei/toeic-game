// Final publication cleanup only: copy and verify before removing any media.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {validateAudio,validASREvidence,m4aMetadata} from './validate-bank-audio.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const work=process.env.TOEIC_TTS_DIR||path.join(os.homedir(),'.local/share/toeic-kokoro');
const apply=process.argv.includes('--apply');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=async(file,fallback)=>{try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
const write=async(file,value)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file+'.tmp',JSON.stringify(value,null,2)+'\n');await fs.rename(file+'.tmp',file);};
const source=await read(path.join(root,'data/audio/source.json'),{});
let manifest=await read(path.join(root,'data/audio/manifest.json'),{});
const units=new Map(source.units.map(u=>[`${u.language}:${u.bank}:${u.key}`,u]));
const optional=[];
for(const meta of manifest.packs){
  const pack=await read(path.join(root,meta.src),{}),audit=await read(path.join(root,`data/audio/audit/${meta.language}/${meta.bank}.json`),{records:{}});
  for(const [key,clip] of Object.entries(pack.clips)){
    const token=`${meta.language}:${meta.bank}:${key}`;
    if(units.get(token)?.required)continue;
    const record=audit.records[key];
    if(!validASREvidence(clip,record)||!['matched','accepted'].includes(record.status))optional.push({token,key,bank:meta.bank,language:meta.language,sha256:clip.sha256,src:clip.src,status:record?.status||'pending',reason:'Optional clip lacks current matched/accepted ASR; use device speech fallback'});
  }
}
if(!apply){
  const result=await validateAudio({allowIncomplete:true});
  console.log(JSON.stringify({dryRun:true,optionalToUnpublish:optional,existingOrphanFiles:result.orphanFiles,unexpectedMetadataFiles:result.unexpectedMetadataFiles,requiredGenerated:result.generated,requiredExpected:result.required},null,2));
  process.exit(0);
}
const state=await read(path.join(work,'bank-processes.json'),{processes:{}});
for(const [role,processInfo] of Object.entries(state.processes)){
  try{process.kill(processInfo.pid,0);throw Error(`Wait for ${role} PID ${processInfo.pid} to exit before final cleanup`);}catch(e){if(e.code!=='ESRCH')throw e;}
}
const children=await read(path.join(work,'bank-retry-children.json'),{});
if(children.state==='running')for(const [role,processInfo] of Object.entries(children.children||{})){
  try{process.kill(processInfo.pid,0);throw Error(`Wait for retry child ${role} PID ${processInfo.pid} to exit before final cleanup`);}catch(e){if(e.code!=='ESRCH')throw e;}
}
if(!(manifest.requiredPlaybackComplete??manifest.requiredComplete))throw Error('Required playback coverage must be complete before cleanup');
// Optional, unaudited files may still be reversibly unpublished below. Every
// required recording and explicit fallback must already have its own evidence.
const preflight=await validateAudio({allowIncomplete:true,ignoreOrphans:true,ignoreUnexpectedMetadata:true});
if(!preflight.ok||preflight.audited!==preflight.generated)throw Error('Pre-cleanup coverage/fallback evidence failed: '+preflight.errors.slice(0,8).join('; '));
// Pruning is reversible metadata work; final coverage validation happens before
// the archive removes anything. The source list retains optional fallback keys.
for(const meta of manifest.packs){
  const remove=optional.filter(o=>o.bank===meta.bank&&o.language===meta.language);if(!remove.length)continue;
  const pack=await read(path.join(root,meta.src),{});for(const row of remove)delete pack.clips[row.key];await write(path.join(root,meta.src),pack);
}
const oldOptional=await read(path.join(root,'data/audio/unpublished-optional.json'),{version:1,entries:[]});
const unpublished=new Map(oldOptional.entries.map(row=>[row.token,row]));for(const row of optional)unpublished.set(row.token,row);
await write(path.join(root,'data/audio/unpublished-optional.json'),{version:1,entries:[...unpublished.values()]});
const sync=spawnSync(path.join(work,'venv/bin/python'),['scripts/generate-bank-audio.py','--workdir',work,'--sync-only'],{cwd:root,stdio:'inherit'});
if(sync.status!==0)throw Error('Could not synchronize publication packs');
manifest=await read(path.join(root,'data/audio/manifest.json'),{});
if(!(manifest.requiredPlaybackComplete??manifest.requiredComplete)||!(manifest.recordedAuditComplete??manifest.requiredAuditComplete))throw Error('Required playback coverage and published recording ASR must be complete before archive removal');
// These two known cleanup classes are handled below; all content/provenance
// validation must still pass before any historical files can be removed.
const checked=await validateAudio({ignoreOrphans:true,ignoreUnexpectedMetadata:true});
if(!checked.ok)throw Error('Final coverage/provenance validation failed: '+checked.errors.slice(0,8).join('; '));
manifest=await read(path.join(root,'data/audio/manifest.json'),{});
const active=new Set();for(const meta of manifest.packs){const pack=await read(path.join(root,meta.src),{});for(const clip of Object.values(pack.clips))active.add(clip.src);}
const archiveDir=path.join(work,'tmp/audio-history');await fs.mkdir(archiveDir,{recursive:true});
const archive=await read(path.join(root,'data/audio/archive.json'),{version:1,files:[]});const archived=new Map(archive.files.map(row=>[row.formerSrc,row]));
const metadataArchived=new Map((archive.metadataFiles||[]).map(row=>[row.formerSrc+'|'+row.sha256,row]));
for(const src of checked.orphanFiles){
  if(active.has(src))throw Error('Refusing to archive an active media file');
  const bytes=await fs.readFile(path.join(root,src)),digest=sha(bytes),target=path.join(archiveDir,digest+'.m4a');
  await fs.writeFile(target,bytes);const copied=await fs.readFile(target);
  if(copied.length!==bytes.length||sha(copied)!==digest)throw Error('Archive verification failed for '+src);
  let metadata={};try{metadata=m4aMetadata(bytes);}catch(e){metadata={containerError:e.message};}
  archived.set(src,{formerSrc:src,sha256:digest,bytes:bytes.length,duration:metadata.duration??null,containerError:metadata.containerError,copyVerified:true,published:false});
}
const metadataToRemove=[];
await fs.mkdir(path.join(archiveDir,'metadata'),{recursive:true});
for(const src of checked.unexpectedMetadataFiles){
  const original=path.join(root,src);
  if(!(await fs.lstat(original)).isFile())throw Error('Refusing to archive a non-regular metadata file '+src);
  const bytes=await fs.readFile(original),digest=sha(bytes),archiveRelativePath='metadata/'+digest+(src.endsWith('.json')?'.json':'.bin');
  const target=path.join(archiveDir,archiveRelativePath);await fs.writeFile(target,bytes);
  const copied=await fs.readFile(target);
  if(copied.length!==bytes.length||sha(copied)!==digest)throw Error('Metadata archive verification failed for '+src);
  const record={formerSrc:src,sha256:digest,bytes:bytes.length,archiveRelativePath,copyVerified:true,published:false};
  metadataArchived.set(src+'|'+digest,record);metadataToRemove.push(record);
}
await write(path.join(root,'data/audio/archive.json'),{version:1,location:'External authoring work directory: tmp/audio-history; not required by the public validator',files:[...archived.values()],metadataFiles:[...metadataArchived.values()]});
const retries=await read(path.join(root,'data/audio/retries.json'),{version:1,records:{}});
for(const entry of [...Object.values(retries.records),...(retries.archivedCases||[])]){
  for(const version of [entry.initial,...(entry.priorRetries||[]),entry.retry,...(entry.failedRecognitionAttempts||[])]){
    const clip=version?.clip;if(!clip||active.has(clip.src))continue;
    const record=archived.get(clip.src);
    if(!record||record.sha256!==clip.sha256||record.bytes!==clip.bytes)throw Error('Cannot bind archived historical audio '+entry.token);
    version.archive={published:false,sha256:record.sha256,bytes:record.bytes,copyVerified:true};
  }
}
await write(path.join(root,'data/audio/retries.json'),retries);
// Repair snapshots are independent of immutable baseline/comparison evidence.
// Bind archive copies before removing unreferenced candidates or originals.
const quality=await read(path.join(root,'data/audio/quality-review.json'),null);
if(quality){
  for(const row of Object.values(quality.records||{})){
    if(row.repair?.complete!==true||row.repair.disposition!=='system-fallback')continue;
    for(const version of [row.repair.original,row.repair.candidate]){
      const clip=version?.clip;if(!clip||active.has(clip.src))continue;
      const record=archived.get(clip.src);
      if(!record||record.sha256!==clip.sha256||record.bytes!==clip.bytes)throw Error('Cannot bind archived system-fallback evidence '+row.token);
      version.archive={published:false,sha256:record.sha256,bytes:record.bytes,copyVerified:true};
    }
  }
  await write(path.join(root,'data/audio/quality-review.json'),quality);
}
// This is the only destructive step, after every backup and its provenance was
// written and verified. A partial interruption is safe to run again.
for(const src of checked.orphanFiles)await fs.unlink(path.join(root,src));
for(const record of metadataToRemove){
  const original=path.join(root,record.formerSrc),bytes=await fs.readFile(original);
  if(bytes.length!==record.bytes||sha(bytes)!==record.sha256)throw Error('Metadata changed after its verified archive copy: '+record.formerSrc);
  await fs.unlink(original);
}
const final=await validateAudio();
await write(path.join(root,'data/audio/validation.json'),final);
if(!final.ok)throw Error('Post-cleanup validation failed: '+final.errors.slice(0,8).join('; '));
console.log(JSON.stringify({ok:true,archivedFiles:checked.orphanFiles.length,archivedMetadataFiles:metadataToRemove.length,optionalUnpublished:optional.length,activeFiles:final.uniqueFiles,activeAudioBytes:final.audioBytes,required:final.required,audited:final.audited,systemFallbackCount:final.systemFallbackCount,remainingReview:final.unresolved,warnings:final.warnings},null,2));
