"""Public CLI contracts use actual local documents, trees and restore artifacts."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

from . import cli
from .test_manifest import release


class CliTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()

    def doc(self, name, value):
        path = self.root / name
        path.write_text(json.dumps(value))
        return str(path)

    def invoke(self, argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try: code = cli.main(argv)
            except SystemExit as exc: code = exc.code
        return code, out.getvalue(), err.getvalue()

    def classify_args(self):
        for tree in ('base', 'target'):
            (self.root / tree).mkdir()
            (self.root / tree / 'apps/web/app').mkdir(parents=True)
            (self.root / tree / 'apps/web/app/a.css').write_text(tree)
        return ['classify', '--base', str(self.root / 'base'), '--target', str(self.root / 'target'),
                '--manifest', self.doc('manifest.json', release()), '--installed-modules', self.doc('installed.json', [])]

    def test_readonly_classify_needs_no_state_and_uses_explicit_scope(self):
        code, out, err = self.invoke(self.classify_args())
        self.assertEqual((code, err), (0, ''))
        self.assertTrue(json.loads(out)['eligible'])
        self.assertFalse((self.root / 'release.sqlite').exists())

    def test_classify_refuses_missing_or_malformed_scope(self):
        args = self.classify_args()
        self.assertEqual(self.invoke(args[:-2])[0], 2)
        Path(args[-1]).write_text('{"project":true}')
        self.assertEqual(self.invoke(args)[0], 1)

    def test_unknown_change_remains_blocked_without_changing_mode(self):
        args = self.classify_args()
        (self.root / 'target/deploy').mkdir()
        (self.root / 'target/deploy/start.sh').write_text('unknown')
        code, out, _ = self.invoke(args)
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(out)['reasons'], ['unknown_change'])
        self.assertEqual(json.loads(out)['mode'], 'online')

    def test_render_emits_candidate_without_starting_or_state(self):
        pool = 'green'
        upstreams = {'odoo': 'http://green-odoo:8069', 'web': 'http://green-web:3000', 'ws': 'http://green-odoo:8072'}
        operator = {'poolId': pool, 'tenancyMode': 'shared', 'upstreams': upstreams,
            'allowedUpstreams': [*upstreams.values(), 'http://guard:8080'], 'guardUrl': 'http://guard:8080',
            'sessionStore': 'liwan_sessions', 'filestore': 'liwan_filestore', 'assetsStore': 'liwan_assets',
            'httpConfig': '/etc/liwan/green-http.conf', 'cronConfig': '/etc/liwan/green-cron.conf',
            'cronDatabases': ['liwan_scratch_a'], 'runtimeSecret': '/etc/liwan/green.env',
            'runtimeDbUser': 'green_runtime', 'runtimeUid': 1000, 'httpConfigDigest': 'a'*64, 'cronConfigDigest': 'b'*64,
            'guardWebNetwork': 'guard_web', 'guardOdooNetwork': 'guard_odoo', 'databaseNetwork': 'db_net',
            'releaseRoutesDir': '/etc/liwan/releases/routes'}
        with patch('subprocess.run', side_effect=AssertionError('render started a process')):
            code, out, err = self.invoke(['render', '--manifest', self.doc('manifest.json', release()),
                                          '--operator-config', self.doc('operator.json', operator)])
        self.assertEqual((code, err), (0, ''))
        result = json.loads(out)
        self.assertEqual(result['services']['green-odoo']['command'], ['--max-cron-threads=0'])
        self.assertTrue(all('ports' not in service for service in result['services'].values()))
        self.assertEqual(result['x-liwan-pool']['releaseId'], 'r20261016')

    def bootstrap_args(self, **changes):
        binding = {'tenantId': 'tenant_a', 'database': 'liwan_scratch_a', 'filestore': 'liwan_scratch_a', 'registryRevision': 1}
        route = {'schemaVersion': 1, 'tenantId': 'tenant_a', 'identityRevision': 1, 'routeRevision': 1,
                 'fence': 1, 'state': 'serving', 'releaseId': 'r20261016', 'poolId': 'blue'}
        evidence = {'schemaVersion': 1, 'tenantId': 'tenant_a', 'database': 'liwan_scratch_a', 'filestore': 'liwan_scratch_a',
                    'identityRevision': 1, 'poolId': 'blue', 'releaseId': 'r20261016', 'fence': 1,
                    'edgeOffline': True, 'cronStopped': True, 'admittedWriters': 0, 'activeTransactions': 0,
                    'oldConnections': 0, 'reviewer': 'operator', 'reference': 'offline-check-1'}
        evidence.update(changes)
        return ['bootstrap', '--state', str(self.root / 'state'), '--binding', self.doc('binding.json', binding),
                '--route', self.doc('route.json', route), '--bootstrap-evidence', self.doc('offline.json', evidence)]

    def test_bootstrap_refuses_missing_or_unsafe_evidence_before_state_mutation(self):
        args = self.bootstrap_args()
        self.assertEqual(self.invoke(args[:-2])[0], 2)
        for patch_value in ({'edgeOffline': False}, {'oldConnections': 1}, {'tenantId': 'other'}, {'activeTransactions': False}):
            self.assertEqual(self.invoke(self.bootstrap_args(**patch_value))[0], 1)
        self.assertFalse((self.root / 'state').exists())

    def test_bootstrap_refuses_relative_state_root(self):
        args = self.bootstrap_args()
        args[2] = 'relative-state'
        self.assertEqual(self.invoke(args)[0], 1)
        self.assertFalse((self.root/'state').exists())

    def test_bootstrap_creates_durable_lease_directory_and_route_after_offline_proof(self):
        code, out, err = self.invoke(self.bootstrap_args())
        self.assertEqual((code, err), (0, ''))
        self.assertTrue(json.loads(out)['registered'])
        self.assertTrue((self.root / 'state/routes/leases').is_dir())
        self.assertEqual(json.loads((self.root / 'state/routes/tenant_a.json').read_text())['poolId'], 'blue')

    def backup(self):
        root = self.root / 'backup'; root.mkdir()
        (root / 'database.dump').write_bytes(b'scratch-dump')
        attachment = self.root / 'attachment'; attachment.write_bytes(b'attachment')
        with tarfile.open(root / 'filestore.tar', 'w') as archive: archive.add(attachment, arcname='ab/attachment')
        receipt = {'version': 1, 'tenantId': 'tenant_a', 'database': 'liwan_scratch_a', 'filestore': 'liwan_scratch_a',
                   'fence': 2, 'image': 'liwan/odoo@sha256:'+'a'*64, 'consistency': 'quiescent_gate', 'restoreVerified': False,
                   'hashes': {name: hashlib.sha256((root/name).read_bytes()).hexdigest() for name in ('database.dump','filestore.tar')}}
        (root / 'receipt.json').write_text(json.dumps(receipt))
        binding = {'tenantId': 'tenant_a', 'database': 'liwan_scratch_restore', 'filestore': 'liwan_scratch_restore'}
        config = {'mode': 'local', 'restoreAllowed': True, 'writesResumed': False, 'createdb': '/usr/bin/true',
                  'pgRestore': '/usr/bin/true', 'targetFilestore': str(self.root/'liwan_scratch_restore'),
                  'recoverySource': {key: receipt[key] for key in ('tenantId','database','filestore','fence')}}
        return root, binding, config

    def test_restore_checks_actual_hashes_and_restores_only_new_scratch_target(self):
        backup, binding, config = self.backup()
        commands = []
        def run(argv, **kwargs):
            commands.append(argv)
            return subprocess.CompletedProcess(argv, 0, '', '')
        with patch('subprocess.run', side_effect=run):
            code, out, err = self.invoke(['restore', '--backup', str(backup), '--binding', self.doc('target.json', binding),
                                          '--runtime', self.doc('restore.json', config)])
        self.assertEqual((code, err), (0, ''))
        self.assertFalse(json.loads(out)['restoreVerified'])
        self.assertEqual((self.root/'liwan_scratch_restore/ab/attachment').read_bytes(), b'attachment')
        self.assertEqual(len(commands), 2)
        self.assertEqual(commands[0][-1], 'liwan_scratch_restore')

    def test_restore_refuses_resumed_writes_and_corrupt_backup_before_process(self):
        backup, binding, config = self.backup()
        args = ['restore', '--backup', str(backup), '--binding', self.doc('target.json', binding), '--runtime', '']
        with patch('subprocess.run', side_effect=AssertionError('unsafe restore started')):
            for patch_value in ({'writesResumed': True}, {'mode': 'container'}):
                args[-1] = self.doc('restore.json', {**config, **patch_value})
                self.assertEqual(self.invoke(args)[0], 1)
            (backup/'database.dump').write_bytes(b'corrupt')
            args[-1] = self.doc('restore.json', config)
            self.assertEqual(self.invoke(args)[0], 1)

    def test_all_mutating_actions_refuse_missing_required_documents(self):
        for action in ('bootstrap', 'restore', 'apply', 'reconcile', 'ai-apply', 'schedule-once'):
            with self.subTest(action=action):
                self.assertEqual(self.invoke([action])[0], 2)
        self.assertFalse((self.root/'state').exists())

    def test_document_refuses_relative_symlink_duplicate_keys_and_keeps_errors_sanitized(self):
        args = self.classify_args()
        Path(args[-1]).write_text('{"password":"super-secret","password":"super-secret"}')
        code, out, err = self.invoke(args)
        self.assertEqual(code, 1); self.assertNotIn('super-secret', out+err)
        with self.assertRaises(ValueError): cli.document('relative.json')
        link = self.root/'link.json'; link.symlink_to(args[-1])
        with self.assertRaises(ValueError): cli.document(link)


if __name__ == '__main__': unittest.main()
