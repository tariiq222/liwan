# Part of Odoo. See LICENSE file for full copyright and licensing details.
import hashlib
import contextlib
import io
import os
import stat
import subprocess
import json
import re
import sys
import tarfile
import tempfile
import unittest
import unittest.mock
from pathlib import Path
from unittest.mock import patch
from deploy.backup import artifact as backup_artifact
from deploy.backup import quiet as backup_quiet
from tools.shared_saas_lifecycle import odoo_effect
try:
    from tools.shared_saas_lifecycle import odoo_backup
except ImportError:
    odoo_backup = None

class BackupBoundaryTests(unittest.TestCase):
    def test_global_gate_is_not_reclaimed_after_interrupted_owner(self):
        self.assertTrue(hasattr(odoo_effect, 'RuntimeGate'))
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw).resolve()
            first = odoo_effect.RuntimeGate(root, {'attemptId': 'first'})
            first.acquire()
            with self.assertRaises(odoo_effect.EffectError):
                odoo_effect.RuntimeGate(root, {'attemptId': 'other-tenant'}).acquire()
            with self.assertRaises(odoo_effect.EffectError):
                odoo_effect.RuntimeGate(root, {'attemptId': 'first'}).acquire()
            self.assertTrue((root / 'runtime-gate').exists())
            first.complete()
            second = odoo_effect.RuntimeGate(root, {'attemptId': 'second'})
            second.acquire()
            second.complete()

    def test_lost_release_authority_keeps_the_global_gate(self):
        with tempfile.TemporaryDirectory() as raw:
            runner = object.__new__(odoo_effect.Runner)
            runner.root = Path(raw).resolve()
            runner.request = {'attemptId':'one','fence':1,'payloadDigest':'a'*64}
            calls = []
            runner.assert_no_effect_containers = lambda **_: calls.append('drained')
            runner.apply = lambda: calls.append('effect')
            def permit(stage):
                if stage == 'release': raise odoo_effect.EffectError('authority_lost')
            with patch.object(odoo_effect,'permit',permit), self.assertRaises(odoo_effect.EffectError):
                runner.apply_owned()
            self.assertEqual(calls,['drained','effect'])
            self.assertTrue((runner.root/'runtime-gate'/'owner.json').exists())
            with self.assertRaises(odoo_effect.EffectError):
                odoo_effect.RuntimeGate(runner.root,{'attemptId':'second'}).acquire()

    def test_reads_structured_helper_output_with_compose_progress_on_stderr(self):
        runner = object.__new__(odoo_backup.BackupRunner)
        def command_args(*_):
            return [sys.executable, '-c',
                    "import sys; print(' Container scratch-helper Creating', file=sys.stderr); print('{\"projects\": 2}')"]
        runner.helper_args = command_args
        self.assertEqual(json.loads(runner.helper('odoo', 'inventory', '')), {'projects': 2})

    def test_capture_checks_writers_before_stopping_odoo(self):
        self.assertTrue(odoo_backup)
        with tempfile.TemporaryDirectory() as raw:
            runner = object.__new__(odoo_backup.BackupRunner)
            runner.root = Path(raw).resolve()
            runner.config = {'projectName': 'liwan-shared-test'}
            commands = []
            def command(args, **_):
                commands.append(args)
                return 'liwan-shared-test-effect-12345678-observe-abcd1234' if args[:2] == ['docker', 'ps'] else ''
            runner.command = command
            stages = []
            with patch.object(odoo_effect, 'permit', stages.append), patch.object(odoo_backup, 'permit', stages.append):
                with self.assertRaises(odoo_effect.EffectError):
                    runner.capture()
            self.assertEqual(stages, [])
            self.assertFalse(any('stop' in args for args in commands))
            self.assertFalse((runner.root / 'backups').exists())

    def drain_runner(self, observers):
        runner = object.__new__(odoo_backup.BackupRunner)
        runner.config = {'projectName': 'liwan-shared-test'}
        commands = []
        live = list(observers)
        def command(args, **_):
            commands.append(args)
            if args[:2] == ['docker', 'ps']:
                return '\n'.join(live)
            if args[:2] == ['docker', 'kill']:
                live.remove(args[2])
            return ''
        runner.command = command
        return runner, commands, live

    def test_observers_are_waited_for_then_killed_after_the_budget(self):
        name = 'liwan-shared-test-effect-12345678-observe-abcd1234'
        runner, commands, live = self.drain_runner([name, 'liwan-shared-test-odoo-1'])
        now = [0]
        def sleep(seconds): now[0] += seconds
        def run(args, **kwargs):
            commands.append(args)
            self.assertIs(kwargs.get('check'), False); self.assertEqual(kwargs.get('timeout'), 15)
            live.remove(args[2])
        with patch.object(odoo_backup.subprocess, 'run', run):
            runner.drain_observers(wait=35, sleep=sleep, clock=lambda: now[0])
        self.assertGreaterEqual(now[0], 35)
        self.assertIn(['docker', 'kill', name], commands)
        self.assertEqual(live, ['liwan-shared-test-odoo-1'])

    def test_observer_gone_before_the_kill_does_not_fail_the_drain(self):
        name = 'liwan-shared-test-effect-12345678-observe-abcd1234'
        runner, commands, live = self.drain_runner([name])
        now = [0]
        def sleep(seconds): now[0] += seconds
        # `docker kill` exits non-zero ("No such container"); with check=False nothing is raised.
        failed = unittest.mock.Mock(returncode=1)
        with patch.object(odoo_backup.subprocess, 'run', return_value=failed) as run:
            runner.drain_observers(wait=2, sleep=sleep, clock=lambda: now[0])
        run.assert_called_once()
        self.assertFalse(run.call_args.kwargs['check'])
        # The writer check afterwards decides: nothing left running means no refusal.
        live.clear()
        runner.assert_no_effect_containers(code='runtime_writer_after_effect')

    def test_observer_that_exits_in_time_is_not_killed(self):
        name = 'liwan-shared-test-effect-12345678-observe-abcd1234'
        runner, commands, live = self.drain_runner([name])
        now = [0]
        def sleep(seconds):
            now[0] += seconds
            if now[0] >= 3: live.clear()
        runner.drain_observers(wait=35, sleep=sleep, clock=lambda: now[0])
        self.assertEqual(now[0], 3)
        self.assertFalse(any(args[:2] == ['docker', 'kill'] for args in commands))

    def test_mutating_effect_after_stop_refuses_with_the_after_effect_code(self):
        runner = object.__new__(odoo_backup.BackupRunner)
        runner.config = {'projectName': 'liwan-shared-test'}
        runner.command = lambda args, **_: 'liwan-shared-test-effect-12345678-install'
        with self.assertRaises(odoo_effect.EffectError) as caught:
            runner.assert_no_effect_containers(code='runtime_writer_after_effect')
        self.assertEqual(str(caught.exception), 'runtime_writer_after_effect')

    def run_main(self, error):
        import contextlib, io as _io, json
        class Boom:
            def __init__(self, request): pass
            def apply_owned(self): raise error
        out = _io.StringIO()
        with patch.object(odoo_backup, 'BackupRunner', Boom), patch('sys.stdin', _io.StringIO('{"action":"apply"}\n')), contextlib.redirect_stdout(out):
            code = odoo_backup.main()
        return code, json.loads(out.getvalue())

    def test_main_reports_writer_refusals_by_name_and_hides_everything_else(self):
        for name in ('runtime_writer_present', 'runtime_writer_after_effect'):
            self.assertEqual(self.run_main(odoo_effect.EffectError(name)), (1, {'error_code': name}))
        self.assertEqual(self.run_main(odoo_effect.EffectError('secret_path_/x')), (1, {'error_code': 'shared_effect_unverified'}))
        self.assertEqual(self.run_main(RuntimeError('boom')), (1, {'error_code': 'shared_effect_unverified'}))

    def test_restore_observe_writer_after_completion_is_not_retryable(self):
        import json
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw).resolve()
            runner = object.__new__(odoo_backup.BackupRunner)
            runner.config = {'projectName': 'liwan-shared-test'}
            runner.command = lambda args, **_: 'liwan-shared-test-effect-12345678-install'
            runner.preflight = lambda: None
            runner.root, runner.operation = root, 'restore'
            runner.complete_path = root / 'complete.json'
            runner.target, runner.backup_id = 'target', 'backup'
            runner.authority = {'approvalId': 'approval', 'manifestSha256': 'digest'}
            runner.request = {'payloadDigest': 'payload'}
            runner.complete_path.write_text(json.dumps({'approvalId': 'approval', 'backupId': 'backup',
                'targetDatabase': 'target', 'digest': 'payload', 'manifestSha256': 'digest'}))
            with self.assertRaisesRegex(odoo_effect.EffectError, '^runtime_writer_after_effect$'):
                runner.observe()

    def test_database_binary_corruption_fails_without_exposing_bytes(self):
        self.assertTrue(hasattr(odoo_backup, 'database_attachment_digest'))
        original = b'private attachment content'
        checksum = hashlib.sha1(original).hexdigest()
        chunks = lambda start, length: original[start:start+length]
        result = odoo_backup.database_attachment_digest('binary', checksum, len(original), len(original), chunks)
        self.assertEqual(result, {'sha256':hashlib.sha256(original).hexdigest(),'size':len(original)})
        self.assertNotIn(original.decode(), str(result))
        with self.assertRaises(odoo_effect.EffectError):
            odoo_backup.database_attachment_digest('binary', checksum, len(original), len(original), lambda start,length:b'x'*length)
        with self.assertRaises(odoo_effect.EffectError):
            odoo_backup.database_attachment_digest('binary', checksum, len(original)+1, len(original), chunks)
        with self.assertRaises(odoo_effect.EffectError):
            odoo_backup.database_attachment_digest('binary', checksum, len(original), None, chunks)
        self.assertIsNone(odoo_backup.database_attachment_digest('url', None, 0, None, lambda *_:self.fail('URL read')))
        self.assertEqual(odoo_backup.database_attachment_digest('binary', None, 0, None, lambda *_:self.fail('empty read')), {'sha256':hashlib.sha256(b'').hexdigest(),'size':0})
        with self.assertRaises(odoo_effect.EffectError):
            odoo_backup.database_attachment_digest('binary', 'a'*40, 65*1024*1024, 65*1024*1024, lambda *_:self.fail('oversized read'))

    def archive(self, root, entries):
        path = root / 'filestore.tar'
        with tarfile.open(path, 'w') as archive:
            for name, kind in entries:
                info = tarfile.TarInfo(name)
                info.type = kind
                if kind == tarfile.REGTYPE:
                    info.size = 3
                if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE):
                    info.linkname = '../escape'
                archive.addfile(info, io.BytesIO(b'abc') if kind == tarfile.REGTYPE else None)
        return path

    def test_archive_rejects_traversal_links_duplicates_and_special_files(self):
        self.assertIsNotNone(odoo_backup)
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw).resolve()
            for entries in [
                [('../escape', tarfile.REGTYPE)], [('/absolute', tarfile.REGTYPE)],
                [('a/../../escape', tarfile.REGTYPE)], [('a\\escape', tarfile.REGTYPE)],
                [('a', tarfile.SYMTYPE)], [('a', tarfile.LNKTYPE)], [('a', tarfile.FIFOTYPE)],
                [('a', tarfile.REGTYPE), ('a', tarfile.REGTYPE)],
                [('a', tarfile.REGTYPE), ('a/b', tarfile.REGTYPE)],
                [('a/b', tarfile.REGTYPE), ('a', tarfile.REGTYPE)],
            ]:
                with self.subTest(entries=entries), self.assertRaises(odoo_effect.EffectError):
                    odoo_backup.validate_archive(self.archive(root, entries))
            self.assertEqual(odoo_backup.validate_archive(self.archive(root, [('aa/file', tarfile.REGTYPE)])), 1)

    def test_artifact_hash_tampering_is_rejected(self):
        self.assertIsNotNone(odoo_backup)
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw).resolve() / 'dump'
            path.write_bytes(b'original')
            expected = odoo_backup.sha256_file(path)
            path.write_bytes(b'tampered')
            with self.assertRaises(odoo_effect.EffectError):
                odoo_backup.require_hash(path, expected)


