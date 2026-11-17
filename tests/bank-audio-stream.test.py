"""Real child-process supervision with temporary workers; no model inference."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


retry = load('stream_retry', ROOT / 'scripts/retry-bank-audio.py')
audit = load('stream_audit', ROOT / 'scripts/audit-bank-audio.py')

WORKER = r'''
import argparse, importlib.util, json, os, time
from pathlib import Path
p = argparse.ArgumentParser()
p.add_argument('role'); p.add_argument('mode'); p.add_argument('work', type=Path)
p.add_argument('auditor'); p.add_argument('--watch', action='store_true')
p.add_argument('--producer-pid', type=int)
a = p.parse_args()
def mark(name, **values):
    (a.work / name).write_text(json.dumps({'time': time.monotonic(), 'pid': os.getpid(), **values}))
def wait_file(name):
    end = time.monotonic() + 12
    while not (a.work / name).exists():
        if time.monotonic() > end: raise TimeoutError(name)
        time.sleep(.02)
if a.mode == 'consume':
    spec = importlib.util.spec_from_file_location('worker_audit', a.auditor)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
mark(a.role + '-start')
if a.mode == 'produce':
    wait_file('audit-live-guard')
    time.sleep(.15)
elif a.mode == 'consume':
    assert a.watch and a.producer_pid
    manifest = {'requiredComplete': True}
    stats = {'errors': 0}
    assert not module.generator_stopped(a.work, a.producer_pid)
    assert not module.watch_complete(manifest, stats, a.producer_pid, False)
    mark('audit-live-guard')
    end = time.monotonic() + 12
    while not module.watch_complete(manifest, stats, a.producer_pid,
                                    module.generator_stopped(a.work, a.producer_pid)):
        if time.monotonic() > end: raise TimeoutError('producer exit')
        time.sleep(.02)
elif a.mode == 'fail':
    wait_file(('audit' if a.role == 'generate' else 'generate') + '-start')
    raise SystemExit(7 if a.role == 'generate' else 9)
elif a.mode == 'hold':
    time.sleep(20)
else:
    raise AssertionError(a.mode)
mark(a.role + '-end')
'''

SUPERVISOR = r'''
import importlib.util, json, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location('child_retry', sys.argv[1])
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
config = json.loads(Path(sys.argv[2]).read_text())
r.ROOT = Path(config['root'])
r.run_workers(config['generate'], config['audit'], Path(config['work']), stream=True)
'''


class StreamWorkersTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.work = self.base / 'work'
        self.work.mkdir()
        self.worker = self.base / 'worker.py'
        self.worker.write_text(WORKER)

    def tearDown(self):
        self.tmp.cleanup()

    def command(self, role, mode):
        return [sys.executable, str(self.worker), role, mode, str(self.work),
                str(ROOT / 'scripts/audit-bank-audio.py')]

    def run_workers(self, producer, consumer):
        with patch.object(retry, 'ROOT', self.base):
            retry.run_workers(self.command('generate', producer),
                              self.command('audit', consumer), self.work, stream=True)

    def record(self, name):
        return json.loads((self.work / name).read_text())

    def assert_reaped(self):
        ledger = self.record('bank-retry-children.json')
        self.assertEqual(ledger['state'], 'exited')
        self.assertEqual(set(ledger['children']), {'generate', 'audit'})
        for child in ledger['children'].values():
            self.assertIsInstance(child['returncode'], int)
            with self.assertRaises(ProcessLookupError):
                os.kill(child['pid'], 0)
        return ledger

    def test_default_mode_remains_sequential(self):
        with patch.object(retry.subprocess, 'run') as run, patch.object(retry.subprocess, 'Popen') as popen:
            retry.run_workers(['generator'], ['auditor'], self.work)
        self.assertEqual([call.args[0] for call in run.call_args_list], [['generator'], ['auditor']])
        self.assertTrue(all(call.kwargs['check'] for call in run.call_args_list))
        popen.assert_not_called()

    def test_overlap_and_old_complete_manifest_waits_for_actual_producer_exit(self):
        before = {s: signal.getsignal(s) for s in (signal.SIGTERM, signal.SIGINT)}
        self.run_workers('produce', 'consume')
        gs, ge = self.record('generate-start'), self.record('generate-end')
        a_start, a_end = self.record('audit-start'), self.record('audit-end')
        self.assertLess(gs['time'], a_start['time'])
        self.assertLess(a_start['time'], ge['time'])
        self.assertLess(self.record('audit-live-guard')['time'], ge['time'])
        self.assertLessEqual(ge['time'], a_end['time'])
        ledger = self.assert_reaped()
        for role, child in ledger['children'].items():
            self.assertEqual(child['returncode'], 0)
            self.assertTrue(child['identity'], role)
        for s, handler in before.items():
            self.assertEqual(signal.getsignal(s), handler)
        self.assertEqual(retry.running(self.work), [])

    def test_failed_generator_cannot_succeed_and_stops_consumer(self):
        with self.assertRaises(subprocess.CalledProcessError) as raised:
            self.run_workers('fail', 'hold')
        self.assertEqual(raised.exception.returncode, 7)
        ledger = self.assert_reaped()
        self.assertNotEqual(ledger['children']['audit']['returncode'], 0)

    def test_failed_consumer_stops_generator(self):
        with self.assertRaises(subprocess.CalledProcessError) as raised:
            self.run_workers('hold', 'fail')
        self.assertEqual(raised.exception.returncode, 9)
        ledger = self.assert_reaped()
        self.assertNotEqual(ledger['children']['generate']['returncode'], 0)

    def test_supervisor_sigterm_reaps_both_children(self):
        script = self.base / 'supervisor.py'
        script.write_text(SUPERVISOR)
        config = self.base / 'config.json'
        config.write_text(json.dumps({'root': str(self.base), 'work': str(self.work),
                                     'generate': self.command('generate', 'hold'),
                                     'audit': self.command('audit', 'hold')}))
        process = subprocess.Popen([sys.executable, str(script),
                                    str(ROOT / 'scripts/retry-bank-audio.py'), str(config)],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            deadline = time.monotonic() + 15
            while True:
                if process.poll() is not None:
                    self.fail('Supervisor exited before cancellation: ' + repr(process.communicate()))
                ledger = retry.read(self.work / 'bank-retry-children.json', {})
                if len(ledger.get('children', {})) == 2 and all(
                        (self.work / (role + '-start')).exists() for role in ['generate', 'audit']):
                    break
                if time.monotonic() > deadline:
                    self.fail('Timed out waiting for both supervised workers')
                time.sleep(.02)
            process.send_signal(signal.SIGTERM)
            stdout, stderr = process.communicate(timeout=12)
            self.assertEqual(process.returncode, 128 + signal.SIGTERM, (stdout, stderr))
            self.assert_reaped()
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.communicate(timeout=12)
                except subprocess.TimeoutExpired:
                    process.kill(); process.communicate()

    def test_matching_live_child_ledger_blocks_restart_but_pid_reuse_does_not(self):
        process = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(20)'])
        try:
            identity = retry.process_identity(process.pid)
            self.assertTrue(identity)
            ledger = {'state': 'running', 'children': {'generate': {'pid': process.pid, 'identity': identity}}}
            retry.atomic(self.work / 'bank-retry-children.json', ledger)
            self.assertEqual(retry.running(self.work), ['retry-generate'])
            ledger['children']['generate']['identity'] = identity + ' different process'
            retry.atomic(self.work / 'bank-retry-children.json', ledger)
            self.assertEqual(retry.running(self.work), [])
        finally:
            process.terminate(); process.wait(timeout=5)

    def test_watch_completion_requires_clean_stats_and_stream_producer_exit(self):
        self.assertFalse(audit.watch_complete({'requiredComplete': True}, {'errors': 0}, 123, False))
        self.assertTrue(audit.watch_complete({'requiredComplete': True}, {'errors': 0}, 123, True))
        self.assertFalse(audit.watch_complete({'requiredComplete': True}, {'errors': 1}, 123, True))
        self.assertFalse(audit.watch_complete({}, {'errors': 0}, 123, True))
        self.assertTrue(audit.watch_complete({'complete': True}, {'errors': 0}))

    def test_explicit_producer_pid_takes_priority_over_old_registry(self):
        retry.atomic(self.work / 'bank-processes.json', {'processes': {'generate': {'pid': 111}}})
        with patch.object(audit.os, 'kill') as kill:
            self.assertFalse(audit.generator_stopped(self.work, 222))
            kill.assert_called_once_with(222, 0)
        with patch.object(audit.os, 'kill', side_effect=ProcessLookupError):
            self.assertTrue(audit.generator_stopped(self.work, 222))


class StartupIdentityTest(unittest.TestCase):
    born = 'Tue Nov 17 23:39:32 2026'
    command = ['/authoring/venv/bin/python', '-c', 'import time; time.sleep(20)']

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.work = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def ps(self, args='', born=None):
        return SimpleNamespace(returncode=0, stdout=(born or self.born) + ' /Framework/Python' +
                               (' ' + args if args else '') + '\n')

    def ledger(self, identity=None, argv=None):
        entry = {'pid': 12345, 'identity': identity or 'start=' + self.born + '\nargs=',
                 'argv': self.command if argv is None else argv}
        retry.atomic(self.work / 'bank-retry-children.json',
                     {'state': 'running', 'children': {'generate': entry}})
        return entry

    def test_capture_uses_real_birth_and_spawn_args_without_sleeping_before_ledger(self):
        with patch.object(retry.subprocess, 'run', return_value=self.ps()) as ps, \
                patch.object(retry.time, 'sleep', side_effect=AssertionError('No pre-ledger wait')):
            identity = retry.process_identity(12345, self.command)
        self.assertEqual(identity, 'start=' + self.born + '\nargs=' + ' '.join(self.command[1:]))
        ps.assert_called_once()

    def test_legacy_empty_args_ledger_matches_later_full_observed_command(self):
        self.ledger()
        with patch.object(retry, 'alive', return_value=True), \
                patch.object(retry.subprocess, 'run', return_value=self.ps(' '.join(self.command[1:]))):
            self.assertEqual(retry.running(self.work), ['retry-generate'])

    def test_current_empty_args_are_reobserved_with_an_already_persisted_ledger(self):
        self.ledger('start=' + self.born + '\nargs=' + ' '.join(self.command[1:]))
        observations = [self.ps(), self.ps(), self.ps(' '.join(self.command[1:]))]
        def after_ledger(_):
            self.assertTrue((self.work / 'bank-retry-children.json').exists())
        with patch.object(retry, 'alive', return_value=True), \
                patch.object(retry.subprocess, 'run', side_effect=observations) as ps, \
                patch.object(retry.time, 'sleep', side_effect=after_ledger) as pause:
            self.assertEqual(retry.running(self.work), ['retry-generate'])
        self.assertEqual(ps.call_count, 3)
        self.assertEqual(pause.call_count, 2)

    def test_birth_or_full_command_mismatch_cannot_match_or_recover_pid_reuse(self):
        self.ledger()
        for observed in [self.ps(' '.join(self.command[1:]), 'Wed Nov 18 00:00:01 2026'),
                         self.ps('-c import time; time.sleep(99)')]:
            with self.subTest(observed=observed.stdout), patch.object(retry, 'alive', return_value=True), \
                    patch.object(retry.subprocess, 'run', return_value=observed):
                self.assertEqual(retry.running(self.work), [])

    def test_persistently_incomplete_live_identity_raises_instead_of_silently_allowing_authors(self):
        self.ledger()
        with patch.object(retry, 'alive', return_value=True), \
                patch.object(retry.subprocess, 'run', return_value=self.ps()) as ps, \
                patch.object(retry.time, 'sleep') as pause:
            with self.assertRaisesRegex(RuntimeError, 'command line is incomplete'):
                retry.running(self.work)
        self.assertEqual(ps.call_count, 5)
        self.assertEqual(pause.call_count, 4)
        with patch.object(retry, 'alive', return_value=True), \
                patch.object(retry.subprocess, 'run', return_value=SimpleNamespace(returncode=1, stdout='')):
            with self.assertRaisesRegex(RuntimeError, 'birth identity'):
                retry.running(self.work)

    def test_stream_supervisor_persists_expected_args_when_first_ps_has_only_birth(self):
        command = [sys.executable, '-c', 'import time; time.sleep(.1)']
        original_sleep = retry.time.sleep
        def after_ledger(seconds):
            self.assertTrue((self.work / 'bank-retry-children.json').exists())
            original_sleep(seconds)
        with patch.object(retry, 'ROOT', self.work), \
                patch.object(retry.subprocess, 'run', return_value=self.ps()), \
                patch.object(retry.time, 'sleep', side_effect=after_ledger):
            retry.run_workers(command, command, self.work, stream=True)
        ledger = retry.read(self.work / 'bank-retry-children.json', {})
        self.assertEqual(ledger['state'], 'exited')
        for row in ledger['children'].values():
            self.assertEqual(row['identity'], 'start=' + self.born + '\nargs=' + ' '.join(row['argv'][1:]))
            self.assertEqual(row['returncode'], 0)

    def test_correction_supervisor_persists_expected_args_on_the_same_forced_startup_race(self):
        correction = load('startup_correction', ROOT / 'scripts/correct-bank-audio.py')
        command = [sys.executable, '-c', 'import time; time.sleep(.1)']
        with patch.object(correction, 'ROOT', self.work), \
                patch.object(correction.retry.subprocess, 'run', return_value=self.ps()), \
                patch.object(correction.retry.time, 'sleep', side_effect=AssertionError('No pre-ledger wait')):
            correction.run_command(command, self.work)
        ledger = retry.read(self.work / 'bank-retry-children.json', {})
        row = ledger['children']['correction']
        self.assertEqual(ledger['state'], 'exited')
        self.assertEqual(row['identity'], 'start=' + self.born + '\nargs=' + ' '.join(command[1:]))
        self.assertEqual(row['returncode'], 0)


if __name__ == '__main__':
    unittest.main()
