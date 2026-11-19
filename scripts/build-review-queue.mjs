// Build only the remaining playable human-review queue from validated evidence.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const shaPattern=/^[a-f0-9]{64}$/;
const rank={part1:0,part2:1,listening:2,dictation:2,grammar:3,vocab:4,reading:5};
const notes={
  'possible-spelling':'核对连写、分词或字母拼读；转写差异不一定是录音错误。',
  'possible-homophone':'核对姓名或同音词的实际发音；不要只根据拼写作判断。',
  'meaning-tense-or-omission':'核对时态、数字、词尾以及是否漏词。',
};
const expect=(ok,message)=>{if(!ok)throw Error(message);};
const FULL_MODEL='whisper-large-v3',FULL_MODEL_SHA='69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1';
function fullRecognition(row,clip,checks){
  const current=(checks??[]).filter(p=>p?.method==='same-media-full-model-crosscheck-v1'&&p.token===row.token&&p.sourceAudioSha256===clip.sha256);
  if(!current.length)return undefined;
  const proof=current.at(-1),full=proof.fullASR,g=full?.recognitionGeneration,original=proof.originalASR;
  const bound=['src','sha256','text','spoken','language','voiceId','inputSha256','phonemeSha256'];
  expect(bound.every(k=>proof.sourceClip?.[k]===clip[k]),`Full-model source binding changed: ${row.token}`);
  expect(full?.key===row.token.split(':').slice(2).join(':')&&['src','sha256','voiceId'].every(k=>full[k]===clip[k])&&full.expected===clip.text&&full.spoken===clip.spoken,
    `Full-model audio binding changed: ${row.token}`);
  expect(original?.sha256===clip.sha256&&original.expected===clip.text&&original.spoken===clip.spoken&&original.recognized===row.recognized,
    `Original Turbo transcript changed: ${row.token}`);
  expect(g?.model===FULL_MODEL&&g.modelSha256===FULL_MODEL_SHA&&g.beamSize===5&&g.prompt===null&&g.hotwords===null&&g.conditionOnPreviousText===false&&g.vadFilter===false&&full.recognitionMethod==='individual-beam5'&&full.singleFileVerification===true&&!full.error,
    `Missing actual full-model identity: ${row.token}`);
  expect(typeof full.recognized==='string'&&full.recognized.trim()&&Array.isArray(full.segments)&&full.segments.length&&full.segments.map(s=>s.text?.trim()).join(' ').trim()===full.recognized,
    `Missing actual full-model transcript: ${row.token}`);
  return full.recognized===row.recognized?undefined:{model:FULL_MODEL,recognized:full.recognized};
}

