// All artwork uses local SVG paths. Form and affinity alter the creature silhouette.
const sprig=(x,y,s=1,flip=1,color='#94b7a0')=>`<g transform="translate(${x} ${y}) scale(${flip*s} ${s})" stroke="#597a7a" stroke-width="2" stroke-linejoin="round" fill="${color}"><path d="M0 0Q0-20-12-35M-2-8Q-15-7-19-18q13-2 17 10Zm-3-9Q-4-29 3-35q4 13-8 18Zm-4-9q-12-1-14-12 11 0 14 12Z"/></g>`;
const sparkle=(x,y,s,color)=>`<path d="M0-7Q1-1 6 0 1 1 0 7-1 1-6 0-1-1 0-7Z" fill="${color}" transform="translate(${x} ${y}) scale(${s})"/>`;
const FORM=['#ffe4a4','#ffe2a3','#f9dca4','#ffdcaa','#fbd7ac','#ffdf9d'];
export function creature(stage=0,branch='vocab'){
 const ink='#544957',belly=FORM[stage]||FORM[0];
 const leaf=(x,y,a,s,color)=>`<g transform="translate(${x} ${y}) rotate(${a}) scale(${s})"><path d="M0 0C-17-2-31-13-32-26-15-29 0-18 0 0Z" fill="${color}" stroke="${ink}" stroke-width="2.8"/><path d="m-25-21 20 16" stroke="#63877a" stroke-width="1.8"/></g>`;
 const features={listening:'<path d="M-42-2Q-87-53-89-19q2 35 48 45m83-29q39-52 44-19-2 39-46 48" fill="#e5baae"/>',grammar:'<path d="m-46 23-29 28 35-4m82-18 30 19-28 4" fill="#8ac0b4"/>',reading:'<path d="m-41 19-29-13 10 31 20 6m79-24 29-13-9 32-19 7" fill="#d1a4dc"/>',vocab:'<path d="M-39 7q-38-14-39-34 29-1 42 20M37 2q21-34 40-26-5 22-36 37" fill="#a6cba1"/>'};
 return `<g stroke="${ink}" stroke-linejoin="round" stroke-linecap="round" stroke-width="3.2">
 ${stage?features[branch]||features.vocab:''}
 ${stage>=4?'<path d="M-27 40c-52 51-78 0-74-18 18 18 28 13 26-3 18 22 32 14 48 21Z" fill="#ab97d1"/>':''}
 <ellipse cx="-29" cy="57" rx="17" ry="9" transform="rotate(-9 -29 57)" fill="#a58182"/><ellipse cx="27" cy="57" rx="16" ry="9" transform="rotate(8 27 57)" fill="#a58182"/>
 <path d="M-47 4q-17-9-23-1-3 12 23 23m89-33q14-18 22-10 7 9-11 28" fill="${belly}"/>
 <path d="M-52 19c0-22 6-42 19-54 8-8 11-16 20-21 10-6 16 0 24-2 11-2 14 10 20 16C45-28 55-8 55 20c0 29-21 40-52 40-32 0-55-11-55-41Z" fill="${belly}"/>
 <path d="M-45 26q-1 24 42 27 35 0 49-16-9 23-43 22-38 0-48-21Z" fill="#edbe8d" stroke="none"/>
 <path d="M-31-34q6-9 13-13" stroke="#fff3c9" stroke-width="6"/>
 ${leaf(-3,-54,4,1,'#9dc389')}${leaf(-3,-54,91,1.13,'#9fcba3')}
 ${stage>=1?leaf(-1,-59,32,.87,'#afd599'):''}${stage>=2?leaf(0,-62,74,.91,'#77ac97'):''}
 ${stage>=3?'<path d="M-2-66q0-19 9-26" fill="none"/><path d="M8-90q-12-11-2-15 5-9 12 0 10 5 1 11-1 9-11 4Z" fill="#c3afe4"/><circle cx="11" cy="-99" r="3" fill="#ffe4a4" stroke="none"/>':''}
 ${stage>=5?'<path d="m-23-84-8-16 16 6 8-17 7 18 17-5-6 17z" fill="#f7cc78"/>':''}
 <g fill="#584650" stroke="none"><ellipse cx="-21" cy="-3" rx="3.6" ry="5.4"/><ellipse cx="19" cy="-3" rx="3.6" ry="5.4"/></g>
 <g fill="#efae96" stroke="none"><ellipse cx="-32" cy="6" rx="8" ry="4.4"/><ellipse cx="31" cy="6" rx="8" ry="4.4"/></g>
 <path d="M-6 4q3 5 6 1 3 4 6-1" fill="none" stroke-width="2.3"/>
 <path d="M-47 20q48 20 97-4l-1 9Q3 50-46 31Z" fill="#9b8cc4"/><path d="m28 35 3 19 9-5 6 2-7-22Z" fill="#aa9bcc"/><path d="m34 38 3 7" fill="none" stroke="#76638d" stroke-width="2"/>
 </g>`;
}
export function landscape(stage=0,branch='vocab'){
 const stars=[[18,35,.6],[78,71,.4],[128,26,.53],[212,64,.38],[279,26,.65],[339,53,.45],[391,22,.52],[449,44,.37],[476,92,.8],[563,26,.46],[653,49,.62],[720,30,.4],[798,74,.82],[865,38,.5],[878,129,.55],[395,108,.43]];
 return `<svg class="sky" preserveAspectRatio="none" viewBox="0 0 900 310" aria-hidden="true"><defs><linearGradient id="dusk" x2=".25" y2="1"><stop stop-color="#383067"/><stop offset=".54" stop-color="#625292"/><stop offset="1" stop-color="#b397c0"/></linearGradient><linearGradient id="far" x2="0" y2="1"><stop stop-color="#b7a6cd"/><stop offset="1" stop-color="#8c7aaf"/></linearGradient></defs><rect width="900" height="310" fill="url(#dusk)"/>
 ${stars.map(([x,y,s])=>sparkle(x,y,s,'#f5e0bd')).join('')}
 <g fill="#f2ddf6" opacity=".65">${Array.from({length:45},(_,i)=>`<circle cx="${(i*137+35)%900}" cy="${9+(i*71)%178}" r="${i%4===0?1.4:.85}"/>`).join('')}</g>
 <g fill="#c4b2d9" opacity=".45"><path d="M362 95q12-7 26-5 11-14 30-8 9-1 13 6 18 0 24 7Z"/><path d="M773 85q14-5 25-3 8-14 25-11 11-5 18 4 20-1 27 10Z"/></g>
 <path d="M0 207q50-38 111-12 57 10 95-18 50-39 99-16 28 14 45 13 39-4 71-40 42-46 89-19 47 34 85 8t61-22q48-2 92 36 40 26 80-7 41-32 72-26v206H0Z" fill="url(#far)" opacity=".6"/>
 <path d="M0 242q58-36 119-22t118-5q66-25 118-6 48 12 104-25 47-31 92-19 43 11 92 2 68-14 119-10 62 8 138-35v188H0Z" fill="#a392c1"/>
 <path d="M0 280q79-40 134-20 73 26 142-5 80-37 139-21 54 14 116-9 64-24 104-18 53 11 96-1 81-30 169-22v126H0Z" fill="#8272a7"/>
 <g fill="#b8a8c8" opacity=".72"><path d="M367 195q23-9 49-7 17-11 35-5 21-3 38 10Z"/><path d="M683 243q20-7 41-6 15-11 32-7 29-2 47 10Z"/></g></svg>
 <svg class="isle" viewBox="0 0 420 285" role="img" aria-label="一只系着紫围巾的芽团，站在长满花草的浮空岛上">
 <defs><linearGradient id="rock" x1="0" y1="0" x2=".7" y2="1"><stop stop-color="#9284a3"/><stop offset=".65" stop-color="#625b81"/><stop offset="1" stop-color="#514f75"/></linearGradient><linearGradient id="grass" x2="0" y2="1"><stop stop-color="#c9d7af"/><stop offset="1" stop-color="#92b89c"/></linearGradient></defs>
 <path d="M329 32q-4 16 12 21-17 9-26-6-7-14 8-23 6-3 11-1-4 4-5 9Z" fill="#ffe5a9"/>
 ${sparkle(80,73,.85,'#fbe8b4')}${sparkle(277,84,.78,'#ffe9ae')}${sparkle(304,103,.35,'#fff0c8')}${sparkle(119,38,.5,'#fff0c8')}
 <g fill="#817494" stroke="#605976" stroke-width="1.6"><path d="m61 220 13-4 12 6-5 10-9 6-5-8Z"/><path d="m304 230 14-5 11 6-5 10-10 5-6-8Z"/><path d="m135 260 7-3 5 4-5 9Z"/></g>
 <path d="m52 173 22-17 47-6 51-5 55 1 59 3 42 12 28 16-9 18-19 9-18 25-20 3-21 17-21-2-23 18-22-8-19 5-21-15-24-1-23-13-18-1-12-17-21-6Z" fill="url(#rock)" stroke="#574f70" stroke-width="2.5"/>
 <g fill="#aea0ae"><path d="m75 183 23 9 17 30-15-8-11-17Z"/><path d="m122 188 36 8-12 31-8 1 2-22Z"/><path d="m196 194 19 9-13 37-2-18-9-8Z"/><path d="m271 191 23-1-15 27-17 8Z"/><path d="m325 180 22 1-12 16-11 2Z"/></g>
 <g fill="#66607e"><path d="m98 192 15 9 26 5-1 22-11-10-9 3Z"/><path d="m157 197 22-3-7 28 13 18-18-9-12 3Z"/><path d="m213 206 27-8-13 22 8 8-14 15-14 5Z"/><path d="m304 200-13 27 15-7 9-18Z"/></g>
 <path d="m50 172 16-11 29-4 19-9 42-2 24-6 38 1 32 4 31-1 22 7 28 4 26 12-3 11-29 9-13-2-14 7-24-1-14 6-27-1-23 7-21-4-27 2-15-8-23 2-18-10-15 2-16-9-15-1Z" fill="#739d8d" stroke="#58697a" stroke-width="2.3"/>
 <path d="m50 169 17-10 29-5 18-9 42-2 23-5 41 1 31 4 32-1 22 7 26 4 25 12-29 11-22-1-18 7-21-1-21 5-25-1-21 5-26-4-19 2-21-7-20 1-22-8-17 1Z" fill="url(#grass)" stroke="#798e8a" stroke-width="2"/>
 <g fill="#7eab8e"><ellipse cx="201" cy="165" rx="59" ry="8"/><ellipse cx="105" cy="161" rx="15" ry="3"/><ellipse cx="293" cy="158" rx="19" ry="3"/></g>
 ${sprig(98,158,.85,-1)}${sprig(115,153,.98,1,'#aac8b0')}${sprig(293,156,1.02,-1)}${sprig(319,161,.79,-1,'#b1c7a9')}
 <g stroke="#73698a" stroke-width="2" stroke-linejoin="round"><path d="m278 170-7-14 4-16 9 10 2 17Z" fill="#d3bee3"/><path d="m283 170 1-22 8-10 5 18-7 14Z" fill="#b19acb"/><path d="m281 171 10-10 9-3-4 10Z" fill="#d6bfe3"/></g>
 <g class="bob"><g transform="translate(200 110) scale(.88)">${creature(stage,branch)}</g></g>
 <g stroke="#648b7e" stroke-width="2" fill="none"><path d="m106 169-6-12m6 12 1-7m-21-2-3-6m43 23-2-7m1 7 4-5m146 0 3-7m29-10 3-6"/></g>
 ${[[124,161],[85,163],[298,168],[245,178],[133,172]].map(([x,y],i)=>`<g transform="translate(${x} ${y})" fill="${i%2?'#e8c4d7':'#fff0b9'}"><circle cx="0" cy="-3" r="3"/><circle cx="3" cy="0" r="3"/><circle cx="-3" cy="0" r="3"/><circle cy="2" r="3"/><circle r="1.9" fill="#d8ac6d"/></g>`).join('')}
 <g fill="#b9cda2" stroke="#6c9886" stroke-width="1.7"><path d="M119 186q5 14-4 26 0-13-4-14 2 12-3 17 0-18-5-31"/><path d="M297 185q-1 13-9 23l3-16-8 8 2-13"/></g></svg>`;
}