class StdinWriteTests(unittest.TestCase):
    """A Compose client that never drains its stdin must not block the effect past its own timeout."""
    def test_a_client_that_never_reads_stdin_times_out_instead_of_blocking_the_write(self):
        runner = object.__new__(odoo_effect.Runner)
        runner.child = None
        runner.current_container = None
        with self.assertRaises(odoo_effect.EffectError) as caught:
            runner.command([sys.executable, '-c', 'import time; time.sleep(30)'], stdin='x' * (1024 * 1024), timeout=1)
        self.assertEqual(str(caught.exception), 'runtime_timeout')

    def test_stdin_is_delivered_and_closed_for_a_client_that_reads_it(self):
        runner = object.__new__(odoo_effect.Runner)
        runner.child = None
        runner.current_container = None
        script = 'import sys; print(len(sys.stdin.buffer.read()))'
        self.assertEqual('4', runner.command([sys.executable, '-c', script], stdin='rows').strip())


class CaptureRestartTests(unittest.TestCase):
    """Odoo is shared by every tenant: once stopped, a capture must always start it again."""
    STEPS = ('stop', 'writers_not_stopped', 'drain_observers', 'assert_no_effect_containers', 'drain_check',
             'dump', 'pack', 'inventory', 'check_files', 'validate_archive', 'sha256_file', 'encrypt', 'resume_permit')

    def capture_runner(self, root, fail_at=None, fail_start=False):
        runner = object.__new__(odoo_backup.BackupRunner)
        runner.root = root
        runner.base = ['compose']
        runner.config = {'projectName': 'liwan-shared-test'}
        runner.database = 'liwan_scratch_a'
        runner.backup_id = '00000000-0000-4000-8000-000000000000'
        runner.artifact = root / 'backups' / runner.backup_id
        runner.authority = {'controlTenantId': 'tenant'}
        runner.request = {'payloadDigest': 'd', 'attemptId': 'attempt01', 'businessKey': 'b', 'job': {'binding': {}}}
        runner.commands = []
        boom = odoo_effect.EffectError('boom')
        def maybe(step):
            if step == fail_at:
                raise boom
        def command(args, **_):
            runner.commands.append(args)
            if 'stop' in args:
                maybe('stop')
            if 'start' in args and fail_start:
                raise odoo_effect.EffectError('compose_down')
            if 'psql' in args:
                maybe('drain_check')
                return '0\n'
            return ''
        runner.command = command
        runner.assert_no_effect_containers = lambda **_: maybe('assert_no_effect_containers') if runner.commands else None
        runner.inspect_service = lambda _service: {'Image': 'image', 'State': {'Running': fail_at == 'writers_not_stopped'}}
        runner.drain_observers = lambda: maybe('drain_observers')
        runner.dump_database_to = lambda _destination: maybe('dump')
        runner.stream = lambda *_, **__: maybe('pack')
        runner.inventory = lambda *_: maybe('inventory') or {'attachments': []}
        runner.check_files = lambda *_: maybe('check_files')
        runner.passphrase_file = lambda: Path(root) / 'passphrase'
        runner.wait_healthy = lambda _service: None
        runner.verify_originals = lambda: None
        runner.read_artifact = lambda: None
        return runner, boom

    def capture(self, runner, fail_at):
        def validate(_path):
            if fail_at == 'validate_archive':
                raise odoo_effect.EffectError('boom')
        def sha(_path):
            if fail_at == 'sha256_file':
                raise odoo_effect.EffectError('boom')
            return 'a' * 64
        def permit(stage):
            if stage == 'resume' and fail_at == 'resume_permit':
                raise odoo_effect.EffectError('boom')
        def encrypt(_plaintext, ciphertext, **_kwargs):
            if fail_at == 'encrypt':
                raise odoo_effect.EffectError('boom')
            Path(ciphertext).write_bytes(b'ciphertext')
            return 'b' * 64
        with patch.object(odoo_backup, 'permit', permit), patch.object(odoo_backup, 'reserve', lambda path, _value: Path(path).write_text('{}')), \
                patch.object(odoo_backup, 'validate_archive', validate), patch.object(odoo_backup, 'sha256_file', sha), \
                patch.object(odoo_backup.backup_artifact, 'encrypt_file', encrypt):
            runner.capture()

    def started(self, runner):
        return [args for args in runner.commands if args[-2:] == ['start', 'odoo']]

    def test_odoo_is_started_again_when_any_step_after_the_stop_fails(self):
        for step in self.STEPS:
            with self.subTest(step=step), tempfile.TemporaryDirectory() as raw:
                runner, _ = self.capture_runner(Path(raw).resolve(), fail_at=step)
                with self.assertRaises(odoo_effect.EffectError) as caught:
                    self.capture(runner, step)
                expected = 'writers_not_stopped' if step == 'writers_not_stopped' else 'boom'
                self.assertEqual(str(caught.exception), expected)
                self.assertEqual(len(self.started(runner)), 1)

    def test_two_termination_signals_in_a_row_still_start_odoo_once_and_complete_it(self):
        # systemd (KillMode=control-group) and the gate both signal the group: the second SIGTERM arrives while the restart runs.
        import os, signal
        saved = {signum: signal.getsignal(signum) for signum in odoo_effect.TERMINATION_SIGNALS}
        self.addCleanup(lambda: [signal.signal(signum, handler) for signum, handler in saved.items()])
        self.addCleanup(signal.pthread_sigmask, signal.SIG_UNBLOCK, odoo_effect.TERMINATION_SIGNALS)
        with tempfile.TemporaryDirectory() as raw:
            runner, _ = self.capture_runner(Path(raw).resolve())
            runner.cancel = lambda: None
            finished, detached = [], []
            plain = runner.command
            def command(args, **kwargs):
                if args[-2:] == ['start', 'odoo']:
                    detached.append(kwargs.get('detached'))
                    os.kill(os.getpid(), signal.SIGTERM)  # the second signal, during the restart
                    os.kill(os.getpid(), signal.SIGHUP)
                    finished.append(args)
                    return ''
                return plain(args, **kwargs)
            runner.command = command
            runner.dump_database_to = lambda _destination: os.kill(os.getpid(), signal.SIGTERM)  # the first signal, during the dump
            odoo_effect.install_termination_handler(runner)
            with self.assertRaises(odoo_effect.EffectError) as caught:
                self.capture(runner, None)
            self.assertEqual(str(caught.exception), 'authority_lost')
            self.assertEqual(len(finished), 1)
            self.assertEqual(detached, [True])  # own session, signals ignored

    def test_the_first_termination_signal_during_the_restart_does_not_kill_it(self):
        # A non-signal failure stops odoo; the restart is the only command that brings it back for every tenant, so a
        # SIGTERM that arrives while it runs must neither cancel it nor abort it (no `odoo_restart_failed`).
        import os, signal
        saved = {signum: signal.getsignal(signum) for signum in odoo_effect.TERMINATION_SIGNALS}
        self.addCleanup(lambda: [signal.signal(signum, handler) for signum, handler in saved.items()])
        self.addCleanup(signal.pthread_sigmask, signal.SIG_UNBLOCK, odoo_effect.TERMINATION_SIGNALS)
        with tempfile.TemporaryDirectory() as raw:
            runner, _ = self.capture_runner(Path(raw).resolve(), fail_at='inventory')
            cancelled, finished, detached = [], [], []
            runner.cancel = lambda: cancelled.append(True)
            plain = runner.command
            def command(args, **kwargs):
                if args[-2:] == ['start', 'odoo']:
                    detached.append(kwargs.get('detached'))
                    os.kill(os.getpid(), signal.SIGTERM)  # the first signal, during the restart
                    finished.append(args)
                    return ''
                return plain(args, **kwargs)
            runner.command = command
            odoo_effect.install_termination_handler(runner)
            with self.assertRaises(odoo_effect.EffectError) as caught:
                self.capture(runner, 'inventory')
            self.assertEqual(str(caught.exception), 'boom')  # the original failure, not a killed restart
            self.assertEqual(cancelled, [])
            self.assertEqual(len(finished), 1)
            self.assertEqual(detached, [True])  # own session, signals ignored

    def test_a_termination_signal_in_the_cleanup_path_still_starts_odoo_and_is_handled_after(self):
        # A first SIGTERM that lands between entering the cleanup and the start of the restart would raise
        # `authority_lost` right there and skip the start, leaving odoo down for every tenant. It is held pending
        # instead and still cancels the run once odoo is back up.
        import os, signal
        saved = {signum: signal.getsignal(signum) for signum in odoo_effect.TERMINATION_SIGNALS}
        self.addCleanup(lambda: [signal.signal(signum, handler) for signum, handler in saved.items()])
        self.addCleanup(signal.pthread_sigmask, signal.SIG_UNBLOCK, odoo_effect.TERMINATION_SIGNALS)
        with tempfile.TemporaryDirectory() as raw:
            runner, _ = self.capture_runner(Path(raw).resolve(), fail_at='inventory')
            cancelled, finished, detached = [], [], []
            runner.cancel = lambda: cancelled.append(True)
            restart = runner.restart_after_failure
            def restart_after_failure():
                os.kill(os.getpid(), signal.SIGTERM)  # the first signal, in the cleanup path before the restart
                restart()
            runner.restart_after_failure = restart_after_failure
            plain = runner.command
            def command(args, **kwargs):
                if args[-2:] == ['start', 'odoo']:
                    detached.append(kwargs.get('detached'))
                    finished.append(args)
                    return ''
                return plain(args, **kwargs)
            runner.command = command
            odoo_effect.install_termination_handler(runner)
            with self.assertRaises(odoo_effect.EffectError) as caught:
                self.capture(runner, 'inventory')
            self.assertEqual(str(caught.exception), 'authority_lost')  # the signal is handled, after the restart
            self.assertEqual(cancelled, [True])
            self.assertEqual(len(finished), 1)
            self.assertEqual(detached, [True])  # own session, signals ignored

    def test_a_termination_signal_beside_a_live_command_thread_still_starts_odoo_and_is_handled_after(self):
        # A timed-out command can leave its feeder thread alive (a surviving grandchild holds the pipe, and only the
        # feeder is joined on the timeout path). A process-directed SIGTERM accepted by such a thread is consumed
        # instead of staying pending for the main thread, defeating the restart shield no matter when the handler
        # fires. The command threads are started with the signals blocked, so the signal stays pending and aborts the
        # run only after odoo is back up.
        import os, signal, time
        saved = {signum: signal.getsignal(signum) for signum in odoo_effect.TERMINATION_SIGNALS}
        self.addCleanup(lambda: [signal.signal(signum, handler) for signum, handler in saved.items()])
        self.addCleanup(signal.pthread_sigmask, signal.SIG_UNBLOCK, odoo_effect.TERMINATION_SIGNALS)
        with tempfile.TemporaryDirectory() as raw:
            runner, _ = self.capture_runner(Path(raw).resolve())
            runner.current_container = None
            finished, detached = [], []
            restart = runner.restart_after_failure
            def restart_after_failure():
                os.kill(os.getpid(), signal.SIGTERM)  # the first signal, in the cleanup path beside the live feeder
                # Give the kernel a moment to deliver: with the command threads' masks blocked nobody accepts the
                # signal and it stays pending for the whole wait; an unblocked feeder consumes it within moments.
                for _ in range(50):
                    if not signal.sigpending():
                        break
                    time.sleep(0.01)
                self.assertTrue(signal.sigpending())  # the live feeder must not have consumed it
                restart()
            runner.restart_after_failure = restart_after_failure
            plain = runner.command
            real = odoo_effect.Runner.command.__get__(runner)
            def command(args, **kwargs):
                if 'stop' in args:
                    stuck = ('import subprocess, sys, time;'
                             'subprocess.Popen([sys.executable, "-c", "import time; time.sleep(8)"],'
                             ' stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(8)')
                    # The real command times out with its feeder thread still alive, blocked on the grandchild's pipe.
                    return real([sys.executable, '-c', stuck], stdin='x' * (1024 * 1024), timeout=1)
                if args[-2:] == ['start', 'odoo']:
                    detached.append(kwargs.get('detached'))
                    finished.append(args)
                    return ''
                return plain(args, **kwargs)
            runner.command = command
            odoo_effect.install_termination_handler(runner)
            with self.assertRaises(odoo_effect.EffectError) as caught:
                self.capture(runner, None)
            self.assertEqual(str(caught.exception), 'authority_lost')  # the signal is handled, after the restart
            self.assertEqual(len(finished), 1)
            self.assertEqual(detached, [True])  # own session, signals ignored

    def test_a_termination_signal_in_the_normal_start_cleanup_still_starts_odoo_and_is_handled_after(self):
        # The second cleanup path (a failure in the normal `start odoo`) is shielded the same way: a SIGTERM landing
        # between entering it and the restart must not skip the restart either.
        import os, signal
        saved = {signum: signal.getsignal(signum) for signum in odoo_effect.TERMINATION_SIGNALS}
        self.addCleanup(lambda: [signal.signal(signum, handler) for signum, handler in saved.items()])
        self.addCleanup(signal.pthread_sigmask, signal.SIG_UNBLOCK, odoo_effect.TERMINATION_SIGNALS)
        with tempfile.TemporaryDirectory() as raw:
            runner, _ = self.capture_runner(Path(raw).resolve())
            cancelled, finished, detached = [], [], []
            runner.cancel = lambda: cancelled.append(True)
            restart = runner.restart_after_failure
            def restart_after_failure():
                os.kill(os.getpid(), signal.SIGTERM)  # the first signal, in the cleanup path before the restart
                restart()
            runner.restart_after_failure = restart_after_failure
            plain = runner.command
            def command(args, **kwargs):
                if args[-2:] == ['start', 'odoo'] and not kwargs.get('detached'):
                    raise odoo_effect.EffectError('compose_down')  # the normal start fails
                if args[-2:] == ['start', 'odoo']:
                    detached.append(kwargs.get('detached'))
                    finished.append(args)
                    return ''
                return plain(args, **kwargs)
            runner.command = command
            odoo_effect.install_termination_handler(runner)
            with self.assertRaises(odoo_effect.EffectError) as caught:
                self.capture(runner, None)
            self.assertEqual(str(caught.exception), 'authority_lost')  # the signal is handled, after the restart
            self.assertEqual(cancelled, [True])
            self.assertEqual(len(finished), 1)
            self.assertEqual(detached, [True])  # own session, signals ignored

    def test_a_second_signal_during_the_restart_discards_the_held_one_with_the_original_error(self):
        # While the first signal is held pending, a second one that arrives during the restart runs the handler, whose
        # `ignore_termination()` ignores every termination signal for the rest of the process: the held signal is
        # discarded when the mask is restored, and the run fails with the original error instead of `authority_lost`.
        import os, signal
        saved = {signum: signal.getsignal(signum) for signum in odoo_effect.TERMINATION_SIGNALS}
        self.addCleanup(lambda: [signal.signal(signum, handler) for signum, handler in saved.items()])
        self.addCleanup(signal.pthread_sigmask, signal.SIG_UNBLOCK, odoo_effect.TERMINATION_SIGNALS)
        with tempfile.TemporaryDirectory() as raw:
            runner, _ = self.capture_runner(Path(raw).resolve(), fail_at='inventory')
            cancelled, finished, detached = [], [], []
            runner.cancel = lambda: cancelled.append(True)
            restart = runner.restart_after_failure
            def restart_after_failure():
                os.kill(os.getpid(), signal.SIGTERM)  # the first signal, held pending in the cleanup path
                restart()
            runner.restart_after_failure = restart_after_failure
            plain = runner.command
            def command(args, **kwargs):
                if args[-2:] == ['start', 'odoo']:
                    detached.append(kwargs.get('detached'))
                    os.kill(os.getpid(), signal.SIGINT)  # the second, different signal, during the restart
                    finished.append(args)
                    return ''
                return plain(args, **kwargs)
            runner.command = command
            odoo_effect.install_termination_handler(runner)
            with self.assertRaises(odoo_effect.EffectError) as caught:
                self.capture(runner, 'inventory')
            self.assertEqual(str(caught.exception), 'boom')  # the original error; the held signal was discarded
            self.assertEqual(cancelled, [])  # no authority_lost anywhere
            self.assertEqual(len(finished), 1)
            self.assertEqual(detached, [True])  # own session, signals ignored

    def test_a_held_signal_does_not_replace_a_failed_restart_with_authority_lost(self):
        # The control plane keys on `odoo_restart_failed` to learn that odoo is down for every tenant. A SIGTERM held
        # pending in the cleanup path is delivered on the caller's mask restore while that failure is unwinding, and
        # its handler would replace it with `authority_lost` (`shared_effect_unverified` for the operator), so the
        # failing restart ignores the termination signals first and the held signal is discarded.
        import os, signal
        saved = {signum: signal.getsignal(signum) for signum in odoo_effect.TERMINATION_SIGNALS}
        self.addCleanup(lambda: [signal.signal(signum, handler) for signum, handler in saved.items()])
        self.addCleanup(signal.pthread_sigmask, signal.SIG_UNBLOCK, odoo_effect.TERMINATION_SIGNALS)
        with tempfile.TemporaryDirectory() as raw:
            runner, boom = self.capture_runner(Path(raw).resolve(), fail_at='inventory', fail_start=True)
            cancelled = []
            runner.cancel = lambda: cancelled.append(True)
            restart = runner.restart_after_failure
            def restart_after_failure():
                os.kill(os.getpid(), signal.SIGTERM)  # the first signal, held pending in the cleanup path
                restart()
            runner.restart_after_failure = restart_after_failure
            odoo_effect.install_termination_handler(runner)
            with self.assertRaises(odoo_effect.EffectError) as caught:
                self.capture(runner, 'inventory')
            self.assertEqual(str(caught.exception), 'odoo_restart_failed')
            self.assertEqual(str(caught.exception.__cause__), 'compose_down')
            self.assertIs(caught.exception.__cause__.__context__, boom)
            self.assertEqual(cancelled, [])  # the held signal is discarded, not turned into authority_lost
            self.assertEqual(len(self.started(runner)), 1)

    def test_a_successful_capture_starts_odoo_once(self):
        with tempfile.TemporaryDirectory() as raw:
            runner, _ = self.capture_runner(Path(raw).resolve())
            self.capture(runner, None)
            self.assertEqual(len(self.started(runner)), 1)

    def test_a_failed_restart_is_reported_explicitly_with_the_original_error_attached(self):
        import signal
        # A failed restart ignores the termination signals; restore the test process's dispositions afterwards.
        saved = {signum: signal.getsignal(signum) for signum in odoo_effect.TERMINATION_SIGNALS}
        self.addCleanup(lambda: [signal.signal(signum, handler) for signum, handler in saved.items()])
        with tempfile.TemporaryDirectory() as raw:
            runner, boom = self.capture_runner(Path(raw).resolve(), fail_at='inventory', fail_start=True)
            with self.assertRaises(odoo_effect.EffectError) as caught:
                self.capture(runner, 'inventory')
            self.assertEqual(str(caught.exception), 'odoo_restart_failed')
            self.assertEqual(str(caught.exception.__cause__), 'compose_down')
            self.assertIs(caught.exception.__cause__.__context__, boom)