export function makeReviewQueue({result,ledger,packs,audits,sourceSha256}){
  expect(result?.ok===true,'Audio coverage and evidence must pass before creating a queue');
  expect(Array.isArray(result.unresolvedItems)&&result.unresolvedItems.length===result.unresolved,'Unresolved queue count differs');
  expect(shaPattern.test(sourceSha256),'Missing validated source fingerprint');
  const systemFallbackCount=result.systemFallbackCount??0;
  expect(Number.isSafeInteger(systemFallbackCount)&&systemFallbackCount>=0,'Invalid processed system-fallback count');
  if(systemFallbackCount)expect(Array.isArray(result.systemFallbackItems)&&result.systemFallbackItems.length===systemFallbackCount,'System-fallback summary differs');
  const focus=new Set(Object.values(ledger.focus??{}).flat()),seen=new Set();
  const entries=result.unresolvedItems.map(row=>{
    const match=/^(en|ja):([^:]+):(.+)$/.exec(row.token??'');
    expect(match&&!seen.has(row.token),'Missing or duplicate review token');seen.add(row.token);
    const [,language,bank,key]=match;
    const pack=packs.get(`${language}:${bank}`),clip=pack?.clips?.[key];
    expect(clip&&!pack.fallbacks?.[key]&&clip.src===row.src&&clip.text===row.text&&clip.spoken===row.spoken&&clip.language===language,
      `Current playable recording changed: ${row.token}`);
    expect(shaPattern.test(clip.sha256)&&new RegExp(`^\\./audio/generated/${language}/[a-z_]+/[a-f0-9]{32}\\.m4a$`).test(clip.src),`Invalid review audio binding: ${row.token}`);
    expect(typeof row.recognized==='string'&&row.recognized.trim(),`Missing actual ASR transcript: ${row.token}`);
    const actual=audits?.get(`${language}:${bank}`)?.records?.[key],g=actual?.recognitionGeneration;
    expect(actual&&actual.key===key&&['src','sha256','voiceId'].every(k=>actual[k]===clip[k])&&actual.expected===clip.text&&actual.spoken===clip.spoken&&actual.recognized===row.recognized,
      `Current ASR binding changed: ${row.token}`);
    const models={'whisper-large-v3-turbo':'e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da',[FULL_MODEL]:FULL_MODEL_SHA};
    expect(Object.hasOwn(models,g?.model)&&g.modelSha256===models[g.model],`Current ASR model changed: ${row.token}`);
    const additional=g.model==='whisper-large-v3-turbo'?fullRecognition(row,clip,ledger.records?.[row.token]?.crossModelChecks):undefined;
    const spelling=language==='en'&&bank==='vocab'&&/^morph-[a-z0-9-]+\/forms\/\d+$/.test(key)
      ?`此处读字母拼写「${clip.spoken}」，不是词缀在单词中的读音；请逐字母核对。`:'';
    const reason=row.humanReview?.reason??(focus.has(row.token)?'重点复听：注意动作、词尾与关键单词。':notes[row.triage?.category]??'对照原文听清关键内容；自动转写只作为线索。');
    return {token:row.token,language,bank,key,text:row.text,recognized:row.recognized,recognitionModel:g.model,...(additional?{fullRecognition:additional}:{}),
      src:clip.src,sha256:clip.sha256,asrStatus:row.asrStatus??actual.status,reviewStatus:row.humanReview?.status==='required'?'pending-human-review':'asr-review',priority:row.humanReview?.status==='required'?0:focus.has(row.token)?0:1,
      reason:[spelling,reason].filter(Boolean).join(' ')};
  });
  const group=row=>row.language==='ja'?10:rank[row.bank]??6;
  entries.sort((a,b)=>group(a)-group(b)||a.priority-b.priority||a.token.localeCompare(b.token,'en'));
  // Completed JA system fallbacks are a separate count, never unplayable rows
  // that would ask the user to judge an inaccessible archived recording.
  return {version:1,sourceSha256,systemFallbackCount,humanApprovedCount:result.humanAcceptedCount??0,forcedHumanReviewCount:result.forcedHumanReviewCount??0,entries};
}

export async function buildReviewQueue({root=ROOT,check=false,output,validate}={}){
  const load=async relative=>JSON.parse(await fs.readFile(path.join(root,relative),'utf8'));
  if(!validate)({validateAudio:validate}=await import(pathToFileURL(path.join(root,'scripts/validate-bank-audio.mjs')).href));
  const result=await validate({root});
  if(!result.ok)throw Error(result.errors.slice(0,10).join('\n'));
  const [ledger,index]=await Promise.all([load('data/audio/quality-review.json'),load('data/audio/manifest.json')]);
  const packs=new Map(),audits=new Map();
  await Promise.all(index.packs.map(async item=>{packs.set(`${item.language}:${item.bank}`,await load(item.src));audits.set(`${item.language}:${item.bank}`,await load(`data/audio/audit/${item.language}/${item.bank}.json`));}));
  const queue=makeReviewQueue({result,ledger,packs,audits,sourceSha256:index.sourceSha256});
  const body=JSON.stringify(queue,null,2)+'\n',dest=output?path.resolve(output):path.join(root,'data/audio/review-queue.json');
  if(check){if(await fs.readFile(dest,'utf8')!==body)throw Error('Review queue differs from current validated playable audio');}
  else{await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,body);}
  return queue;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);if(i<0)return undefined;if(!args[i+1]||args[i+1].startsWith('--'))throw Error(`Missing ${name}`);return args[i+1];};
  const queue=await buildReviewQueue({root:value('--root')?path.resolve(value('--root')):ROOT,check:args.includes('--check'),output:value('--output')});
  console.log(`Review queue: ${queue.entries.length} playable recordings; English ${queue.entries.filter(x=>x.language==='en').length}, Japanese ${queue.entries.filter(x=>x.language==='ja').length}; ${queue.systemFallbackCount} processed Japanese system fallbacks are counted separately.`);
}
