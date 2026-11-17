// Destructive archive paths are exercised ONLY in disposable /private/tmp checkouts.
// Sync imports the local authoring environment but never constructs an audio model.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {validateAudio,unexpectedAudioMetadata,AUDIO_METADATA_REPORTS} from '../scripts/validate-bank-audio.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const authoring=process.env.TOEIC_TTS_DIR||path.join(os.homedir(),'.local/share/toeic-kokoro');
const venv=path.join(authoring,'venv');
const canSync=await fs.access(path.join(venv,'bin/python')).then(()=>true,()=>false);
const syncRequired={skip:canSync?false:'Local Kokoro Python environment is required for real --sync-only; no model inference is performed'};
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const json=async file=>JSON.parse(await fs.readFile(file,'utf8'));
async function write(file,value){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(value,null,2)+'\n');}
const atom=(type,data)=>{const bytes=Buffer.alloc(8+data.length);bytes.writeUInt32BE(bytes.length);bytes.write(type,4);data.copy(bytes,8);return bytes;};
function m4a(tag){
 const movie=Buffer.alloc(20);movie.writeUInt32BE(1000,12);movie.writeUInt32BE(1234,16);
 const sample=Buffer.alloc(28);sample.writeUInt16BE(1,16);sample.writeUInt32BE(24000*65536,24);
 return Buffer.concat([atom('ftyp',Buffer.from('M4A ')),atom('moov',Buffer.concat([atom('mvhd',movie),atom('stsd',Buffer.concat([Buffer.alloc(8),atom('mp4a',sample)]))])),atom('mdat',Buffer.from([tag]))]);
}
const asr=clip=>({sha256:clip.sha256,expected:clip.text,spoken:clip.spoken,recognized:clip.spoken,status:'matched',recognitionMethod:'individual-beam5',singleFileVerification:true,recognitionGeneration:{model:'fixture-asr',modelSha256:'c'.repeat(64),device:'cpu',computeType:'int8',conditionOnPreviousText:false,vadFilter:false,prompt:null,beamSize:5}});
const version=clip=>({clip,asr:asr(clip)});
const history=(initial,retry)=>({token:'en:vocab:v-retired/meaning',complete:true,selectedSha256:initial.sha256,synthesisAttemptCount:2,asrAttemptCount:2,initial:version(initial),retry:version(retry)});
async function media(f,tag,extra={}){
 const bytes=m4a(tag),sha256=hash(bytes),src='./audio/generated/en/af_heart/'+sha256.slice(0,32)+'.m4a';
 await fs.mkdir(path.dirname(path.join(f.repo,src)),{recursive:true});await fs.writeFile(path.join(f.repo,src),bytes);
 return {language:'en',voiceId:'af_heart',text:'Archived material.',spoken:'Archived material.',required:true,inputSha256:'d'.repeat(64),src,sha256,bytes:bytes.length,duration:1.234,decodedPeak:.5,asrStatus:'matched',...extra};
}
async function extraMetadata(f){
 const files=['./data/audio/ja/listening 2.json','./data/audio/audit/ja/listening 3.json','./data/audio/manifest.json.interrupted.tmp','./data/audio/en/retired.json'];
 for(const [i,src]of files.entries())await write(path.join(f.repo,src),{fixture:'unpublished metadata '+i});
 return files.sort();
}
async function fixture(t){
 const base=await fs.mkdtemp('/private/tmp/toeic-archive-test-'),f={base,repo:path.join(base,'repo'),work:path.join(base,'work')};
 t.after(()=>fs.rm(base,{recursive:true,force:true}));
 await fs.mkdir(path.join(f.repo,'scripts'),{recursive:true});
 for(const name of ['archive-bank-audio-history.mjs','validate-bank-audio.mjs','generate-bank-audio.py','generate-audition.py','audio-evidence.py'])await fs.copyFile(path.join(ROOT,'scripts',name),path.join(f.repo,'scripts',name));
 await fs.cp(path.join(ROOT,'js'),path.join(f.repo,'js'),{recursive:true});
 for(const bank of ['part1','part2','listening','vocab','reading','grammar','methods']){await write(path.join(f.repo,'data',bank+'.json'),[]);await write(path.join(f.repo,'data/i18n/ja',bank+'.json'),{version:1,entries:{}});}
 await write(path.join(f.repo,'data/i18n/ja/terms.json'),{version:1,entries:{}});
 f.source={version:1,model:'isolated archive fixture',voices:{en:['af_heart','am_puck','af_bella'],ja:['jf_alpha']},units:[]};
 await write(path.join(f.repo,'data/audio/source.json'),f.source);
 await write(path.join(f.repo,'data/audio/manifest.json'),{version:1,sourceSha256:hash(await fs.readFile(path.join(f.repo,'data/audio/source.json'))),complete:true,requiredComplete:true,requiredAuditComplete:true,packs:[],totals:{requiredExpected:0,requiredCount:0,requiredAudited:0,files:0,audioBytes:0}});
 await write(path.join(f.repo,'data/audio/retries.json'),{version:1,records:{}});
 await fs.mkdir(path.join(f.work,'models'),{recursive:true});
 await fs.writeFile(path.join(f.work,'models/kokoro-v1.0.onnx'),'not a real model; sync-only must not load this');
 await fs.writeFile(path.join(f.work,'models/voices-v1.0.bin'),'not a voice bank; sync-only must not load this');
 if(canSync)await fs.symlink(venv,path.join(f.work,'venv'),'dir');
 return f;
}
function run(f,args,{env={},cwd=f.repo}={}){
 assert(f.repo.startsWith('/private/tmp/toeic-archive-test-')&&path.resolve(f.repo)!==path.resolve(ROOT),'archive commands must never target the real checkout');
 assert(cwd===f.repo||cwd===path.join(f.base,'public-clone'));
 return spawnSync(process.execPath,args,{cwd,env:{...process.env,TOEIC_TTS_DIR:f.work,...env},encoding:'utf8',timeout:20000});
}
function succeeded(result){assert.equal(result.error,undefined,result.error?.stack);assert.equal(result.status,0,result.stderr+'\n'+result.stdout);}
function sync(f){
 assert(f.repo.startsWith('/private/tmp/toeic-archive-test-'));
 const result=spawnSync(path.join(f.work,'venv/bin/python'),['scripts/generate-bank-audio.py','--workdir',f.work,'--sync-only'],{cwd:f.repo,encoding:'utf8',timeout:20000});succeeded(result);
}
async function snapshot(root){
 const rows=[];async function visit(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory())await visit(full);else if(entry.isFile())rows.push([path.relative(root,full),hash(await fs.readFile(full))]);}}await visit(root);return rows.sort((a,b)=>a[0].localeCompare(b[0]));
}

