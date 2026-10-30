"""Backup tests use real temporary dump/archive files and external-command seams."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from . import backup
from .backup import Deadline, capture_tenant, capture_window, validate_backup, restore_tenant


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.store = self.root / 'filestore' / 'tenant_a'; self.store.mkdir(parents=True)
        (self.store / 'attachment').write_bytes(b'attachment-data')
        self.binding = {'tenantId': 'tenant_a', 'database': 'tenant_a', 'filestore': 'shared_store', 'fence': 2}
        self.proof = {**self.binding, 'gateClosed': True, 'admittedWriters': 0, 'activeTransactions': 0, 'oldConnections': 0}
        self.commands = []
        def runner(argv, **kwargs):
            self.commands.append(argv)
            if '--file' in argv: Path(argv[argv.index('--file') + 1]).write_bytes(b'dump-data')
            return subprocess.CompletedProcess(argv, 0, '', '')
        self.config = {'mode': 'local', 'outputDir': str(self.root / 'backup'), 'filestorePath': str(self.store),
                       'pgDump': '/usr/bin/true', 'createdb': '/usr/bin/true', 'pgRestore': '/usr/bin/true',
                       'image': 'liwan/odoo@sha256:' + 'a' * 64, 'runner': runner,
                       'pgEnv': {}, 'timeoutSeconds': 30}

    def test_capture_records_hashes_and_never_stops_shared_services(self):
        receipt = capture_tenant(self.binding, self.proof, self.config)
        self.assertTrue(validate_backup(self.root / 'backup')['valid'])
        self.assertEqual(receipt['fence'], 2)
        self.assertEqual(len(self.commands), 1)
        self.assertIn('--format=custom', self.commands[0])
        self.assertIn('--serializable-deferrable', self.commands[0])
        self.assertNotIn('stop', self.commands[0])

    def test_admitted_or_active_writer_blocks_before_dump(self):
        for key in ('admittedWriters', 'activeTransactions', 'oldConnections'):
            proof = dict(self.proof); proof[key] = 1
            with self.subTest(key=key), self.assertRaises(ValueError):
                capture_tenant(self.binding, proof, self.config)
        self.assertFalse(self.commands)

    def test_symlink_store_is_rejected_and_corruption_blocks_restore(self):
        (self.store / 'escape').symlink_to('/etc/passwd')
        with self.assertRaises(ValueError): capture_tenant(self.binding, self.proof, self.config)
        (self.store / 'escape').unlink()
        capture_tenant(self.binding, self.proof, self.config)
        (self.root / 'backup' / 'database.dump').write_bytes(b'corrupt')
        self.assertFalse(validate_backup(self.root / 'backup')['valid'])
        before = len(self.commands)
        with self.assertRaises(ValueError):
            restore_tenant(self.root / 'backup', {'tenantId':'tenant_a','database': 'liwan_scratch_restore','filestore':'liwan_scratch_restore'},
                           {**self.config, 'restoreAllowed': True, 'writesResumed': False,
                            'targetFilestore': str(self.root / 'liwan_scratch_restore'),'recoverySource':self.binding})
        self.assertEqual(len(self.commands), before)

    def test_restore_rejects_cross_tenant_or_unbound_recovery_before_commands(self):
        capture_tenant(self.binding,self.proof,self.config)
        before=len(self.commands)
        config={**self.config,'restoreAllowed':True,'writesResumed':False,'recoverySource':self.binding,
                'targetFilestore':str(self.root/'liwan_scratch_other')}
        for binding,patch in [({'tenantId':'tenant_b','database':'liwan_scratch_other','filestore':'liwan_scratch_other'},{}),
                              ({'tenantId':'tenant_a','database':'liwan_scratch_other','filestore':'liwan_scratch_other'},{'recoverySource':{}})]:
            with self.assertRaises(ValueError):restore_tenant(self.root/'backup',binding,{**config,**patch})
        self.assertEqual(len(self.commands),before)

    def test_restore_only_new_explicit_scratch_and_never_after_resumed_writes(self):
        capture_tenant(self.binding, self.proof, self.config)
        config = {**self.config, 'restoreAllowed': True, 'writesResumed': False,
                  'targetFilestore': str(self.root / 'liwan_scratch_restore'),'recoverySource':self.binding}
        result = restore_tenant(self.root / 'backup', {'tenantId':'tenant_a','database': 'liwan_scratch_restore','filestore':'liwan_scratch_restore'}, config)
        self.assertTrue(result['restored'])
        self.assertEqual((self.root / 'liwan_scratch_restore' / 'attachment').read_bytes(), b'attachment-data')
        for patch, db in [({'writesResumed': True}, 'liwan_scratch_again'), ({}, 'odoo19')]:
            with self.subTest(db=db), self.assertRaises(ValueError):
                restore_tenant(self.root / 'backup', {'database': db}, {**config, **patch})


class FakeClock:
    """Monotonic clock advanced only by the test's explicit cost model."""
    def __init__(self): self.now = 0.0
    def __call__(self): return self.now


