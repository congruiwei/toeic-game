import { hush, speak } from './audio.js';
import { speakJapanese } from './japanese-audio.js';
let active;
function clear() {
  if(!active)return;
  active.button.setAttribute('aria-pressed','false');active.host?.classList.remove('is-reading');active=null;
}
export function stopReadAloud(){if(active){clear();hush();}}
export function mountReadAloud(scope,{allowed=true,prefs,notify}={}) {
  const hosts=[...(scope.matches?.('[data-read-text]')?[scope]:[]),...scope.querySelectorAll('[data-read-text]')];
  for(const host of hosts){
    if((typeof allowed==='function'?!allowed(host):!allowed)||host.closest('button,option,a,[hidden],[aria-hidden="true"],fieldset[disabled]')||host.querySelector('[data-act="read-aloud"]')||!host.dataset.readText?.trim())continue;
    const button=document.createElement('button');button.type='button';button.className='read-aloud';button.dataset.act='read-aloud';button.dataset.text=host.dataset.readText;
    for(const name of ['key','bank','seed','language'])if(host.dataset['read'+name[0].toUpperCase()+name.slice(1)])button.dataset[name]=host.dataset['read'+name[0].toUpperCase()+name.slice(1)];
    button.setAttribute('aria-label','朗读这段文字');button.setAttribute('aria-pressed','false');button.textContent='▶ 朗读';host.append(button);
  }
  // Event routing and authorization belong to the page; this helper never binds a global click handler.
  return hosts.length;
}
export function playReadAloud(button,prefs={},notify=()=>{}) {
  if(!button?.isConnected||button.disabled||button.closest('[hidden],[aria-hidden="true"],fieldset[disabled]'))return false;
  const host=button.closest('[data-read-text]'),text=button.dataset.text||host?.dataset.readText;
  if(!text?.trim())return false;
  const same=active?.button===button;stopReadAloud();if(same)return false;
  // Cancel a different playback before registering this button's cleanup callback.
  hush();active={button,host};button.setAttribute('aria-pressed','true');host?.classList.add('is-reading');
  const key=button.dataset.key||host?.dataset.readKey,bank=button.dataset.bank||host?.dataset.readBank;
  const seed=button.dataset.seed||host?.dataset.readSeed||'',language=button.dataset.language||host?.dataset.readLanguage||'en';
  const done=()=>{if(active?.button===button)clear();},failure=message=>{done();notify(message);};
  const options={key,bank,seed,onEnd:done,onCancel:done};
  const result=language==='ja'?speakJapanese(text,prefs,failure,options):speak([{text,key,bank,speaker:'A'}],prefs,failure,options);
  if(result===false)done();return result;
}