test('archive dry-run reports orphan fixtures without changing the isolated checkout or external work',async t=>{
 const f=await fixture(t),first=await media(f,1),second=await media(f,2);
 const unexpected=await extraMetadata(f);
 await write(path.join(f.repo,'data/audio/retries.json'),{version:1,records:{retired:history(first,second)}});
 const before=await snapshot(f.base),result=run(f,['scripts/archive-bank-audio-history.mjs']);succeeded(result);
 const output=JSON.parse(result.stdout);assert.equal(output.dryRun,true);assert.deepEqual(output.existingOrphanFiles.sort(),[first.src,second.src].sort());
 assert.deepEqual(output.unexpectedMetadataFiles,unexpected);
 assert.deepEqual(await snapshot(f.base),before);
});

test('archive refuses a live authoring PID before mutating any isolated files',async t=>{
 const f=await fixture(t);await media(f,3);await extraMetadata(f);await write(path.join(f.work,'bank-processes.json'),{processes:{generate:{pid:process.pid}}});
 const before=await snapshot(f.base),result=run(f,['scripts/archive-bank-audio-history.mjs','--apply']);
 assert.notEqual(result.status,0);assert.match(result.stderr,/Wait for generate PID/);assert.deepEqual(await snapshot(f.base),before);
});

test('archive refuses a still-running retry child even when its controller has exited',async t=>{
 const f=await fixture(t);await extraMetadata(f);
 await write(path.join(f.work,'bank-retry-children.json'),{version:1,parentPid:99999999,state:'running',children:{audit:{pid:process.pid,identity:'fixture-live-child',argv:['fixture']}}});
 const before=await snapshot(f.base),result=run(f,['scripts/archive-bank-audio-history.mjs','--apply']);
 assert.notEqual(result.status,0);assert.match(result.stderr,/Wait for retry child audit PID/);assert.deepEqual(await snapshot(f.base),before);
});

