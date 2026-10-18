"""Migration runs stock commands, parses ORM evidence and refuses unsafe phases."""
import json
import shutil
from pathlib import Path
import subprocess
import tempfile
import unittest
from .migrate import migrate_tenant, verify_tenant, source_tree_digest, readiness_probe
from .test_manifest import release


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        for name in ('odoo', 'webvue', 'addons', 'data', 'webvue_scratch_state'): (self.root / name).mkdir()
        (self.root / 'webvue' / 'odoo-addons').mkdir()
        (self.root / 'odoo' / 'addons').mkdir()
        (self.root / 'webvue' / 'odoo-addons' / 'source.py').write_text('value = 1')
        for name in ('launcher.py', 'odoo.conf'): (self.root / name).write_text('')
        self.binding = {'tenantId': 'a', 'database': 'webvue_scratch_a', 'fence': 2}
        self.manifest = release(mode='tenant_maintenance', upgradeModules=['webvue_a'],
                                moduleVersions={'webvue_a': '19.0.1.0.0'}, affectedServices=['odoo'])
        self.calls = []
        def runner(argv, **kwargs):
            self.calls.append((argv, kwargs))
            if 'status' in argv: return subprocess.CompletedProcess(argv, 0, '', '')
            if 'rev-parse' in argv:
                commit = '2' * 40 if str(self.root / 'odoo') in argv else '1' * 40
                return subprocess.CompletedProcess(argv, 0, commit + '\n', '')
            output = 'WEBVUE_RELEASE_OBSERVATION=' + json.dumps({'moduleVersions': {'webvue_a': '19.0.1.0.0'},
                      'moduleStatesReady': True, 'database': 'webvue_scratch_a', 'profile': {'commercial_mode': 'non_saas'}, 'readOnly': True})
            return subprocess.CompletedProcess(argv, 0, output, '')
        self.config = {'mode': 'local', 'python': '/usr/bin/true', 'odooRoot': str(self.root / 'odoo'),
                       'webvueRoot': str(self.root / 'webvue'), 'launcher': str(self.root / 'launcher.py'),
                       'odooConfig': str(self.root / 'odoo.conf'), 'addonsPaths': [str(self.root / 'odoo' / 'addons'), str(self.root / 'webvue' / 'odoo-addons')],
                       'dataDir': str(self.root / 'data'), 'stateDir': str(self.root / 'webvue_scratch_state'), 'timeoutSeconds': 20, 'runner': runner,
                       'sourceIdentity': {'webvueCommit': '1' * 40, 'odooCommit': '2' * 40,
                                          'image': self.manifest['images']['odoo'], 'treeDigest': source_tree_digest(self.root / 'webvue')},
                       'expectedProfile': {'commercial_mode': 'non_saas'},
                       'quiescence': {**self.binding, 'gateClosed': True, 'admittedWriters': 0, 'activeTransactions': 0, 'oldConnections': 0}}

    def test_stock_upgrade_command_and_orm_verification(self):
        result = migrate_tenant(self.binding, self.manifest, self.config, 2)
        self.assertTrue(result['migrated'])
        argv = next(argv for argv, kwargs in self.calls if '--update=webvue_a' in argv)
        for flag in ('--no-http', '--stop-after-init', '--max-cron-threads=0', '--database=webvue_scratch_a'):
            self.assertIn(flag, argv)
        self.assertNotIn('--update=all', argv)
        shell = next(kwargs for argv, kwargs in self.calls if 'shell' in argv)
        self.assertEqual(shell['env']['PGOPTIONS'], '-c default_transaction_read_only=on')
        self.assertIn("env['ir.module.module']", shell['input'])
        self.assertNotIn('UPDATE ir_', shell['input'])

    def test_fence_mismatch_and_online_operations_refused_before_subprocess(self):
        with self.assertRaises(ValueError): migrate_tenant(self.binding, self.manifest, self.config, 1)
        self.assertFalse(self.calls)

    def test_pending_modules_and_wrong_profile_block_acceptance(self):
        runner = self.config['runner']
        def wrong(argv, **kwargs):
            result = runner(argv, **kwargs)
            if 'shell' in argv: result.stdout = 'WEBVUE_RELEASE_OBSERVATION=' + json.dumps({'moduleVersions': {}, 'moduleStatesReady': False, 'database': 'webvue_scratch_a', 'profile': {}, 'readOnly': True})
            return result
        with self.assertRaises(ValueError):
            verify_tenant(self.binding, self.manifest, {**self.config, 'runner': wrong})

    def test_addon_search_path_cannot_escape_the_verified_source_roots(self):
        with self.assertRaisesRegex(ValueError, '^addons_paths_rejected$'):
            migrate_tenant(self.binding, self.manifest,
                           {**self.config, 'addonsPaths': [str(self.root / 'addons')]}, 2)
        self.assertFalse(any('server' in argv for argv, _ in self.calls))

    def oca_setup(self):
        """A WebVue root with the real OCA helper and a one-repository pin file, plus that repository."""
        repo = self.root / 'oca' / 'demo'
        repo.mkdir(parents=True)
        git = ['git', '-c', 'user.email=t@t', '-c', 'user.name=t']
        for args in (['init', '-q'], ['commit', '-q', '--allow-empty', '-m', 'one']):
            subprocess.run([*git, *args], cwd=repo, check=True, capture_output=True)
        commit = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=repo, check=True, capture_output=True, text=True).stdout.strip()
        (self.root / 'webvue' / 'tools').mkdir()
        (self.root / 'webvue' / 'deploy').mkdir()
        shutil.copy(Path(__file__).resolve().parents[2] / 'tools' / 'oca_addons.py', self.root / 'webvue' / 'tools')
        pins = {'repos': [{'repo': 'OCA/demo', 'branch': '19.0', 'commit': commit}]}
        (self.root / 'webvue' / 'deploy' / 'oca-addons.json').write_text(json.dumps(pins))
        return {**self.config, 'ocaDir': str(self.root / 'oca'),
                'addonsPaths': [*self.config['addonsPaths'], str(repo)]}

    def test_pinned_oca_repositories_are_allowed_when_verified_at_their_pin(self):
        config = self.oca_setup()
        self.assertTrue(migrate_tenant(self.binding, self.manifest, config, 2)['migrated'])
        argv = next(argv for argv, kwargs in self.calls if '--update=webvue_a' in argv)
        self.assertIn(str(self.root / 'oca' / 'demo'), next(a for a in argv if a.startswith('--addons-path=')))

    def test_oca_repository_not_at_its_pin_or_unlisted_is_rejected(self):
        config = self.oca_setup()
        subprocess.run(['git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'two'],
                       cwd=self.root / 'oca' / 'demo', check=True, capture_output=True)
        with self.assertRaisesRegex(ValueError, '^addons_paths_rejected$'):
            migrate_tenant(self.binding, self.manifest, config, 2)
        stray = self.root / 'oca' / 'stray'
        stray.mkdir()
        config = self.oca_setup_paths(stray)
        with self.assertRaisesRegex(ValueError, '^addons_paths_rejected$'):
            migrate_tenant(self.binding, self.manifest, config, 2)
        self.assertFalse(any('server' in argv for argv, _ in self.calls))

    def oca_setup_paths(self, extra):
        return {**self.config, 'addonsPaths': [*self.config['addonsPaths'], str(extra)]}

    def test_operator_python_can_be_a_virtualenv_executable_symlink(self):
        python = self.root / 'python'
        python.symlink_to('/usr/bin/true')
        result = migrate_tenant(self.binding, self.manifest, {**self.config, 'python': str(python)}, 2)
        self.assertTrue(result['migrated'])
        argv = next(argv for argv, kwargs in self.calls if '--update=webvue_a' in argv)
        self.assertEqual(argv[0], str(python))

    def test_source_digest_changes_block_launch_without_requiring_a_commit(self):
        (self.root / 'webvue' / 'odoo-addons' / 'source.py').write_text('value = 2')
        with self.assertRaisesRegex(ValueError, '^source_identity_mismatch$'):
            migrate_tenant(self.binding, self.manifest, self.config, 2)
        self.assertFalse(any('server' in argv for argv, _ in self.calls))

    def test_readiness_callback_combines_orm_and_independent_runtime_observation(self):
        callback = readiness_probe(lambda binding: self.config, self.manifest,
                                   lambda pool, binding: {'poolId': 'green', 'images': self.manifest['images']})
        result = callback({}, self.binding)
        self.assertTrue(result['databaseReady'])
        self.assertEqual(result['moduleVersions'], {'webvue_a': '19.0.1.0.0'})
        self.assertEqual(result['poolId'], 'green')

    def test_subprocess_failure_is_sanitized_and_timeout_bounded(self):
        def failed(argv, **kwargs): raise subprocess.TimeoutExpired(argv, 20, stderr='password=private')
        with self.assertRaisesRegex(ValueError, '^release_process_failed$'):
            migrate_tenant(self.binding, self.manifest, {**self.config, 'runner': failed}, 2)


if __name__ == '__main__': unittest.main()