class ArtifactModeTests(unittest.TestCase):
    """The artifact directory is 0750 for the worker's group: only the manifest is meant to be read there."""

    def test_streamed_artifacts_are_created_0600_even_under_umask_zero(self):
        runner = object.__new__(odoo_backup.BackupRunner)
        modes = []
        real_open = os.open

        def recording_open(path, flags, mode=0o777, **kwargs):
            modes.append(mode)
            return real_open(path, flags, mode, **kwargs)
        old = os.umask(0)
        try:
            with tempfile.TemporaryDirectory() as raw, patch.object(odoo_backup.os, 'open', recording_open):
                destination = Path(raw) / 'database.dump'
                runner.stream(['sh', '-c', 'echo data'], destination=destination)
                self.assertEqual(modes[0], 0o600)
                self.assertEqual(stat.S_IMODE(destination.stat().st_mode), 0o600)
        finally:
            os.umask(old)

    def test_a_captured_artifact_has_a_0750_directory_and_only_the_manifest_group_readable(self):
        runner = CaptureRestartTests().capture_runner(Path(tempfile.mkdtemp()).resolve())[0]

        def create(*_args, destination=None, **_kwargs):
            if destination:
                os.close(os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600))
        def encrypt(_plaintext, ciphertext, **_kwargs):
            # What openssl writes with this umask; the capture itself tightens it to 0600.
            Path(ciphertext).write_bytes(b'ciphertext')
            return 'b' * 64
        runner.stream = create
        runner.dump_database_to = create
        old = os.umask(0o007)
        try:
            with patch.object(odoo_backup, 'permit', lambda _stage: None), \
                    patch.object(odoo_backup, 'validate_archive', lambda _path: None), \
                    patch.object(odoo_backup, 'sha256_file', lambda _path: 'a' * 64), \
                    patch.object(odoo_backup.backup_artifact, 'encrypt_file', encrypt):
                runner.capture()
        finally:
            os.umask(old)
        modes = {entry.name: stat.S_IMODE(entry.stat().st_mode) for entry in runner.artifact.iterdir()}
        self.assertEqual(stat.S_IMODE(runner.artifact.stat().st_mode), 0o750)
        self.assertEqual(modes['manifest.json'], 0o640)
        self.assertEqual({name: mode for name, mode in modes.items() if name != 'manifest.json'},
                         {'database.dump.enc': 0o600, 'filestore.tar.enc': 0o600, 'reservation.json': 0o600})


