#!/usr/bin/env python3
"""Regression for the actual stop entrypoint and the real TERM trap.

Faithful model (learned from the reproduced failure, 2026-09-23):

* ``command kill`` does NOT bypass the bash builtin, so a fake ``kill`` on PATH
  can never intercept the TERM this script sends. The test therefore does not
  fake ``kill`` at all: every PID the script may signal is a real child of this
  test process, created here, with a fresh, non-guessed PID.
* A child killed by the script stays a zombie until its parent reaps it, and
  ``kill -0`` succeeds for a zombie. Each child therefore gets a parent-side
  reaper thread so the liveness model the script relies on matches reality.
* Only ``command=`` is shimmed (PATH ``ps``), and only for this test's own three
  PIDs, because the real expected argv names node/tsx which cannot be executed
  here. ``lstart=`` and every other ``ps`` invocation delegate to /bin/ps, so a
  dead process reports no start time exactly like production.

Deliberately NOT covered here: a direct TERM with no ``stop-handoff`` marker
(the runtime-trap-cleanup path) and a mismatched marker. Only the external-stop
marker path is exercised.
"""
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
LOCAL = HERE / 'local-process.sh'
LOCK = HERE / 'process_lock.py'

# Stand-in supervisor body: sources the REAL runtime-trap.sh, holds the lifecycle
# lock only until the owner records are published, then releases it (mirrors
# run-local.sh:43-55). WEBVUE_PROCESS_LOCK_FD stays in the environment after the
# descriptor is closed, exactly as production leaves it.
RUNNER_BODY = '''#!/bin/bash
set +x; set +v; set -euo pipefail
HOME_DIR="$WEBVUE_CONTROL_HOME"; DEPLOY="$WEBVUE_TEST_DEPLOY"
source "$DEPLOY/runtime-trap.sh"
trap 'control_runtime_trap || exit $?; exit 0' TERM INT
printf ready > "$HOME_DIR/ready"
for ((i=0;i<2000;i++)); do [[ -f "$HOME_DIR/records-published" ]] && break; /bin/sleep 0.01; done
exec 3>&-
while :; do /bin/sleep 0.05; done
'''


def build_fixture_layout(root):
    """Real argv/identity layout under root; node is a symlink to this interpreter."""
    node_bin = root / 'node22' / 'bin'; node_bin.mkdir(parents=True)
    process_image = subprocess.check_output(['/bin/ps', '-p', str(os.getpid()), '-o', 'comm='], text=True).strip()
    node_link = node_bin / 'node'; os.symlink(process_image, node_link)
    tsx = root / 'node_modules' / 'tsx' / 'dist' / 'cli.mjs'; tsx.parent.mkdir(parents=True)
    tsx.write_text('import time\ntime.sleep(600)\n')
    entries = {}
    for name in ('main.ts', 'worker-main.ts'):
        path = root / 'apps' / 'control-plane' / 'src' / name
        path.parent.mkdir(parents=True, exist_ok=True); path.write_text('// stand-in\n')
        entries[name] = path
    return node_bin, node_link, tsx, entries


def lstart(pid):
    out = subprocess.run(['/bin/ps', '-p', str(pid), '-o', 'lstart='], capture_output=True, text=True).stdout
    return ' '.join(out.split())


def spawn(children, reapers, argv, **kwargs):
    child = subprocess.Popen(argv, **kwargs)
    children.append(child)
    reaper = threading.Thread(target=child.wait, daemon=True)
    reaper.start(); reapers.append(reaper)
    return child