class CaptureWindowTests(unittest.TestCase):
    """Backup-current window: one absolute budget across every step."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.store = self.root / 'filestore' / 'tenant_a'; self.store.mkdir(parents=True)
        (self.store / 'attachment').write_bytes(b'attachment-data')
        self.binding = {'tenantId': 'tenant_a', 'database': 'tenant_a', 'filestore': 'shared_store', 'fence': 2}
        self.proof = {**self.binding, 'gateClosed': True, 'admittedWriters': 0, 'activeTransactions': 0,
                      'oldConnections': 0, 'writerConnections': 0, 'deniedWriters': ['role_blue', 'role_green']}
        self.commands, self.rechecks = [], []
        self.clock = FakeClock()
        def runner(argv, **kwargs):
            self.commands.append((argv, kwargs['timeout']))
            if '--file' in argv: Path(argv[argv.index('--file') + 1]).write_bytes(b'dump-data')
            return subprocess.CompletedProcess(argv, 0, '', '')
        def recheck(binding, deadline):
            self.rechecks.append(deadline.remaining())
            return self.proof
        self.config = {'mode': 'local', 'outputDir': str(self.root / 'backup'), 'filestorePath': str(self.store),
                       'pgDump': '/usr/bin/true', 'createdb': '/usr/bin/true', 'pgRestore': '/usr/bin/true',
                       'image': 'liwan/odoo@sha256:' + 'a' * 64, 'runner': runner, 'recheck': recheck,
                       'pgEnv': {}, 'timeoutSeconds': 30}

    def capture(self, seconds=60, **config):
        return capture_window(self.binding, self.proof, {**self.config, **config}, Deadline(seconds, self.clock))

    def test_window_capture_rechecks_before_dump_and_after_archive(self):
        receipt = self.capture()
        self.assertTrue(validate_backup(self.root / 'backup')['valid'])
        self.assertEqual(len(self.rechecks), 2)
        self.assertEqual(receipt['consistency'], 'quiescent_gate')
        self.assertFalse(receipt['restoreVerified'])
        self.assertEqual(sorted(path.name for path in (self.root / 'backup').iterdir()),
                         ['database.dump', 'filestore.tar', 'receipt.json'])

    def test_window_requires_recheck_and_denied_writer_evidence(self):
        for proof in ({k: v for k, v in self.proof.items() if k != 'deniedWriters'},
                      {**self.proof, 'deniedWriters': []}, {**self.proof, 'writerConnections': 1}):
            with self.subTest(proof=proof), self.assertRaises(ValueError):
                capture_window(self.binding, proof, self.config, Deadline(60, self.clock))
        config = {**self.config}; config.pop('recheck')
        with self.assertRaises(ValueError): capture_window(self.binding, self.proof, config, Deadline(60, self.clock))
        with self.assertRaises(ValueError): capture_window(self.binding, self.proof, self.config, 60)
        self.assertFalse(self.commands)
        self.assertFalse((self.root / 'backup').exists())

    def test_hardlinked_attachments_validate_and_restore_identical_bytes(self):
        (self.store / 'ab').mkdir()
        (self.store / 'ab' / 'first').write_bytes(b'shared-attachment-bytes')
        os.link(self.store / 'ab' / 'first', self.store / 'ab' / 'second')
        self.capture()
        self.assertTrue(validate_backup(self.root / 'backup')['valid'])
        target = self.root / 'liwan_scratch_restore'
        restore_tenant(self.root / 'backup', {'tenantId': 'tenant_a', 'database': target.name, 'filestore': target.name},
                       {**self.config, 'restoreAllowed': True, 'writesResumed': False,
                        'targetFilestore': str(target), 'recoverySource': self.binding})
        for name in ('first', 'second'):
            self.assertEqual((target / 'ab' / name).read_bytes(), b'shared-attachment-bytes')

    def test_budget_starts_before_the_filestore_walk(self):
        walk = backup.os.walk
        def slow_walk(*args, **kwargs):
            for item in walk(*args, **kwargs):
                self.clock.now += 40
                yield item
        (self.store / 'more').mkdir()
        with patch.object(backup.os, 'walk', slow_walk), self.assertRaisesRegex(ValueError, 'backup_deadline_exceeded'):
            self.capture()
        self.assertFalse(self.commands)
        self.assertFalse((self.root / 'backup').exists())

    def test_cumulative_overrun_across_scan_fsync_and_rechecks_fails(self):
        # Each step alone fits the 60 s budget; only their sum exceeds it.
        walk, fsync = backup.os.walk, backup.os.fsync
        def slow_walk(*args, **kwargs):
            for item in walk(*args, **kwargs):
                self.clock.now += 15
                yield item
        def slow_fsync(descriptor):
            self.clock.now += 15
            return fsync(descriptor)
        def slow_recheck(binding, deadline):
            self.clock.now += 15
            self.rechecks.append(deadline.remaining())
            return self.proof
        with patch.object(backup.os, 'walk', slow_walk), patch.object(backup.os, 'fsync', slow_fsync), \
                self.assertRaisesRegex(ValueError, 'backup_deadline_exceeded'):
            self.capture(recheck=slow_recheck)
        self.assertFalse((self.root / 'backup' / 'receipt.json').exists())

    def test_sequential_rechecks_share_one_budget(self):
        seen = []
        def recheck(binding, deadline):
            seen.append(deadline.remaining())
            self.clock.now += 35
            return self.proof
        with self.assertRaisesRegex(ValueError, 'backup_deadline_exceeded'):
            self.capture(recheck=recheck)
        self.assertEqual(seen, [60, 25])
        self.assertEqual(self.commands[0][1], 25)
        self.assertFalse((self.root / 'backup' / 'receipt.json').exists())

    def test_final_fsync_past_the_budget_leaves_no_receipt(self):
        fsync = backup.os.fsync
        calls = []
        def fsync_then_expire(descriptor):
            calls.append(descriptor)
            result = fsync(descriptor)
            if len(calls) == 4: self.clock.now = 1000  # the output directory fsync overruns
            return result
        with patch.object(backup.os, 'fsync', fsync_then_expire), self.assertRaisesRegex(ValueError, 'backup_deadline_exceeded'):
            self.capture()
        self.assertEqual(len(calls), 4)
        self.assertFalse((self.root / 'backup' / 'receipt.json').exists())
        self.assertTrue((self.root / 'backup' / 'receipt.pending').is_file())
        self.assertFalse(validate_backup(self.root / 'backup')['valid'])

    def test_dump_child_gets_only_the_remaining_budget(self):
        def recheck(binding, deadline):
            self.clock.now += 50
            return self.proof
        with self.assertRaises(ValueError): self.capture(recheck=recheck)
        self.assertEqual(self.commands[0][1], 10)


if __name__ == '__main__': unittest.main()
