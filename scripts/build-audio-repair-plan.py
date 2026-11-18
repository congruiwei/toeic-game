#!/usr/bin/env python3
"""Prepare an external, reviewable plan from completed strong ASR; no synthesis."""
import argparse,hashlib,json,re,unicodedata
from pathlib import Path
from japanese_repair_readings import japanese_reading_override

sha=lambda value:hashlib.sha256(value).hexdigest()
FOCUS={
 'en:part2:p2-037/audio/0':('hˌuəl','hˈu wɪl','Who will take minutes if Dana is presenting?','Expand Who’ll only in spoken input; preserve the displayed question and the remaining phones'),
 'en:part1:p1-004/options/1/0':('kæn tˈɔɹd','kˈæn təwˈɔɹd',None,'Stress noun can and use the valid two-syllable toward reading to make their word boundary clearer'),
 'en:listening:p3-g11-q2/options/2/0':('hæz','hˈæz',None,'Stress has explicitly to clarify its contrast with is'),
 'en:listening:p3-g14/turns/1/1':('hæz','hˈæz',None,'Stress has explicitly to clarify its contrast with is'),
 'en:listening:p4-g13-q1/options/2/0':('hæz','hˈæz',None,'Stress has explicitly to clarify its contrast with is'),
}

def terminal_word_phonemes(unit,current,base_override=None,first_ids=()):
 """Add only a prosodic stop to eligible uncued isolated-word phones."""
 if unit.get('language')!='en' or unit.get('nonSpoken') or unit.get('required') is not True:return None
 if (base_override or {}).get('phonemes'):return None
 text=unit.get('text','').strip();key=unit.get('key','');bank=unit.get('bank')
 letter=bank=='labels' and bool(re.fullmatch(r'labels/(af_heart|am_puck|af_bella)/[A-D]',key) and re.fullmatch(r'[A-D]\.',text))
 word=bool(re.fullmatch(r"[^\W\d_]+(?:['’\-][^\W\d_]+)*",text,flags=re.UNICODE)) and len(text)<=40
 head=bank=='vocab' and bool(re.fullmatch(r'v-[^/]+/meaning',key))
 first=bank=='part2' and unit.get('group') in first_ids and '/options/' in key
 if not (letter or (word and (head or first))):return None
 if not current.strip() or unicodedata.category(current.rstrip()[-1]).startswith('P'):return None
 return current.rstrip()+'.'

def main():
 p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,default=Path.cwd());p.add_argument('--workdir',type=Path,default=Path.home()/'.local/share/toeic-kokoro');p.add_argument('--output',type=Path,required=True);p.add_argument('--language',choices=['en','ja']);args=p.parse_args()
 root=args.repo.resolve();out=root/'data/audio';work=args.workdir.resolve();target=args.output.resolve()
 if target==root or root in target.parents:raise ValueError('Keep the plan outside the checkout; applied proposals are retained in the public ledger')
 source_bytes=(out/'source.json').read_bytes();source=json.loads(source_bytes);quality=json.loads((out/'quality-review.json').read_text())
 if not quality.get('stages',{}).get('strongerASR',{}).get('complete'):raise ValueError('Complete and publish the stronger-ASR stage first')
 units={f"{u['language']}:{u['bank']}:{u['key']}":u for u in source['units']};overrides=json.loads((out/'overrides.json').read_text())['entries'];audits={};packs={}
 first_ids={q['id'] for q in json.loads((root/'data/part2.json').read_text()) if q.get('type')=='first'}
 rows=[];wanted=set()
 for token,row in quality['records'].items():
  if args.language and row['language']!=args.language:continue
  if row.get('repair',{}).get('complete'):continue
  pair=(row['language'],row['bank'])
  if pair not in packs:
   packs[pair]=json.loads((out/pair[0]/(pair[1]+'.json')).read_text());audits[pair]=json.loads((out/'audit'/pair[0]/(pair[1]+'.json')).read_text())
  clip=packs[pair]['clips'].get(row['key']);record=audits[pair]['records'].get(row['key'])
  if not clip or record.get('status')!='review':continue
  if record.get('recognitionGeneration',{}).get('model')!='whisper-large-v3-turbo' or record['sha256']!=clip['sha256']:raise ValueError('Stale strong ASR: '+token)
  if clip['language']=='en':wanted.add(clip['phonemeSha256'])
  rows.append((token,units[token],clip,record))
 phones={}
 for path in (work/'tmp/bank-audio').glob('*.json'):
  if wanted<=phones.keys():break
  value=json.loads(path.read_text());text=value.get('phonemes','');digest=sha(text.encode())
  if digest in wanted:phones[digest]=text
 missing=wanted-phones.keys()
 if missing:raise ValueError('Missing exact cached English phone evidence: '+str(len(missing)))
 entries=[];focused=[]
 for token,u,clip,record in rows:
  if u['language']=='ja':
   override={'speed':.94};method='Regenerate the same Japanese text and reviewed input at synthesis pace 0.94; retain system speech if strong ASR remains inconsistent'
   reading=japanese_reading_override(u,clip,overrides.get(token))
   if reading:
    override['spoken']=reading['spoken']
    method=reading['reason']+'; synthesis pace 0.94 and a new strong-ASR check; retain system speech if unresolved'
  else:
   current=phones[clip['phonemeSha256']];override={'spoken':clip['spoken'],'phonemes':current,'speed':.88}
   method='Keep the attested phoneme input and synthesize at pace 0.88 for clearer articulation; recheck the changed media with strong ASR'
   terminal=terminal_word_phonemes(u,current,overrides.get(token),first_ids)
   if terminal:
    override['phonemes']=terminal
    method='Preserve the isolated word phones and add only a terminal period for closure prosody; synthesis pace 0.88 and a new strong-ASR check'
   if token in FOCUS:
    before,after,spoken,reason=FOCUS[token]
    if current.count(before)!=1:raise ValueError('Focused phone fragment changed: '+token)
    override['phonemes']=current.replace(before,after)
    if spoken:override['spoken']=spoken
    method=reason+'; synthesis pace 0.88 and a new strong-ASR check';focused.append(token)
  if abs(float(overrides.get(token,{}).get('speed',1))-override['speed'])<.00001:raise ValueError('Pace already tried as selected input; review plan manually: '+token)
  entries.append({'token':token,'sourceText':u['text'],'beforeSha256':clip['sha256'],'beforePhonemeSha256':clip['phonemeSha256'],'method':method,'override':override})
 target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps({'version':1,'sourceSha256':sha(source_bytes),'entries':entries},ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'planned':len(entries),'en':sum(e['token'].startswith('en:') for e in entries),'ja':sum(e['token'].startswith('ja:') for e in entries),'focused':focused},ensure_ascii=False))

if __name__=='__main__':main()
