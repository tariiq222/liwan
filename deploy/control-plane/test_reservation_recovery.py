#!/usr/bin/env python3
"""Fake-only unit coverage for fail-closed reservation recovery under the lifecycle lock.

The real caller chain (run-local.sh -> real begin_generation.py -> real
recover_reservation) is covered by test_actual_reservation_caller.py. The cases
here isolate the coordinator guard and the refusal probes with injected process
snapshots, so no caller chain and no service is involved.
"""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from recover_generation import recover_reservation, _runtime_candidate, _runtime_candidates_present, _process_snapshot

HERE = Path(__file__).resolve().parent
GEN = '1234567890abcdef1234567890abcdef'
ROOT = HERE.parents[1]
NODE_BIN = Path('/opt/homebrew/opt/node@22/bin')


def rows_with_coordinator(begin_pid, coord_pid=2000):
    """Synthetic coherent snapshot: begin's parent is the trusted run-local.sh."""
    return {
        begin_pid: (coord_pid, 'begin-start',
                    f'{sys.executable} {ROOT / "deploy/control-plane/begin_generation.py"}'),
        coord_pid: (1, 'coordinator-start',
                    f'bash {ROOT / "deploy/control-plane/run-local.sh"} runtime'),
    }


def reservation(home: Path, raw=None):
    state = home / 'processes'; state.mkdir(mode=0o700)
    (home / 'processes.lock').touch()
    (state / 'generation').write_bytes((GEN + '\n').encode() if raw is None else raw)
    return state


