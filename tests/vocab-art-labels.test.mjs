import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
const sibling=new URL('./validate-vocab-art.mjs',import.meta.url);
const validator=existsSync(sibling)?sibling:new URL('../scripts/validate-vocab-art.mjs',import.meta.url);
async function fixture(labels,kind='B'){
 const root=await mkdtemp(join(tmpdir(),'vocab-art-labels-'));
 try{
  for(const dir of ['scripts','assets/vocab','data'])await mkdir(join(root,dir),{recursive:true});
  await copyFile(validator,join(root,'scripts/validate-vocab-art.mjs'));
  const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 144"><title>图意说明不算可见标签</title><desc>描述中的数字 1 2 3 4 不计数</desc><style>@media(prefers-color-scheme:dark){text{fill:white}}</style>'+labels+'</svg>';
  await writeFile(join(root,'assets/vocab/v-label-test.svg'),svg);
  await writeFile(join(root,'data/vocab.json'),JSON.stringify([{id:'v-label-test'}]));
  await writeFile(join(root,'data/confusables.json'),JSON.stringify({questions:[]}));
  await writeFile(join(root,'data/vocab-art.json'),JSON.stringify({version:1,aliases:{},entries:{'v-label-test':{class:kind,alt:'几何图与短标签',rev:createHash('sha256').update(svg).digest('hex').slice(0,12)}}}));
  return spawnSync(process.execPath,[join(root,'scripts/validate-vocab-art.mjs')],{encoding:'utf8'});
 }finally{await rm(root,{recursive:true,force:true});}
}
test('B illustrations allow zero through three labels, ignoring metadata and blank text',async()=>{
 for(let count=0;count<=3;count++){
  const result=await fixture('<text> \n </text><text>&#32;</text><text>&#x20;</text>'+Array.from({length:count},(_,i)=>'<text>'+i+'</text>').join(''));
  assert.equal(result.status,0,result.stderr);
 }
});
test('a fourth visible label is rejected even when it is only a numeral or symbol',async()=>{
 for(const fourth of ['100','=']){
  const result=await fixture('<text>成本</text><text>收益</text><text>利润</text><text>'+fourth+'</text>');
  assert.notEqual(result.status,0);assert.match(result.stderr,/exceeds 3 nonempty text labels/);
 }
});
