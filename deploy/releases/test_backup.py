"""Backup tests use real temporary dump/archive files and external-command seams."""
from pathlib import Path
import subprocess
import tempfile
import unittest
from .backup import capture_tenant, validate_backup, restore_tenant


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
                       'image': 'webvue/odoo@sha256:' + 'a' * 64, 'runner': runner,
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
