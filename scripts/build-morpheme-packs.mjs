import fs from 'node:fs/promises';
import {morphemeSourceUnits,morphologyAudioUnits} from '../js/word-enrichment.js';
const root=new URL('../',import.meta.url),read=async file=>JSON.parse(await fs.readFile(new URL(file,root),'utf8'));
const data=await read('data/morphemes.json'),vocab=await read('data/vocab.json'),units=morphemeSourceUnits(data);
for(const lang of ['zh','ja'])await fs.writeFile(new URL(`data/i18n/${lang}/morphemes.json`,root),JSON.stringify({version:1,entries:Object.fromEntries(units.map(u=>[u.key,u[lang]]))},null,2)+'\n');
await fs.writeFile(new URL('morphology-audio-units.json',root),JSON.stringify(morphologyAudioUnits(data,vocab),null,2)+'\n');
console.log(JSON.stringify({translationUnits:units.length,audioUnits:morphologyAudioUnits(data,vocab).length}));