class ArtifactEncryptionTests(unittest.TestCase):
    """Console artifacts are encrypted per file: only ciphertext outlives a capture or a restore."""

    PASSPHRASE = 'one console backup passphrase'
    DATABASE = 'liwan_scratch_' + 'a' * 32

    def runner(self, root):
        runner = object.__new__(odoo_backup.BackupRunner)
        runner.root = root
        runner.database = self.DATABASE
        runner.base = ['compose']
        runner.config = {'projectName': 'liwan-shared-test'}
        runner.backup_id = '00000000-0000-4000-8000-000000000000'
        runner.artifact = root / 'backups' / runner.backup_id
        runner.authority = {'controlTenantId': 'tenant'}
        runner.request = {'payloadDigest': 'd', 'attemptId': 'attempt01', 'businessKey': 'b', 'job': {'binding': {}}}
        runner.operation = 'backup'
        runner.current_container = None
        runner.child = None
        return runner

    def passphrase(self, root):
        path = root / 'passphrase'
        path.write_text(self.PASSPHRASE + '\n', encoding='utf-8')
        path.chmod(0o600)
        return path

    def archive(self, destination):
        with tarfile.open(destination, 'w') as out:
            payload = b'abc'
            info = tarfile.TarInfo('ab/file')
            info.size = len(payload)
            out.addfile(info, io.BytesIO(payload))

    def captured(self, root):
        """One capture_while_stopped through the package's real encryption."""
        runner = self.runner(root)
        passphrase = self.passphrase(root)
        runner.artifact.mkdir(parents=True, mode=0o750)
        dump = b'custom format archive' * 128
        runner.inspect_service = lambda _service: {'State': {'Running': False}}
        runner.drain_observers = lambda: None
        runner.assert_no_effect_containers = lambda **_kwargs: None
        runner.command = lambda *_args, **_kwargs: '0\n'
        runner.dump_database_to = lambda destination: Path(destination).write_bytes(dump)
        runner.stream = lambda _args, destination=None, **_kwargs: self.archive(destination)
        runner.inventory = lambda *_args: {'attachments': []}
        runner.check_files = lambda *_args: None
        runner.passphrase_file = lambda: passphrase
        with patch.object(odoo_backup, 'permit', lambda _stage: None):
            manifest = runner.capture_while_stopped('sha256:' + 'a' * 64, 'sha256:' + 'b' * 64)
        return runner, manifest, dump, passphrase

    def test_the_dump_runs_the_package_argv_inside_the_db_container(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw).resolve()
            runner = self.runner(root)
            calls = []
            runner.stream = lambda args, **kwargs: calls.append((args, kwargs))
            destination = root / 'database.dump'
            runner.dump_database_to(destination)
        args, kwargs = calls[0]
        self.assertEqual(args[:9], ['compose', 'run', '--rm', '--no-deps', '-T', '--name',
                                    'liwan-shared-test-effect-attempt0-dump', '--entrypoint', '/bin/sh'])
        self.assertEqual(args[9:13], ['db', '-c', odoo_backup.DUMP_SCRIPT, 'sh'])
        self.assertEqual(args[13:], ['pg_dump', '-Fc', '--serializable-deferrable', '--no-password',
                                     '-d', self.DATABASE, '-f', '-', '-h', 'db', '-U', 'postgres'])
        self.assertEqual(kwargs['destination'], destination)
        # The secret travels through the service environment: never a password flag, never a value.
        self.assertFalse({'-W', '--password'} & set(args))
        self.assertEqual(args.count(odoo_backup.DUMP_SCRIPT), 1)

    def test_a_capture_writes_ciphertext_and_keeps_the_plaintext_digests_it_promised(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw).resolve()
            runner, manifest, dump, passphrase = self.captured(root)
            self.assertEqual(sorted(entry.name for entry in runner.artifact.iterdir()),
                             ['database.dump.enc', 'filestore.tar.enc'])
            self.assertEqual(manifest['databaseSha256'], hashlib.sha256(dump).hexdigest())
            self.assertEqual(manifest['cipher'], 'aes-256-cbc-pbkdf2')
            for name, digest_field, size_field in ((odoo_backup.CIPHERTEXT_DUMP, 'databaseCiphertextSha256', 'databaseCiphertextBytes'),
                                                   (odoo_backup.CIPHERTEXT_ARCHIVE, 'filestoreCiphertextSha256', 'filestoreCiphertextBytes')):
                ciphertext = runner.artifact / name
                self.assertEqual(manifest[digest_field], hashlib.sha256(ciphertext.read_bytes()).hexdigest())
                self.assertEqual(manifest[size_field], ciphertext.stat().st_size)
                self.assertEqual(stat.S_IMODE(ciphertext.stat().st_mode), 0o600)
            # The ciphertext decrypts back to exactly the plaintext the manifest pinned.
            roundtrip = root / 'roundtrip.dump'
            digest = backup_artifact.decrypt_file(
                runner.artifact / odoo_backup.CIPHERTEXT_DUMP, roundtrip, passphrase_file=passphrase)
            self.assertEqual((digest, roundtrip.read_bytes()), (manifest['databaseSha256'], dump))

    def test_a_restore_decrypts_into_a_0600_file_that_is_gone_when_the_block_ends(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw).resolve()
            runner, manifest, dump, _passphrase = self.captured(root)
            (runner.artifact / 'manifest.json').write_text(json.dumps(manifest))
            runner.operation = 'restore'
            runner.authority = {'controlTenantId': 'tenant', 'databaseSha256': manifest['databaseSha256'],
                                'filestoreSha256': manifest['filestoreSha256']}
            with runner.artifact_plaintext(runner.read_artifact()) as (plain_dump, plain_archive):
                self.assertEqual(stat.S_IMODE(plain_dump.stat().st_mode), 0o600)
                self.assertEqual(stat.S_IMODE(plain_archive.stat().st_mode), 0o600)
                self.assertEqual(plain_dump.read_bytes(), dump)
                self.assertEqual(odoo_backup.validate_archive(plain_archive), 1)
                self.assertNotEqual(plain_dump.parent, runner.artifact)
            self.assertEqual(sorted(entry.name for entry in runner.artifact.iterdir()),
                             ['database.dump.enc', 'filestore.tar.enc', 'manifest.json'])

    def test_an_artifact_captured_before_encryption_is_still_readable(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw).resolve()
            runner = self.runner(root)
            runner.artifact.mkdir(parents=True)
            (runner.artifact / odoo_backup.PLAINTEXT_DUMP).write_bytes(b'older plaintext dump')
            self.archive(runner.artifact / odoo_backup.PLAINTEXT_ARCHIVE)
            manifest = {'schemaVersion': 1, 'format': 'odoo-pg-filestore-v1', 'backupId': runner.backup_id,
                        'controlTenantId': 'tenant', 'binding': {}, 'businessKey': 'b', 'payloadDigest': 'd',
                        'databaseSha256': hashlib.sha256(b'older plaintext dump').hexdigest(),
                        'filestoreSha256': hashlib.sha256((runner.artifact / odoo_backup.PLAINTEXT_ARCHIVE).read_bytes()).hexdigest(),
                        'sourceImageId': 'sha256:' + 'a' * 64, 'postgresImageId': 'sha256:' + 'b' * 64,
                        'capturedAt': '2026-11-24T00:00:00Z', 'inventory': {}}
            (runner.artifact / 'manifest.json').write_text(json.dumps(manifest))
            runner.operation = 'restore'
            runner.authority = {'controlTenantId': 'tenant', 'databaseSha256': manifest['databaseSha256'],
                                'filestoreSha256': manifest['filestoreSha256']}
            with runner.artifact_plaintext(runner.read_artifact()) as (dump, archive):
                self.assertEqual(dump, runner.artifact / odoo_backup.PLAINTEXT_DUMP)
                self.assertEqual(archive, runner.artifact / odoo_backup.PLAINTEXT_ARCHIVE)

    def test_a_ciphertext_that_changed_is_refused_before_it_is_decrypted(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw).resolve()
            runner, manifest, _dump, _passphrase = self.captured(root)
            ciphertext = runner.artifact / odoo_backup.CIPHERTEXT_DUMP
            ciphertext.write_bytes(ciphertext.read_bytes() + b'x')
            (runner.artifact / 'manifest.json').write_text(json.dumps(manifest))
            with self.assertRaisesRegex(odoo_effect.EffectError, '^artifact_hash_mismatch$'):
                runner.read_artifact()

    def test_a_capture_without_a_usable_key_is_refused_before_odoo_is_stopped(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw).resolve()
            runner = self.runner(root)
            commands = []
            runner.assert_no_effect_containers = lambda **_kwargs: None
            runner.command = lambda args, **_kwargs: commands.append(args) or ''
            def missing_key():
                raise odoo_effect.EffectError('backup_key_unavailable')
            runner.passphrase_file = missing_key
            with patch.object(odoo_backup, 'permit', lambda _stage: None), \
                    self.assertRaisesRegex(odoo_effect.EffectError, '^backup_key_unavailable$'):
                runner.capture()
            # Nothing was written and the shared odoo was never stopped for a capture that could not run.
            self.assertEqual(commands, [])
            self.assertFalse(runner.artifact.exists())


