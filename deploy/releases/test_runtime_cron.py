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
backup_module = importlib.import_module(PACKAGE + '.backup')
operation_module = importlib.import_module(PACKAGE + '.backup_operation')


class BackupCursor:
    def __init__(self, connection): self.connection = connection
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def execute(self, sql, args=()):
        self.connection.statements.append((sql, args)); self.sql, self.args = sql, args
        self.connection.tick()
        if sql.startswith('GRANT CONNECT ON DATABASE'): self.connection.grants[sql.rsplit('"', 2)[1]] = True
        if sql.startswith('REVOKE CONNECT ON DATABASE'): self.connection.grants[sql.rsplit('"', 2)[1]] = False
    def fetchone(self):
        # Enough catalog for the real fence_writers role validation: an existing
        # database and plain login roles without membership, ownership or PUBLIC.
        if 'count(*)' in self.sql: return (self.connection.active,)
        if 'FROM pg_database WHERE datname' in self.sql: return (True,)
        if 'FROM pg_roles WHERE rolname' in self.sql: return (True, False, False, False, False, False)
        if self.sql.startswith('SELECT EXISTS'): return (False,)
        return (0,)
    def fetchall(self):
        if 'has_database_privilege' in self.sql:
            return [(role, self.connection.grants[role]) for role in self.args[1] if role in self.connection.grants]
        return []