test('metadata whitelist keeps only manifest packs, matching audits, exact reports and SHA-named batch evidence',async t=>{
 const f=await fixture(t),manifest=await json(path.join(f.repo,'data/audio/manifest.json'));
 const src='./data/audio/en/vocab.json',pack={version:1,language:'en',bank:'vocab',sourceSha256:manifest.sourceSha256,clips:{}};
 await write(path.join(f.repo,src),pack);const bytes=await fs.readFile(path.join(f.repo,src));
 manifest.packs=[{bank:'vocab',language:'en',src,count:0,bytes:bytes.length,sha256:hash(bytes)}];
 await write(path.join(f.repo,'data/audio/manifest.json'),manifest);
 await write(path.join(f.repo,'data/audio/audit/en/vocab.json'),{records:{}});
 await write(path.join(f.repo,'data/audio/audit-batches','a'.repeat(64)+'.json'),{fixture:'preserved ASR batch evidence'});
 for(const name of AUDIO_METADATA_REPORTS)if(!['source.json','manifest.json','retries.json'].includes(name))await write(path.join(f.repo,'data/audio',name),{fixture:'known publication report'});
 assert.deepEqual(await unexpectedAudioMetadata(f.repo,manifest),[]);
 assert.equal((await validateAudio({root:f.repo})).ok,true);
 const unexpected=await extraMetadata(f);
 const unknown='./data/audio/audit-batches/not-a-content-sha.json';await write(path.join(f.repo,unknown),{});unexpected.push(unknown);unexpected.sort();
 const final=await validateAudio({root:f.repo});assert.equal(final.ok,false);assert.deepEqual(final.unexpectedMetadataFiles,unexpected);assert.match(final.errors.join('\n'),/Unexpected audio metadata files/);
 const progress=await validateAudio({root:f.repo,allowIncomplete:true});assert.equal(progress.ok,true);assert.deepEqual(progress.unexpectedMetadataFiles,unexpected);
});

test('apply verifies external copies, annotates every history variant, and public validation needs no authoring directory',syncRequired,async t=>{
 const f=await fixture(t),first=await media(f,4),second=await media(f,5);
 const unexpected=await extraMetadata(f),metadataBefore=new Map(await Promise.all(unexpected.map(async src=>[src,await fs.readFile(path.join(f.repo,src))])));
 const batch='./data/audio/audit-batches/'+ 'b'.repeat(64)+'.json';await write(path.join(f.repo,batch),{fixture:'preserve actual evidence filenames'});
 const entry=history(first,second);entry.priorRetries=[version(second)];entry.failedRecognitionAttempts=[version(first)];
 await write(path.join(f.repo,'data/audio/retries.json'),{version:1,records:{retired:entry},archivedCases:[history(second,first)]});
 const result=run(f,['scripts/archive-bank-audio-history.mjs','--apply']);succeeded(result);
 for(const clip of [first,second]){const copied=await fs.readFile(path.join(f.work,'tmp/audio-history',clip.sha256+'.m4a'));assert.equal(copied.length,clip.bytes);assert.equal(hash(copied),clip.sha256);await assert.rejects(fs.access(path.join(f.repo,clip.src)),{code:'ENOENT'});}
 const archive=await json(path.join(f.repo,'data/audio/archive.json'));assert.equal(archive.files.length,2);
 assert.equal(archive.metadataFiles.length,unexpected.length);
 for(const row of archive.metadataFiles){const original=metadataBefore.get(row.formerSrc);assert(original);assert.equal(row.sha256,hash(original));assert.equal(row.bytes,original.length);assert.equal(row.copyVerified,true);assert.equal(row.published,false);assert(row.archiveRelativePath.startsWith('metadata/'));assert.deepEqual(await fs.readFile(path.join(f.work,'tmp/audio-history',row.archiveRelativePath)),original);await assert.rejects(fs.access(path.join(f.repo,row.formerSrc)),{code:'ENOENT'});}
 assert.deepEqual(await json(path.join(f.repo,batch)),{fixture:'preserve actual evidence filenames'});
 for(const row of archive.files){assert.equal(row.copyVerified,true);assert.equal(row.published,false);assert.equal(row.duration,1.234);assert.equal(row.bytes,first.bytes);assert(/^[a-f0-9]{64}$/.test(row.sha256));}
 const saved=await json(path.join(f.repo,'data/audio/retries.json'));
 for(const item of [...Object.values(saved.records),...saved.archivedCases])for(const v of [item.initial,...(item.priorRetries||[]),item.retry,...(item.failedRecognitionAttempts||[])])assert.deepEqual(v.archive,{published:false,sha256:v.clip.sha256,bytes:v.clip.bytes,copyVerified:true});
 assert.equal((await json(path.join(f.repo,'data/audio/validation.json'))).ok,true);
 const publicClone=path.join(f.base,'public-clone');await fs.cp(f.repo,publicClone,{recursive:true});await fs.rm(f.work,{recursive:true,force:true});
 const validation=run(f,['scripts/validate-bank-audio.mjs'],{cwd:publicClone});succeeded(validation);const report=JSON.parse(validation.stdout);assert.equal(report.ok,true);assert.equal(report.historicalFiles,2);assert.deepEqual(report.orphanFiles,[]);assert.deepEqual(report.unexpectedMetadataFiles,[]);
});