class StopProtocol(unittest.TestCase):
    def test_real_local_stop_orders_children_and_supervisor_no_lock_deadlock(self):
        children = []
        reapers = []
        with tempfile.TemporaryDirectory(prefix='webvue-stop-protocol-canary-') as tmp:
            home = Path(tmp)
            state = home / 'processes'
            state.mkdir(mode=0o700)
            (home / 'logs').mkdir()
            (home / 'runtime.env').touch()
            (home / 'processes.lock').touch()
            tools = home / 'bin'
            tools.mkdir()

            # ``ps`` shim: fabricate argv only for this test's owned PIDs; delegate
            # everything else (notably lstart and liveness) to the real /bin/ps.
            ps = tools / 'ps'
            ps.write_text('''#!/bin/bash
original=("$@")
pid=""; field=""
while (($#)); do
  case "$1" in
    -p) pid="${2:-}"; (($# >= 2)) && shift 2 || shift;;
    -o) field="${2:-}"; (($# >= 2)) && shift 2 || shift;;
    *) shift;;
  esac
done
if [[ "$field" == "command=" ]]; then
  case "$pid" in
    "${WEBVUE_TEST_RUNTIME_PID:-__none__}") printf '%s\\n' "bash $WEBVUE_REPOSITORY_ROOT/deploy/control-plane/run-local.sh"; exit 0;;
    "${WEBVUE_TEST_API_PID:-__none__}") printf '%s\\n' "$WEBVUE_NODE_BIN/node $WEBVUE_REPOSITORY_ROOT/node_modules/tsx/dist/cli.mjs $WEBVUE_REPOSITORY_ROOT/apps/control-plane/src/main.ts"; exit 0;;
    "${WEBVUE_TEST_WORKER_PID:-__none__}") printf '%s\\n' "$WEBVUE_NODE_BIN/node $WEBVUE_REPOSITORY_ROOT/node_modules/tsx/dist/cli.mjs $WEBVUE_REPOSITORY_ROOT/apps/control-plane/src/worker-main.ts"; exit 0;;
  esac
fi
exec /bin/ps "${original[@]}"
''')
            ps.chmod(0o700)

            env = {
                **os.environ,
                'WEBVUE_CONTROL_HOME': str(home),
                'WEBVUE_REPOSITORY_ROOT': str(HERE.parents[1]),
                'WEBVUE_NODE_BIN': '/fake/node22/bin',
                'WEBVUE_TEST_DEPLOY': str(HERE),
                'PATH': f'{tools}:{os.environ["PATH"]}',
            }

            def spawn(argv, **kwargs):
                child = subprocess.Popen(argv, **kwargs)
                children.append(child)
                reaper = threading.Thread(target=child.wait, daemon=True)
                reaper.start()
                reapers.append(reaper)
                return child

            def proc_start(pid):
                out = subprocess.run([str(ps), '-p', str(pid), '-o', 'lstart='],
                                     capture_output=True, text=True).stdout
                return ' '.join(out.split())

            # Real supervisor stand-in: sources the real trap and exits through the
            # stop-handoff marker path.
            runner = home / 'run-local.sh'
            runner.write_text('''#!/bin/bash
set +x; set +v; set -euo pipefail
HOME_DIR="$WEBVUE_CONTROL_HOME"; DEPLOY="$WEBVUE_TEST_DEPLOY"
source "$DEPLOY/runtime-trap.sh"
trap 'control_runtime_trap || exit $?; exit 0' TERM INT
printf ready > "$HOME_DIR/ready"
while :; do /bin/sleep 0.05; done
''')
            runner.chmod(0o700)

            owner = spawn(['/bin/bash', str(runner)], env=env,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)
            api = worker = None
            try:
                deadline = time.monotonic() + 5
                while not (home / 'ready').exists() and time.monotonic() < deadline:
                    time.sleep(.01)
                self.assertTrue((home / 'ready').exists(), 'supervisor stand-in never signalled ready')

                api = spawn([sys.executable, '-c', 'import time; time.sleep(600)'])
                worker = spawn([sys.executable, '-c', 'import time; time.sleep(600)'])
                pids = {'runtime': owner.pid, 'api': api.pid, 'worker': worker.pid}
                self.assertEqual(len(set(pids.values())), 3, 'distinct freshly created child PIDs required')
                for name, child in (('runtime', owner), ('api', api), ('worker', worker)):
                    self.assertIsNone(child.poll(), f'{name} child must be alive before the stop')

                generation = '1234567890abcdef1234567890abcdef'
                (state / 'generation').write_text(generation + '\n')
                for name, child in (('runtime', owner), ('api', api), ('worker', worker)):
                    start = proc_start(child.pid)
                    self.assertTrue(start, f'{name}: real start time unavailable for own child')
                    (state / f'{name}.pid').write_text(str(child.pid) + '\n')
                    (state / f'{name}.start').write_text(start + '\n')
                    if name != 'runtime':
                        (state / f'{name}.generation').write_text(generation + '\n')

                env.update({
                    'WEBVUE_TEST_RUNTIME_PID': str(owner.pid),
                    'WEBVUE_TEST_API_PID': str(api.pid),
                    'WEBVUE_TEST_WORKER_PID': str(worker.pid),
                })
                stopped = subprocess.run(['/bin/bash', str(LOCAL), 'stop', 'runtime'],
                                         env=env, capture_output=True, text=True, timeout=45)
                # Split diagnostics: 10 is an identity refusal, 11 a stop timeout.
                self.assertEqual(
                    stopped.returncode, 0,
                    f"stop exit={stopped.returncode} (10=identity refusal, 11=stop timeout) "
                    f"stdout={stopped.stdout[-2000:]!r} stderr={stopped.stderr[-2000:]!r}",
                )
                self.assertIn('Owned runtime stopped', stopped.stdout)
                for name, child in (('runtime', owner), ('api', api), ('worker', worker)):
                    self.assertIsNotNone(child.wait(timeout=5), f'{name} child was not signalled by the stop')
                self.assertFalse((state / 'generation').exists())
                self.assertFalse((state / 'stop-handoff').exists())
                for name in ('runtime', 'api', 'worker'):
                    self.assertFalse((state / f'{name}.pid').exists(), f'{name}.pid owner record retained')
            finally:
                for child in children:
                    if child.poll() is None:
                        child.kill()
                for child in children:
                    if child.poll() is None:
                        child.wait(timeout=5)
                for reaper in reapers:
                    reaper.join(timeout=5)


    def test_direct_term_without_handoff_runs_owned_cleanup(self):
        """Direct TERM with no stop-handoff must run the owned-generation cleanup.

        Documented expectation: runtime-trap.sh:9 cannot match (no marker), so
        runtime-trap-cleanup.sh must stop this generation's api and worker through
        the identity-checked local-process.sh, then remove runtime.pid,
        runtime.start and generation. This is the untrusted path, so it may act
        only on records it can verify and must never touch a foreign record.
        """
        children = []
        reapers = []
        with tempfile.TemporaryDirectory(prefix='webvue-direct-term-canary-') as tmp:
            home = Path(tmp); root = home
            state = home / 'processes'; state.mkdir(mode=0o700)
            (home / 'processes.lock').touch(); (home / 'runtime.env').write_text(''); (home / 'logs').mkdir()
            node_bin, node_link, tsx, entries = build_fixture_layout(root)
            runner = root / 'deploy' / 'control-plane' / 'run-local.sh'; runner.parent.mkdir(parents=True)
            runner.write_text(RUNNER_BODY); runner.chmod(0o700)
            trace = home / 'runtime-stderr.txt'; trace_handle = trace.open('w')
            env = {**os.environ, 'WEBVUE_CONTROL_HOME': str(home), 'WEBVUE_REPOSITORY_ROOT': str(root),
                   'WEBVUE_NODE_BIN': str(node_bin), 'WEBVUE_TEST_DEPLOY': str(HERE)}
            owner = api = worker = None
            try:
                owner = spawn(children, reapers, [sys.executable, str(LOCK), '--hold', 'bash', str(runner)],
                              env=env, stdout=subprocess.DEVNULL, stderr=trace_handle, close_fds=True)
                deadline = time.monotonic() + 5
                while not (home / 'ready').exists() and time.monotonic() < deadline: time.sleep(.01)
                self.assertTrue((home / 'ready').exists(), 'stand-in supervisor never signalled ready')
                api = spawn(children, reapers, [str(node_link), str(tsx), str(entries['main.ts'])])
                worker = spawn(children, reapers, [str(node_link), str(tsx), str(entries['worker-main.ts'])])
                generation = '1234567890abcdef1234567890abcdef'
                (state / 'generation').write_text(generation + '\n')
                for name, child in (('runtime', owner), ('api', api), ('worker', worker)):
                    start = lstart(child.pid)
                    self.assertTrue(start, f'{name}: no real start time for own child')
                    (state / f'{name}.pid').write_text(str(child.pid) + '\n')
                    (state / f'{name}.start').write_text(start + '\n')
                    if name != 'runtime': (state / f'{name}.generation').write_text(generation + '\n')
                sentinel = state / 'foreign-record.sentinel'
                sentinel.write_text('untouched\n'); sentinel_bytes = sentinel.read_bytes()
                (home / 'records-published').touch()
                self.assertFalse((state / 'stop-handoff').exists(), 'this case is the no-handoff path')

                os.kill(owner.pid, signal.SIGTERM)
                deadline = time.monotonic() + 20
                while time.monotonic() < deadline and owner.poll() is None: time.sleep(.05)
                self.assertIsNotNone(owner.poll(), 'supervisor did not exit after a direct TERM')
                trace_handle.flush()
                detail = trace.read_text(errors='replace')[-2000:]

                deadline = time.monotonic() + 10
                while time.monotonic() < deadline and (api.poll() is None or worker.poll() is None): time.sleep(.05)
                self.assertIsNotNone(api.poll(), f'owned cleanup did not stop api after a direct TERM; stderr={detail!r}')
                self.assertIsNotNone(worker.poll(), f'owned cleanup did not stop worker after a direct TERM; stderr={detail!r}')
                self.assertFalse((state / 'generation').exists(), f'generation retained after owned cleanup; stderr={detail!r}')
                for name in ('runtime', 'api', 'worker'):
                    self.assertFalse((state / f'{name}.pid').exists(), f'{name}.pid retained after owned cleanup; stderr={detail!r}')
                    self.assertFalse((state / f'{name}.start').exists(), f'{name}.start retained after owned cleanup; stderr={detail!r}')
                self.assertEqual(sentinel.read_bytes(), sentinel_bytes, 'foreign record must be untouched')
                self.assertEqual(list(home.glob('processes-archive-*')), [], 'owned cleanup must not archive records')
            finally:
                for child in (owner, api, worker):
                    if child is not None and child.poll() is None: child.kill()
                for child in (owner, api, worker):
                    if child is not None and child.poll() is None: child.wait(timeout=5)
                for reaper in reapers: reaper.join(timeout=5)
                trace_handle.close()


if __name__ == '__main__':
    unittest.main()
