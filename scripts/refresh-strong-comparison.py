#!/usr/bin/env python3
"""Comparison-only revision of completed actual strong ASR.

Default preview. No inference, changed recordings, replaced transcripts or
edits to the immutable first-stage quality-review ledger. Apply only after all
selected actual strong ASR records exist and authoring processes have stopped.
"""
import argparse
import copy
import fcntl
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location('reaudit_finalizer', Path(__file__).with_name('finalize-audio-reaudit.py'))
finalizer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(finalizer)
read, sha, require = finalizer.read, finalizer.sha, finalizer.require


def raw_sha(record):
    return sha(json.dumps({k: v for k, v in record.items() if k not in ('comparison', 'status')},
                          ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode())


def proof(record):
    return copy.deepcopy({'status': record['status'], 'comparison': record['comparison']})


def summarize(rows, which, status):
    return {lang: sum(row['language'] == lang and row[which]['status'] == status for row in rows)
            for lang in ('en', 'ja')}


def prepare_revision(root, work, *, tokens_file=None, model=finalizer.MODEL, bank_loader=None, comparator_loader=None):
    ledger = read(root / 'data/audio/quality-review.json')
    require(set(ledger.get('stages', {})) == {'comparison'}, 'Comparison revision must precede strong finalization and repair stages')
    # Historical proof remains bound to the actual record, but is intentionally
    # allowed to carry the previous comparator's code hash. The new proof below
    # is checked strictly against the currently installed source-code hashes.
    prepared = finalizer.prepare(root, work, model, tokens_file, verify_current_code=False)
    bank = bank_loader(root) if bank_loader else finalizer.module(root, 'revision_bank', 'generate-bank-audio.py')
    comparator = comparator_loader(root) if comparator_loader else finalizer.module(root, 'revision_compare', 'audio-compare.py')
    evidence = finalizer.module(root, 'revision_evidence', 'audio-evidence.py')
    overrides = read(root / 'data/audio/overrides.json')['entries']
    target = root / 'data/audio/comparison-revision.json'
    prior = read(target) if target.exists() else None
    code = prepared['summary']['comparisonCode']
    selected = sorted(t for t, row in ledger['records'].items() if not row['comparison']['equivalent'])
    if prior is not None:
        require(prior.get('version') == 1 and prior.get('stage') == 'stronger-ASR-comparison' and
                prior.get('sourceSha256') == prepared['sourceHash'] and
                prior.get('targetTokensSha256') == prepared['summary']['targetTokensSha256'] and
                prior.get('currentCode') == code and
                prior.get('recognitionGeneration') == prepared['summary']['recognitionGeneration'] and
                isinstance(prior.get('entries'), dict) and not (set(prior['entries']) - set(selected)),
                'Existing comparison revision has a different binding')
    audits = copy.deepcopy(prepared['audits'])
    entries, accounting = {}, []
    for token in selected:
        row = ledger['records'][token]
        pair, key = (row['language'], row['bank']), row['key']
        clip = prepared['packs'][pair]['clips'][key]
        record = prepared['audits'][pair]['records'][key]
        override = bool(overrides.get(token, {}).get('phonemes'))
        comparison = comparator.compare(clip['spoken'], record['recognized'], row['language'],
                                        normalizer=bank.normalize, source_text=clip['text'], phoneme_override=override)
        require(isinstance(comparison, dict) and type(comparison.get('equivalent')) is bool,
                'Comparator did not return a concrete result: ' + token)
        comparison['audioSha256'] = clip['sha256']
        # No historical ASR or candidate transcript is ever substituted here.
        updated = {**record, 'comparison': comparison, 'status': 'matched' if comparison['equivalent'] else 'review'}
        finalizer.validate_strong(updated, clip, key, row['language'], work, model, evidence, code, override)
        require(raw_sha(record) == raw_sha(updated), 'Comparison update changed actual recognition evidence: ' + token)
        before, after = proof(record), proof(updated)
        raw_digest = raw_sha(record)
        previous = prior['entries'].get(token) if prior is not None else None
        if previous is not None:
            require(previous.get('audioSha256') == clip['sha256'] and previous.get('rawASRSha256') == raw_digest and
                    previous.get('after') == after and before in (previous.get('before'), previous.get('after')),
                    'Existing per-row revision cannot be overwritten: ' + token)
            before = copy.deepcopy(previous['before'])
        if before != after:
            entries[token] = {'language': row['language'], 'audioSha256': clip['sha256'],
                              'rawASRSha256': raw_digest, 'before': before, 'after': after}
        elif previous is not None:
            raise ValueError('Existing revision no longer reproduces a proof change: ' + token)
        audits[pair]['records'][key] = updated
        accounting.append({'token': token, 'language': row['language'], 'before': before, 'after': after})
    changed_status = [row for row in accounting if row['before']['status'] != row['after']['status']]
    summary = {'tested': prepared['summary']['tested'],
               'before': {status: summarize(accounting, 'before', status) for status in ('matched', 'review')},
               'after': {status: summarize(accounting, 'after', status) for status in ('matched', 'review')},
               'promoted': summarize(changed_status, 'after', 'matched'),
               'demoted': summarize(changed_status, 'after', 'review'),
               'proofUpdated': len(entries), 'classificationChanged': len(changed_status),
               'audioFilesChanged': 0, 'rawASRChanged': 0, 'newRecognitionCalls': 0}
    report = {'version': 1, 'stage': 'stronger-ASR-comparison', 'sourceSha256': prepared['sourceHash'],
              'targetCount': len(selected), 'targetTokensSha256': prepared['summary']['targetTokensSha256'],
              'recognitionGeneration': prepared['summary']['recognitionGeneration'],
              'priorRuleFileSha256': sorted({row['before']['comparison']['provenance']['ruleFileSha256'] for row in accounting}),
              'currentCode': code, 'summary': summary, 'affectedTokens': sorted(entries),
              'classificationChangedTokens': sorted(row['token'] for row in changed_status), 'entries': entries}
    if prior is not None:
        require(prior == report, 'Existing revision summary differs; refusing to rewrite history')
    return {'report': report, 'priorReport': prior, 'audits': audits, 'priorAudits': prepared['audits'], 'bank': bank}


def refresh(root, work, *, apply=False, tokens_file=None, model=finalizer.MODEL, bank_loader=None, comparator_loader=None):
    root, work = Path(root).resolve(), Path(work).resolve()
    require(work.is_dir() and work != root and root not in work.parents, 'Use an existing external authoring workdir')
    locks = []
    try:
        for name in ('bank-generate.lock', 'bank-audit.lock'):
            lock = (work / name).open('a')
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                lock.close()
                raise ValueError('Audio author is live; cannot revise comparison while holding ' + name) from None
            locks.append(lock)
        plan = prepare_revision(root, work, tokens_file=Path(tokens_file) if tokens_file else None, model=model,
                                bank_loader=bank_loader, comparator_loader=comparator_loader)
        if apply:
            # Journal first, so an interrupted audit-file write can resume from
            # the same original proofs. Nothing is written until all targets pass.
            if plan['report'] != plan['priorReport']:
                finalizer.atomic_exact(root / 'data/audio/comparison-revision.json', plan['report'])
            for (language, name), audit in plan['audits'].items():
                if audit != plan['priorAudits'][(language, name)]:
                    finalizer.atomic_exact(root / 'data/audio/audit' / language / (name + '.json'), audit)
        return {'applied': apply, **plan['report']['summary']}
    finally:
        for lock in reversed(locks):
            lock.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=Path.cwd())
    parser.add_argument('--workdir', type=Path, default=finalizer.DEFAULT_WORK)
    parser.add_argument('--model', default=finalizer.MODEL)
    parser.add_argument('--tokens-file', type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args(argv)
    result = refresh(args.repo, args.workdir, apply=args.apply, model=args.model, tokens_file=args.tokens_file)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