test('a corrupted metadata copy aborts before deleting the original duplicate or temporary file',syncRequired,async t=>{
 const f=await fixture(t),unexpected=await extraMetadata(f);
 const before=new Map(await Promise.all(unexpected.map(async src=>[src,hash(await fs.readFile(path.join(f.repo,src)))])));
 const hook=path.join(f.base,'corrupt-metadata-copy.mjs');
 await fs.writeFile(hook,"import fs from 'node:fs/promises';const write=fs.writeFile.bind(fs);fs.writeFile=async(file,data,...rest)=>write(file,String(file).includes('/tmp/audio-history/metadata/')?Buffer.from('corrupted metadata'):data,...rest);\n");
 const result=run(f,['--import',pathToFileURL(hook).href,'scripts/archive-bank-audio-history.mjs','--apply']);
 assert.notEqual(result.status,0);assert.match(result.stderr,/Metadata archive verification failed/);
 for(const src of unexpected)assert.equal(hash(await fs.readFile(path.join(f.repo,src))),before.get(src));
 await assert.rejects(fs.access(path.join(f.repo,'data/audio/archive.json')),{code:'ENOENT'});
});

test('a corrupted external copy aborts apply before deleting any historical media',syncRequired,async t=>{
 const f=await fixture(t),clip=await media(f,6);
 await write(path.join(f.repo,'data/audio/retries.json'),{version:1,records:{retired:history(clip,clip)}});
 const hook=path.join(f.base,'corrupt-copy.mjs');
 await fs.writeFile(hook,"import fs from 'node:fs/promises';const write=fs.writeFile.bind(fs);fs.writeFile=async(file,data,...rest)=>write(file,String(file).includes('/tmp/audio-history/')&&String(file).endsWith('.m4a')?Buffer.from('corrupted copy'):data,...rest);\n");
 const result=run(f,['--import',pathToFileURL(hook).href,'scripts/archive-bank-audio-history.mjs','--apply']);
 assert.notEqual(result.status,0);assert.match(result.stderr,/Archive verification failed/);assert.equal(hash(await fs.readFile(path.join(f.repo,clip.src))),clip.sha256);
 await assert.rejects(fs.access(path.join(f.repo,'data/audio/archive.json')),{code:'ENOENT'});
});

