# Part of Odoo. See LICENSE file for full copyright and licensing details.
import hashlib
import io
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
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

    def test_capture_checks_writers_before_stopping_odoo(self):
        self.assertTrue(odoo_backup)
        with tempfile.TemporaryDirectory() as raw:
            runner = object.__new__(odoo_backup.BackupRunner)
            runner.root = Path(raw).resolve()
            runner.config = {'projectName': 'nasq-shared-test'}
            commands = []
            def command(args, **_):
                commands.append(args)
                return 'nasq-shared-test-effect-12345678-observe-abcd1234' if args[:2] == ['docker', 'ps'] else ''
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
        runner.config = {'projectName': 'nasq-shared-test'}
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
        name = 'nasq-shared-test-effect-12345678-observe-abcd1234'
        runner, commands, live = self.drain_runner([name, 'nasq-shared-test-odoo-1'])
        now = [0]
        def sleep(seconds): now[0] += seconds
        runner.drain_observers(wait=35, sleep=sleep, clock=lambda: now[0])
        self.assertGreaterEqual(now[0], 35)
        self.assertIn(['docker', 'kill', name], commands)
        self.assertEqual(live, ['nasq-shared-test-odoo-1'])

    def test_observer_that_exits_in_time_is_not_killed(self):
        name = 'nasq-shared-test-effect-12345678-observe-abcd1234'
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
        runner.config = {'projectName': 'nasq-shared-test'}
        runner.command = lambda args, **_: 'nasq-shared-test-effect-12345678-install'
        with self.assertRaises(odoo_effect.EffectError) as caught:
            runner.assert_no_effect_containers(code='runtime_writer_after_effect')
        self.assertEqual(str(caught.exception), 'runtime_writer_after_effect')

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

if __name__ == '__main__':
    unittest.main()
