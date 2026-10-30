#!/usr/bin/env python3
"""Real-caller integration for reservation recovery (no services, no real state).

Runs the real deploy/control-plane/run-local.sh, which invokes the real
begin_generation.py and the real recover_reservation():

    bash deploy/control-plane/run-local.sh runtime
      -> process_lock.py --hold -> startup_handoff.py -> /bin/bash run-local.sh   (one PID)
      -> python3 begin_generation.py <fake-home>                                  (direct child)

The lifecycle lock is acquired by run-local.sh itself (the documented entry), so
the coordinator ancestry is exercised exactly as an operator start would be. The
cases here carry the two reservation cases that cannot be isolated with injected
snapshots (archive-and-reserve, lock serialization of competing publishers).

Nothing real is touched: a fake `docker` shadows the client and only records its
argv, so run-local.sh fails closed at resource verification (exit 6) before
npm/migrate/API/worker; a fake `lsof` reports no listener; python3 is pinned to
the interpreter this suite runs under; the fake home holds placeholders only.
"""
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
RUN_LOCAL = HERE / 'run-local.sh'
GEN = '1234567890abcdef1234567890abcdef'
RELATIVE = 'deploy/control-plane/run-local.sh'
PINNED = Path('/Users/tariq/code/odoo/.venv/bin/python')
if not PINNED.exists():  # pragma: no cover - pinned interpreter is the supported host layout
    PINNED = Path(sys.executable)