test('a referenced current recording survives apply while its retired alternative is archived',syncRequired,async t=>{
 const f=await fixture(t),unit={language:'en',bank:'labels',key:'labels/af_heart/A',text:'A.',voiceId:'af_heart',required:true};
 f.source.units=[unit];await write(path.join(f.repo,'data/audio/source.json'),f.source);sync(f);
 // Compute exactly the generator's JSON fingerprint from its real sync-only metadata.
 const python="import json,hashlib,sys; m=json.load(open(sys.argv[1])); g=m['generation']; s={k:g[k] for k in ['recipe','modelSha256','voicesSha256','packages']}; print(hashlib.sha256(json.dumps([s,g['encoding'],'af_heart','A.',None],sort_keys=True).encode()).hexdigest())";
 const fingerprint=spawnSync(path.join(f.work,'venv/bin/python'),['-c',python,path.join(f.repo,'data/audio/manifest.json')],{encoding:'utf8'});succeeded(fingerprint);
 const active=await media(f,7,{...unit,spoken:'A.',inputSha256:fingerprint.stdout.trim()}),old=await media(f,8,{...unit,spoken:'A.'});
 await write(path.join(f.repo,'data/audio/en/labels.json'),{version:1,language:'en',bank:'labels',clips:{[unit.key]:active}});
 await write(path.join(f.repo,'data/audio/audit/en/labels.json'),{records:{[unit.key]:asr(active)}});
 const entry=history(active,old);entry.token='en:labels:'+unit.key;await write(path.join(f.repo,'data/audio/retries.json'),{version:1,records:{[entry.token]:entry}});sync(f);
 assert.equal((await json(path.join(f.repo,'data/audio/manifest.json'))).requiredAuditComplete,true);
 const result=run(f,['scripts/archive-bank-audio-history.mjs','--apply']);succeeded(result);
 assert.equal(hash(await fs.readFile(path.join(f.repo,active.src))),active.sha256);await assert.rejects(fs.access(path.join(f.repo,old.src)),{code:'ENOENT'});
 const archive=await json(path.join(f.repo,'data/audio/archive.json'));assert.deepEqual(archive.files.map(row=>row.formerSrc),[old.src]);
 const saved=(await json(path.join(f.repo,'data/audio/retries.json'))).records[entry.token];assert.equal(saved.initial.archive,undefined);assert.equal(saved.retry.archive.copyVerified,true);
 const final=await json(path.join(f.repo,'data/audio/validation.json'));assert.equal(final.ok,true);assert.equal(final.uniqueFiles,1);assert.equal(final.required,1);assert.equal(final.audited,1);
});

