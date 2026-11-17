#!/usr/bin/env python3
"""Reclassify existing actual ASR using explicit equivalence rules, without inference.

The first snapshot preserves every original review's media and recognition
evidence. No historical transcript is substituted for the currently selected
recording. Later recognition and repair stages extend the same ledger.
"""
import argparse
import copy
import fcntl
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/audio'


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def counts(rows):
    return {language: sum(row['language'] == language for row in rows) for language in ['en', 'ja']}


def classify(clip, record, language, comparator, normalizer, phoneme_override=False):
    # The caller separately verifies actual ASR provenance and file integrity.
    result = comparator(clip['spoken'], record['recognized'], language,
                        normalizer=normalizer, source_text=clip['text'], phoneme_override=phoneme_override)
    if not isinstance(result, dict) or type(result.get('equivalent')) is not bool:
        raise ValueError('Comparison must return an explicit equivalent boolean')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Persist comparison, audit status and refreshed index')
    parser.add_argument('--workdir', type=Path, default=Path.home() / '.local/share/toeic-kokoro')
    args = parser.parse_args()
    work = args.workdir.resolve()
    if work == ROOT or ROOT in work.parents:
        parser.error('Keep authoring caches outside the repository')
    bank = module('comparison_bank', 'generate-bank-audio.py')
    comparator = module('audio_comparison', 'audio-compare.py')
    evidence = module('comparison_evidence', 'audio-evidence.py')
    # Same writer locks as the authoring tools; the read-only preview also takes
    # them so a ledger cannot accidentally combine two different checkpoints.
    locks = []
    try:
        for name in ['bank-generate.lock', 'bank-audit.lock']:
            lock = (work / name).open('a')
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            locks.append(lock)
        manifest = bank.read(OUT / 'manifest.json', {})
        source_bytes = (OUT / 'source.json').read_bytes()
        source = json.loads(source_bytes)
        overrides = bank.read(OUT / 'overrides.json', {'entries': {}})['entries']
        if manifest['sourceSha256'] != bank.sha(source_bytes):
            raise ValueError('Source and manifest checkpoints differ')
        packs, audits = {}, {}
        for meta in manifest['packs']:
            pair = (meta['language'], meta['bank'])
            packs[pair] = bank.read(ROOT / meta['src'], {})
            audits[pair] = bank.read(OUT / 'audit' / pair[0] / (pair[1] + '.json'), {})
        target = OUT / 'quality-review.json'
        ledger = bank.read(target, None)
        if ledger is None:
            records = {}
            for (language, name), pack in packs.items():
                for key, clip in pack['clips'].items():
                    record = audits[(language, name)]['records'].get(key)
                    if clip.get('required') and record and record.get('status') == 'review':
                        token = f'{language}:{name}:{key}'
                        records[token] = {'token': token, 'language': language, 'bank': name, 'key': key,
                                          'baseline': {'clip': copy.deepcopy(clip), 'asr': copy.deepcopy(record)}}
            ledger = {'version': 1, 'baselineSourceSha256': manifest['sourceSha256'],
                      'baselineCounts': counts(records.values()), 'records': records, 'stages': {}}
        if ledger['version'] != 1:
            raise ValueError('Unsupported quality ledger version')
        if args.apply and any(stage != 'comparison' for stage in ledger['stages']):
            raise ValueError('Later review stages exist; do not overwrite the step-one comparison baseline')
        changed, remaining, reasons = [], [], {}
        for token, row in ledger['records'].items():
            pair = (row['language'], row['bank'])
            clip = packs[pair]['clips'].get(row['key'])
            record = audits[pair]['records'].get(row['key'])
            if not evidence.valid_asr(clip, record):
                raise ValueError('Missing current actual ASR: ' + token)
            integrity = evidence.media_integrity(ROOT, clip)
            if not integrity['ok']:
                raise ValueError('Invalid current media: ' + token)
            result = classify(clip, record, row['language'], comparator.compare, bank.normalize,
                              phoneme_override=bool(overrides.get(token, {}).get('phonemes')))
            row['comparison'] = {'audioSha256': clip['sha256'], 'recognized': record['recognized'], **result}
            if result['equivalent']:
                changed.append(row)
                for reason in result.get('reasons', []):
                    label = reason if isinstance(reason, str) else json.dumps(reason, ensure_ascii=False, sort_keys=True)
                    reasons[label] = reasons.get(label, 0) + 1
            else:
                remaining.append(row)
            record['comparison'] = copy.deepcopy(row['comparison'])
            record['status'] = 'matched' if result['equivalent'] else 'review'
        summary = {'baseline': ledger['baselineCounts'], 'equivalent': counts(changed),
                   'remaining': counts(remaining), 'rules': reasons,
                   'audioFilesChanged': 0, 'newRecognitionCalls': 0}
        ledger['stages']['comparison'] = summary
        if args.apply:
            bank.atomic(target, ledger)
            for (language, name), audit in audits.items():
                bank.atomic(OUT / 'audit' / language / (name + '.json'), audit)
            # Only status/index metadata changes; exact original input recipe and
            # every delivered M4A remain intact.
            bank.flush(source, bank.sha(source_bytes), manifest['generation'], packs)
        print(json.dumps({'applied': args.apply, **summary}, ensure_ascii=False, indent=2))
    finally:
        for lock in reversed(locks):
            lock.close()


if __name__ == '__main__':
    main()
