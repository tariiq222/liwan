#!/usr/bin/env python3
"""Private-process canaries for generation recovery; no live services are signaled."""
import os
import sys
import subprocess
import tempfile
import unittest
from pathlib import Path
import errno
import threading
import time
from unittest.mock import patch

from recover_generation import recover, pid_is_absent

SCRIPT = Path(__file__).with_name('local-process.sh')
GENERATION = '97d4e3cab7f5de8e0121352e66b351ce'


def make_generation(state: Path, pids: dict[str, int], generation: str = GENERATION) -> None:
    state.mkdir(parents=True, exist_ok=True)
    (state / 'generation').write_text(generation + '\n')
    for name in ('runtime', 'api', 'worker'):
        (state / f'{name}.pid').write_text(f'{pids[name]}\n')
        (state / f'{name}.start').write_text('Wed 23 Sep 03:38:51 2026\n')
        if name != 'runtime':
            (state / f'{name}.generation').write_text(generation + '\n')


class DeadGenerationRecovery(unittest.TestCase):
    def invoke(self, root: Path, action='recover'):
        env = {**os.environ, 'LIWAN_CONTROL_HOME': str(root), 'LIWAN_REPOSITORY_ROOT': str(SCRIPT.parents[2]), 'LIWAN_NODE_BIN': '/opt/homebrew/opt/node@22/bin'}
        return subprocess.run(['/bin/bash', str(SCRIPT), action, 'runtime'], env=env, capture_output=True, text=True, timeout=10)

    def test_all_dead_coherent_generation_is_archived_without_deletion(self):
        with tempfile.TemporaryDirectory(prefix='liwan-dead-generation-canary-') as tmp:
            root = Path(tmp); state = root / 'processes'
            make_generation(state, {'runtime': 99000101, 'api': 99000102, 'worker': 99000103})
            result = self.invoke(root)
            self.assertEqual(result.returncode, 0, result.stderr)
            archives = list(root.glob(f'processes-archive-{GENERATION}-*'))
            self.assertEqual(len(archives), 1)
            self.assertEqual(archives[0].stat().st_mode & 0o777, 0o700)
            self.assertEqual(sorted(p.name for p in archives[0].iterdir()), sorted(['runtime.pid','runtime.start','api.pid','api.start','api.generation','worker.pid','worker.start','worker.generation','generation']))
            self.assertTrue(state.is_dir())
            self.assertEqual(state.stat().st_mode & 0o777, 0o700)
            self.assertEqual(list(state.iterdir()), [])

    def test_live_or_reused_pid_preserves_every_record(self):
        with tempfile.TemporaryDirectory(prefix='liwan-live-generation-canary-') as tmp:
            root = Path(tmp); state = root / 'processes'
            make_generation(state, {'runtime': os.getpid(), 'api': 99000202, 'worker': 99000203})
            before = {p.name: p.read_bytes() for p in state.iterdir()}
            result = self.invoke(root)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual({p.name: p.read_bytes() for p in state.iterdir()}, before)

    def test_mixed_generation_preserves_every_record(self):
        with tempfile.TemporaryDirectory(prefix='liwan-mixed-generation-canary-') as tmp:
            root = Path(tmp); state = root / 'processes'
            make_generation(state, {'runtime': 99000301, 'api': 99000302, 'worker': 99000303})
            (state / 'worker.generation').write_text('0123456789abcdef0123456789abcdef\n')
            before = {p.name: p.read_bytes() for p in state.iterdir()}
            result = self.invoke(root)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual({p.name: p.read_bytes() for p in state.iterdir()}, before)


    def test_pid_probe_accepts_only_esrch(self):
        def esrch(pid, sig): raise OSError(errno.ESRCH, 'absent')
        self.assertTrue(pid_is_absent(200001, esrch))
        for err in (errno.EPERM, errno.EACCES, errno.EINVAL):
            with self.subTest(errno=err):
                def denied(pid, sig, err=err): raise OSError(err, 'uncertain')
                self.assertFalse(pid_is_absent(200001, denied))
        self.assertFalse(pid_is_absent(200001, lambda pid, sig: None))

    def test_unexpected_and_symlink_records_preserve_generation(self):
        for kind in ('unexpected', 'symlink'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory(prefix='liwan-invalid-record-canary-') as tmp:
                root = Path(tmp); state = root / 'processes'
                make_generation(state, {'runtime': 99000401, 'api': 99000402, 'worker': 99000403})
                if kind == 'unexpected': (state / 'extra').write_text('preserve')
                else:
                    (state / 'generation').unlink(); (state / 'generation').symlink_to(root / 'target')
                before = [(x.name, x.is_symlink(), x.readlink() if x.is_symlink() else x.read_bytes()) for x in state.iterdir()]
                result = self.invoke(root)
                self.assertNotEqual(result.returncode, 0)
                after = [(x.name, x.is_symlink(), x.readlink() if x.is_symlink() else x.read_bytes()) for x in state.iterdir()]
                self.assertEqual(before, after)

    def test_stop_refuses_partial_or_live_generation_without_any_signal(self):
        with tempfile.TemporaryDirectory(prefix='liwan-stop-no-partial-canary-') as tmp:
            root=Path(tmp); state=root/'processes'
            make_generation(state, {'runtime':os.getpid(),'api':99001102,'worker':99001103})
            before={p.name:p.read_bytes() for p in state.iterdir()}
            result=self.invoke(root, action='stop')
            self.assertNotEqual(result.returncode,0)
            self.assertEqual({p.name:p.read_bytes() for p in state.iterdir()},before)
            self.assertEqual(list(root.glob('processes-archive-*')),[])

    def test_partial_generation_and_stop_refuses_without_archiving(self):
        with tempfile.TemporaryDirectory(prefix='liwan-partial-generation-canary-') as tmp:
            root = Path(tmp); state = root / 'processes'
            make_generation(state, {'runtime': 99000501, 'api': 99000502, 'worker': 99000503})
            (state / 'worker.start').unlink()
            before = {p.name: p.read_bytes() for p in state.iterdir()}
            result = self.invoke(root, action='stop')
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual({p.name: p.read_bytes() for p in state.iterdir()}, before)
            self.assertEqual(list(root.glob('processes-archive-*')), [])

    def test_recreate_directory_failure_preserves_archived_records(self):
        with tempfile.TemporaryDirectory(prefix='liwan-mkdir-failure-canary-') as tmp:
            root = Path(tmp); state = root / 'processes'
            make_generation(state, {'runtime': 99000901, 'api': 99000902, 'worker': 99000903})
            def fail_mkdir(path, mode): raise OSError('injected mkdir failure')
            def rename_then_fail(src, dst):
                if Path(src) == state: os.rename(src, dst)
                else: raise OSError('injected restore failure')
            with self.assertRaises(ValueError): recover(state, root, pid_probe=lambda pid: True, listener_check=lambda: False, rename=rename_then_fail, mkdir=fail_mkdir)
            archives = list(root.glob(f'processes-archive-{GENERATION}-*'))
            self.assertEqual(len(archives), 1)
            self.assertTrue((archives[0] / 'generation').is_file())
            self.assertFalse(state.exists())


    def test_pid_reappearing_between_checks_prevents_archive(self):
        with tempfile.TemporaryDirectory(prefix='liwan-pid-race-canary-') as tmp:
            root = Path(tmp); state = root / 'processes'
            make_generation(state, {'runtime': 99000601, 'api': 99000602, 'worker': 99000603})
            calls = {}
            def probe(pid):
                calls[pid] = calls.get(pid, 0) + 1
                return not (pid == 99000602 and calls[pid] > 1)
            with patch('recover_generation.subprocess.run', return_value=type('R', (), {'returncode': 1, 'stdout': b''})()):
                with self.assertRaises(ValueError): recover(state, root, pid_probe=probe, listener_check=lambda: False)
            self.assertTrue(state.exists())
            self.assertEqual(list(root.glob('processes-archive-*')), [])


    def test_lock_wrapper_blocks_competing_process_transition(self):
        with tempfile.TemporaryDirectory(prefix='liwan-lock-canary-') as tmp:
            env = {**os.environ, 'LIWAN_CONTROL_HOME': tmp}
            lock = SCRIPT.with_name('process_lock.py')
            marker = Path(tmp) / 'ran'
            cmd = [sys.executable, str(lock), '--hold', sys.executable, '-c', f"import pathlib,time; pathlib.Path({str(marker)!r}).write_text('x'); time.sleep(.4)"]
            first = subprocess.Popen(cmd, env=env)
            deadline = time.time() + 3
            while not marker.exists() and time.time() < deadline: time.sleep(.01)
            second = subprocess.run(cmd, env=env, capture_output=True, timeout=5)
            first.wait(timeout=5)
            self.assertEqual(first.returncode, 0)
            self.assertEqual(second.returncode, 0, second.stderr)


    def test_rename_and_recreate_failures_preserve_archive_or_original(self):
        with tempfile.TemporaryDirectory(prefix='liwan-fs-failure-canary-') as tmp:
            root = Path(tmp); state = root / 'processes'
            make_generation(state, {'runtime': 99000801, 'api': 99000802, 'worker': 99000803})
            def no_rename(src, dst): raise OSError('rename')
            with self.assertRaises(OSError): recover(state, root, pid_probe=lambda pid: True, listener_check=lambda: False, rename=no_rename)
            self.assertTrue((state / 'generation').exists())
            def fail_second_mkdir(path, mode): raise OSError('mkdir')
            with self.assertRaises(ValueError): recover(state, root, pid_probe=lambda pid: True, listener_check=lambda: False, mkdir=fail_second_mkdir)
            self.assertTrue((state / 'generation').exists())
            self.assertEqual(list(root.glob('processes-archive-*')), [])


if __name__ == '__main__':
    unittest.main()