test('a twice-corrected three-version chain survives real archive and public-clone validation',syncRequired,async t=>{
 const f=await fixture(t),unit={language:'en',bank:'labels',key:'labels/af_heart/A',text:'A.',voiceId:'af_heart',required:true};
 const token='en:labels:'+unit.key,phones=['ɐ','ˌA','ˈA'];
 f.source.units=[unit];await write(path.join(f.repo,'data/audio/source.json'),f.source);
 await write(path.join(f.repo,'data/audio/overrides.json'),{version:1,entries:{[token]:{phonemes:phones[2]}}});sync(f);
 const python="import json,hashlib,sys; g=json.load(open(sys.argv[1]))['generation']; s={k:g[k] for k in ['recipe','modelSha256','voicesSha256','packages']}; print(hashlib.sha256(json.dumps([s,g['encoding'],'af_heart','A.',sys.argv[2]],sort_keys=True).encode()).hexdigest())";
 const fingerprint=spawnSync(path.join(f.work,'venv/bin/python'),['-c',python,path.join(f.repo,'data/audio/manifest.json'),phones[2]],{encoding:'utf8'});succeeded(fingerprint);
 const first=await media(f,9,{...unit,spoken:'A.',phonemeSha256:hash(phones[0])});
 const second=await media(f,10,{...unit,spoken:'A.',phonemeSha256:hash(phones[1])});
 const current=await media(f,11,{...unit,spoken:'A.',phonemeSha256:hash(phones[2]),inputSha256:fingerprint.stdout.trim()});
 const old={...history(first,second),token,kind:'confirmed-input-correction',selectedSha256:second.sha256,
  baseOverride:{phonemes:phones[0]},retryOverride:{phonemes:phones[1]}};
 const entry={...history(second,current),token,kind:'confirmed-input-correction',selectedSha256:current.sha256,
  baseOverride:{phonemes:phones[1]},retryOverride:{phonemes:phones[2]},
  predecessor:{archiveIndex:0,token,selectedSha256:second.sha256}};
 await write(path.join(f.repo,'data/audio/en/labels.json'),{version:1,language:'en',bank:'labels',clips:{[unit.key]:current}});
 await write(path.join(f.repo,'data/audio/audit/en/labels.json'),{records:{[unit.key]:asr(current)}});
 await write(path.join(f.repo,'data/audio/retries.json'),{version:1,records:{[token]:entry},archivedCases:[old]});
 await write(path.join(f.repo,'data/audio/normalization-review.json'),{version:1,confirmedInputCorrections:[{
  token,sourceBinding:{text:unit.text,spoken:'A.',voiceId:unit.voiceId,language:unit.language},
  appliedOverride:{phonemes:phones[2]},delivery:'regenerated-with-both-ASR-versions',selectedSha256:current.sha256,
 }]});sync(f);
 assert.equal((await json(path.join(f.repo,'data/audio/manifest.json'))).requiredAuditComplete,true);

 const result=run(f,['scripts/archive-bank-audio-history.mjs','--apply']);succeeded(result);
 const archive=await json(path.join(f.repo,'data/audio/archive.json'));
 assert.deepEqual(archive.files.map(row=>row.formerSrc).sort(),[first.src,second.src].sort());
 for(const clip of [first,second]){
  assert.equal(hash(await fs.readFile(path.join(f.work,'tmp/audio-history',clip.sha256+'.m4a'))),clip.sha256);
  await assert.rejects(fs.access(path.join(f.repo,clip.src)),{code:'ENOENT'});
 }
 assert.equal(hash(await fs.readFile(path.join(f.repo,current.src))),current.sha256);
 const saved=await json(path.join(f.repo,'data/audio/retries.json'));
 assert.equal(saved.archivedCases.length,1);assert.deepEqual(saved.records[token].predecessor,entry.predecessor);
 assert.equal(saved.records[token].selectedSha256,current.sha256);assert.equal(saved.archivedCases[0].selectedSha256,second.sha256);
 const pairs=[[saved.archivedCases[0].initial,old.initial],[saved.archivedCases[0].retry,old.retry],
  [saved.records[token].initial,entry.initial],[saved.records[token].retry,entry.retry]];
 for(const [actual,original]of pairs){
  assert.deepEqual(actual.clip,original.clip);assert.deepEqual(actual.asr,original.asr);
  if(actual.clip.sha256===current.sha256)assert.equal(actual.archive,undefined,'the current recording stays published');
  else assert.deepEqual(actual.archive,{published:false,sha256:actual.clip.sha256,bytes:actual.clip.bytes,copyVerified:true});
 }
 assert.equal(new Set(pairs.map(([v])=>v.clip.sha256)).size,3);

 const publicClone=path.join(f.base,'public-clone');await fs.cp(f.repo,publicClone,{recursive:true});await fs.rm(f.work,{recursive:true,force:true});
 await assert.rejects(fs.access(f.work),{code:'ENOENT'});
 const validation=run(f,['scripts/validate-bank-audio.mjs'],{cwd:publicClone});succeeded(validation);
 const report=JSON.parse(validation.stdout);assert.equal(report.ok,true);assert.equal(report.uniqueFiles,1);assert.equal(report.historicalFiles,2);
 assert.equal(report.required,1);assert.equal(report.audited,1);assert.deepEqual(report.orphanFiles,[]);
 assert.deepEqual(report.pendingInputCorrections,[]);
 // The public validator must still inspect the old a->b evidence, although only c's audio is published.
 const damaged=structuredClone(saved);damaged.archivedCases[0].initial.asr.recognized='';
 await write(path.join(publicClone,'data/audio/retries.json'),damaged);
 const rejected=run(f,['scripts/validate-bank-audio.mjs'],{cwd:publicClone});assert.notEqual(rejected.status,0);
 assert.match(JSON.parse(rejected.stdout).errors.join('\n'),/Invalid archived retry ASR evidence/);
});
