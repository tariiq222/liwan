"""Backup tests use real temporary dump/archive files and external-command seams."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch
from . import backup
from .backup import capture_tenant, validate_backup, restore_tenant


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.store = self.root / 'filestore' / 'tenant_a'; self.store.mkdir(parents=True)
        (self.store / 'attachment').write_bytes(b'attachment-data')
        self.binding = {'tenantId': 'tenant_a', 'database': 'tenant_a', 'filestore': 'shared_store', 'fence': 2}
        self.proof = {**self.binding, 'gateClosed': True, 'admittedWriters': 0, 'activeTransactions': 0,
                      'oldConnections': 0, 'writerConnections': 0, 'deniedWriters': ['role_blue', 'role_green']}
        self.commands = []
        def runner(argv, **kwargs):
            self.commands.append(argv)
            if '--file' in argv: Path(argv[argv.index('--file') + 1]).write_bytes(b'dump-data')
            return subprocess.CompletedProcess(argv, 0, '', '')
        self.config = {'mode': 'local', 'outputDir': str(self.root / 'backup'), 'filestorePath': str(self.store),
                       'pgDump': '/usr/bin/true', 'createdb': '/usr/bin/true', 'pgRestore': '/usr/bin/true',
                       'image': 'webvue/odoo@sha256:' + 'a' * 64, 'runner': runner, 'writerWindow': True,
                       'recheck': lambda binding, timeout: self.proof, 'totalDeadlineSeconds': 60,
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

    def test_verified_window_requires_recheck_and_denied_writer_evidence(self):
        config = {**self.config}; config.pop('recheck')
        with self.assertRaises(ValueError): capture_tenant(self.binding, self.proof, config)
        without = {key: value for key, value in self.proof.items() if key != 'deniedWriters'}
        with self.assertRaises(ValueError): capture_tenant(self.binding, without, self.config)
        empty = {**self.proof, 'deniedWriters': []}
        with self.assertRaises(ValueError): capture_tenant(self.binding, empty, self.config)
        stale = {**self.proof, 'writerConnections': 1}
        with self.assertRaises(ValueError): capture_tenant(self.binding, stale, self.config)
        self.assertFalse(self.commands)
        self.assertFalse((self.root / 'backup').exists())

    def test_window_evidence_is_rechecked_after_the_filestore_archive(self):
        observed = []
        def recheck(binding, timeout):
            observed.append(binding['tenantId'])
            if len(observed) > 1: raise ValueError('writer reconnected during the window')
            return self.proof
        with self.assertRaises(ValueError):
            capture_tenant(self.binding, self.proof, {**self.config, 'recheck': recheck})
        self.assertEqual(observed, ['tenant_a', 'tenant_a'])
        self.assertEqual(len(self.commands), 1)
        self.assertFalse((self.root / 'backup' / 'receipt.json').exists())

    def test_total_deadline_stops_the_window_and_keeps_partial_artifacts(self):
        def slow(argv, **kwargs):
            self.commands.append(argv)
            time.sleep(0.05)
            if '--file' in argv: Path(argv[argv.index('--file') + 1]).write_bytes(b'dump-data')
            return subprocess.CompletedProcess(argv, 0, '', '')
        config = {**self.config, 'runner': slow, 'totalDeadlineSeconds': 0.01}
        with self.assertRaises(ValueError): capture_tenant(self.binding, self.proof, config)
        self.assertTrue((self.root / 'backup' / 'database.dump').is_file())
        self.assertFalse((self.root / 'backup' / 'receipt.json').exists())
        with self.assertRaises(ValueError):
            capture_tenant(self.binding, self.proof, {**self.config, 'totalDeadlineSeconds': 0})

    def test_deadline_bounds_the_archive_and_the_hashing_not_only_the_dump(self):
        clock = [0.0]
        def after_dump(argv, **kwargs):
            Path(argv[argv.index('--file') + 1]).write_bytes(b'dump-data')
            clock[0] = 1000.0  # time runs out after the dump, before the archive
            return subprocess.CompletedProcess(argv, 0, '', '')
        with patch.object(backup.time, 'monotonic', lambda: clock[0]), self.assertRaisesRegex(ValueError, 'backup_deadline_exceeded'):
            capture_tenant(self.binding, self.proof, {**self.config, 'runner': after_dump})
        self.assertFalse((self.root / 'backup' / 'receipt.json').exists())
        clock[0] = 0.0
        shutil.rmtree(self.root / 'backup')
        calls = []
        def late_recheck(binding, timeout):
            calls.append(timeout)
            if len(calls) == 2: clock[0] = 1000.0  # budget exhausted right before hashing
            return self.proof
        with patch.object(backup.time, 'monotonic', lambda: clock[0]), self.assertRaisesRegex(ValueError, 'backup_deadline_exceeded'):
            capture_tenant(self.binding, self.proof, {**self.config, 'recheck': late_recheck})
        self.assertFalse((self.root / 'backup' / 'receipt.json').exists())

    def test_deadline_is_passed_to_every_recheck_as_its_remaining_time(self):
        seen = []
        def recheck(binding, timeout):
            seen.append(timeout); return self.proof
        capture_tenant(self.binding, self.proof, {**self.config, 'recheck': recheck, 'totalDeadlineSeconds': 30})
        self.assertEqual(len(seen), 2)
        self.assertTrue(all(0 < value <= 30 for value in seen))

    def test_fixture_capture_without_a_writer_window_keeps_its_contract(self):
        # The isolated infrastructure fixture does not own a tenant writer window;
        # it must keep working while producing the same receipt shape.
        config = {key: value for key, value in self.config.items() if key != 'writerWindow'}
        config['outputDir'] = str(self.root / 'fixture')
        proof = {key: value for key, value in self.proof.items()
                 if key not in ('writerConnections', 'deniedWriters')}
        receipt = capture_tenant(self.binding, proof, config)
        self.assertTrue(validate_backup(self.root / 'fixture')['valid'])
        self.assertEqual(receipt['consistency'], 'quiescent_gate')
        self.assertFalse(receipt['restoreVerified'])

    def test_symlink_store_is_rejected_and_corruption_blocks_restore(self):
        (self.store / 'escape').symlink_to('/etc/passwd')
        with self.assertRaises(ValueError): capture_tenant(self.binding, self.proof, self.config)
        (self.store / 'escape').unlink()
        capture_tenant(self.binding, self.proof, self.config)
        (self.root / 'backup' / 'database.dump').write_bytes(b'corrupt')
        self.assertFalse(validate_backup(self.root / 'backup')['valid'])
        before = len(self.commands)
        with self.assertRaises(ValueError):
            restore_tenant(self.root / 'backup', {'tenantId':'tenant_a','database': 'webvue_scratch_restore','filestore':'webvue_scratch_restore'},
                           {**self.config, 'restoreAllowed': True, 'writesResumed': False,
                            'targetFilestore': str(self.root / 'webvue_scratch_restore'),'recoverySource':self.binding})
        self.assertEqual(len(self.commands), before)

    def test_restore_rejects_cross_tenant_or_unbound_recovery_before_commands(self):
        capture_tenant(self.binding,self.proof,self.config)
        before=len(self.commands)
        config={**self.config,'restoreAllowed':True,'writesResumed':False,'recoverySource':self.binding,
                'targetFilestore':str(self.root/'webvue_scratch_other')}
        for binding,patch in [({'tenantId':'tenant_b','database':'webvue_scratch_other','filestore':'webvue_scratch_other'},{}),
                              ({'tenantId':'tenant_a','database':'webvue_scratch_other','filestore':'webvue_scratch_other'},{'recoverySource':{}})]:
            with self.assertRaises(ValueError):restore_tenant(self.root/'backup',binding,{**config,**patch})
        self.assertEqual(len(self.commands),before)

    def test_restore_only_new_explicit_scratch_and_never_after_resumed_writes(self):
        capture_tenant(self.binding, self.proof, self.config)
        config = {**self.config, 'restoreAllowed': True, 'writesResumed': False,
                  'targetFilestore': str(self.root / 'webvue_scratch_restore'),'recoverySource':self.binding}
        result = restore_tenant(self.root / 'backup', {'tenantId':'tenant_a','database': 'webvue_scratch_restore','filestore':'webvue_scratch_restore'}, config)
        self.assertTrue(result['restored'])
        self.assertEqual((self.root / 'webvue_scratch_restore' / 'attachment').read_bytes(), b'attachment-data')
        for patch, db in [({'writesResumed': True}, 'webvue_scratch_again'), ({}, 'odoo19')]:
            with self.subTest(db=db), self.assertRaises(ValueError):
                restore_tenant(self.root / 'backup', {'database': db}, {**config, **patch})


if __name__ == '__main__': unittest.main()
