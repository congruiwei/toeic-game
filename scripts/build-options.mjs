import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {optionLexemeId,optionLexiconBucket,optionSourceSignature} from '../js/option-details.js';
import {sourceUnits} from '../js/translation-source.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const norm=s=>s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
const vocab=read('data/vocab.json'),japanese=read('data/i18n/ja/vocab-meanings.json').entries;
const vocabChinese=read('data/i18n/zh/vocab.json').entries;
const dictionary=new Map();
const compact=(lexemes,key)=>[...new Set(lexemes.map(x=>x[key]))].join('；');
function add(word,lexeme){const key=norm(word);const prior=dictionary.get(key)?.lexemes||[];const lexemes=[...prior,lexeme];dictionary.set(key,{pos:compact(lexemes,'pos'),zh:compact(lexemes,'zh'),ja:compact(lexemes,'ja'),lexemes});}
for(const w of vocab)add(w.word,{id:w.id,wordId:w.id,word:w.word,pos:w.pos,zh:w.zh,ja:japanese[`${w.id}/meaning`],...(w.sense?{sense:w.sense}:{}),ipa:w.ipa,example:w.example});
const authored=fs.readdirSync(path.join(root,'data/options/authoring')).filter(f=>f.endsWith('.json')&&!f.startsWith('reasons-')).flatMap(f=>read('data/options/authoring/'+f));
const seen=new Set();for(const w of authored){const unique=[norm(w.word),w.pos,w.zh,w.ja].join('|');if(seen.has(unique))throw Error('Duplicate authored lexeme '+w.word);seen.add(unique);if(![w.word,w.pos,w.zh,w.ja].every(x=>typeof x==='string'&&x.trim()))throw Error('Incomplete '+w.word);add(w.word,{id:optionLexemeId(unique),...w});}
const irregular={am:['be','第一人称单数现在式','一人称単数現在形'],is:['be','第三人称单数现在式','三人称単数現在形'],are:['be','现在式','現在形'],was:['be','单数过去式','単数過去形'],were:['be','复数过去式／虚拟形式','複数過去形・仮定法の形'],been:['be','过去分词','過去分詞'],being:['be','现在分词／动名词','現在分詞・動名詞'],has:['have','第三人称单数现在式','三人称単数現在形'],had:['have','过去式／过去分词','過去形・過去分詞'],did:['do','过去式','過去形'],does:['do','第三人称单数现在式','三人称単数現在形'],kept:['keep','过去式／过去分词','過去形・過去分詞'],taken:['take','过去分词','過去分詞'],took:['take','过去式','過去形'],lain:['lie','过去分词','過去分詞'],laid:['lay','过去式／过去分词','過去形・過去分詞'],risen:['rise','过去分词','過去分詞'],rose:['rise','过去式','過去形'],fallen:['fall','过去分词','過去分詞'],fell:['fall','过去式','過去形'],bought:['buy','过去式／过去分词','過去形・過去分詞'],brought:['bring','过去式／过去分词','過去形・過去分詞'],sent:['send','过去式／过去分词','過去形・過去分詞'],left:['leave','过去式／过去分词','過去形・過去分詞'],chose:['choose','过去式','過去形'],chosen:['choose','过去分词','過去分詞'],heard:['hear','过去式／过去分词','過去形・過去分詞'],stood:['stand','过去式／过去分词','過去形・過去分詞'],borne:['bear','过去分词','過去分詞'],bore:['bear','过去式','過去形'],wound:['wind','过去式／过去分词','過去形・過去分詞'],made:['make','过去式／过去分词','過去形・過去分詞'],hidden:['hide','过去分词','過去分詞'],worn:['wear','过去分词','過去分詞'],given:['give','过去分词','過去分詞'],better:['good','比较级','比較級'],best:['good','最高级','最上級']};
function variant(word,base,zhLabel,jaLabel,type='v.'){
 const origin=dictionary.get(norm(base));if(!origin)return null;
 const lexemes=origin.lexemes.filter(x=>type==='n.'?/\bn\./.test(x.pos):type==='adj.'?/adj\.|adv\./.test(x.pos):/\bv\.|助动词|情态动词/.test(x.pos));
 if(!lexemes.length)return null;
 let result={pos:`${type}（${zhLabel}）`,zh:`${compact(lexemes,'zh')}（${base} 的${zhLabel}）`,ja:`${compact(lexemes,'ja')}（${base} の${jaLabel}）`,lexemes};const previous=dictionary.get(norm(word));if(previous){result={pos:[...new Set([previous.pos,result.pos])].join(' / '),zh:[...new Set([previous.zh,result.zh])].join('；'),ja:[...new Set([previous.ja,result.ja])].join('；'),lexemes:[...new Map([...previous.lexemes,...result.lexemes].map(x=>[x.id,x])).values()]};}dictionary.set(norm(word),result);return result;
}
function derived(word,force=false){
 const w=norm(word);if(dictionary.has(w)&&!force)return dictionary.get(w);
 if(irregular[w]){const [base,zh,ja]=irregular[w];return variant(w,base,zh,ja,['比较级','最高级'].includes(zh)?'adj.':'v.');}
 if(w.endsWith("'s"))return variant(w,w.slice(0,-2),'单数所有格','単数所有格','n.');
 if(w.endsWith("s'"))return variant(w,w.slice(0,-2),'复数所有格','複数所有格','n.');
 const options=[];
 if(w.endsWith('ies'))options.push([w.slice(0,-3)+'y','s']);
 if(w.endsWith('es'))options.push([w.slice(0,-2),'s']);
 if(w.endsWith('s'))options.push([w.slice(0,-1),'s']);
 if(w.endsWith('ied'))options.push([w.slice(0,-3)+'y','ed']);
 for(const suffix of ['ed','ing','er','est'])if(w.endsWith(suffix)){
  const stem=w.slice(0,-suffix.length);options.push([stem,suffix],[stem+'e',suffix]);
  if(stem.endsWith('i'))options.push([stem.slice(0,-1)+'y',suffix]);
  if(stem.at(-1)===stem.at(-2))options.push([stem.slice(0,-1),suffix]);
 }
 for(const [base,suffix] of options){if(!dictionary.has(base))continue;let result;
  if(suffix==='s'){
   result=variant(w,base,'第三人称单数现在式','三人称単数現在形');
   const noun=variant(w,base,'复数','複数形','n.');
   result=noun||result;
  }else if(suffix==='ed')result=variant(w,base,'过去式／过去分词','過去形・過去分詞');
  else if(suffix==='ing')result=variant(w,base,'现在分词／动名词','現在分詞・動名詞');
  else result=variant(w,base,suffix==='er'?'比较级':'最高级',suffix==='er'?'比較級':'最上級','adj.');
  if(result)return result;
 }
 return null;
}
const invalid={unpay:['不作为本题“免付费用的”标准形容词；应为 unpaid','この問題の「未払いの」を表す標準的な形容詞ではなく、unpaid を用います'],unpaying:['非本题所需的标准形容词；不能表示费用已豁免','この問題で料金が免除されていることを表す形容詞としては使えません'],'would putting':['would 后误接 putting；应接原形 put','would の後に putting は置けず、原形 put を置きます'],'would taking':['would 后误接 taking；应接原形 take','would の後に taking は置けず、原形 take を置きます'],'would fallen':['would 后误接 fallen；应接原形 fall','would の後に fallen は置けず、原形 fall を置きます'],'did we realized':['did 已表示过去，后面的 realized 应还原为 realize','did が過去を示すため、後ろは realized ではなく原形 realize です'],'is arrive':['be 动词后不能直接接原形 arrive 构成谓语','be 動詞の後に原形 arrive を置いて述語にはできません'],'is risen':['本句 rise 表“上升”，应用完成时 has risen 而非 is risen','この文では rise は「上昇する」を表し、is risen ではなく has risen を用います']};
for(const [word,[zh,ja]]of Object.entries(invalid))dictionary.set(word,{pos:'非本题所需的规范语法形式',zh,ja,lexemes:[]});
const phraseManual={
 'signing off':['动词短语 · 现在分词／动名词','签字批准；结束通讯','署名して承認する；通信を終える'],
 'stay away':['动词短语 · 原形','远离；不前往','近づかない；欠席する'],'staying away':['动词短语 · 现在分词／动名词','远离；不前往','近づかないこと；欠席すること'],'stayed away':['动词短语 · 过去式','没有靠近；未出席','近づかなかった；欠席した'],
 'to stay away':['不定式短语','远离；不前往','近づかないこと；欠席すること'],
 'we realized':['主语＋一般过去时谓语','我们意识到','私たちは気づいた'],'did we realize':['主谓倒装 · 一般过去时','我们才意识到；我们意识到了吗','私たちは初めて気づいた；私たちは気づいたのか'],'we had realized':['主语＋过去完成时谓语','我们此前已经意识到','私たちはそれ以前に気づいていた'],
 'should have':['情态动词＋助动词','本应；后接过去分词表示过去本应完成','〜すべきだった；後ろに過去分詞を置く'],
 'the one':['代词短语','那一个；所指的单个事物','そのもの；指している一つのもの'],'that of':['指示代词＋介词','……的那个；替代前面的单数名词','〜のもの；前の単数名詞を受ける'],
 'too few':['数量短语 · 接可数名词复数','太少的','数が少なすぎる'],'too many':['数量短语 · 接可数名词复数','太多的','数が多すぎる'],'too little':['数量短语 · 接不可数名词','太少的量','量が少なすぎる'],
 'as light':['比较结构的一部分','同样轻；需与后面的 as 配合','同じくらい軽い；後ろの as と組み合わせる'],'as small':['比较结构的一部分','同样小；需与后面的 as 配合','同じくらい小さい；後ろの as と組み合わせる'],'as low':['比较结构的一部分','同样低；需与后面的 as 配合','同じくらい低い；後ろの as と組み合わせる'],'as short':['比较结构的一部分','同样短；需与后面的 as 配合','同じくらい短い；後ろの as と組み合わせる'],
 'more useful':['形容词比较级短语','更有用的','より役立つ'],'most useful':['形容词最高级短语','最有用的','最も役立つ'],'more shortly':['副词比较形式','更简短地；不是 shorter 的形容词用法','より短く；形容詞 shorter の用法ではない'],
 'to enrolling':['to＋动名词','参加报名；介词 to 后可以接 enrolling，不定式 to 后不可以','登録すること；前置詞 to の後なら enrolling を置けるが、不定詞の to の後には置けない'],
 'to applying':['to＋动名词','申请；应用；涂抹；介词 to 后可以接 applying，不定式 to 后不可以','申請すること；適用すること；塗ること；前置詞 to の後なら applying を置けるが、不定詞の to の後には置けない'],
 'to trying':['to＋动名词','尝试；介词 to 后可以接 trying，不定式 to 后不可以','試みること；前置詞 to の後なら trying を置けるが、不定詞の to の後には置けない']
};
for(const [word,[pos,zh,ja]]of Object.entries(phraseManual))if(!dictionary.has(word))dictionary.set(word,{pos,zh,ja,lexemes:[{id:optionLexemeId(word),word,pos,zh,ja}]});
// These choices test the grammar around prepositional/infinitive "to". Keep
// that explanation on the option, but collect the underlying verb as a word.
for(const [phrase,base] of [['to applying','apply'],['to enrolling','enroll'],['to trying','try']]){
 const verbs=dictionary.get(base)?.lexemes.filter(item=>/\bv\./.test(item.pos));
 if(!verbs?.length)throw Error('Missing underlying verb for '+phrase);
 dictionary.get(phrase).lexemes=verbs;
}
function verbPhrase(word){
 const w=norm(word);if(dictionary.has(w))return dictionary.get(w);
 const tokens=w.split(' ');if(tokens.length<2)return derived(w);
 let baseText=tokens.at(-1);let end=derived(baseText);if(!end||!end.lexemes.some(x=>/\bv\.|助动词/.test(x.pos)))end=derived(baseText,true);if(!end)return null;
 const lexemes=end.lexemes.filter(x=>/\bv\.|助动词/.test(x.pos));if(!lexemes.length)return null;
 const prefix=tokens.slice(0,-1).join(' ');let form;
 if(prefix==='to')form=['不定式','不定詞'];
 else if(/^(?:has|have)$/.test(prefix))form=['现在完成时','現在完了形'];
 else if(prefix==='had')form=['过去完成时','過去完了形'];
 else if(prefix==='will have')form=['将来完成时','未来完了形'];
 else if(prefix==='would have')form=['过去假设的完成形式','過去に関する仮定の完了形'];
 else if(prefix==='will')form=['一般将来时','未来を表す形'];
 else if(prefix==='would')form=['假设语气 would＋原形','仮定を表す would＋原形'];
 else if(/^(?:am|is|are|was|were)(?: being)?$/.test(prefix)){
  const past=/^(was|were)/.test(prefix);const progressive=baseText.endsWith('ing');
  form=[(past?'过去':'现在')+(progressive?'进行时':prefix.endsWith('being')?'进行时被动语态':'被动语态'),(past?'過去':'現在')+(progressive?'進行形':prefix.endsWith('being')?'進行形の受動態':'受動態')];
 }else if(/^(?:has|have|had) been$/.test(prefix))form=[prefix.startsWith('had')?'过去完成进行时':'现在完成进行时',prefix.startsWith('had')?'過去完了進行形':'現在完了進行形'];
 if(!form)return null;
 const result={pos:`动词短语（${form[0]}）`,zh:`${compact(lexemes,'zh')}（${form[0]}）`,ja:`${compact(lexemes,'ja')}（${form[1]}）`,lexemes};dictionary.set(w,result);return result;
}
const banks=['part1','part2','grammar','listening','reading'];const records=Object.fromEntries(banks.map(b=>[b,read(`data/${b}.json`)]));
const questions=banks.flatMap(bank=>records[bank].flatMap(row=>row.questions?row.questions.map(q=>({bank,q,group:row})):[{bank,q:row,group:null}]));
const lexicalWords=new Set(vocab.flatMap(w=>[w.word,...w.clozeDistractors,...(w.confusables||[])]));
for(const {bank,q,group}of questions)if(bank==='grammar'||bank==='reading'&&group.part===6&&q.kind!=='sentence')q.options.forEach(x=>lexicalWords.add(x));
const missing=[];for(const word of lexicalWords)if(!verbPhrase(word))missing.push(word);
// A lexicalized adjective may also be a participle in a grammar sentence.
// Preserve its adjective sense while adding the independently verified verb base.
for(const {bank,q,group}of questions)if(bank==='grammar'||bank==='reading'&&group.part===6&&q.kind!=='sentence')for(const text of q.options)if(/^[a-z]+(?:ed|ing|s)$/.test(text)&&dictionary.has(norm(text))&&!dictionary.get(norm(text)).lexemes.some(x=>/\bv\./.test(x.pos)))derived(text,true);
fs.mkdirSync('/private/tmp/isle-options',{recursive:true});
const missingOutput=process.env.OPTIONS_MISSING||'/private/tmp/isle-options/missing.json';fs.writeFileSync(missingOutput,JSON.stringify(missing,null,2)+'\n');
if(missing.length){const output=missingOutput;console.log(`Missing ${missing.length} dictionary surfaces; see ${output}`);if(!process.argv.includes('--inspect'))process.exit(1);}
if(process.argv.includes('--inspect')){fs.writeFileSync('/private/tmp/isle-options/lexicon-preview.json',JSON.stringify(Object.fromEntries(dictionary),null,2));console.log(`Prepared ${dictionary.size} dictionary surfaces. No runtime files written.`);process.exit(0);}
// Runtime generation follows only after exact dictionary coverage has passed.
const outputDir=path.join(root,'data/options');
const write=(name,value)=>fs.writeFileSync(path.join(outputDir,name+'.json'),JSON.stringify(value,null,2)+'\n');
const overrides=fs.existsSync(path.join(outputDir,'authoring/reasons-static.json'))?read('data/options/authoring/reasons-static.json'):{};
const actionStarts=new Set('continue stand contact call return book wait respond visit pay reserve measure ask count postpone hire submit report repair buy join give get collect purchase skip pick wear adjust select clear replace choose compare find retain calibrate print describe show name move erase leave send stop watch convert scan approve promise change remove borrow meet write trim demonstrate keep treat hand photograph cancel tell fill set wash refill use replenish go check put deliver split sign retest exclude complete advertise fasten obstruct investigate recognize correct'.split(' '));
const finiteWords=new Set('is are was were has have had will would can could must should may might'.split(' '));
const shortPOS={promises:'v.（第三人称单数）',obstructs:'v.（第三人称单数）',investigates:'v.（第三人称单数）',recognizes:'v.（第三人称单数）',corrects:'v.（第三人称单数）',will:'情态动词',should:'情态动词',could:'情态动词',upstairs:'adv.（在楼上）',east:'n.（方位）',west:'n.（方位）',north:'n.（方位）',south:'n.（方位）',plus:'专有名称（方案名）',basic:'专有名称（方案名）',plain:'专有名称（服务名）',rush:'专有名称（服务名）',amber:'n.; adj.（颜色）',gray:'n.; adj.（颜色）',blue:'n.; adj.（颜色）',rose:'n.; adj.（颜色）',leaf:'n.',snow:'n.',sun:'n.',gloves:'n.（复数）',notebooks:'n.（复数）',exhibitors:'n.（复数）',green:'n.; adj.（颜色）',white:'n.; adj.（颜色）',yellow:'n.; adj.（颜色）',red:'n.; adj.（颜色）',purple:'n.; adj.（颜色）',orange:'n.; adj.（颜色）',black:'n.; adj.（颜色）',mila:'专有名词（人名）',find:'v.',complete:'v.',lost:'v.（过去式／过去分词）',unobstructed:'adj.',unclouded:'adj.',unmistakable:'adj.',ingredients:'n.（复数）'};
function phraseType(text){
 const t=text.trim(),lower=norm(t),tokens=lower.split(/\s+/),first=tokens[0];
 if(/^\[\d+\]$/.test(t))return{kind:'position'};
 if(/^[A-Z](?:\d+)?$/.test(t))return{kind:'phrase',pos:'编号／图表标签'};
 if(/^(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|sixteen|twenty|twenty-four)$/i.test(t))return{kind:'word',pos:'数词'};
 if(/^[A-Za-z'-]+$/.test(t)){
  const pos=shortPOS[lower]||verbPhrase(lower)?.pos;if(!pos)throw Error('Unclassified single option '+t);
  return{kind:'word',pos};
 }
 if(/^(?:To\s+[a-z]|In order to\b)/.test(t))return{kind:'phrase',pos:'不定式短语'};
 if(/^As soon as\b/i.test(t))return{kind:'phrase',pos:'时间从句'};
 if(/^(?:Who|What|Which|Whichever|Whether|How|When|Where|Why|Once|While)\b/i.test(t))return{kind:'phrase',pos:/^(?:When|Once)\b/i.test(t)?'时间从句／间接疑问从句':'名词性从句／间接疑问结构'};
 if(/(?:hours?|minutes?)\s+(?:earlier|later|before|after)$/i.test(t)||/^(?:Still there|Away from)\b/i.test(t))return{kind:'phrase',pos:'副词短语'};
 if(/^(?:At|In|On|By|Near|Beside|Behind|Beneath|Inside|Outside|Under|Above|Across|From|For|With|Without|Before|After|During|Between|Through|Until|Within|About|Around|Over|As of)\b/i.test(t))return{kind:'phrase',pos:'介词短语'};
 if(/^(?:\d|\$)/.test(t)&&!/[.!?]$/.test(t))return{kind:'phrase',pos:'数字／数量短语'};
 if(/[.!?]$/.test(t)||/^Repair equipment will\b/.test(t))return{kind:'sentence'};
 if(['Name badges','Clear skies only'].includes(t))return{kind:'phrase',pos:'名词短语'};
 if(actionStarts.has(first)||/^(?:Count|Write|Put|Pay|Pick|Hand|Tell|Set|Go|Check|Send)\b/.test(t))return{kind:'phrase',pos:'动词短语'};
 if(/^(?:Suspended|Issued|Added)\b/.test(t))return{kind:'phrase',pos:'动词短语（过去式）'};
 if(/^(?:Able to|Late,|Level with|Still negotiable|Wrongly numbered|Just delivered|Already (?:claimed|covered)|(?:Deducted|Required|Charged|Paid|Billed|Kept|Fastened|Covered)\b|Occupied already)/i.test(t))return{kind:'phrase',pos:'形容词／分词短语'};
 if(/[.!?]$/.test(t))return{kind:'sentence'};
 const relative=tokens.findIndex(x=>['who','which','that','whose'].includes(x));
 const finite=tokens.some((word,i)=>i>(/^(?:a|an|the|her|his|its|their|our|your|my)$/.test(first)?1:0)&&(relative<0||i<relative)&&finiteWords.has(word))||/^(?:Suppliers charge|Her payment appeared|Its members lack|The posters still need|The display height needs)\b/.test(t);
 if(finite)return{kind:'sentence'};
 if(/^[A-Za-z]+ing\b/.test(t))return{kind:'phrase',pos:'动名词短语'};
 return{kind:'phrase',pos:'名词短语'};
}
function materialContext(bank,q,group){
 if(bank==='part1')return q.answer;
 if(bank==='part2')return q.audio;
 if(bank==='grammar')return q.prompt.replace(/_{3,}/g,q.answer);
 if(bank==='listening')return group.turns.map(x=>`${x.speaker}: ${x.text}`).join('\n');
 let text=group.documents.map(d=>[d.title,d.text,d.table?JSON.stringify(d.table):''].filter(Boolean).join('\n')).join('\n\n');
 if(group.part===6){if(q.kind==='sentence')return q.answer;const slot=q.prompt.match(/\[\d+\]/)?.[0];if(slot)text=text.replace(slot,q.answer);}
 return text;
}
const translations=Object.fromEntries(banks.map(bank=>[bank,{zh:read(`data/i18n/zh/${bank}.json`).entries,ja:read(`data/i18n/ja/${bank}.json`).entries,units:sourceUnits(bank,records[bank])}]));
function translatedOption(bank,q,index){const keys=translations[bank].units.filter(u=>u.id===q.id&&u.option===index).map(u=>u.key);return{keys,zh:keys.map(k=>translations[bank].zh[k]).join('')};}
function insertionContext(group,marker){const text=group.documents.map(d=>d.text).join('\n');const i=text.indexOf(marker);if(i<0)return'';const clean=s=>s.replace(/\[\d+\]/g,'').trim();const before=clean(text.slice(0,i));const after=clean(text.slice(i+marker.length));const previous=before.match(/[^.!?]+[.!?]$/)?.[0].trim()||before;const next=after.match(/^[^.!?]+[.!?]/)?.[0].trim()||after;return `该位置前一句是“${previous}”，后一句是“${next}”。`;}
function explanation(bank,q,group,text,meaning,correct){
 const specific=q.zh?.trim();if(!specific)throw Error('Missing original explanation '+q.id);
 if(bank==='grammar'||bank==='reading'&&group.part===6&&q.kind!=='sentence'){
  const d=dictionary.get(norm(text));
  return `${text} 的形式／词性是${d.pos}，表示“${d.zh}”。${specific}${correct?'这一词义和形式满足空格的要求。':`把这一项放入空格，会将该处表达改成“${d.zh}”${d.pos.includes('非本题')?'，并产生上述形式错误':''}；它不能实现上面明确的结构或逻辑关系。`}`;
 }
 if(bank==='part1')return `这一项描述“${meaning}”。图中实际可见：${specific}${correct?'动作、人物与物体的位置均与此一致。':'该选项增加或改变了画面中的动作、物体或位置，因此不能用来描述这张图。'}`;
 if(bank==='part2'){
  if(q.skill==='first-word'||/第一个词|听清开头/.test(q.prompt||'')){
   const first=q.audio.trim().match(/^[A-Za-z']+/)?.[0];return `音频开头是“${first}”。${text} 表示“${meaning}”。${specific}${correct?'选项保留了实际听到的句首词。':`这项的拼写及发音对应 ${text}，并不是音频中的 ${first}。`}`;
  }
  const sourceZh=translations[bank].units.filter(u=>u.id===q.id&&u.key.includes('/audio/')).map(u=>translations[bank].zh[u.key]).join('');
  return `听到的是“${sourceZh}”；这一回答表示“${meaning}”。${specific}${correct?'回答提供了所问的信息或可接受的间接回应。':'这句话虽然本身可以成立，但它提供的信息与上述问题需要的回应不同。'}`;
 }
 if(/^\[\d+\]$/.test(text))return `${insertionContext(group,text)}${specific}${correct?'此处的前后文能接住所插句的指代与信息顺序。':'此处的前后文无法建立原解析指出的那一组指代与承接关系。'}`;
 if(/\b(?:NOT|EXCEPT)\b/.test(q.prompt))return `题目要求找出“未提及／不成立／不符合要求”的一项。这一项表达“${meaning}”。${specific}${correct?'它对应题目要找的缺失信息或例外。':'它属于材料中有依据或符合所述要求的内容，不能作为本题的例外项。'}`;
 const evidence=typeof q.evidence==='string'&&q.evidence.trim()?`原文依据是“${q.evidence}”。`:'';
 return `这一项表达“${meaning}”。${evidence}${specific}${correct?'该选项将这一依据换一种说法表达出来。':'这一选项的具体内容与上述依据所支持的结论不同；不能把材料中别的人、时间、地点或行动替换为这一说法。'}`;
}
for(const bank of banks){const entries={};for(const {q,group}of questions.filter(x=>x.bank===bank)){
 const ref={id:q.id,mode:bank==='listening'?'dialogue':bank};const full={...q,...(group?{set:group}:{})};
 entries[q.id]={signature:optionSourceSignature(ref,full),context:materialContext(bank,q,group),options:q.options.map((text,i)=>{
  let lexical=bank==='grammar'||bank==='reading'&&group.part===6&&q.kind!=='sentence';
  const {keys,zh}=translatedOption(bank,q,i);const kind=lexical?{kind:text.includes(' ')?'phrase':'word'}:phraseType(text);
  if(!lexical&&['word','phrase'].includes(kind.kind)&&dictionary.has(norm(text))&&!/编号|专有名称|人名|颜色|数词/.test(kind.pos||''))lexical=true;
  const d=lexical?dictionary.get(norm(text)):null;const meaning=d?.zh||zh;
  if(kind.kind!=='position'&&!meaning)throw Error('Option translation missing '+q.id+' '+text);
  const reasonZh=overrides[q.id]?.[text]||explanation(bank,q,group,text,meaning,text===q.answer);
  return{text,...kind,reasonZh,...(lexical?{lexical:norm(text)}:kind.kind==='position'?{}:{translationKeys:keys})};
 })};
 }write(bank,{version:1,entries});}
const clozeOverrides=fs.existsSync(path.join(outputDir,'authoring/reasons-vocab.json'))?read('data/options/authoring/reasons-vocab.json'):{};
write('vocab',{version:1,entries:Object.fromEntries(vocab.map(w=>[w.id,{signature:optionSourceSignature({id:w.id,mode:'vocab'},w),reasons:Object.fromEntries([w.word,...w.clozeDistractors].map(text=>{
 const d=dictionary.get(norm(text));
 const context=Object.entries(vocabChinese).filter(([key])=>key.startsWith(w.id+'/example/')).map(([,value])=>value).join('');if(!context)throw Error('Missing translated vocabulary context '+w.id);
 const role=/adv\./.test(w.pos)?'动作发生的方式、时间或程度':/adj\./.test(w.pos)?'所述对象的性质或状态':/\bv\./.test(w.pos)?'句中发生的动作':'句中所指的人、物或概念';
 const reason=clozeOverrides[w.id]?.[text]||(text===w.word?`本句的情境是“${context}”。空格表达${role}，${w.word} 的“${w.zh}”义${w.sense?`（${w.sense}）`:''}与该情境相符。`:`${text} 是${d.pos}，表示“${d.zh}”。本句的情境是“${context}”；这里${role}要表达“${w.zh}”${w.sense?`（${w.sense}）`:''}，并非 ${text} 所指的“${d.zh}”。`);
 return[text,reason];}))}]))});
const shards=Object.fromEntries([...Array.from({length:26},(_,i)=>String.fromCharCode(97+i)),'other'].map(k=>[k,{}]));
for(const [word,value]of [...dictionary].sort(([a],[b])=>a.localeCompare(b,'en')))shards[optionLexiconBucket(word)][word]=value;
for(const [bucket,entries]of Object.entries(shards))write('lexicon/'+bucket,{version:1,entries});
console.log(`Generated ${questions.length} static questions, ${questions.reduce((n,x)=>n+x.q.options.length,0)} static option reasons, ${vocab.length} cloze cards and ${dictionary.size} dictionary surfaces.`);
