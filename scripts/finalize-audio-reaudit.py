#!/usr/bin/env python3
"""Finalize the stronger-ASR stage without inference or changing any recording.

Pass --repo when running outside a checkout. Preview is the
only default; --apply snapshots fully validated actual evidence and refreshes
existing pack/index statuses. All validation finishes before public writes.
"""
import argparse
import copy
import fcntl
import hashlib
import importlib.util
import json
import math
import os
import tempfile
from pathlib import Path

MODEL = 'whisper-large-v3-turbo'
MODEL_SHA = 'e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da'
RULE_VERSION = 'strict-audio-equivalence-1'
DEFAULT_WORK = Path.home() / '.local/share/toeic-kokoro'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    return json.loads(path.read_text(encoding='utf8'))


def atomic_exact(path, value):
    """Write exact existing evidence fields; do not sanitize/transform history."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf8', dir=path.parent,
                                     prefix=path.name+'.', suffix='.tmp', delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
            stream.flush()
            os.fsync(stream.fileno())
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)


def module(root, name, filename):
    spec = importlib.util.spec_from_file_location(name, root / 'scripts' / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def require(condition, message):
    if not condition:
        raise ValueError(message)


def counts(rows):
    return {language: sum(row['language'] == language for row in rows) for language in ('en', 'ja')}


def bound_comparison(evidence, clip, record, code_hashes, *, current=False, override=False):
    """The step-one proof remains historical; current proof must use current code."""
    result = record.get('comparison')
    require(isinstance(result, dict) and evidence.valid_comparison(clip, record),
            'Missing or invalid comparison proof')
    require(result.get('ruleVersion') == RULE_VERSION, 'Unexpected comparison rule version')
    if current:
        provenance = result['provenance']
        require(all(provenance.get(name) == digest for name, digest in code_hashes.items()),
                'Stale comparison code binding')
        require(provenance.get('phonemeOverride') is override, 'Stale phoneme-override proof binding')


def actual_segments(record):
    segments = record.get('segments')
    require(isinstance(segments, list) and segments, 'Missing actual recognition segments')
    for segment in segments:
        require(isinstance(segment, dict) and isinstance(segment.get('text'), str), 'Invalid recognition segment')
        for field in ('start', 'end'):
            value = segment.get(field)
            require(type(value) in (float, int) and math.isfinite(value) and value >= 0,
                    'Invalid recognition segment time')
        require(segment['end'] >= segment['start'], 'Invalid recognition segment interval')
    transcript = ' '.join(segment['text'].strip() for segment in segments).strip()
    require(transcript and transcript == record['recognized'], 'Transcript does not match executed segment evidence')


def validate_strong(record, clip, key, language, work, model, evidence, code_hashes, override, *, verify_current_code=True):
    require(evidence.valid_asr(clip, record), 'Missing valid current actual ASR')
    require(record.get('key') == key and record.get('src') == clip['src'] and
            record.get('voiceId') == clip['voiceId'], 'Actual ASR key/source/voice differs')
    identity = record['recognitionGeneration']
    require(identity.get('model') == model and identity.get('modelSha256') == MODEL_SHA,
            'Wrong stronger ASR model identity')
    require(record.get('recognitionMethod') == 'individual-beam5' and
            record.get('singleFileVerification') is True and identity.get('beamSize') == 5,
            'Strong ASR must be actual individual beam 5')
    # The author currently omits hotwords/initialPrompt from its identity but
    # calls transcribe with both explicitly None. Reject supplied conditioning;
    # do not invent those fields in the preserved actual record.
    require(all(identity.get(field) is None for field in ('hotwords', 'initialPrompt', 'initial_prompt')) and
            all(record.get(field) is None for field in ('prompt', 'hotwords', 'initialPrompt', 'initial_prompt')),
            'Prompt or hotword conditioning is not allowed')
    require(record.get('status') in ('matched', 'review'), 'Unexpected strong ASR classification')
    require(not record.get('error'), 'Actual ASR error cannot be finalized')
    bound_comparison(evidence, clip, record, code_hashes, current=verify_current_code, override=override)
    require(record['comparison']['provenance'].get('phonemeOverride') is override,
            'Stale phoneme-override proof binding')
    actual_segments(record)
    fingerprint = sha(json.dumps([identity, clip['sha256'], language], sort_keys=True).encode())
    require(record.get('fingerprint') == fingerprint, 'Actual ASR fingerprint differs')
    cache = read(work / 'tmp/bank-asr' / (fingerprint + '.json'))
    require(cache.get('generation') == identity and cache.get('sha256') == clip['sha256'] and
            cache.get('method') in (None, 'individual-beam5') and
            cache.get('recognized') == record['recognized'] and cache.get('segments') == record['segments'] and
            not cache.get('error'), 'Actual ASR cache evidence differs')
    require(all(cache.get(field) is None for field in ('prompt', 'hotwords', 'initialPrompt', 'initial_prompt')),
            'ASR cache has prompt or hotword conditioning')
    return identity


def prepare(root, work, model=MODEL, tokens_file=None, *, verify_current_code=True):
    """Read and preflight everything. Does not write; callers must hold locks."""
    require(model == MODEL, 'Only the agreed stronger ASR model is allowed')
    out = root / 'data/audio'
    evidence = module(root, 'finalize_evidence', 'audio-evidence.py')
    source_bytes = (out / 'source.json').read_bytes()
    source_hash = sha(source_bytes)
    source = json.loads(source_bytes)
    manifest = read(out / 'manifest.json')
    ledger = read(out / 'quality-review.json')
    require(manifest.get('sourceSha256') == source_hash == ledger.get('baselineSourceSha256'),
            'Source, manifest and immutable baseline checkpoints differ')
    require(ledger.get('version') == 1 and isinstance(ledger.get('records'), dict) and ledger['records'],
            'Invalid or empty quality-review ledger')
    stages = ledger.get('stages', {})
    require(isinstance(stages, dict) and isinstance(stages.get('comparison'), dict), 'Missing comparison stage')
    require(not (set(stages) - {'comparison', 'strongerASR'}), 'Later repair/review stages exist')
    code_hashes = {'ruleFileSha256': sha((root / 'scripts/audio-compare.py').read_bytes()),
                   'normalizerFileSha256': sha((root / 'scripts/generate-bank-audio.py').read_bytes())}
    overrides = read(out / 'overrides.json').get('entries', {})
    require(isinstance(overrides, dict), 'Invalid pronunciation overrides')
    units = {}
    for unit in source['units']:
        token = f"{unit['language']}:{unit['bank']}:{unit['key']}"
        require(token not in units, 'Duplicate source token: ' + token)
        units[token] = unit
    packs, audits = {}, {}
    for meta in manifest['packs']:
        pair = (meta['language'], meta['bank'])
        require(pair not in packs and meta['src'] == f'./data/audio/{pair[0]}/{pair[1]}.json',
                'Duplicate or invalid manifest pack path')
        pack = read(root / meta['src'])
        require(pack.get('sourceSha256') == source_hash and pack.get('generation') == manifest['generation'],
                'Pack and manifest checkpoints differ')
        packs[pair] = pack
        audits[pair] = read(out / 'audit' / pair[0] / (pair[1] + '.json'))
    records = ledger['records']
    selected = []
    equivalent = []
    checked_media = set()
    for token, row in records.items():
        require(isinstance(row, dict) and not (set(row) -
                {'token', 'language', 'bank', 'key', 'baseline', 'comparison', 'strongerASR'}),
                'Later or unknown row review stage exists: ' + token)
        require(row.get('language') in ('en', 'ja') and token == row.get('token') ==
                f"{row.get('language')}:{row.get('bank')}:{row.get('key')}", 'Invalid ledger token: ' + token)
        baseline = row.get('baseline', {})
        old_clip, old_asr = baseline.get('clip'), baseline.get('asr')
        require(evidence.valid_asr(old_clip, old_asr), 'Invalid immutable baseline actual ASR: ' + token)
        result = row.get('comparison')
        require(isinstance(result, dict) and type(result.get('equivalent')) is bool,
                'Missing immutable baseline comparison: ' + token)
        historical = {**old_asr, 'comparison': result, 'status': 'matched' if result['equivalent'] else 'review'}
        try:
            bound_comparison(evidence, old_clip, historical, code_hashes)
        except ValueError as error:
            raise ValueError(f'{error}: {token}') from error
        unit = units.get(token)
        require(unit and not unit.get('nonSpoken') and unit.get('required', True) and
                unit['text'] == old_clip['text'] and unit['voiceId'] == old_clip['voiceId'] and
                old_clip.get('language') == row['language'],
                'Required source differs from baseline: ' + token)
        pair = (row['language'], row['bank'])
        clip = packs.get(pair, {}).get('clips', {}).get(row['key'])
        # Status is the only pack field that may change during ASR-only work.
        require(isinstance(clip, dict) and
                {k: v for k, v in clip.items() if k != 'asrStatus'} ==
                {k: v for k, v in old_clip.items() if k != 'asrStatus'},
                'Recording/input metadata changed since baseline: ' + token)
        binding = (clip['src'], clip['sha256'], clip['bytes'])
        if binding not in checked_media:
            require(evidence.media_integrity(root, clip)['ok'], 'Current media integrity failed: ' + token)
            checked_media.add(binding)
        if result['equivalent']:
            require('strongerASR' not in row, 'Untargeted baseline row has strongerASR: ' + token)
            equivalent.append(row)
        else:
            selected.append(row)
    require(ledger.get('baselineCounts') == counts(records.values()) and
            stages['comparison'].get('baseline') == ledger['baselineCounts'] and
            stages['comparison'].get('equivalent') == counts(equivalent) and
            stages['comparison'].get('remaining') == counts(selected), 'Immutable comparison counts differ')
    tokens = sorted(row['token'] for row in selected)
    require(tokens, 'Comparison selected no stronger-ASR targets')
    if tokens_file is not None:
        supplied = read(tokens_file)
        require(isinstance(supplied, list) and all(isinstance(token, str) for token in supplied) and
                len(supplied) == len(set(supplied)) and set(supplied) == set(tokens),
                'Tokens file must exactly equal all unresolved baseline comparisons, with no duplicates')
    result = copy.deepcopy(ledger)
    identity = None
    matched, remaining = [], []
    unique = {'en': set(), 'ja': set()}
    for row in selected:
        token, pair = row['token'], (row['language'], row['bank'])
        clip = packs[pair]['clips'][row['key']]
        record = audits[pair].get('records', {}).get(row['key'])
        try:
            current_identity = validate_strong(record, clip, row['key'], row['language'], work, model,
                                               evidence, code_hashes, bool(overrides.get(token, {}).get('phonemes')),
                                               verify_current_code=verify_current_code)
        except (ValueError, OSError) as error:
            raise ValueError(f'{error}: {token}') from error
        require(identity is None or current_identity == identity, 'Mixed stronger ASR execution identities')
        identity = current_identity
        if 'strongerASR' in row:
            require(row['strongerASR'] == record, 'Existing stronger-ASR snapshot differs; refusing to overwrite: ' + token)
        result['records'][token]['strongerASR'] = copy.deepcopy(record)
        (matched if record['comparison']['equivalent'] else remaining).append(row)
        unique[row['language']].add(clip['sha256'])
    summary = {
        'complete': True, 'selection': 'baseline comparison.equivalent == false',
        'targetCount': len(tokens), 'targetTokensSha256': sha(json.dumps(tokens, separators=(',', ':')).encode()),
        'tested': counts(selected), 'matched': counts(matched), 'review': counts(remaining),
        'uniqueAudioSha256': {'total': len(unique['en'] | unique['ja']), 'en': len(unique['en']), 'ja': len(unique['ja'])},
        'recognitionMethod': 'individual-beam5', 'recognitionGeneration': copy.deepcopy(identity),
        'comparisonRuleVersion': RULE_VERSION, 'comparisonCode': code_hashes,
        'baselineMediaVerified': {'rows': len(records), 'uniqueFiles': len(checked_media)},
        'audioFilesChanged': 0, 'mediaBindingsChanged': 0, 'finalizerRecognitionCalls': 0,
    }
    if 'strongerASR' in stages:
        require(stages['strongerASR'] == summary, 'Existing stronger-ASR summary differs; refusing to overwrite')
    result['stages']['strongerASR'] = summary
    # Defensive preservation assertions for future edits to this finalizer.
    require(result['stages']['comparison'] == ledger['stages']['comparison'] and
            all(result['records'][t]['baseline'] == r['baseline'] and
                result['records'][t]['comparison'] == r['comparison'] for t, r in records.items()),
            'Immutable first-stage evidence was modified')
    return {'ledger': result, 'originalLedger': ledger, 'source': source, 'sourceHash': source_hash,
            'generation': copy.deepcopy(manifest['generation']), 'packs': packs, 'audits': audits, 'summary': summary}


def finalize(root, work, *, apply=False, model=MODEL, tokens_file=None, bank_loader=None):
    root, work = Path(root).resolve(), Path(work).resolve()
    require(work != root and root not in work.parents, 'Keep authoring caches outside the repository')
    require(work.is_dir(), 'External audio workdir does not exist')
    locks = []
    try:
        for name in ('bank-generate.lock', 'bank-audit.lock'):
            lock = (work / name).open('a')
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                lock.close()
                raise ValueError('Audio author is live; cannot finalize while holding ' + name) from None
            locks.append(lock)
        prepared = prepare(root, work, model, Path(tokens_file) if tokens_file else None)
        if apply:
            bank = bank_loader(root) if bank_loader else module(root, 'finalize_bank', 'generate-bank-audio.py')
            if prepared['ledger'] != prepared['originalLedger']:
                atomic_exact(root / 'data/audio/quality-review.json', prepared['ledger'])
            # A crash after the ledger write is safely resumable: same snapshots
            # are required above, and flush re-derives indexes from actual audits.
            bank.flush(prepared['source'], prepared['sourceHash'], prepared['generation'], prepared['packs'])
        return {'applied': apply, **prepared['summary']}
    finally:
        for lock in reversed(locks):
            lock.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=Path.cwd(), help='Checkout root (default: current directory)')
    parser.add_argument('--workdir', type=Path, default=DEFAULT_WORK)
    parser.add_argument('--model', default=MODEL, help='Exact agreed model ID; no model is loaded')
    parser.add_argument('--tokens-file', type=Path, help='Optional JSON array; must equal the full derived target set')
    parser.add_argument('--apply', action='store_true', help='Persist the validated stage and synchronize index statuses')
    args = parser.parse_args(argv)
    result = finalize(args.repo, args.workdir, apply=args.apply, model=args.model, tokens_file=args.tokens_file)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