class ActualReservationCaller(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='liwan-actual-reservation-')
        self.home = Path(self.tmp.name)
        self.state = self.home / 'processes'; self.state.mkdir(mode=0o700)
        for name in ('control-db-password', 'control-service-key', 'control-database-url', 'inventory-v2.json', 'runtime.env'):
            (self.home / name).write_text('{}' if name.endswith('.json') else 'fake')
        (self.home / 'processes.lock').touch()
        self.bin = self.home / 'fake-bin'; self.bin.mkdir()
        self._fake('docker', '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$LIWAN_CONTROL_HOME/docker-calls"\n'
                             'case "$1" in compose) exit 0;; *) exit 1;; esac\n')
        self._fake('lsof', '#!/bin/sh\nexit 1\n')
        # Fake node so no real node process (e.g. an unrelated live fixture started
        # from the same node@22 binary) can make the runtime-candidate scan refuse.
        self._fake('node', '#!/bin/sh\ncase "$1" in --version) echo v22.0.0; exit 0;; esac\n'
                           'while :; do /bin/sleep 0.05; done\n')
        os.symlink(PINNED, self.bin / 'python3')
        self.children = []
        self.reapers = []

    def tearDown(self):
        for child in self.children:
            if child.poll() is None:
                child.kill()
        for child in self.children:
            if child.poll() is None:
                child.wait(timeout=5)
        for reaper in self.reapers:
            reaper.join(timeout=5)
        self.tmp.cleanup()

    def _fake(self, name, body):
        path = self.bin / name
        path.write_text(body); path.chmod(0o700)
        return path

    def _spawn(self, argv, **kwargs):
        child = subprocess.Popen(argv, **kwargs)
        self.children.append(child)
        reaper = threading.Thread(target=child.wait, daemon=True)
        reaper.start(); self.reapers.append(reaper)
        return child

    def _env(self):
        env = {**os.environ,
               'LIWAN_CONTROL_HOME': str(self.home),
               'LIWAN_NODE_BIN': str(self.bin),
               'LIWAN_REPOSITORY_ROOT': str(ROOT),
               'PATH': f'{self.bin}:{os.environ["PATH"]}'}
        env.pop('LIWAN_PROCESS_LOCK_FD', None)  # run-local.sh acquires the lock itself
        return env

    def _reserve(self):
        (self.state / 'generation').write_text(GEN + '\n')
        return (self.state / 'generation').read_bytes()

    def test_real_caller_relative_path_archives_reservation_before_any_service(self):
        before = self._reserve()
        result = subprocess.run(['bash', RELATIVE, 'runtime'], cwd=str(ROOT), env=self._env(),
                                capture_output=True, text=True, timeout=90)
        self.assertNotIn('locked_coordinator_unverified', result.stderr,
                         f'real caller chain must be recognized; stderr={result.stderr[-2000:]!r}')
        self.assertEqual(result.returncode, 6,
                         f'exit={result.returncode} stderr={result.stderr[-2000:]!r}')
        archives = list(self.home.glob(f'processes-archive-reservation-{GEN}-*'))
        self.assertEqual(len(archives), 1, result.stderr[-2000:])
        self.assertEqual((archives[0] / 'generation').read_bytes(), before)
        fresh = (self.state / 'generation').read_text().strip()
        self.assertNotEqual(fresh, GEN)
        self.assertRegex(fresh, r'^[a-f0-9]{32}$')
        self.assertTrue((self.home / 'docker-calls').is_file(), 'fake docker must have been used')
        self.assertIn('compose', (self.home / 'docker-calls').read_text())

    def test_real_caller_live_candidate_refuses_and_preserves_records(self):
        before = self._reserve()
        candidate = self._spawn([str(self.bin / 'node'), str(ROOT / 'apps/control-plane/src/main.ts')],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        result = subprocess.run(['bash', RELATIVE, 'runtime'], cwd=str(ROOT), env=self._env(),
                                capture_output=True, text=True, timeout=90)
        self.assertNotIn('locked_coordinator_unverified', result.stderr, result.stderr[-2000:])
        self.assertEqual(result.returncode, 4, f'exit={result.returncode} stderr={result.stderr[-2000:]!r}')
        self.assertIn('Existing runtime records could not be safely recovered.', result.stderr)
        self.assertIn('runtime_process_present', result.stderr)
        self.assertEqual((self.state / 'generation').read_bytes(), before)
        self.assertEqual(list(self.home.glob('processes-archive-*')), [])
        self.assertIsNone(candidate.poll(), 'the live candidate must never be signalled')

    def test_real_caller_ignores_foreign_process_sharing_the_node_binary(self):
        before = self._reserve()
        foreign = self._spawn([str(self.bin / 'node'),
                               str(self.home / 'other-root' / 'node_modules' / '@nuxt' / 'cli.mjs'),
                               'dev', '--port', '13109'],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        result = subprocess.run(['bash', RELATIVE, 'runtime'], cwd=str(ROOT), env=self._env(),
                                capture_output=True, text=True, timeout=90)
        self.assertNotIn('locked_coordinator_unverified', result.stderr, result.stderr[-2000:])
        self.assertEqual(result.returncode, 6, f'exit={result.returncode} stderr={result.stderr[-2000:]!r}')
        self.assertEqual(len(list(self.home.glob(f'processes-archive-reservation-{GEN}-*'))), 1,
                         f'a foreign same-binary process must not block the archive; stderr={result.stderr[-2000:]!r}')
        self.assertNotEqual((self.state / 'generation').read_text().strip(), GEN)
        self.assertIsNone(foreign.poll(), 'the foreign process must never be signalled')

    def test_real_caller_waits_for_the_lifecycle_lock_then_archives(self):
        before = self._reserve()
        holder = self._spawn([str(PINNED), '-c',
                              "import fcntl, os, time\n"
                              "from pathlib import Path\n"
                              "home = Path(os.environ['LIWAN_CONTROL_HOME'])\n"
                              "fd = os.open(str(home / 'processes.lock'), os.O_RDWR)\n"
                              "fcntl.flock(fd, fcntl.LOCK_EX)\n"
                              "(home / 'holder-ready').touch()\n"
                              "time.sleep(60)\n"],
                             env={**os.environ, 'LIWAN_CONTROL_HOME': str(self.home)},
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.monotonic() + 10
        while not (self.home / 'holder-ready').exists() and time.monotonic() < deadline:
            time.sleep(.01)
        self.assertTrue((self.home / 'holder-ready').exists(), 'holder failed to take the lifecycle lock')
        starter = self._spawn(['bash', str(RUN_LOCAL), 'runtime'], cwd=str(ROOT), env=self._env(),
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        time.sleep(.4)
        self.assertIsNone(starter.poll(), 'the real caller must stay serialized behind the lock')
        self.assertEqual((self.state / 'generation').read_bytes(), before)
        holder.kill(); holder.wait(timeout=5)
        out, err = starter.communicate(timeout=90)
        self.assertNotIn('locked_coordinator_unverified', err, err[-2000:])
        self.assertEqual(starter.returncode, 6, f'exit={starter.returncode} stderr={err[-2000:]!r}')
        self.assertEqual(len(list(self.home.glob(f'processes-archive-reservation-{GEN}-*'))), 1)
        self.assertNotEqual((self.state / 'generation').read_text().strip(), GEN)


if __name__ == '__main__':
    unittest.main()