class ReservationRecovery(unittest.TestCase):
    def test_foreign_process_sharing_the_node_binary_is_not_a_candidate(self):
        """The node executable alone is not identity; another root must not block archival."""
        node = str(NODE_BIN / 'node')
        foreign_nuxt = f'{node} /other/root/node_modules/@nuxt/cli.mjs dev --port 13109'
        self.assertFalse(_runtime_candidate(foreign_nuxt, ROOT, NODE_BIN))
        other_root_runtime = (f'{node} /other/root/node_modules/tsx/dist/cli.mjs '
                              f'/other/root/apps/control-plane/src/main.ts')
        self.assertFalse(_runtime_candidate(other_root_runtime, ROOT, NODE_BIN))
        self.assertFalse(_runtime_candidate(f'{node} --inspect', ROOT, NODE_BIN))
        self.assertFalse(_runtime_candidate(f'{node} main.ts', ROOT, NODE_BIN))

    def test_root_artifact_is_recognized_absolute_alias_and_relative(self):
        real = ROOT / 'apps/control-plane/src/main.ts'
        node = str(NODE_BIN / 'node')
        self.assertTrue(_runtime_candidate(f'{node} {real}', ROOT, NODE_BIN))
        self.assertTrue(_runtime_candidate(f'{node} {ROOT}/node_modules/tsx/dist/cli.mjs {real}', ROOT, NODE_BIN))
        self.assertTrue(_runtime_candidate('node node_modules/tsx/dist/cli.mjs apps/control-plane/src/main.ts',
                                           ROOT, NODE_BIN))
        self.assertTrue(_runtime_candidate('bash deploy/control-plane/run-local.sh runtime', ROOT, NODE_BIN))
        with tempfile.TemporaryDirectory(prefix='liwan-alias-') as tmp:
            alias = Path(tmp) / 'alias-main.ts'
            os.symlink(real, alias)
            self.assertTrue(_runtime_candidate(f'{node} {alias}', ROOT, NODE_BIN),
                            'a canonical alias of a root artifact must still be a candidate')

    def test_shell_wrapper_and_superstring_boundaries(self):
        real = ROOT / 'apps/control-plane/src/main.ts'
        node = str(NODE_BIN / 'node')
        self.assertTrue(_runtime_candidate(f"bash -c 'exec node {real}'", ROOT, NODE_BIN))
        self.assertFalse(_runtime_candidate(f"bash -c 'exec node {real}.bak'", ROOT, NODE_BIN))
        self.assertFalse(_runtime_candidate(f'{node} {real}.bak', ROOT, NODE_BIN))
        self.assertFalse(_runtime_candidate(f'{node} {ROOT}-other/apps/control-plane/src/main.ts', ROOT, NODE_BIN))

    def test_live_candidate_without_listener_refuses_preserving_reservation(self):
        with tempfile.TemporaryDirectory(prefix='liwan-reservation-live-') as tmp:
            home = Path(tmp); state = reservation(home)
            before = (state / 'generation').read_bytes()
            with patch('recover_generation._process_snapshot', return_value=rows_with_coordinator(4242)):
                with self.assertRaisesRegex(ValueError, 'runtime_process_present'):
                    recover_reservation(state, home, ROOT, NODE_BIN, 4242,
                                        listener_check=lambda: False,
                                        candidate_check=lambda root, node, pid, coordinator: True)
            self.assertEqual((state / 'generation').read_bytes(), before)
            self.assertEqual(list(home.glob('processes-archive-*')), [])

    def test_unknown_symlink_and_malformed_reservations_refuse(self):
        for kind in ('unknown', 'symlink', 'malformed'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory(prefix='liwan-reservation-invalid-') as tmp:
                home = Path(tmp); state = reservation(home)
                if kind == 'unknown': (state / 'foreign').write_text('untouched')
                elif kind == 'symlink':
                    (state / 'generation').unlink(); (state / 'generation').symlink_to(home / 'missing')
                else: (state / 'generation').write_text('not-a-generation\n')
                before = {p.name: (p.is_symlink(), p.read_bytes() if not p.is_symlink() else os.readlink(p)) for p in state.iterdir()}
                with self.assertRaises(ValueError):
                    recover_reservation(state, home, ROOT, NODE_BIN, 100,
                                        listener_check=lambda: False,
                                        candidate_check=lambda root, node, pid, coordinator: False)
                after = {p.name: (p.is_symlink(), p.read_bytes() if not p.is_symlink() else os.readlink(p)) for p in state.iterdir()}
                self.assertEqual(after, before)
                self.assertEqual(list(home.glob('processes-archive-*')), [])

    def test_foreign_supervisor_with_same_argv_refuses_even_without_listener(self):
        with tempfile.TemporaryDirectory(prefix='liwan-reservation-foreign-runtime-') as tmp:
            home = Path(tmp); state = reservation(home)
            before = (state / 'generation').read_bytes()
            rows = {1233: (1234, 'begin-start', f'{sys.executable} {ROOT / "deploy/control-plane/begin_generation.py"}'),
                    1234: (2000, 'coordinator-start', f'bash {ROOT / "deploy/control-plane/run-local.sh"} runtime'),
                    2000: (1, 'lock-start', f'{sys.executable} {ROOT / "deploy/control-plane/process_lock.py"} --hold'),
                    1235: (1, 'foreign-start', f'bash {ROOT / "deploy/control-plane/run-local.sh"} runtime')}
            coordinator = (1234, 'coordinator-start')
            with patch('recover_generation._process_snapshot', return_value=rows):
                self.assertTrue(_runtime_candidates_present(ROOT, NODE_BIN, 1233, coordinator))
            self.assertEqual((state / 'generation').read_bytes(), before)
            self.assertEqual(list(home.glob('processes-archive-*')), [])

    def test_listener_command_error_refuses(self):
        with tempfile.TemporaryDirectory(prefix='liwan-reservation-listener-error-') as tmp:
            home = Path(tmp); state = reservation(home)
            class Failed:
                returncode = 2
                stdout = ''
            with patch('recover_generation.subprocess.run', return_value=Failed()):
                rows = {os.getpid(): (os.getppid(), 'begin-start', f'{sys.executable} begin_generation.py'),
                        os.getppid(): (1, 'coord-start', f'bash {ROOT / "deploy/control-plane/run-local.sh"}')}
                with patch('recover_generation._process_snapshot', return_value=rows):
                    with self.assertRaisesRegex(ValueError, 'api_listener_present_or_uncertain'):
                        recover_reservation(state, home, ROOT, NODE_BIN, os.getpid(),
                                            candidate_check=lambda root, node, pid, coordinator: False)
            self.assertTrue((state / 'generation').is_file())
            self.assertEqual(list(home.glob('processes-archive-*')), [])

    def test_probe_errors_refuse(self):
        with tempfile.TemporaryDirectory(prefix='liwan-reservation-probe-error-') as tmp:
            home = Path(tmp); state = reservation(home)
            for listener, candidate in ((lambda: True, lambda root, node, pid, coordinator: False),
                                        (lambda: False, lambda root, node, pid, coordinator: (_ for _ in ()).throw(ValueError('process_enumeration_failed')))):
                with self.subTest(listener=listener), patch('recover_generation._process_snapshot',
                                                            return_value=rows_with_coordinator(4242)):
                    with self.assertRaises(ValueError):
                        recover_reservation(state, home, ROOT, NODE_BIN, 4242,
                                            listener_check=listener, candidate_check=candidate)
                    self.assertEqual((state / 'generation').read_text(), GEN + '\n')

    def test_full_process_enumeration_matches_wrapped_node_and_fails_on_command_error(self):
        class Result:
            returncode = 0
            stdout = f'1 0 Sun Jan 01 00:00:00 2023 /sbin/launchd\n100 99 Sun Jan 01 00:00:00 2023 python -B {ROOT}/deploy/control-plane/startup_handoff.py\n'
        with patch('recover_generation.subprocess.run', return_value=Result()) as run:
            rows = _process_snapshot()
            self.assertEqual(run.call_args.args[0], ['/bin/ps', '-ww', '-axo', 'pid=,ppid=,lstart=,command='])
            self.assertIn(100, rows)
        class Failed:
            returncode = 1
            stdout = ''
        with patch('recover_generation.subprocess.run', return_value=Failed()):
            with self.assertRaisesRegex(ValueError, 'process_enumeration_failed'):
                _process_snapshot()


if __name__ == '__main__':
    unittest.main()