class RestartReconcileTests(unittest.TestCase):
    """One intent file records the stop; the next attempt reconciles it before doing anything else."""

    def runner(self, root, calls):
        runner = object.__new__(odoo_backup.BackupRunner)
        runner.root = root
        runner.database = 'liwan_scratch_a'
        runner.base = ['compose']
        runner.config = {'projectName': 'liwan-shared-test'}
        runner.command = lambda args, **_kwargs: calls.append(args) or ''
        return runner

    def test_a_crash_between_the_stop_and_the_start_is_repaired_by_the_next_attempt(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw).resolve()
            stopped = []
            crashed = self.runner(root, stopped)
            backup_quiet.quiesce(crashed.intent(), crashed.service_control())
            self.assertEqual(stopped, [['compose', 'stop', '--timeout', '30', 'odoo']])
            self.assertEqual(backup_quiet.read_state(crashed.intent()), backup_quiet.STATE_QUIESCING)
            started = []
            next_attempt = self.runner(root, started)
            self.assertEqual(next_attempt.reconcile(), backup_quiet.STATE_RESUMED)
            self.assertEqual(started, [['compose', 'start', 'odoo']])
            self.assertEqual(backup_quiet.read_state(next_attempt.intent()), backup_quiet.STATE_RESUMED)
            # A resumed intent is never started again.
            self.assertEqual(next_attempt.reconcile(), backup_quiet.STATE_RESUMED)
            self.assertEqual(len(started), 1)

    def test_a_capture_after_a_crash_starts_odoo_before_it_stops_it_again(self):
        case = CaptureRestartTests()
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw).resolve()
            runner, _boom = case.capture_runner(root, fail_at='inventory')
            backup_quiet.record_state(runner.intent(), backup_quiet.STATE_QUIESCING)
            with self.assertRaises(odoo_effect.EffectError):
                case.capture(runner, 'inventory')
        starts = [args for args in runner.commands if args[-2:] == ['start', 'odoo']]
        stops = [args for args in runner.commands if 'stop' in args]
        self.assertEqual(len(stops), 1)
        self.assertGreaterEqual(len(starts), 2)  # the reconcile, then the restart after the failure
        self.assertLess(runner.commands.index(starts[0]), runner.commands.index(stops[0]))

    def test_main_reconciles_on_the_reconcile_action(self):
        class Reconciling:
            def __init__(self, _request): pass
            def reconcile(self): return backup_quiet.STATE_RESUMED
        out = io.StringIO()
        with patch.object(odoo_backup, 'BackupRunner', Reconciling), \
                patch.object(odoo_backup, 'install_termination_handler', lambda _runner: None), \
                patch.object(sys, 'stdin', io.StringIO('{"action":"reconcile"}\n')), patch.object(sys, 'stdout', out):
            status = odoo_backup.main()
        self.assertEqual((status, json.loads(out.getvalue())), (0, {'result': {'state': 'resumed'}}))

    def test_a_symlinked_intent_is_refused_before_it_is_written(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw).resolve()
            (root / odoo_backup.INTENT_NAME).symlink_to(root / 'elsewhere')
            runner = self.runner(root, [])
            with self.assertRaisesRegex(odoo_effect.EffectError, '^runtime_path_invalid$'):
                runner.intent()


