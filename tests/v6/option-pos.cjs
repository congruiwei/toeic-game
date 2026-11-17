const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');

// Both recordings deliberately belong to noun cards. A verb choice has no
// matching recording and must use system speech, never the same-spelling noun.
module.exports=async({page,act,nav,state,store})=>{
  const cases=[
    {id:'v-redeem',word:'transfer',noun:'v-transfer',lexeme:'lex-86b30500',zh:'调动；转移；转接',ja:'異動させる；移す；転送する'},
    {id:'v-landscape',word:'survey',noun:'v-survey',lexeme:'lex-9db35cc7',zh:'勘测；调查',ja:'測量する；調査する'}
  ];
  const sourceSha256=digest('option-pos noun-only fixture');
  const clips=Object.fromEntries(cases.map(item=>{
    const sha256=digest(item.noun);
    return [item.noun+'/meaning',{text:item.word,language:'en',voiceId:'af_heart',required:true,
      src:`./audio/generated/en/af_heart/${sha256.slice(0,32)}.m4a`,duration:.2,bytes:32,sha256}];
  }));
  const body=JSON.stringify({version:1,bank:'vocab',language:'en',complete:true,sourceSha256,clips});
  const manifest={version:1,model:'option-pos fixture',voices:{en:['af_heart'],ja:[]},complete:true,sourceSha256,
    packs:[{bank:'vocab',language:'en',src:'./data/audio/en/vocab.json',complete:true,count:2,bytes:Buffer.byteLength(body),sha256:digest(body)}]};
  const loaded=[];
  await page.route('**/data/audio/**',async route=>{
    const pathname=new URL(route.request().url()).pathname;loaded.push(pathname);
    if(pathname.endsWith('/data/audio/manifest.json'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(manifest)});
    if(pathname.endsWith('/data/audio/en/vocab.json'))return route.fulfill({status:200,contentType:'application/json',body});
    return route.fulfill({status:404,body:'This fixture provides only the two noun heads.'});
  });
  await page.addInitScript(()=>{
    window.optionPosMedia=[];
    Object.defineProperties(HTMLMediaElement.prototype,{
      load:{configurable:true,value(){}},pause:{configurable:true,value(){}},
      play:{configurable:true,value(){
        if(/\.m4a(?:$|[?#])/.test(this.src))window.optionPosMedia.push(this.src);
        this.dispatchEvent(new Event('playing'));
        setTimeout(()=>this.dispatchEvent(new Event('ended')),0);
        return Promise.resolve();
      }}
    });
  });
  const progress=await state();
  progress.settings.sfx=false;progress.settings.audioGapMs=0;
  progress.personalVocab={version:1,items:[],run:null};
  for(const item of cases)progress.words[item.noun]={box:3,due:Date.now()+86400000,right:7,tries:9};
  progress.session={mode:'vocab',title:'填空义项',items:cases.map(item=>({id:item.id,mode:'vocab',format:'cloze'})),index:0,right:0,gain:0,elapsed:0,selected:null,intro:false,timed:false};
  await store(progress);
  // The common harness intentionally restores system mode; exercise the real UI
  // preference so the app's live state, not just localStorage, uses recordings.
  await act('settings');await page.locator('[data-pref=audioMode]').selectOption('recorded');await act('close');
  assert.equal((await state()).settings.audioMode,'recorded');
  const packed=await page.evaluate(async()=>{
    const audio=await import('./js/recorded-audio.js');await audio.loadAudioPack('vocab');
    return ['v-transfer','v-survey'].map(id=>audio.getAudioClip(id+'/meaning',{bank:'vocab'})?.key);
  });
  assert.deepEqual(packed,['v-transfer/meaning','v-survey/meaning']);
  assert(loaded.some(path=>path.endsWith('/data/audio/en/vocab.json')),'the valid noun-only pack must really load');
  const readyState=await state(),nounProgress=Object.fromEntries(cases.map(item=>[item.noun,readyState.words[item.noun]]));
  async function expectSystemWord(button,word){
    const before=await page.evaluate(()=>({speech:window.played.length,media:window.optionPosMedia.length}));
    await button.click();
    await page.waitForFunction(previous=>window.played.length>previous.speech||window.optionPosMedia.length>previous.media,before);
    const result=await page.evaluate(previous=>({spoken:window.played.slice(previous.speech),media:window.optionPosMedia.slice(previous.media),gesture:window.speechGestures.at(-1)}),before);
    assert.deepEqual(result.media,[],word+' must not play a noun recording for the external verb sense');
    assert.deepEqual(result.spoken,[word],word+' falls back to the actual English word');
    assert.equal(result.gesture.type,'click');assert.equal(result.gesture.trusted,true,'preloaded missing sense falls back within the trusted click');
  }
  await act('resume');
  for(const [index,item]of cases.entries()){
    await page.locator('.lesson-question').waitFor();await act('unknown');await page.locator('.option-details').waitFor();
    const option=page.locator('.option-detail').filter({has:page.locator('summary > span:first-child',{hasText:new RegExp(' · '+item.word+'$')})});
    assert.equal(await option.count(),1);
    assert.equal((await option.locator('.option-pos').textContent()).trim(),'v.');
    assert.equal((await option.locator('p[lang=zh-CN]').textContent()).trim(),item.zh);
    assert.equal((await option.locator('p[lang=ja]').textContent()).trim(),item.ja);
    assert.equal(await option.locator('[data-act=option-word]').count(),0,'the verb must not link to the noun card');
    await expectSystemWord(option.locator('[data-act=option-en]'),item.word);
    await option.locator('[data-act=option-collect]').click();
    const saved=await state(),collected=saved.personalVocab.items.find(card=>card.key==='personal-'+item.lexeme);
    assert(collected);assert.equal(collected.wordId,null);assert.equal(collected.pos,'v.');assert.equal(collected.zh,item.zh);assert.equal(collected.ja,item.ja);
    assert.equal(collected.source.id,item.id);assert.equal(collected.source.option,item.word);
    for(const noun of cases)assert.deepEqual(saved.words[noun.noun],nounProgress[noun.noun],'collection leaves both noun cards untouched');
    if(index<cases.length-1)await act('next');
  }
  await act('leave');await nav('learn');await act('personal-open');await page.locator('.personal-word-list').waitFor();
  for(const item of cases){
    const card=page.locator(`[data-personal-key="personal-${item.lexeme}"]`);
    assert.equal(await card.locator('h2').textContent(),item.word);
    assert.equal((await card.locator('p[lang=zh-CN]').textContent()).trim(),item.zh);
    assert.equal((await card.locator('p[lang=ja]').textContent()).trim(),item.ja);
    await expectSystemWord(card.locator('[data-act=personal-speak][data-language=en]:not([data-field])'),item.word);
  }
  // Self-rating these external senses must also leave canonical noun FSRS and
  // objective-answer totals unchanged.
  await page.locator('[data-act=personal-start][data-direction=en-zh]').click();
  for(const item of cases){
    const current=await state(),run=current.personalVocab.run,card=current.personalVocab.items.find(entry=>entry.key===run.keys[run.index]);
    assert(cases.some(expected=>card.key==='personal-'+expected.lexeme));
    await expectSystemWord(page.locator('[data-act=personal-speak][data-language=en]'),card.word);
    await act('personal-flip');await page.locator('[data-act=personal-rate][data-grade="3"]').click();
  }
  const final=await state();assert.equal(final.personalVocab.items.length,2);assert(final.personalVocab.items.every(item=>item.wordId===null&&item.fsrs.lastRating===3));
  for(const item of cases)assert.deepEqual(final.words[item.noun],nounProgress[item.noun]);
  assert.deepEqual(await page.evaluate(()=>window.optionPosMedia),[],'no same-spelling noun recording was attempted anywhere');
};
