"""No-model integration fixtures for comparison-only revision and recovery."""
import copy
import importlib.util
import json
from pathlib import Path
import types
import unittest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, (ROOT / 'scripts' / filename if filename == 'refresh-strong-comparison.py' else HERE / filename))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result
fixture = load('revision_fixture', 'bank-audio-finalize.test.py')
refresh = load('revision_tool', 'refresh-strong-comparison.py')

class RefreshTest(unittest.TestCase):
    def setUp(self):
        self.f = fixture.FinalizeTest('runTest')
        self.f.setUp()
        self.root, self.work, self.out = self.f.root, self.f.work, self.f.out
        # A deterministic old-rule false negative: actual Japanese transcript
        # is unchanged, but its prior comparison deliberately says review.
        def old_false(r):
            r['status'] = 'review'
            r['comparison'].update(equivalent=False, proofExpected=None, proofRecognized=None,
                                   reasons=['fixture-prior-false-negative'])
        self.f.corrupt_audit(old_false)
        # Historical diagnostics on an untargeted row must not be sanitized or
        # otherwise transformed merely because its audit file is rewritten.
        self.f.corrupt_audit(lambda r:r.update(diagnostic={'error':'/tmp/old-fixture-diagnostic'}), key='d', language='en')
        self.original_ledger = (self.out / 'quality-review.json').read_bytes()
        self.original_audits = {p: p.read_bytes() for p in (self.out / 'audit').rglob('*.json')}
        self.original_caches = {p: p.read_bytes() for p in self.work.rglob('*.json')}
        p = self.root / 'scripts/audio-compare.py'
        p.write_text(p.read_text() + '\n# isolated reviewed formatting revision fixture\n')

    def tearDown(self):
        self.f.tearDown()

    def bank(self, root):
        module = self.f.load_bank_without_inference_imports(root)
        module.normalize = lambda text, language: text
        return module

    def comparator(self, root):
        def compare(spoken, heard, language, **kwargs):
            # The semantic finite-format rules have a separate 27-test suite.
            # This fixture compares literal strings to test only revision I/O,
            # real SHA bindings, preservation and deterministic recovery.
            clip = {'sha256': '', 'spoken': spoken, 'text': kwargs['source_text'], 'language': language}
            r = self.f.comparison(clip, heard, spoken == heard)
            r.pop('audioSha256')
            r['provenance']['ruleFileSha256'] = refresh.sha((root / 'scripts/audio-compare.py').read_bytes())
            r['provenance']['phonemeOverride'] = kwargs['phoneme_override']
            return r
        return types.SimpleNamespace(compare=compare)

    def run_tool(self, apply=False, **kwargs):
        return refresh.refresh(self.root, self.work, apply=apply, bank_loader=self.bank,
                               comparator_loader=self.comparator, **kwargs)

    def reject_without_write(self, **kwargs):
        before = self.f.snapshot()
        with self.assertRaises((ValueError, FileNotFoundError)):
            self.run_tool(True, **kwargs)
        self.assertEqual(self.f.snapshot(), before)

    def test_preview_is_read_only_and_reclassifies_only_actual_current_transcript(self):
        before = self.f.snapshot()
        summary = self.run_tool()
        self.assertFalse(summary['applied'])
        self.assertEqual(summary['tested'], {'en': 3, 'ja': 1})
        self.assertEqual(summary['promoted'], {'en': 0, 'ja': 1})
        self.assertEqual(summary['demoted'], {'en': 0, 'ja': 0})
        self.assertEqual(summary['proofUpdated'], 4)
        self.assertEqual(summary['classificationChanged'], 1)
        self.assertEqual(self.f.snapshot(), before)

    def test_apply_preserves_raw_evidence_baseline_untargeted_rows_then_finalizer_accepts(self):
        old = self.f.snapshot()
        self.run_tool(True)
        self.assertEqual((self.out / 'quality-review.json').read_bytes(), self.original_ledger)
        self.assertEqual({p: p.read_bytes() for p in self.original_caches}, self.original_caches)
        for path, content in old.items():
            if path.startswith('audio/') or path in ('data/audio/source.json', 'data/audio/manifest.json', 'data/audio/en/part2.json', 'data/audio/ja/part2.json'):
                self.assertEqual((self.root / path).read_bytes(), content)
        report = refresh.read(self.out / 'comparison-revision.json')
        self.assertEqual(report['classificationChangedTokens'], ['ja:part2:c'])
        self.assertEqual(set(report['entries']), set(self.f.tokens))
        self.assertNotIn(str(self.work), json.dumps(report))
        for path, data in self.original_audits.items():
            original, current = json.loads(data)['records'], refresh.read(path)['records']
            language = path.parent.name
            for key, record in original.items():
                self.assertEqual(refresh.raw_sha(record), refresh.raw_sha(current[key]))
                token = f'{language}:part2:{key}'
                if token not in self.f.tokens:
                    self.assertEqual(record, current[key])
                else:
                    self.assertEqual(report['entries'][token]['before'], refresh.proof(record))
                    self.assertEqual(report['entries'][token]['after'], refresh.proof(current[key]))
        self.assertEqual(self.f.flush_calls, 0, 'Only the subsequent finalizer updates pack/index status')
        # Strict finalizer defaults still require new current code hashes.
        prepared = refresh.finalizer.prepare(self.root, self.work)
        self.assertEqual(prepared['summary']['matched'], {'en': 2, 'ja': 1})
        after = self.f.snapshot()
        self.run_tool(True)
        self.assertEqual(self.f.snapshot(), after, 'Revision resume must not erase previous proofs')

    def test_resume_after_journal_written_and_only_one_audit_updated(self):
        plan = refresh.prepare_revision(self.root, self.work, bank_loader=self.bank, comparator_loader=self.comparator)
        self.f.write(self.out / 'comparison-revision.json', plan['report'])
        self.f.write(self.out / 'audit/en/part2.json', plan['audits'][('en', 'part2')])
        self.run_tool(True)
        self.assertEqual(refresh.read(self.out / 'comparison-revision.json'), plan['report'])
        self.assertEqual(refresh.read(self.out / 'audit/ja/part2.json'), plan['audits'][('ja', 'part2')])
        self.assertEqual((self.out / 'quality-review.json').read_bytes(), self.original_ledger)

    def test_missing_wrong_model_empty_invalid_proof_and_stale_sha_prevent_all_writes(self):
        path = self.out / 'audit/ja/part2.json'
        original = path.read_bytes()
        changes = [lambda r: r.update(recognized=''),
                   lambda r: r['recognitionGeneration'].update(model='whisper-small'),
                   lambda r: r.update(sha256='0' * 64),
                   lambda r: r.update(segments=[]),
                   lambda r: r['comparison'].update(reasons=[None]),
                   lambda r: r['recognitionGeneration'].update(hotwords='answer')]
        for i, change in enumerate(changes):
            with self.subTest(case=i):
                path.write_bytes(original)
                self.f.corrupt_audit(change)
                self.reject_without_write()
        path.write_bytes(original)
        value = refresh.read(path)
        del value['records']['c']
        self.f.write(path, value)
        self.reject_without_write()

    def test_cache_evidence_or_media_change_prevents_any_revision(self):
        r = refresh.read(self.out / 'audit/ja/part2.json')['records']['c']
        p = self.work / 'tmp/bank-asr' / (r['fingerprint'] + '.json')
        original = p.read_bytes()
        cache = refresh.read(p)
        cache['recognized'] = 'Unexecuted transcript'
        self.f.write(p, cache)
        self.reject_without_write()
        p.write_bytes(original)
        clip = refresh.read(self.out / 'ja/part2.json')['clips']['c']
        (self.root / clip['src']).write_bytes(b'another audio')
        self.reject_without_write()

    def test_later_finalization_and_modified_journal_are_not_overwritten(self):
        self.run_tool(True)
        p = self.out / 'comparison-revision.json'
        report = refresh.read(p)
        report['entries']['ja:part2:c']['rawASRSha256'] = '0' * 64
        self.f.write(p, report)
        self.reject_without_write()
        p.unlink()
        ledger = refresh.read(self.out / 'quality-review.json')
        ledger['stages']['strongerASR'] = {'complete': True}
        self.f.write(self.out / 'quality-review.json', ledger)
        self.reject_without_write()

    def test_current_comparator_invalid_result_fails_before_any_write(self):
        original = self.comparator
        def invalid(root):
            comp = original(root)
            def compare(*args, **kwargs):
                result = comp.compare(*args, **kwargs)
                result['provenance']['ruleFileSha256'] = '0' * 64
                return result
            return types.SimpleNamespace(compare=compare)
        self.comparator = invalid
        self.reject_without_write()

    def test_locks_and_exact_token_selection_stay_enforced(self):
        import fcntl
        for name in ('bank-generate.lock', 'bank-audit.lock'):
            with (self.work / name).open('a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                self.reject_without_write()
        self.f.write(self.f.token_path, self.f.tokens[:1])
        self.reject_without_write(tokens_file=self.f.token_path)

if __name__ == '__main__':
    unittest.main()
