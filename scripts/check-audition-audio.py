#!/usr/bin/env python3
"""Decode and check every published audition asset; run with the external authoring environment."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json, subprocess, numpy as np
root=Path(__file__).resolve().parents[1]
manifest=json.loads((root/'data/audio-audition-manifest.json').read_text())
assert manifest['complete'] is True
files={r['src']:r for v in manifest['clips'].values() for c in v.values() for r in [c,*c['segments']]}
def check(item):
    rel,record=item; p=root/rel
    assert p.stat().st_size==record['bytes'], rel
    info=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(p)]))
    s=info['streams'][0]
    assert s['codec_name']=='aac' and s['profile']=='LC' and s['channels']==1 and int(s['sample_rate'])==24000, rel
    duration=float(info['format']['duration'])
    assert abs(duration-record['duration'])<.002, rel
    decode=subprocess.run(['ffmpeg','-v','error','-i',str(p),'-ar','96000','-f','f32le','-acodec','pcm_f32le','-'],capture_output=True,check=True)
    assert not decode.stderr, (rel,decode.stderr)
    values=np.frombuffer(decode.stdout,dtype='<f4')
    assert np.isfinite(values).all() and len(values)>9600 and .005<np.max(np.abs(values))<=.951, rel
    return duration, p.stat().st_size, float(np.max(np.abs(values)))
with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(check,files.items()))
print('PASS: decoded all',len(results),'M4A files; AAC-LC / mono / 24000 Hz; exact duration/bytes; no decoder errors, empty or silent waveform; 4x reconstruction peak <= 0.95.')
print(json.dumps({'files':len(results),'bytes':sum(r[1] for r in results),'duration_seconds':round(sum(r[0] for r in results),3),'peak_range':[round(min(r[2] for r in results),4),round(max(r[2] for r in results),4)]},indent=2))