class InventoryChannelTests(unittest.TestCase):
    def inventory_runner(self, output):
        runner = object.__new__(odoo_backup.BackupRunner)
        runner.config = {'projectName': 'liwan-shared-test'}
        runner.request = {'attemptId': 'attempt01', 'job': {'requestId': 'req'}}
        runner.base = []
        runner.current_container = None
        runner.child = None
        runner.helper_args = lambda *_: [sys.executable, '-c', output]
        return runner

    def test_inventory_far_above_the_command_buffer_is_read_whole(self):
        rows = 'import json;print(json.dumps({"attachments":[[i,"ab/"+"c"*40,"d"*40,10] for i in range(20000)]}))'
        inventory = self.inventory_runner(rows).inventory('odoo', 'liwan_scratch_a')
        self.assertEqual(len(inventory['attachments']), 20000)

    def test_runaway_inventory_is_an_explicit_limit_error(self):
        runner = self.inventory_runner('print("x" * 4096)')
        with patch.object(odoo_backup, 'MAX_INVENTORY', 1024):
            with self.assertRaisesRegex(odoo_effect.EffectError, '^inventory_too_large$'):
                runner.inventory('odoo', 'liwan_scratch_a')


class HelperArgvTests(unittest.TestCase):
    """One argv string is capped at 128 KiB: attachment rows must travel on stdin, never in the helper's -c script."""
    LIMIT = 128 * 1024
    TARGET = 'liwan_scratch_' + 'b' * 32

    def runner(self):
        runner = object.__new__(odoo_backup.BackupRunner)
        runner.config = {'projectName': 'liwan-shared-test'}
        runner.request = {'attemptId': 'attempt01', 'job': {'requestId': 'req'}}
        runner.base = []
        runner.current_container = None
        calls = []
        runner.command = lambda args, **kwargs: calls.append((args, kwargs)) or '{}'
        return runner, calls

    def rows(self, count=20000, name=None):
        return [[i, name, 'd' * 40, 10] for i in range(count)]

    def test_check_files_keeps_every_argv_element_small_and_sends_the_rows_on_stdin(self):
        runner, calls = self.runner()
        rows = self.rows(name='ab/' + 'c' * 40)
        runner.check_files('odoo', 'liwan_scratch_a', {'attachments': rows})
        args, kwargs = calls[0]
        self.assertTrue(all(len(item.encode()) < self.LIMIT // 8 for item in args))
        self.assertEqual(json.loads(kwargs['stdin']), rows)

    def test_the_check_files_helper_reads_the_rows_from_stdin(self):
        runner, calls = self.runner()
        runner.check_files('odoo', 'liwan_scratch_a', {'attachments': self.rows()})
        args, kwargs = calls[0]
        script = args[args.index('-c') + 1]
        done = subprocess.run([sys.executable, '-c', script], input=kwargs['stdin'].encode(), capture_output=True)
        self.assertEqual((done.returncode, done.stdout), (0, b'{}\n'))
        bad = json.dumps([[1, 'not-a-path', 'd' * 40, 10]]).encode()
        done = subprocess.run([sys.executable, '-c', script], input=bad, capture_output=True)
        self.assertNotEqual(done.returncode, 0)
        self.assertIn(b'attachment_path', done.stderr)

    def test_verify_restore_keeps_argv_small_with_many_attachments(self):
        runner, calls = self.runner()
        rows = self.rows()
        inventory = {'attachments': rows, 'databaseAttachments': [], 'profile': [{'id': 1}]}
        runner.target = self.TARGET
        runner.inventory = lambda *_: inventory
        runner.verify_odoo_readiness = lambda *_: None
        runner.verify_restore({'inventory': inventory})
        args, kwargs = calls[0]
        self.assertTrue(all(len(item.encode()) < self.LIMIT // 8 for item in args))
        self.assertEqual(json.loads(kwargs['stdin']), rows)


class InventoryManifestLimitTests(unittest.TestCase):
    def test_the_inventory_limit_fits_inside_the_manifest_limit(self):
        self.assertLess(odoo_backup.MAX_INVENTORY, odoo_backup.MAX_MANIFEST)
        self.assertEqual(odoo_backup.MAX_INVENTORY, odoo_backup.MAX_MANIFEST - odoo_backup.MANIFEST_OVERHEAD)

    def test_a_manifest_that_json_escaping_pushes_over_the_limit_is_refused_when_built(self):
        case = CaptureRestartTests()
        with tempfile.TemporaryDirectory() as raw:
            runner, _ = case.capture_runner(Path(raw).resolve())
            runner.artifact.mkdir(parents=True)
            runner.inventory = lambda *_: {'attachments': [], 'note': '\u00e9' * 600}
            def encrypt(_plaintext, ciphertext, **_kwargs):
                Path(ciphertext).write_bytes(b'ciphertext')
                return 'b' * 64
            with patch.object(odoo_backup, 'permit', lambda _stage: None), patch.object(odoo_backup, 'validate_archive', lambda _p: None), \
                    patch.object(odoo_backup, 'sha256_file', lambda _p: 'a' * 64), patch.object(odoo_backup, 'MAX_MANIFEST', 1024), \
                    patch.object(odoo_backup.backup_artifact, 'encrypt_file', encrypt):
                with self.assertRaises(odoo_effect.EffectError) as caught:
                    runner.capture_while_stopped('img', 'pg')
        self.assertEqual(str(caught.exception), 'inventory_too_large')


class ReportedErrorCodeTests(unittest.TestCase):
    def emitted(self, code):
        class Failing:
            def __init__(self, _request): pass
            def apply_owned(self): raise odoo_effect.EffectError(code)
        out = io.StringIO()
        request = {'action': 'apply'}
        with patch.object(odoo_backup, 'BackupRunner', Failing), patch.object(odoo_backup, 'install_termination_handler', lambda _r: None), \
                patch.object(sys, 'stdin', io.StringIO(json.dumps(request) + '\n')), patch.object(sys, 'stdout', out):
            status = odoo_backup.main()
        return status, json.loads(out.getvalue().strip())

    def test_main_emits_the_restart_and_inventory_codes_as_they_are(self):
        for code in ('odoo_restart_failed', 'inventory_too_large', 'backup_key_unavailable'):
            self.assertEqual(self.emitted(code), (1, {'error_code': code}))

    def test_an_unlisted_code_stays_opaque(self):
        self.assertEqual(self.emitted('boom'), (1, {'error_code': 'shared_effect_unverified'}))


class RestoreIsolationTests(unittest.TestCase):
    DATABASE = 'liwan_scratch_' + 'b' * 32

    def test_create_stage_is_one_admin_statement_in_database_postgres(self):
        script = odoo_backup.create_database_script(self.DATABASE)
        create = script.index('CREATE DATABASE "' + self.DATABASE + '"')
        # shlex.quote splits the recipe's single quotes, so the options are checked after the name.
        self.assertTrue(create < script.index('LC_COLLATE') < script.index('TEMPLATE template0'))
        self.assertTrue(script.startswith('set -eu\nexport PGPASSWORD="$POSTGRES_PASSWORD"\n'))
        self.assertIn('-U postgres -v ON_ERROR_STOP=1 -q -d postgres -c ', script)
        self.assertEqual(script.count('-U postgres'), 1)
        self.assertNotIn('CREATE DATABASE', odoo_backup.restore_database_script(self.DATABASE))

    def test_restore_script_prepares_as_admin_then_restores_as_the_runtime_role_only(self):
        script = odoo_backup.restore_database_script(self.DATABASE)
        revoke = script.index('REVOKE CONNECT ON DATABASE "' + self.DATABASE + '" FROM PUBLIC')
        grant, assertion = script.index('GRANT CONNECT ON DATABASE'), script.index('public_connect_not_revoked')
        bootstrap, skeleton = script.index('CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public'), script.index("<<'LIWAN_TENANT_SCHEMA'")
        restore = script.index('exec pg_restore ')
        self.assertTrue(revoke < grant < assertion < bootstrap < skeleton < restore)
        self.assertTrue(script.startswith('set -eu\n'))
        self.assertNotIn('createdb', script)
        # Admin: isolation, bootstrap in the target, skeleton script. Odoo: the archive, schema public only.
        self.assertEqual(script.count('-U postgres'), 3)
        self.assertEqual(script[:skeleton].count('-v ON_ERROR_STOP=1'), 3)
        self.assertIn('exec pg_restore -h restore-db -U odoo --no-owner -n public --exit-on-error --single-transaction -d "$1"', script)
        self.assertEqual(script.count('exec pg_restore'), 1)
        self.assertNotIn('-U postgres --', script)
        self.assertNotIn('--use-set-session-authorization', script)
        # The password of each login comes from the container environment, never from a command line.
        self.assertTrue(script.index('export PGPASSWORD="$POSTGRES_PASSWORD"') < revoke)
        self.assertTrue(skeleton < script.index('export PGPASSWORD="$ODOO_DB_PASSWORD"') < restore)
        # The skeleton script is the repository file itself, in a quoted here-document, run in database postgres.
        self.assertIn(odoo_effect.AI_TENANT_SCHEMA.read_text().rstrip('\n'), script)
        self.assertIn('-d postgres -v tenant_db="$1" -f - <<', script)

    def test_ai_stage_logs_in_as_the_ai_role_or_drains_the_archive_without_one(self):
        script = odoo_backup.restore_ai_script()
        self.assertIn('exec pg_restore -h restore-db -U liwan_ai --no-owner -n liwan_ai --exit-on-error --single-transaction -d "$1"', script)
        self.assertEqual(script.count('pg_restore '), 2)  # the archive listing and the exec line
        self.assertTrue(script.index('ai_data_without_role') < script.index('exit 0') < script.index('export PGPASSWORD="$AI_DB_PASSWORD"'))
        # The admin role only looks the AI role up in the catalog of database postgres; it never touches the archive.
        self.assertEqual(script.count('-U postgres'), 1)
        self.assertIn("-d postgres -c 'SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '\"'\"'liwan_ai'\"'\"''", script)
        self.assertTrue(script.index('-U postgres') < script.index('ai_password_missing') < script.index('ai_data_without_role'))

    def test_drop_stage_removes_only_the_target_in_database_postgres(self):
        script = odoo_backup.drop_target_script(self.DATABASE)
        self.assertIn('-d postgres -c \'DROP DATABASE IF EXISTS "' + self.DATABASE + '" WITH (FORCE)\'', script)
        self.assertEqual(script.count('-U postgres'), 1)

    def test_drop_stage_quotes_the_name_as_an_identifier_and_refuses_a_malformed_one(self):
        with self.assertRaisesRegex(ValueError, '^database_identifier_rejected$'):
            odoo_backup.drop_target_script('liwan_scratch_x" CASCADE; --')
        with self.assertRaisesRegex(ValueError, '^database_identifier_rejected$'):
            odoo_backup.drop_target_script('')

    def test_restore_operation_passes_the_isolating_script_to_the_restore_container(self):
        self.assertTrue(odoo_backup)
        with tempfile.TemporaryDirectory() as raw:
            runner = object.__new__(odoo_backup.BackupRunner)
            runner.root = Path(raw).resolve()
            (runner.root / 'classifications').mkdir()
            runner.target = self.DATABASE
            runner.artifact = Path(raw) / 'artifact'
            runner.authority = {'approvalId': 'a'}
            runner.backup_id = 'b'
            runner.request = {'payloadDigest': 'c' * 64, 'attemptId': 'd' * 32, 'fence': 1}
            runner.read_artifact = lambda: {'sourceImageId': 'i', 'postgresImageId': 'p'}
            runner.inspect_service = lambda service: {'Image': 'i' if service == 'restore-odoo' else 'p'}
            runner.database_exists = lambda *_: False
            runner.files_exist = lambda *_: False
            runner.database = 'liwan_scratch_a'
            # The plaintext of the artifact is opened by the restore; these tests stub the artifact directory.
            runner.artifact_plaintext = lambda _manifest: contextlib.nullcontext(
                (runner.artifact / odoo_backup.PLAINTEXT_DUMP, runner.artifact / odoo_backup.PLAINTEXT_ARCHIVE))
            streams = []
            def pg_stream(service, stage, script, database, **kwargs):
                streams.append((stage, script, database))
                if stage != 'restore-create':
                    raise odoo_effect.EffectError('restore_stopped_after_database')
            runner.pg_stream = pg_stream
            with patch.object(odoo_backup, 'permit', lambda stage: None), \
                    patch.object(odoo_backup, 'reserve', lambda path, payload: Path(path).write_text('{}')):
                with self.assertRaisesRegex(odoo_effect.EffectError, '^restore_stopped_after_database$'):
                    runner.restore()
        # The failing first stage is followed by the drop of the fresh target; the AI stage never starts.
        self.assertEqual(streams, [('restore-create', odoo_backup.create_database_script(self.DATABASE), self.DATABASE),
                                   ('restore-db', odoo_backup.restore_database_script(self.DATABASE), self.DATABASE),
                                   ('restore-drop', odoo_backup.drop_target_script(self.DATABASE), self.DATABASE)])

    def test_a_failed_create_never_drops_the_name(self):
        with tempfile.TemporaryDirectory() as raw:
            runner = object.__new__(odoo_backup.BackupRunner)
            runner.root = Path(raw).resolve()
            (runner.root / 'classifications').mkdir()
            runner.target, runner.artifact = self.DATABASE, Path(raw) / 'artifact'
            runner.authority, runner.backup_id = {'approvalId': 'a'}, 'b'
            runner.request = {'payloadDigest': 'c' * 64, 'attemptId': 'd' * 32, 'fence': 1}
            runner.read_artifact = lambda: {'sourceImageId': 'i', 'postgresImageId': 'p'}
            runner.inspect_service = lambda service: {'Image': 'i' if service == 'restore-odoo' else 'p'}
            runner.database_exists = lambda *_: False
            runner.files_exist = lambda *_: False
            runner.database = 'liwan_scratch_a'
            # The plaintext of the artifact is opened by the restore; these tests stub the artifact directory.
            runner.artifact_plaintext = lambda _manifest: contextlib.nullcontext(
                (runner.artifact / odoo_backup.PLAINTEXT_DUMP, runner.artifact / odoo_backup.PLAINTEXT_ARCHIVE))
            streams = []
            def pg_stream(service, stage, script, database, **kwargs):
                streams.append(stage)
                raise odoo_effect.EffectError('artifact_command_failed')  # the name already exists, made by someone else
            runner.pg_stream = pg_stream
            with patch.object(odoo_backup, 'permit', lambda stage: None), \
                    patch.object(odoo_backup, 'reserve', lambda path, payload: Path(path).write_text('{}')):
                with self.assertRaisesRegex(odoo_effect.EffectError, '^artifact_command_failed$'):
                    runner.restore()
        self.assertEqual(streams, ['restore-create'])

    def test_both_restore_stages_run_in_order_and_a_failing_ai_stage_drops_the_target(self):
        with tempfile.TemporaryDirectory() as raw:
            runner = object.__new__(odoo_backup.BackupRunner)
            runner.root = Path(raw).resolve()
            (runner.root / 'classifications').mkdir()
            runner.target, runner.artifact = self.DATABASE, Path(raw) / 'artifact'
            runner.authority, runner.backup_id = {'approvalId': 'a'}, 'b'
            runner.request = {'payloadDigest': 'c' * 64, 'attemptId': 'd' * 32, 'fence': 1}
            runner.read_artifact = lambda: {'sourceImageId': 'i', 'postgresImageId': 'p'}
            runner.inspect_service = lambda service: {'Image': 'i' if service == 'restore-odoo' else 'p'}
            runner.database_exists = lambda *_: False
            runner.files_exist = lambda *_: False
            runner.database = 'liwan_scratch_a'
            # The plaintext of the artifact is opened by the restore; these tests stub the artifact directory.
            runner.artifact_plaintext = lambda _manifest: contextlib.nullcontext(
                (runner.artifact / odoo_backup.PLAINTEXT_DUMP, runner.artifact / odoo_backup.PLAINTEXT_ARCHIVE))
            streams = []
            def pg_stream(service, stage, script, database, **kwargs):
                streams.append((service, stage, kwargs.get('source') is not None))
                if stage == 'restore-ai':
                    raise odoo_effect.EffectError('artifact_command_failed')
                if stage == 'restore-drop':
                    return
            runner.pg_stream = pg_stream
            with patch.object(odoo_backup, 'permit', lambda stage: None), \
                    patch.object(odoo_backup, 'reserve', lambda path, payload: Path(path).write_text('{}')):
                with self.assertRaisesRegex(odoo_effect.EffectError, '^artifact_command_failed$'):
                    runner.restore()
        self.assertEqual(streams, [('restore-db', 'restore-create', False), ('restore-db', 'restore-db', True), ('restore-db', 'restore-ai', True),
                                   ('restore-db', 'restore-drop', False)])


class StreamRefusalTests(unittest.TestCase):
    """A restore stage's fixed refusal word on stderr is the error code; any other stderr text is never reported."""

    def run_stream(self, stderr_text):
        runner = object.__new__(odoo_backup.BackupRunner)
        runner.child = None
        runner.stream([sys.executable, '-c', 'import sys; sys.stderr.write(' + repr(stderr_text) + '); sys.exit(1)'])

    def test_a_known_refusal_word_reaches_the_error_code(self):
        for code in ('ai_password_missing', 'ai_data_without_role'):
            with self.subTest(code=code):
                with self.assertRaisesRegex(odoo_effect.EffectError, '^' + code + '$'):
                    self.run_stream(code + '\n')

    def test_other_stderr_text_stays_out_of_the_error(self):
        with self.assertRaisesRegex(odoo_effect.EffectError, '^artifact_command_failed$'):
            self.run_stream('FATAL: password authentication failed for secret-value')

    def test_the_refusal_codes_are_reported_as_themselves(self):
        for code in odoo_effect.STREAM_REFUSALS:
            self.assertEqual(odoo_effect.classify_error(odoo_effect.EffectError(code)), code)


class RestoreServicesDeclaredTests(unittest.TestCase):
    """The services the restore runner drives must exist in the compose file it is pointed at."""

    ROOT = Path(__file__).resolve().parents[2]

    def test_every_restore_service_the_runner_names_is_declared_under_the_restore_profile(self):
        source = Path(odoo_backup.__file__).read_text(encoding='utf-8')
        required = set(re.findall(r"'(restore-(?:odoo|db))'", source))
        self.assertEqual(required, {'restore-odoo', 'restore-db'})
        self.assertIn("'--profile', 'restore'", source)
        compose = (self.ROOT / 'deploy/stack/compose.yml').read_text(encoding='utf-8')
        for service in required:
            block = re.search(r'^  ' + service + r':\n((?:    .*\n|\n)+)', compose, re.M)
            with self.subTest(service=service):
                self.assertIsNotNone(block, service + ' is not declared in deploy/stack/compose.yml')
                self.assertIn('profiles: [restore]', block.group(1))


if __name__ == '__main__':
    unittest.main()


class CommercialRestoreInventoryTests(unittest.TestCase):
    def test_authorized_policy_changes_preserve_backed_up_data_and_identity(self):
        original = {
            'attachments': [[1, '01/file', 'sha1', 4]], 'databaseAttachments': [],
            'projects': 3, 'tasks': 4, 'modules': [['liwan_platform', '1', 'installed']],
            'profile': [{'id': 1, 'root_company_id': 5, 'commercial_revision_id': 'old',
                         'commercial_digest': 'old', 'features': {}, 'policy_revision': 1}],
        }
        current = {**original, 'profile': [{**original['profile'][0],
            'commercial_revision_id': 'paid', 'commercial_digest': 'digest',
            'features': {'users.limit': 4}, 'policy_revision': 2}]}
        repaired = {'revisionId': 'paid', 'digest': 'digest'}
        self.assertTrue(odoo_backup.restore_inventory_matches(original, current, repaired))
        for change in (
            {'tasks': 3}, {'attachments': []}, {'modules': []},
            {'profile': [{**current['profile'][0], 'root_company_id': 6}]},
            {'profile': [{**current['profile'][0], 'commercial_digest': 'wrong'}]},
        ):
            self.assertFalse(odoo_backup.restore_inventory_matches(original, {**current, **change}, repaired))
        self.assertFalse(odoo_backup.restore_inventory_matches(original, current))

class OdooReadinessTests(unittest.TestCase):
    SOURCE = 'liwan_scratch_' + 'a' * 32
    TARGET = 'liwan_scratch_' + 'b' * 32

    def test_source_resume_probes_only_enabled_databases_without_bootstrap_credentials(self):
        with tempfile.TemporaryDirectory() as raw:
            runner = object.__new__(odoo_backup.BackupRunner)
            runner.root = Path(raw).resolve()
            (runner.root / 'registry').mkdir()
            (runner.root / 'registry' / 'registry.json').write_text(json.dumps({'targets': [
                {'enabled': True, 'database': self.SOURCE},
                {'enabled': False, 'database': self.TARGET},
            ]}))
            runner.verify_odoo_readiness = unittest.mock.Mock()
            runner.verify_originals()
        runner.verify_odoo_readiness.assert_called_once_with('odoo', self.SOURCE)

    def test_restore_checks_exact_service_and_database_after_inventory_and_filestore(self):
        runner = object.__new__(odoo_backup.BackupRunner)
        runner.target = self.TARGET
        inventory = {'profile': [{'id': 1, 'root_company_id': 1}]}
        probes = unittest.mock.Mock()
        runner.inventory = probes.inventory
        runner.inventory.return_value = inventory
        runner.check_files = probes.check_files
        runner.verify_odoo_readiness = probes.verify_odoo_readiness
        runner.verify_restore({'inventory': inventory})
        self.assertEqual(probes.mock_calls, [
            unittest.mock.call.inventory('restore-odoo', self.TARGET),
            unittest.mock.call.check_files('restore-odoo', self.TARGET, inventory),
            unittest.mock.call.verify_odoo_readiness('restore-odoo', self.TARGET),
        ])

    def test_readiness_probes_the_db_scoped_public_route_without_credentials_or_redirects(self):
        with patch('http.client.HTTPConnection') as connection:
            http = connection.return_value
            response = http.getresponse.return_value
            response.status = 200
            response.read.return_value = b'{"name":"Fixture company","primary_color":"#14102a"}'
            config = {'dbfilter': '^%h$', 'db_host': 'restore-db'}
            self.assertEqual(odoo_backup.read_odoo_readiness(config, self.TARGET, restore=True), {'database': self.TARGET})
            connection.assert_called_once_with('127.0.0.1', 8069, timeout=25)
            http.request.assert_called_once_with('GET', '/api/v1/branding', headers={'Host': self.TARGET})
            self.assertEqual(http.close.call_count, 1)
            response.status = 302
            with self.assertRaises(ValueError):
                odoo_backup.read_odoo_readiness(config, self.TARGET, restore=True)

    def test_restore_readiness_rejects_the_source_db_host_and_an_ambiguous_dbfilter(self):
        for config in ({'dbfilter': '^%h$', 'db_host': 'db'},
                       {'dbfilter': '.*', 'db_host': 'restore-db'}):
            with patch('http.client.HTTPConnection') as connection, self.assertRaises(ValueError):
                odoo_backup.read_odoo_readiness(config, self.TARGET, restore=True)
            connection.assert_not_called()