class BackupConnection:
    """Fake PostgreSQL seam: reports durable CONNECT grants and records statements."""
    def __init__(self, grants):
        self.grants, self.active, self.statements = dict(grants), 0, []
        self.tick = lambda: None
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
        self.ids = {'blue-cron': '1' * 64, 'green-cron': '3' * 64}
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
        return {'ready': True, 'dbUser': expected['dbUser'], 'running': self.running.get(container, True),
            'containerId': self.ids.get(container, 'f' * 64)}

    def fence(self, binding, old_role, new_role, connector, **kwargs):
        self.events.append(('fence', old_role, new_role))
        return {'fenced': True, 'fence': binding['fence'], 'activeTransactions': 0,
            'oldConnections': 0, 'transactionScope': binding['transactionScope']}

    def docker(self, argv, **kwargs):
        self.events.append(('docker', tuple(argv)))
        if argv[:2] in (['docker', 'stop'], ['docker', 'start']):
            # The backup targets the inspected id; the release path still uses the name.
            container = next((name for name, value in self.ids.items() if value == argv[-1]), argv[-1])
            self.running[container] = argv[1] == 'start'
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
        self.connects = []
        self.runtime.connector = lambda _database, **options: self.connects.append(options) or self.connection
        return self.old

    def backup_previous(self, grants=None, cron=None, **patch):
        return {'version': 2, 'tenantId': 'tenant_a', 'database': self.binding['database'],
            'filestore': self.binding['filestore'], 'registryRevision': 1, 'releaseId': 'r1', 'poolId': 'blue',
            'routeRevision': 1, 'fence': 1, 'image': 'img-blue', 'roles': ['role_blue', 'role_green'],
            'grants': grants if grants is not None else {'role_blue': True, 'role_green': False},
            'cron': cron if cron is not None else {'blue-cron': {'containerId': '1' * 64, 'running': True}}, **patch}

    def window(self, binding, roles, connector, **kwargs):
        self.events.append(('window', tuple(roles), binding.get('transactionScope')))
        return {'fenced': True, 'fence': binding['fence'], 'activeTransactions': 0, 'oldConnections': 0,
            'writerConnections': 0, 'deniedWriters': list(roles), 'transactionScope': 'tenant'}

    def test_window_recheck_requires_every_declared_writer_to_be_denied(self):
        self.state.maintenance('tenant_a', 1)
        route = self.backup_config(grants={'role_blue': True, 'role_green': False})
        with self.assertRaisesRegex(state_module.ReleaseConflict, 'writer_admission_open'):
            self.runtime._recheck_window(self.binding, backup_module.Deadline(5))
        self.connection.grants = {'role_blue': False, 'role_green': False}
        proof = self.runtime._recheck_window(self.binding, backup_module.Deadline(5))
        self.assertEqual(proof['deniedWriters'], ['role_blue', 'role_green'])
        self.assertEqual(proof['writerConnections'], 0)
        self.assertEqual(proof['fence'], route['fence'])

    def test_release_quiesce_keeps_the_candidate_connectable_through_verify(self):
        # R1: release/migrate/retire behave as on main. quiesce swaps generations with
        # fence_runtime (grants the candidate) and never uses the backup-only fence.
        self.state.maintenance('tenant_a', 1)
        self.backup_config(grants={'role_blue': True, 'role_green': False})
        self.runtime.acknowledge = lambda *_: {'ready': True}
        def forbidden(*_a, **_k): self.fail('release path used the backup writer fence')
        with patch.object(runtime_module, 'fence_runtime', self.fence), \
                patch.object(runtime_module, 'fence_writers', forbidden), \
                patch.object(runtime_module.subprocess, 'run', self.docker):
            proof = self.runtime.quiesce(self.binding, self.old)
        self.assertIn(('fence', 'role_blue', 'role_green'), self.events)  # old revoked, candidate granted
        self.assertEqual(self.runtime.proofs['tenant_a'], proof)
        self.assertEqual(self.runtime._recheck(self.binding), proof)
        with self.assertRaisesRegex(state_module.ReleaseConflict, 'writer_admission_open'):
            self.runtime._recheck_window(self.binding, backup_module.Deadline(5))

    def test_recheck_refuses_a_writer_session_of_any_declared_role(self):
        self.state.maintenance('tenant_a', 1)
        self.backup_config(grants={'role_blue': False, 'role_green': False})
        self.connection.active = 1
        with self.assertRaisesRegex(state_module.ReleaseConflict, 'writer_reconnect_observed'):
            self.runtime._recheck_window(self.binding, backup_module.Deadline(5))

    def test_backup_previous_state_records_grants_and_owned_cron(self):
        route = self.backup_config()
        previous = self.runtime.prepare_backup(self.binding, route)
        self.assertEqual(previous['roles'], ['role_blue', 'role_green'])
        self.assertEqual(previous['grants'], {'role_blue': True, 'role_green': False})
        self.assertEqual(previous['cron'], {'blue-cron': {'containerId': '1' * 64, 'running': True}})
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
            proof = self.runtime._fence_backup_writers(self.binding, route, self.backup_previous(), backup_module.Deadline(30))
        self.assertEqual(proof['deniedWriters'], ['role_blue', 'role_green'])
        self.assertEqual(proof['writerConnections'], 0)
        window = next(event for event in self.events if event[0] == 'window')
        self.assertEqual(window[1], ('role_blue', 'role_green'))
        self.assertEqual(window[2], 'tenant')
        stops = [event for event in self.events if event[0] == 'docker' and event[1][:2] == ('docker', 'stop')]
        self.assertEqual(len(stops), 1)
        self.assertEqual(stops[0][1], ('docker', 'stop', '1' * 64))
        self.assertFalse(any('green-cron' in event[1] for event in stops))

    def test_resume_restores_only_previously_granted_writers_and_running_cron(self):
        self.state.maintenance('tenant_a', 1)
        route = self.backup_config(grants={'role_blue': False, 'role_green': False})
        self.running['blue-cron'] = False
        with patch.object(runtime_module.subprocess, 'run', self.docker):
            result = self.runtime.resume_backup(self.binding, route, self.backup_previous(), backup_module.Deadline(30))
        self.assertEqual(result['restoredWriters'], ['role_blue'])
        sql = '\n'.join(statement for statement, _ in self.connection.statements)
        self.assertIn('GRANT CONNECT ON DATABASE "webvue_scratch_cron_a" TO "role_blue"', sql)
        self.assertNotIn('role_green', sql)
        self.assertTrue(self.running['blue-cron'])
        starts = [event[1] for event in self.events if event[0] == 'docker']
        self.assertEqual(starts, [('docker', 'start', '1' * 64)])

    def test_stopped_previous_cron_is_never_started_by_a_backup(self):
        self.state.maintenance('tenant_a', 1)
        route = self.backup_config(grants={'role_blue': False, 'role_green': False})
        self.running['blue-cron'] = False
        with patch.object(runtime_module.subprocess, 'run', self.docker):
            result = self.runtime.resume_backup(self.binding, route,
                self.backup_previous(cron={'blue-cron': {'containerId': '1' * 64, 'running': False}}), backup_module.Deadline(30))
        self.assertEqual(result['cron'], {'blue-cron': {'containerId': '1' * 64, 'running': False}})
        self.assertFalse(self.running['blue-cron'])
        self.assertFalse([event for event in self.events if event[0] == 'docker'])

    def test_resume_refuses_a_replaced_or_unverified_previous_cron(self):
        self.state.maintenance('tenant_a', 1)
        route = self.backup_config(grants={'role_blue': False, 'role_green': False})
        self.config['pools']['blue']['cronRuntimes'][0]['container'] = 'blue-cron-v2'
        with self.assertRaisesRegex(state_module.ReleaseConflict, 'cron_identity_changed'):
            self.runtime.resume_backup(self.binding, route, self.backup_previous(), backup_module.Deadline(30))

    def test_resume_refuses_a_previous_state_from_another_route(self):
        self.state.maintenance('tenant_a', 1)
        route = self.backup_config()
        for patch_state in ({'fence': 2}, {'poolId': 'green'}, {'roles': ['role_blue']}, {'grants': {'role_blue': True}}):
            with self.subTest(patch=patch_state), self.assertRaisesRegex(state_module.ReleaseConflict, 'backup_previous_state_mismatch'):
                self.runtime.resume_backup(self.binding, route, self.backup_previous(**patch_state), backup_module.Deadline(30))

    def cronless_backup(self, tmp):
        self.config['jobsRequired'] = False
        for pool in ('blue', 'green'): self.config['pools'][pool]['cronRuntimes'] = []
        route = self.backup_config()
        store = tmp / self.binding['database']; store.mkdir()
        (store / 'attachment').write_bytes(b'cronless-attachment')
        def runner(argv, **kwargs):
            Path(argv[argv.index('--file') + 1]).write_bytes(b'dump')
            return SimpleNamespace(returncode=0, stdout='', stderr='')
        image = 'webvue/odoo@sha256:' + 'c' * 64
        self.config['backup'].update(image=image, pgDump='/usr/bin/true', runner=runner)
        self.config['pools']['blue']['odooRuntime']['image'] = image
        self.config['tenants']['tenant_a']['filestorePath'] = str(store)
        marker = self.state.routes / 'tenant_a.maintenance'
        self.guard_timeouts = []
        def guard(binding, timeout=10):
            # The real HTTP seam: the guard reports the route and whether the marker is up.
            self.guard_timeouts.append(timeout); self.guard_delay()
            return {**{key: route[key] for key in ('routeRevision', 'fence', 'poolId', 'releaseId')},
                    'maintenance': marker.is_file()}
        self.guard_delay = lambda: None
        self.runtime._guard = guard
        def window(binding, roles, connector, **kwargs):
            self.connection.grants = dict.fromkeys(roles, False)
            return self.window(binding, roles, connector, **kwargs)
        return route, window

    def test_cronless_topology_backs_up_resumes_and_reconciles(self):
        # jobsRequired=False with no owned cron is a supported topology: its empty
        # previous cron state must restore, on success and on a retried request.
        with tempfile.TemporaryDirectory() as temporary:
            tmp = Path(temporary).resolve()
            route, window = self.cronless_backup(tmp)
            with patch.object(runtime_module, 'fence_writers', window), \
                    patch.object(runtime_module.subprocess, 'run', self.docker):
                receipt = operation_module.backup_current(self.state, self.runtime, self.binding, 'cronless_ok',
                                                          tmp / 'ok', lambda result: None)
                self.assertEqual(receipt['stage'], 'verified')
                self.assertEqual(self.connection.grants, {'role_blue': True, 'role_green': False})
                def interrupted(result): raise OSError('finalize interrupted')
                with self.assertRaises(OSError):
                    operation_module.backup_current(self.state, self.runtime, self.binding, 'cronless_retry',
                                                    tmp / 'retry', interrupted)
                self.assertEqual(self.state.receipt('cronless_retry')['stage'], 'needs_intervention')
                self.assertEqual(self.connection.grants, {'role_blue': False, 'role_green': False})
                receipt = operation_module.backup_current(self.state, self.runtime, self.binding, 'cronless_retry',
                                                          tmp / 'retry', interrupted)
        self.assertEqual(receipt['stage'], 'reconciled')
        self.assertEqual(self.connection.grants, {'role_blue': True, 'role_green': False})
        self.assertFalse((self.state.routes / 'tenant_a.maintenance').exists())
        self.assertFalse([event for event in self.events if event[0] == 'docker'])

    def test_required_or_changed_cron_still_refuses_an_empty_previous_state(self):
        self.state.maintenance('tenant_a', 1)
        route = self.backup_config(grants={'role_blue': False, 'role_green': False})
        with self.assertRaisesRegex(state_module.ReleaseConflict, 'cron_identity_changed'):
            self.runtime.resume_backup(self.binding, route, self.backup_previous(cron={}), backup_module.Deadline(30))

    def test_every_window_query_gets_only_the_time_left_on_one_budget(self):
        # Each statement costs 2 s on a fake clock: four sequential rechecks overrun
        # one 30 s budget, and every connection/statement sees only what is left.
        self.state.maintenance('tenant_a', 1)
        self.backup_config(grants={'role_blue': False, 'role_green': False})
        now = [0.0]
        def tick(): now[0] += 2
        self.connection.tick = tick
        deadline = backup_module.Deadline(30, lambda: now[0])
        for _ in range(3): self.runtime._recheck_window(self.binding, deadline)
        with self.assertRaisesRegex(ValueError, 'backup_deadline_exceeded'):
            self.runtime._recheck_window(self.binding, deadline)
        timeouts = [int(statement.rsplit(' ', 1)[1]) for statement, _ in self.connection.statements
                    if statement.startswith('SET LOCAL statement_timeout')]
        self.assertEqual(timeouts, [30000, 26000, 22000, 18000, 14000, 10000, 6000, 2000])
        self.assertEqual([options['connect_timeout'] for options in self.connects], [30, 22, 14, 6])

    def test_reconcile_refuses_when_a_previously_denied_writer_was_reopened(self):
        self.state.maintenance('tenant_a', 1)
        route = self.backup_config(grants={'role_blue': True, 'role_green': True})
        with self.assertRaisesRegex(state_module.ReleaseConflict, 'backup_fence_lost'):
            self.runtime.reconcile_backup(self.binding, route, self.backup_previous(), backup_module.Deadline(30))

    def test_reconcile_restores_previous_state_without_capturing(self):
        self.state.maintenance('tenant_a', 1)
        route = self.backup_config(grants={'role_blue': False, 'role_green': False})
        self.running['blue-cron'] = False
        with patch.object(runtime_module.subprocess, 'run', self.docker):
            result = self.runtime.reconcile_backup(self.binding, route, self.backup_previous(), backup_module.Deadline(30))
        self.assertEqual(result['restoredWriters'], ['role_blue'])
        sql = '\n'.join(statement for statement, _ in self.connection.statements)
        self.assertIn('TO "role_blue"', sql)
        self.assertNotIn('role_green', sql)

    def test_resume_refuses_a_same_name_replacement_cron_without_starting_it(self):
        # F2: the recorded cron was container 111…; a replacement under the same name
        # (222…) passes image/config/role checks but is not the container recorded.
        self.state.maintenance('tenant_a', 1)
        route = self.backup_config(grants={'role_blue': False, 'role_green': False})
        self.running['blue-cron'] = False
        self.ids['blue-cron'] = '2' * 64
        with patch.object(runtime_module.subprocess, 'run', self.docker):
            with self.assertRaisesRegex(state_module.ReleaseConflict, '^cron_container_replaced$'):
                self.runtime.resume_backup(self.binding, route, self.backup_previous(), backup_module.Deadline(30))
        self.assertFalse([event for event in self.events if event[0] == 'docker'])
        self.assertFalse(self.running['blue-cron'])

    def test_reconcile_refuses_a_same_name_replacement_cron_without_starting_it(self):
        self.state.maintenance('tenant_a', 1)
        route = self.backup_config(grants={'role_blue': False, 'role_green': False})
        self.running['blue-cron'] = False
        self.ids['blue-cron'] = '2' * 64
        with patch.object(runtime_module.subprocess, 'run', self.docker):
            with self.assertRaisesRegex(state_module.ReleaseConflict, '^cron_container_replaced$'):
                self.runtime.reconcile_backup(self.binding, route, self.backup_previous(), backup_module.Deadline(30))
        self.assertFalse([event for event in self.events if event[0] == 'docker'])

    def test_window_refuses_to_stop_a_cron_replaced_after_prepare(self):
        self.state.maintenance('tenant_a', 1)
        route = self.backup_config()
        previous = self.runtime.prepare_backup(self.binding, route)
        self.assertEqual(previous['cron'], {'blue-cron': {'containerId': '1' * 64, 'running': True}})
        self.ids['blue-cron'] = '2' * 64
        with patch.object(runtime_module, 'fence_writers', self.window), \
                patch.object(runtime_module.subprocess, 'run', self.docker):
            with self.assertRaisesRegex(state_module.ReleaseConflict, '^cron_container_replaced$'):
                self.runtime._fence_backup_writers(self.binding, route, previous, backup_module.Deadline(30))
        self.assertFalse([event for event in self.events if event[0] == 'docker'])

    def test_previous_cron_state_without_a_container_id_is_refused(self):
        self.state.maintenance('tenant_a', 1)
        route = self.backup_config(grants={'role_blue': False, 'role_green': False})
        for cron in ({'blue-cron': True}, {'blue-cron': {'running': True}},
                     {'blue-cron': {'containerId': 'blue-cron', 'running': True}}):
            with self.subTest(cron=cron), self.assertRaisesRegex(state_module.ReleaseConflict, '^cron_identity_changed$'):
                self.runtime.resume_backup(self.binding, route, self.backup_previous(cron=cron), backup_module.Deadline(30))

    def budget_run(self, request_id, tmp, *, during_validation=0, during_finalize=0):
        """Drive the real backup_current consumer on a fake clock: every SQL statement
        costs 2 s, and the given phase consumes the stated seconds of the budget."""
        route, window = self.cronless_backup(tmp)
        now = [0.0]
        def tick(): now[0] += 2
        self.connection.tick = tick
        real_validate = runtime_module.validate_window
        def slow_validate(path, deadline):
            now[0] += during_validation
            return real_validate(path, deadline)
        def finalize(result): now[0] += during_finalize
        clock = lambda seconds: backup_module.Deadline(seconds, lambda: now[0])
        with patch.object(runtime_module, 'fence_writers', window), \
                patch.object(runtime_module, 'Deadline', clock), \
                patch.object(runtime_module, 'validate_window', slow_validate), \
                patch.object(runtime_module.subprocess, 'run', self.docker):
            try:
                return operation_module.backup_current(self.state, self.runtime, self.binding, request_id,
                                                       tmp / request_id, finalize)
            finally:
                self.connection.tick = lambda: None

    def assert_failed_closed(self, request_id):
        receipt = self.state.receipt(request_id)
        self.assertEqual((receipt['stage'], receipt['errorCode']), ('needs_intervention', 'backup_unverified'))
        self.assertTrue((self.state.routes / 'tenant_a.maintenance').is_file())
        self.assertEqual(self.connection.grants, {'role_blue': False, 'role_green': False})

    def test_one_operation_budget_covers_capture_validation_and_resume(self):
        # F3: totalDeadlineSeconds=60; capture and resume cost about 28 s of SQL.
        with tempfile.TemporaryDirectory() as temporary:
            tmp = Path(temporary).resolve()
            self.assertEqual(self.budget_run('budget_ok', tmp, during_validation=20)['stage'], 'verified')
            self.assertEqual(self.connection.grants, {'role_blue': True, 'role_green': False})
            self.assertFalse((self.state.routes / 'tenant_a.maintenance').exists())

    def test_overrun_during_final_validation_is_never_verified(self):
        with tempfile.TemporaryDirectory() as temporary:
            tmp = Path(temporary).resolve()
            with self.assertRaisesRegex(ValueError, '^backup_deadline_exceeded$'):
                self.budget_run('budget_validation', tmp, during_validation=60)
            self.assert_failed_closed('budget_validation')
            self.assertTrue((tmp / 'budget_validation' / 'receipt.json').is_file())  # artifacts kept for the operator
            # The owning request id still recovers on its own reconciliation budget.
            receipt = operation_module.backup_current(self.state, self.runtime, self.binding, 'budget_validation',
                                                      tmp / 'budget_validation')
        self.assertEqual(receipt['stage'], 'reconciled')
        self.assertEqual(self.connection.grants, {'role_blue': True, 'role_green': False})
        self.assertFalse((self.state.routes / 'tenant_a.maintenance').exists())

    def test_overrun_during_resume_fails_closed(self):
        # Finalize leaves 7 s: the post-finalize check passes, the resume statements overrun.
        with tempfile.TemporaryDirectory() as temporary:
            tmp = Path(temporary).resolve()
            with self.assertRaisesRegex(ValueError, '^backup_deadline_exceeded$'):
                self.budget_run('budget_resume', tmp, during_finalize=60 - 16 - 7)
            self.assert_failed_closed('budget_resume')
            self.assertNotIn('GRANT CONNECT', '\n'.join(sql for sql, _ in self.connection.statements))
            receipt = operation_module.backup_current(self.state, self.runtime, self.binding, 'budget_resume',
                                                      tmp / 'budget_resume')
        self.assertEqual(receipt['stage'], 'reconciled')
        self.assertEqual(self.connection.grants, {'role_blue': True, 'role_green': False})

    def test_window_connection_is_closed_when_the_budget_ran_out_while_connecting(self):
        self.backup_config()
        now = [0.0]
        closed = []
        def connect(_database, **options):
            now[0] += 10  # connect returned after the budget
            return SimpleNamespace(close=lambda: closed.append(True))
        self.runtime.connector = connect
        with self.assertRaisesRegex(ValueError, '^backup_deadline_exceeded$'):
            with self.runtime._window_connection(self.binding['database'], backup_module.Deadline(5, lambda: now[0])):
                self.fail('a connection obtained past the budget was used')
        self.assertEqual(closed, [True])

    def test_every_window_connection_is_closed_after_use(self):
        self.state.maintenance('tenant_a', 1)
        self.backup_config(grants={'role_blue': False, 'role_green': False})
        closed = []
        self.connection.close = lambda: closed.append(True)
        self.runtime._recheck_window(self.binding, backup_module.Deadline(30))
        self.assertEqual(closed, [True])

    def clocked_run(self, tmp, now, *, statement=0, connect=0, ack=0):
        """Real backup_current + LocalRuntime + fence_writers on a fake clock.

        Only the PostgreSQL, guard HTTP and Docker seams are faked: every executed
        statement costs ``statement`` s, every admin connect ``connect`` s, and a
        final guard ACK (marker already removed) ``ack`` s.
        """
        route, _window = self.cronless_backup(tmp)
        marker = self.state.routes / 'tenant_a.maintenance'
        self.timeline = []
        def tick(): now[0] += statement
        self.connection.tick = tick
        def connector(_database, **options):
            self.timeline.append(('connect', now[0], options)); now[0] += connect
            return self.connection
        self.runtime.connector = connector
        def guard_delay():
            if not marker.is_file(): now[0] += ack
        self.guard_delay = guard_delay
        clock = lambda seconds: backup_module.Deadline(seconds, lambda: now[0])
        return route, clock

    def statement_timeouts(self, start=0, end=None):
        return [int(sql.rsplit(' ', 1)[1]) for sql, _ in self.connection.statements[start:end]
                if sql.startswith('SET LOCAL statement_timeout')]

    def run_fence_overrun(self, request_id, *, budget, statement=0, connect=0):
        now = [0.0]
        with tempfile.TemporaryDirectory() as temporary:
            tmp = Path(temporary).resolve()
            _route, clock = self.clocked_run(tmp, now, statement=statement, connect=connect)
            self.config['backup']['totalDeadlineSeconds'] = budget
            with patch.object(runtime_module, 'Deadline', clock), \
                    patch.object(runtime_module.subprocess, 'run', self.docker):
                with self.assertRaisesRegex(ValueError, '^backup_deadline_exceeded$'):
                    operation_module.backup_current(self.state, self.runtime, self.binding, request_id,
                                                    tmp / request_id, lambda result: self.fail('captured past the budget'))
                self.assertFalse((tmp / request_id).exists())  # nothing captured
        receipt = self.state.receipt(request_id)
        self.assertEqual((receipt['stage'], receipt['errorCode']), ('needs_intervention', 'backup_unverified'))
        self.assertTrue((self.state.routes / 'tenant_a.maintenance').is_file())
        self.assertEqual(self.connection.grants, {'role_blue': False, 'role_green': False})
        return now

    def test_fence_entry_slow_sql_overruns_one_budget_and_fails_closed(self):
        # 10 s budget, every statement 2 s (its SET LOCAL included): the fence runs
        # out mid-catalog. It must stop there, not finish after ~38 modeled seconds.
        self.run_fence_overrun('fence_slow_sql', budget=10, statement=1)
        preflight, capture_connect, recovery_connect = self.timeline[:3]
        self.assertEqual(preflight[2], {})  # read-only prepare_backup, before the budget starts
        self.assertEqual(capture_connect[2], {'connect_timeout': 10})
        fence_window = self.connection.statements[:next(i for i, (sql, _) in enumerate(self.connection.statements)
                                                        if sql.startswith('SET LOCAL statement_timeout = 120000'))]
        timeouts = self.statement_timeouts(0, len(fence_window))
        self.assertEqual(timeouts, [10000, 8000, 6000, 4000, 2000])  # recomputed from what is left
        self.assertFalse([sql for sql, _ in fence_window if sql.startswith('REVOKE')])
        # The fail-closed cleanup ran on its own fresh budget, from the overrun instant.
        self.assertEqual(recovery_connect[2], {'connect_timeout': 120})
        self.assertLessEqual(recovery_connect[1], 10 + 2)

    def test_fence_entry_slow_connect_overruns_one_budget_and_fails_closed(self):
        self.run_fence_overrun('fence_slow_connect', budget=10, connect=15)
        capture_connect = self.timeline[1]
        self.assertEqual(capture_connect[2], {'connect_timeout': 10})
        # No statement ran on the connection obtained past the budget.
        recovery_start = next(i for i, (sql, _) in enumerate(self.connection.statements)
                              if sql.startswith('SET LOCAL statement_timeout'))
        recovery_start -= 1  # the preflight grant read ran first, unbudgeted
        self.assertEqual(self.timeline[2][2], {'connect_timeout': 120})
        self.assertEqual(self.statement_timeouts()[0], 120000 - 15000)
        self.assertEqual(recovery_start, 0)

    def test_fence_entry_within_budget_still_verifies(self):
        now = [0.0]
        with tempfile.TemporaryDirectory() as temporary:
            tmp = Path(temporary).resolve()
            _route, clock = self.clocked_run(tmp, now, statement=1, connect=1)
            self.config['backup']['totalDeadlineSeconds'] = 120
            with patch.object(runtime_module, 'Deadline', clock), \
                    patch.object(runtime_module.subprocess, 'run', self.docker):
                receipt = operation_module.backup_current(self.state, self.runtime, self.binding, 'fence_ok',
                                                          tmp / 'fence_ok', lambda result: None)
        self.assertEqual(receipt['stage'], 'verified')
        self.assertEqual(self.connection.grants, {'role_blue': True, 'role_green': False})
        self.assertFalse((self.state.routes / 'tenant_a.maintenance').exists())
        timeouts = self.statement_timeouts()
        self.assertEqual(timeouts[0], 120000 - 1000)  # after the 1 s connect
        self.assertEqual(timeouts, sorted(timeouts, reverse=True))
        self.assertLess(timeouts[-1], 120000 - 50000)  # one budget, not a fresh one per step
        self.assertTrue(all(0 < entry[2]['connect_timeout'] <= 120 for entry in self.timeline[1:]))
        self.assertLess(now[0], 120)

    def failed_backup_then_reconcile(self, request_id, *, connect, ack):
        now = [0.0]
        with tempfile.TemporaryDirectory() as temporary:
            tmp = Path(temporary).resolve()
            _route, clock = self.clocked_run(tmp, now)
            self.config['backup']['timeoutSeconds'] = 120
            def interrupted(result): raise OSError('finalize interrupted')
            with patch.object(runtime_module, 'Deadline', clock), \
                    patch.object(runtime_module.subprocess, 'run', self.docker):
                with self.assertRaises(OSError):
                    operation_module.backup_current(self.state, self.runtime, self.binding, request_id,
                                                    tmp / request_id, interrupted)
                self.assertEqual(self.state.receipt(request_id)['stage'], 'needs_intervention')
                # Reconciliation: two admin connects then the final ACK, on one 120 s budget.
                now[0] = 0.0
                self.connection.statements.clear(); self.timeline.clear()
                def connect_slow(_database, **options):
                    self.timeline.append(('connect', now[0], options)); now[0] += connect
                    return self.connection
                self.runtime.connector = connect_slow
                marker = self.state.routes / 'tenant_a.maintenance'
                def ack_slow():
                    if not marker.is_file(): now[0] += ack
                self.guard_delay = ack_slow
                try:
                    return operation_module.backup_current(self.state, self.runtime, self.binding, request_id,
                                                           tmp / request_id, interrupted), now
                except ValueError as error:
                    return error, now

    def test_reconciliation_overrun_at_final_ack_is_never_reconciled(self):
        # Restore done at t=119 of a 120 s budget; the final ACK takes 2 s (t=121).
        result, now = self.failed_backup_then_reconcile('reconcile_late', connect=59.5, ack=2)
        self.assertIsInstance(result, ValueError)
        self.assertEqual(str(result), 'backup_deadline_exceeded')
        receipt = self.state.receipt('reconcile_late')
        self.assertEqual((receipt['stage'], receipt['errorCode']), ('needs_intervention', 'backup_reconciliation_failed'))
        self.assertTrue((self.state.routes / 'tenant_a.maintenance').is_file())  # marker kept
        self.assertEqual(self.connection.grants, {'role_blue': False, 'role_green': False})  # writers fenced again
        self.assertEqual(self.guard_timeouts[-2], 1)  # the final ACK got only what was left
        self.assertGreaterEqual(now[0], 121)

    def test_reconciliation_within_budget_still_reconciles(self):
        receipt, now = self.failed_backup_then_reconcile('reconcile_ok', connect=50, ack=2)
        self.assertEqual(receipt['stage'], 'reconciled')
        self.assertFalse((self.state.routes / 'tenant_a.maintenance').exists())
        self.assertEqual(self.connection.grants, {'role_blue': True, 'role_green': False})
        self.assertEqual([entry[2]['connect_timeout'] for entry in self.timeline], [120, 70])
        self.assertEqual(now[0], 102)


if __name__ == '__main__':
    unittest.main()
