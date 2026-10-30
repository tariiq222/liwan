#!/usr/bin/env python3
"""Fake caller-sequence tests for startup locking and real stop/trap interactions.

Scope and non-vacuity notes (2026-09-23 repair):

* The stop test no longer fabricates any process identity. The temp root holds a
  real directory layout and a stand-in ``node`` executable, so the script's own
  identity checks run against genuine PIDs, genuine argv from the real ``ps`` and
  genuine start times. There is no ``ps`` shim and no ``kill`` shim.
* Every PID the script may signal is a freshly created child of this test and is
  reaped by a parent-side reaper thread, so liveness matches reality.
* The supervisor stand-in mirrors run-local.sh:43-55: it holds the lifecycle lock
  until the owner records are published, then releases it, which is what lets an
  external stop acquire the lock. The previous failure was this fixture's own
  guessed PIDs, unreaped zombies and retained lock - it was never production
  evidence, in either direction.
* NOT covered here: a direct TERM with no stop-handoff marker (the
  runtime-trap-cleanup path) is covered in test_stop_protocol.py; the forged or
  mismatched marker case is covered by the extra test below. A green result here
  is not a product-wide pass.
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
LOCK = HERE / 'process_lock.py'
BEGIN = HERE / 'begin_generation.py'
LOCAL = HERE / 'local-process.sh'

# Stand-in supervisor body used by the forged-marker case: sources the REAL
# runtime-trap.sh, holds the lifecycle lock only until the records are published,
# then releases it while LIWAN_PROCESS_LOCK_FD stays in the environment.
RUNNER_BODY = '''#!/bin/bash
set +x; set +v; set -euo pipefail
HOME_DIR="$LIWAN_CONTROL_HOME"; DEPLOY="$LIWAN_TEST_DEPLOY"
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


class StartupPublication(unittest.TestCase):
    def test_second_start_blocked_until_publication_then_rejected(self):
        with tempfile.TemporaryDirectory(prefix='liwan-run-sequence-canary-') as tmp:
            home = Path(tmp); state = home / 'processes'; state.mkdir(mode=0o700); (home / 'processes.lock').touch()
            env = {**os.environ, 'LIWAN_CONTROL_HOME': str(home)}
            # The previous generation must be genuinely not-dead, so the second
            # start is refused by the fail-closed liveness probe rather than by a
            # guessed, out-of-range PID. The two live records are this test's own
            # children (reaped in the finally block); runtime.pid is the adapter's
            # own real PID, dead once the adapter exits.
            live = [subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)']) for _ in range(2)]

            def start_of(pid):
                out = subprocess.run(['/bin/ps', '-p', str(pid), '-o', 'lstart='], capture_output=True, text=True).stdout
                return ' '.join(out.split())

            adapter = r'''import fcntl,os,pathlib,subprocess,sys,time
h=pathlib.Path(sys.argv[1]); p=h/'processes'; fd=os.open(h/'processes.lock',os.O_RDWR); fcntl.flock(fd,fcntl.LOCK_EX); os.set_inheritable(fd,True); os.environ['LIWAN_PROCESS_LOCK_FD']=str(fd)
subprocess.check_call([sys.executable,sys.argv[2],'--check'],pass_fds=(fd,)); subprocess.check_call([sys.executable,sys.argv[3],str(h)],pass_fds=(fd,))
own=subprocess.run(['/bin/ps','-p',str(os.getpid()),'-o','lstart='],capture_output=True,text=True).stdout
(p/'runtime.pid').write_text(str(os.getpid())+'\n'); time.sleep(.2); (p/'runtime.start').write_text(' '.join(own.split())+'\n'); g=(p/'generation').read_text()
for n,pid,start in (('api',sys.argv[4],sys.argv[6]),('worker',sys.argv[5],sys.argv[7])):
 (p/(n+'.pid')).write_text(pid+'\n'); (p/(n+'.start')).write_text(start+'\n'); (p/(n+'.generation')).write_text(g)
(h/'published').write_text('yes'); time.sleep(2)
'''
            first = subprocess.Popen([sys.executable, '-c', adapter, str(home), str(LOCK), str(BEGIN),
                                      str(live[0].pid), str(live[1].pid),
                                      start_of(live[0].pid), start_of(live[1].pid)],
                                     env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            second = None
            try:
                deadline = time.monotonic() + 3
                while not (state / 'runtime.pid').exists() and time.monotonic() < deadline: time.sleep(.01)
                self.assertTrue((state / 'runtime.pid').exists())
                second = subprocess.Popen([sys.executable, str(LOCK), '--hold', sys.executable, str(BEGIN), str(home)], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                time.sleep(.05); self.assertIsNone(second.poll())
                out, err = first.communicate(timeout=3); out2, err2 = second.communicate(timeout=3)
                self.assertEqual(first.returncode, 0, (out, err)); self.assertNotEqual(second.returncode, 0, (out2, err2))
                # Non-vacuity: the refusal is the fail-closed live-record probe, not
                # an out-of-range PID artifact, and nothing was archived.
                self.assertIn('pid_live_or_uncertain', out2 + err2,
                              'concurrent start must be refused because the recorded generation is not dead')
                self.assertTrue((state / 'api.generation').exists()); self.assertTrue((state / 'worker.generation').exists())
                self.assertEqual(list(home.glob('processes-archive-*')), [])
            finally:
                if second is not None and second.poll() is None: second.kill(); second.communicate(timeout=2)
                if first.poll() is None: first.kill(); first.wait(timeout=2)
                for child in live:
                    if child.poll() is None: child.kill()
                for child in live:
                    if child.poll() is None: child.wait(timeout=5)

    def test_actual_local_stop_runtime_uses_real_run_local_trap_without_deadlock(self):
        children = []
        reapers = []
        with tempfile.TemporaryDirectory(prefix='liwan-actual-stop-canary-') as tmp:
            home = Path(tmp); root = home
            state = home / 'processes'; state.mkdir(mode=0o700)
            (home / 'processes.lock').touch(); (home / 'runtime.env').write_text(''); (home / 'logs').mkdir()

            # Real layout + a real binary stand-in so identity checks see genuine
            # argv/PIDs: ``node`` is a symlink to the running interpreter (a script
            # shebang would rewrite argv to include the script path), and the tsx
            # entry is an inert sleeper executed by it.
            node_bin = root / 'node22' / 'bin'; node_bin.mkdir(parents=True)
            fake_node = node_bin / 'node'
            process_image = subprocess.check_output(['/bin/ps', '-p', str(os.getpid()), '-o', 'comm='], text=True).strip()
            os.symlink(process_image, fake_node)
            tsx = root / 'node_modules' / 'tsx' / 'dist' / 'cli.mjs'; tsx.parent.mkdir(parents=True)
            tsx.write_text('import time\ntime.sleep(600)\n')
            entrypoints = {}
            for name in ('main.ts', 'worker-main.ts'):
                path = root / 'apps' / 'control-plane' / 'src' / name
                path.parent.mkdir(parents=True, exist_ok=True); path.write_text('// stand-in\n'); entrypoints[name] = path

            runner = root / 'deploy' / 'control-plane' / 'run-local.sh'; runner.parent.mkdir(parents=True)
            runner.write_text('''#!/bin/bash
set +x; set +v; set -euo pipefail
HOME_DIR="$LIWAN_CONTROL_HOME"; DEPLOY="$LIWAN_TEST_DEPLOY"
source "$DEPLOY/runtime-trap.sh"
trap 'control_runtime_trap || exit $?; exit 0' TERM INT
printf ready > "$HOME_DIR/ready"
# Mirror run-local.sh:43-55: hold the lifecycle lock until the owner records are
# published, then release it so an external stop can acquire it.
for ((i=0;i<2000;i++)); do [[ -f "$HOME_DIR/records-published" ]] && break; /bin/sleep 0.01; done
exec 3>&-
while :; do /bin/sleep 0.05; done
'''); runner.chmod(0o700)

            env = {**os.environ, 'LIWAN_CONTROL_HOME': str(home), 'LIWAN_REPOSITORY_ROOT': str(root),
                   'LIWAN_NODE_BIN': str(node_bin), 'LIWAN_TEST_DEPLOY': str(HERE)}

            def spawn(argv, **kwargs):
                child = subprocess.Popen(argv, **kwargs)
                children.append(child)
                reaper = threading.Thread(target=child.wait, daemon=True)
                reaper.start(); reapers.append(reaper)
                return child

            def proc_start(pid):
                out = subprocess.run(['/bin/ps', '-p', str(pid), '-o', 'lstart='],
                                     capture_output=True, text=True).stdout
                return ' '.join(out.split())

            owner = spawn([sys.executable, str(LOCK), '--hold', 'bash', str(runner)], env=env,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)
            api = worker = None
            try:
                deadline = time.monotonic() + 5
                while not (home / 'ready').exists() and time.monotonic() < deadline: time.sleep(.01)
                self.assertTrue((home / 'ready').exists(), 'supervisor stand-in never signalled ready')
                api = spawn([str(fake_node), str(tsx), str(entrypoints['main.ts'])])
                worker = spawn([str(fake_node), str(tsx), str(entrypoints['worker-main.ts'])])
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
                    if name != 'runtime': (state / f'{name}.generation').write_text(generation + '\n')
                sentinel = state / 'foreign-record.sentinel'
                sentinel.write_text('untouched\n'); sentinel_bytes = sentinel.read_bytes()
                (home / 'records-published').touch()

                stopped = subprocess.run(['/bin/bash', str(LOCAL), 'stop', 'runtime'], env=env,
                                         capture_output=True, text=True, timeout=45)
                self.assertEqual(stopped.returncode, 0,
                                 f"stop exit={stopped.returncode} (10=identity refusal, 11=stop timeout) "
                                 f"stdout={stopped.stdout[-2000:]!r} stderr={stopped.stderr[-2000:]!r}")
                self.assertIn('Owned runtime stopped', stopped.stdout)
                owner.wait(timeout=5); api.wait(timeout=5); worker.wait(timeout=5)
                self.assertFalse((state / 'generation').exists())
                self.assertFalse((state / 'runtime.pid').exists())
                self.assertFalse((state / 'stop-handoff').exists())
                for name in ('runtime', 'api', 'worker'):
                    self.assertFalse((state / f'{name}.pid').exists(), f'{name}.pid owner record retained')
                    self.assertFalse((state / f'{name}.start').exists(), f'{name}.start owner record retained')
                self.assertEqual(list(home.glob('processes-archive-*')), [],
                                 'a completed stop must not archive or drop records')
                self.assertEqual(sentinel.read_bytes(), sentinel_bytes, 'foreign record must be untouched')
                after = subprocess.run(['/bin/bash', str(LOCAL), 'status', 'runtime'], env=env,
                                       capture_output=True, text=True, timeout=15)
                self.assertNotEqual(after.returncode, 0, 'stopped runtime must not be reported as confirmed')
            finally:
                for child in children:
                    if child.poll() is None: child.kill()
                for child in children:
                    if child.poll() is None: child.wait(timeout=5)
                for reaper in reapers: reaper.join(timeout=5)


    def test_forged_handoff_marker_never_signals_foreign_process(self):
        """A forged/mismatched stop-handoff must never be trusted.

        Documented expectation: runtime-trap.sh:9 requires the handoff to equal
        "<runtime.pid> <generation>" and that pid to be this shell, so a forged
        marker (foreign pid, wrong generation) takes the untrusted cleanup path.
        Safety properties: the foreign pid in the marker is never signalled, the
        marker and foreign records are preserved as evidence, and the
        generation's own children/records are handled by the identity-checked
        cleanup rather than by the marker fast path.
        """
        children = []
        reapers = []
        with tempfile.TemporaryDirectory(prefix='liwan-forged-marker-canary-') as tmp:
            home = Path(tmp); root = home
            state = home / 'processes'; state.mkdir(mode=0o700)
            (home / 'processes.lock').touch(); (home / 'runtime.env').write_text(''); (home / 'logs').mkdir()
            node_bin, node_link, tsx, entries = build_fixture_layout(root)
            runner = root / 'deploy' / 'control-plane' / 'run-local.sh'; runner.parent.mkdir(parents=True)
            runner.write_text(RUNNER_BODY); runner.chmod(0o700)
            trace = home / 'runtime-stderr.txt'; trace_handle = trace.open('w')
            env = {**os.environ, 'LIWAN_CONTROL_HOME': str(home), 'LIWAN_REPOSITORY_ROOT': str(root),
                   'LIWAN_NODE_BIN': str(node_bin), 'LIWAN_TEST_DEPLOY': str(HERE)}
            owner = api = worker = foreign = None
            try:
                owner = spawn(children, reapers, [sys.executable, str(LOCK), '--hold', 'bash', str(runner)],
                              env=env, stdout=subprocess.DEVNULL, stderr=trace_handle, close_fds=True)
                deadline = time.monotonic() + 5
                while not (home / 'ready').exists() and time.monotonic() < deadline: time.sleep(.01)
                self.assertTrue((home / 'ready').exists(), 'stand-in supervisor never signalled ready')
                api = spawn(children, reapers, [str(node_link), str(tsx), str(entries['main.ts'])])
                worker = spawn(children, reapers, [str(node_link), str(tsx), str(entries['worker-main.ts'])])
                foreign = spawn(children, reapers, [sys.executable, '-c', 'import time; time.sleep(600)'])
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
                forged = f'{foreign.pid} ' + 'f' * 32 + '\n'
                (state / 'stop-handoff').write_text(forged)
                (home / 'records-published').touch()
                self.assertIsNone(foreign.poll(), 'foreign stand-in must be alive before the TERM')

                os.kill(owner.pid, signal.SIGTERM)
                deadline = time.monotonic() + 20
                while time.monotonic() < deadline and owner.poll() is None: time.sleep(.05)
                self.assertIsNotNone(owner.poll(), 'supervisor did not exit after the forged-marker TERM')
                trace_handle.flush()
                detail = trace.read_text(errors='replace')[-2000:]

                self.assertIsNone(foreign.poll(), f'the foreign pid in a forged marker must never be signalled; stderr={detail!r}')
                self.assertEqual((state / 'stop-handoff').read_text(), forged, 'a forged marker is evidence and must not be deleted')
                self.assertEqual(sentinel.read_bytes(), sentinel_bytes, 'foreign record must be untouched')
                self.assertEqual(list(home.glob('processes-archive-*')), [], 'no archive may be created here')
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline and (api.poll() is None or worker.poll() is None): time.sleep(.05)
                self.assertIsNotNone(api.poll(), f'untrusted marker must not skip the owned cleanup for api; stderr={detail!r}')
                self.assertIsNotNone(worker.poll(), f'untrusted marker must not skip the owned cleanup for worker; stderr={detail!r}')
                self.assertFalse((state / 'generation').exists(), f'generation retained after owned cleanup; stderr={detail!r}')
            finally:
                for child in (owner, api, worker, foreign):
                    if child is not None and child.poll() is None: child.kill()
                for child in (owner, api, worker, foreign):
                    if child is not None and child.poll() is None: child.wait(timeout=5)
                for reaper in reapers: reaper.join(timeout=5)
                trace_handle.close()


if __name__ == '__main__':
    unittest.main()
