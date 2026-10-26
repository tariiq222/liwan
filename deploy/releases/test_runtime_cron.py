"""Cron generation regressions; only external Docker/PostgreSQL seams are faked.

Run against the coordinator's current source without copying it::

    WEBVUE_RUNTIME_REVIEW_SOURCE=/absolute/coordinator/worktree python3 -m unittest deploy.releases.test_runtime_cron -v
"""
import importlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace


SOURCE = Path(os.environ.get('WEBVUE_RUNTIME_REVIEW_SOURCE', Path(__file__).resolve().parents[2]))
PACKAGE = '_webvue_cron_review'
spec = importlib.util.spec_from_file_location(PACKAGE, SOURCE / 'deploy/releases/__init__.py',
    submodule_search_locations=[str(SOURCE / 'deploy/releases')])
package = importlib.util.module_from_spec(spec)
sys.modules[PACKAGE] = package
spec.loader.exec_module(package)
runtime_module = importlib.import_module(PACKAGE + '.runtime')
state_module = importlib.import_module(PACKAGE + '.state')
engine_module = importlib.import_module(PACKAGE + '.engine')
manifest_module = importlib.import_module(PACKAGE + '.manifest')


class BackupCursor:
    def __init__(self, connection): self.connection = connection
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def execute(self, sql, args=()):
        self.connection.statements.append((sql, args)); self.sql, self.args = sql, args
    def fetchone(self):
        if 'has_database_privilege' in self.sql: return (self.connection.grants.get(self.args[0]),)
        if 'count(*)' in self.sql: return (self.connection.active,)
        return (0,)


class BackupConnection:
    """Fake PostgreSQL seam: reports durable CONNECT grants and records statements."""
    def __init__(self, grants):
        self.grants, self.active, self.statements = dict(grants), 0, []
    def cursor(self): return BackupCursor(self)
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def commit(self): pass
    def rollback(self): pass
    def close(self): pass


class RuntimeCronTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.state = state_module.ReleaseState(Path(temporary.name).resolve())
        self.binding = {'tenantId': 'tenant_a', 'database': 'webvue_scratch_cron_a',
            'filestore': 'webvue_scratch_cron_a', 'registryRevision': 1}
        self.old = {'schemaVersion': 1, 'tenantId': 'tenant_a', 'identityRevision': 1,
            'routeRevision': 1, 'fence': 1, 'releaseId': 'r1', 'poolId': 'blue', 'state': 'serving'}
        self.state.register(self.binding, self.old)
        self.current = {**self.old, 'routeRevision': 2, 'fence': 2, 'poolId': 'green', 'releaseId': 'r2',
            'draining': [{key: self.old[key] for key in ('poolId', 'releaseId', 'routeRevision', 'fence')}]}
        self.events = []
        self.running = {'blue-cron': True, 'green-cron': False}
        self.config = {'mode': 'local', 'postgres': {'host': '127.0.0.1'}, 'targetPool': 'green',
            'jobsRequired': True, 'drainSeconds': 0, 'pools': {},
            'tenants': {'tenant_a': {**self.binding, 'roles': {'blue': 'role_blue', 'green': 'role_green'}}}}
        for pool, release in [('blue', 'r1'), ('green', 'r2')]:
            identity = {'releaseId': release}
            self.config['pools'][pool] = {'containers': {'odoo': pool + '-http', 'web': pool + '-web'},
                'odooRuntime': identity, 'cronRuntimes': [{'container': pool + '-cron',
                    'identity': identity, 'databases': [self.binding['database']]}]}
        self.runtime = runtime_module.LocalRuntime(self.state, self.config, role_inspector=self.inspect,
            classifier=lambda *_: {'ready': True}, inspector=lambda *_: {'ready': True},
            inventory_inspector=lambda *_: None)

    def inspect(self, container, expected, **kwargs):
        self.events.append(('inspect', container, kwargs))
        return {'ready': True, 'dbUser': expected['dbUser'], 'running': self.running.get(container, True)}

    def fence(self, binding, old_role, new_role, connector, **kwargs):
        self.events.append(('fence', old_role, new_role))
        return {'fenced': True, 'fence': binding['fence'], 'activeTransactions': 0,
            'oldConnections': 0, 'transactionScope': binding['transactionScope']}

    def docker(self, argv, **kwargs):
        self.events.append(('docker', tuple(argv)))
        if argv[:2] in (['docker', 'stop'], ['docker', 'start']):
            self.running[argv[-1]] = argv[1] == 'start'
        return type('Result', (), {'returncode': 0, 'stdout': '', 'stderr': ''})()

    def publish(self):
        self.state.publish(self.current, expected_revision=1)

    def test_running_old_cron_is_not_a_candidate_after_publication(self):
        self.publish()
        result = self.runtime._bind_role(self.binding, 'blue')
        self.assertTrue(result['ready'])
        self.assertTrue(self.running['blue-cron'])

    def test_missing_required_target_cron_is_rejected_before_database_access(self):
        self.config['pools']['green']['cronRuntimes'] = []
        self.runtime.connector = lambda _: self.fail('preflight reached PostgreSQL without cron ownership')
        with self.assertRaisesRegex(state_module.ReleaseConflict, 'tenant_cron_ownership_missing'):
            self.runtime.prepare(self.binding, {'images': {'odoo': 'test-odoo', 'web': 'test-web'}}, 'green')

    def test_duplicate_required_target_cron_is_rejected_before_database_access(self):
        self.config['pools']['green']['cronRuntimes'] *= 2
        self.runtime.connector = lambda _: self.fail('preflight reached PostgreSQL with duplicate cron ownership')
        with self.assertRaisesRegex(state_module.ReleaseConflict, 'tenant_cron_ownership_missing'):
            self.runtime.prepare(self.binding, {'images': {'odoo': 'test-odoo', 'web': 'test-web'}}, 'green')

    def test_candidate_running_cron_is_rejected_before_database_access(self):
        self.running['green-cron'] = True
        self.runtime.connector = lambda _: self.fail('running candidate reached PostgreSQL')
        with self.assertRaisesRegex(state_module.ReleaseConflict, 'candidate_cron_must_be_stopped'):
            self.runtime.prepare(self.binding, {'images': {'odoo': 'test-odoo', 'web': 'test-web'}}, 'green')

    def test_old_cron_stops_only_after_database_fence_proves_zero_work(self):
        self.publish()
        with patch.object(runtime_module, 'fence_runtime', self.fence), \
                patch.object(runtime_module.subprocess, 'run', self.docker):
            result = self.runtime.retire(self.binding, self.old, self.current)
        self.assertTrue(result['drained'])
        self.assertFalse(self.running['blue-cron'])
        fence_index = next(i for i, event in enumerate(self.events) if event[0] == 'fence')
        stops = [(i, event) for i, event in enumerate(self.events) if event[0] == 'docker' and event[1][:2] == ('docker', 'stop')]
        self.assertEqual(len(stops), 1)
        self.assertGreater(stops[0][0], fence_index)
        self.assertIn('blue-cron', stops[0][1][1])
        self.assertFalse(any('green-cron' in event[1] for _, event in stops))

    def test_active_database_work_keeps_old_cron_running(self):
        self.publish()
        def busy(binding, *_args, **_kwargs):
            self.events.append(('fence', 'busy'))
            return {'fenced': False, 'reason': 'active_transactions', 'fence': binding['fence']}
        with patch.object(runtime_module, 'fence_runtime', busy), \
                patch.object(runtime_module.subprocess, 'run', self.docker):
            result = self.runtime.retire(self.binding, self.old, self.current)
        self.assertFalse(result['drained'])
        self.assertTrue(self.running['blue-cron'])
        self.assertFalse(any(event[0] == 'docker' for event in self.events))

    def test_docker_inventory_requires_exact_declared_pool_containers(self):
        declared = ['green-http', 'green-web', 'green-cron']
        for observed, valid in [(declared, True), (declared[:-1], False),
                ([*declared, 'green-unowned-cron'], False)]:
            with self.subTest(observed=observed):
                def docker(argv, **kwargs):
                    self.assertEqual(argv, ['docker', 'ps', '--all', '--filter',
                        'label=webvue.pool=green', '--format', '{{.Names}}'])
                    return SimpleNamespace(stdout='\n'.join(observed) + '\n')
                with patch.object(runtime_module.subprocess, 'run', docker):
                    if valid:
                        self.runtime._inspect_inventory('green')
                    else:
                        with self.assertRaisesRegex(state_module.ReleaseConflict, 'runtime_inventory_mismatch'):
                            self.runtime._inspect_inventory('green')

    def test_docker_inventory_rejects_duplicate_declared_container_ownership(self):
        self.config['pools']['green']['cronRuntimes'] *= 2
        with patch.object(runtime_module.subprocess, 'run', side_effect=AssertionError('must fail before Docker')):
            with self.assertRaisesRegex(state_module.ReleaseConflict, 'duplicate_runtime_ownership'):
                self.runtime._inspect_inventory('green')

    def test_job_start_failure_preserves_retired_stage_and_reconcile_never_replays_upgrade(self):
        manifest = {'releaseId': 'r2', 'webvueCommit': '1' * 40, 'odooCommit': '2' * 40,
            'images': {'odoo': 'webvue/odoo@sha256:' + 'a' * 64, 'web': 'webvue/web@sha256:' + 'b' * 64},
            'assetsId': 'assets2', 'moduleVersions': {'webvue_core': '19.0.1.0.0'},
            'upgradeModules': ['webvue_core'], 'installModules': [], 'mode': 'tenant_maintenance',
            'affectedServices': ['odoo'], 'aiStateVersion': '1',
            'compatibilityEvidence': {'reviewer': 'owner', 'reference': 'review42'},
            'rollbackPolicy': {}}
        request = {'requestId': 'request_cron', 'manifestDigest': manifest_module.manifest_digest(manifest),
            'tenantIds': ['tenant_a'], 'expectedRoutes': {'tenant_a': 1},
            'targetPool': 'green', 'approvedMode': 'tenant_maintenance'}
        calls = []
        def migrate(binding, manifest, proof):
            calls.append('migrate')
            return {'fence': 1, 'digest': 'b' * 64}
        def activate(binding, current):
            calls.append('activate')
            if calls.count('activate') == 1:
                raise OSError('scripted Docker start failure')
            return {'ready': True}
        adapter = SimpleNamespace(
            prepare=lambda *_: {'ready': True}, verify=lambda *_: {'ready': True},
            acknowledge=lambda binding, route, maintenance=False: {'ready': True,
                'routeRevision': route['routeRevision'], 'maintenance': maintenance},
            quiesce=lambda binding, route: {**binding, 'fence': 1, 'gateClosed': True,
                'admittedWriters': 0, 'activeTransactions': 0, 'oldConnections': 0},
            capture=lambda *_: {'fence': 1, 'digest': 'a' * 64}, migrate=migrate,
            block_generation=lambda *_: None,
            retire=lambda *_: calls.append('retire') or {'drained': True}, activate_jobs=activate)
        engine = engine_module.ReleaseEngine(self.state, adapter)
        with self.assertRaisesRegex(OSError, 'scripted Docker start failure'):
            engine.apply(request, manifest)
        receipt = self.state.receipt(request['requestId'])
        self.assertEqual(receipt['stage'], 'retired_old')
        self.assertTrue(receipt['tenants'][0]['retirement_digest'])
        self.assertEqual(json.loads((self.state.routes / 'tenant_a.json').read_text())['poolId'], 'green')
        self.assertEqual(engine.reconcile(request, manifest)['stage'], 'verified')
        self.assertEqual(calls, ['migrate', 'retire', 'activate', 'activate'])


    def backup_config(self, grants=None):
        self.config['backup'] = {'image': 'img-blue', 'totalDeadlineSeconds': 60}
        self.config['pools']['blue']['odooRuntime']['image'] = 'img-blue'
        self.config['pools']['green']['odooRuntime']['image'] = 'img-green'
        self.connection = BackupConnection(grants if grants is not None else {'role_blue': True, 'role_green': False})
        self.runtime.connector = lambda _: self.connection
        return self.old

    def backup_previous(self, grants=None, cron=None, **patch):
        return {'version': 1, 'tenantId': 'tenant_a', 'database': self.binding['database'],
            'filestore': self.binding['filestore'], 'registryRevision': 1, 'releaseId': 'r1', 'poolId': 'blue',
            'routeRevision': 1, 'fence': 1, 'image': 'img-blue', 'roles': ['role_blue', 'role_green'],
            'grants': grants if grants is not None else {'role_blue': True, 'role_green': False},
            'cron': cron if cron is not None else {'blue-cron': True}, **patch}

    def window(self, binding, roles, connector, **kwargs):
        self.events.append(('window', tuple(roles), binding.get('transactionScope')))
        return {'fenced': True, 'fence': binding['fence'], 'activeTransactions': 0, 'oldConnections': 0,
            'writerConnections': 0, 'deniedWriters': list(roles), 'transactionScope': 'tenant'}

    def test_window_recheck_requires_every_declared_writer_to_be_denied(self):
        self.state.maintenance('tenant_a', 1)
        route = self.backup_config(grants={'role_blue': True, 'role_green': False})
        with self.assertRaisesRegex(state_module.ReleaseConflict, 'writer_admission_open'):
            self.runtime._recheck_window(self.binding)
        self.connection.grants = {'role_blue': False, 'role_green': False}
        proof = self.runtime._recheck_window(self.binding)
        self.assertEqual(proof['deniedWriters'], ['role_blue', 'role_green'])
        self.assertEqual(proof['writerConnections'], 0)
        self.assertEqual(proof['fence'], route['fence'])

    def test_generation_recheck_keeps_serving_role_admission_for_migration(self):
        # fence_runtime still admits the serving generation; the shared recheck must
        # stay usable there instead of demanding a full writer window.
        self.state.maintenance('tenant_a', 1)
        self.backup_config(grants={'role_blue': True, 'role_green': False})
        self.assertTrue(self.runtime._recheck(self.binding)['gateClosed'])
        with self.assertRaisesRegex(state_module.ReleaseConflict, 'writer_admission_open'):
            self.runtime._recheck_window(self.binding)

    def test_recheck_refuses_a_writer_session_of_any_declared_role(self):
        self.state.maintenance('tenant_a', 1)
        self.backup_config(grants={'role_blue': False, 'role_green': False})
        self.connection.active = 1
        with self.assertRaisesRegex(state_module.ReleaseConflict, 'writer_reconnect_observed'):
            self.runtime._recheck_window(self.binding)

    def test_backup_previous_state_records_grants_and_owned_cron(self):
        route = self.backup_config()
        previous = self.runtime.prepare_backup(self.binding, route)
        self.assertEqual(previous['roles'], ['role_blue', 'role_green'])
        self.assertEqual(previous['grants'], {'role_blue': True, 'role_green': False})
        self.assertEqual(previous['cron'], {'blue-cron': True})
        self.assertEqual((previous['fence'], previous['poolId'], previous['routeRevision']), (1, 'blue', 1))

    def test_backup_previous_state_refuses_a_running_candidate_cron(self):
        route = self.backup_config(); self.running['green-cron'] = True
        with self.assertRaisesRegex(state_module.ReleaseConflict, 'candidate_cron_must_be_stopped'):
            self.runtime.prepare_backup(self.binding, route)

    def test_backup_window_denies_every_declared_writer_before_stopping_owned_cron(self):
        self.state.maintenance('tenant_a', 1)
        route = self.backup_config()
        with patch.object(runtime_module, 'fence_writers', self.window), \
                patch.object(runtime_module.subprocess, 'run', self.docker):
            proof = self.runtime._fence_backup_writers(self.binding, route)
        self.assertEqual(proof['deniedWriters'], ['role_blue', 'role_green'])
        self.assertEqual(proof['writerConnections'], 0)
        window = next(event for event in self.events if event[0] == 'window')
        self.assertEqual(window[1], ('role_blue', 'role_green'))
        self.assertEqual(window[2], 'tenant')
        stops = [event for event in self.events if event[0] == 'docker' and event[1][:2] == ('docker', 'stop')]
        self.assertEqual(len(stops), 1)
        self.assertIn('blue-cron', stops[0][1])
        self.assertFalse(any('green-cron' in event[1] for event in stops))

    def test_resume_restores_only_previously_granted_writers_and_running_cron(self):
        self.state.maintenance('tenant_a', 1)
        route = self.backup_config(grants={'role_blue': False, 'role_green': False})
        self.running['blue-cron'] = False
        with patch.object(runtime_module.subprocess, 'run', self.docker):
            result = self.runtime.resume_backup(self.binding, route, self.backup_previous())
        self.assertEqual(result['restoredWriters'], ['role_blue'])
        sql = '\n'.join(statement for statement, _ in self.connection.statements)
        self.assertIn('GRANT CONNECT ON DATABASE "webvue_scratch_cron_a" TO "role_blue"', sql)
        self.assertNotIn('role_green', sql)
        self.assertTrue(self.running['blue-cron'])

    def test_stopped_previous_cron_is_never_started_by_a_backup(self):
        self.state.maintenance('tenant_a', 1)
        route = self.backup_config(grants={'role_blue': False, 'role_green': False})
        self.running['blue-cron'] = False
        with patch.object(runtime_module.subprocess, 'run', self.docker):
            result = self.runtime.resume_backup(self.binding, route, self.backup_previous(cron={'blue-cron': False}))
        self.assertEqual(result['cron'], {'blue-cron': False})
        self.assertFalse(self.running['blue-cron'])
        self.assertFalse([event for event in self.events if event[0] == 'docker'])

    def test_resume_refuses_a_replaced_or_unverified_previous_cron(self):
        self.state.maintenance('tenant_a', 1)
        route = self.backup_config(grants={'role_blue': False, 'role_green': False})
        self.config['pools']['blue']['cronRuntimes'][0]['container'] = 'blue-cron-v2'
        with self.assertRaisesRegex(state_module.ReleaseConflict, 'cron_identity_changed'):
            self.runtime.resume_backup(self.binding, route, self.backup_previous())

    def test_resume_refuses_a_previous_state_from_another_route(self):
        self.state.maintenance('tenant_a', 1)
        route = self.backup_config()
        for patch_state in ({'fence': 2}, {'poolId': 'green'}, {'roles': ['role_blue']}, {'grants': {'role_blue': True}}):
            with self.subTest(patch=patch_state), self.assertRaisesRegex(state_module.ReleaseConflict, 'backup_previous_state_mismatch'):
                self.runtime.resume_backup(self.binding, route, self.backup_previous(**patch_state))

    def test_partial_resume_failure_denies_writers_and_stops_owned_cron(self):
        route = self.backup_config(); self.running['blue-cron'] = True
        with patch.object(runtime_module, 'fence_writers', self.window), \
                patch.object(runtime_module.subprocess, 'run', self.docker):
            result = self.runtime.fail_closed_backup(self.binding, route)
        self.assertEqual(result['deniedWriters'], ['role_blue', 'role_green'])
        self.assertFalse(self.running['blue-cron'])

    def test_reconcile_refuses_when_a_previously_denied_writer_was_reopened(self):
        self.state.maintenance('tenant_a', 1)
        route = self.backup_config(grants={'role_blue': True, 'role_green': True})
        with self.assertRaisesRegex(state_module.ReleaseConflict, 'backup_fence_lost'):
            self.runtime.reconcile_backup(self.binding, route, self.backup_previous())

    def test_reconcile_restores_previous_state_without_capturing(self):
        self.state.maintenance('tenant_a', 1)
        route = self.backup_config(grants={'role_blue': False, 'role_green': False})
        self.running['blue-cron'] = False
        with patch.object(runtime_module.subprocess, 'run', self.docker):
            result = self.runtime.reconcile_backup(self.binding, route, self.backup_previous())
        self.assertEqual(result['restoredWriters'], ['role_blue'])
        sql = '\n'.join(statement for statement, _ in self.connection.statements)
        self.assertIn('TO "role_blue"', sql)
        self.assertNotIn('role_green', sql)


if __name__ == '__main__':
    unittest.main()
