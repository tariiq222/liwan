"""Local HTTP/filesystem regression evidence; no containers or live database.

Run from the worktree root: python3 -m unittest deploy.releases.test_runtime -v
Node + the worktree's installed jiti/h3 exercise the actual TypeScript handlers.
LIWAN_RUNTIME_REVIEW_SOURCE may select the coordinator source during worker review.
Only PostgreSQL and stock Odoo process boundaries use external-system seams.
"""
import json
import hashlib
import os
import subprocess
import tempfile
import threading
import unittest
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

from .backup import capture_tenant, restore_tenant
from .engine import ReleaseEngine
from .manifest import manifest_digest
from .migrate import MARKER as OBSERVATION
from .odoo_gateway import MARKER, OdooBookingGateway
from .postgres import fence_runtime
from .runtime import LocalRuntime
from .scheduler import MaintenanceScheduler, ReleaseEngineAdapter, ReleaseTarget
from .state import ReleaseConflict, ReleaseState, atomic_json


def manifest(release='r2'):
    return {'releaseId': release, 'liwanCommit': '1' * 40, 'odooCommit': '2' * 40,
            'images': {'odoo': 'liwan/odoo@sha256:' + 'a' * 64,
                       'web': 'liwan/web@sha256:' + 'b' * 64},
            'assetsId': 'assets_2', 'moduleVersions': {}, 'upgradeModules': [],
            'installModules': [], 'mode': 'online', 'affectedServices': ['web'],
            'aiStateVersion': '1',
            'compatibilityEvidence': {'reviewer': 'owner', 'reference': 'review42',
                                      **dict.fromkeys(('apiCompatible', 'sessionCompatible',
                                                       'concurrentWritesCompatible', 'jobsCompatible'), True)},
            'rollbackPolicy': {'oldWritesCompatible': True}}


@contextmanager
def http_server(respond):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            status, body = respond(self.path, self.headers)
            data = json.dumps(body).encode() if not isinstance(body, bytes) else body
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}'
    finally:
        server.shutdown()
        server.server_close()
        thread.join(2)


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve()
        self.state = ReleaseState(self.root / 'state')
        self.binding = {'tenantId': 'tenant_a', 'database': 'liwan_scratch_runtime_a',
                        'filestore': 'liwan_scratch_runtime_a', 'registryRevision': 1}
        self.old = {'schemaVersion': 1, 'tenantId': 'tenant_a', 'identityRevision': 1,
                    'routeRevision': 1, 'releaseId': 'r1', 'poolId': 'blue', 'fence': 1,
                    'state': 'serving'}
        self.state.register(self.binding, self.old)
        self.manifest = manifest()
        for name, data in [('proxy', 'p' * 40), ('probe', 't' * 40), ('session', 'existing_session')]:
            (self.root / name).write_text(data)
        self.config = {'mode': 'local', 'postgres': {'host': '127.0.0.1'},
                       'targetPool': 'green', 'drainSeconds': 1,'jobsRequired':False,
                       'proxyTokenFile': str(self.root / 'proxy'),
                       'probeTokenFile': str(self.root / 'probe'),
                       'migration': {}, 'pools': {pool: {'containers':{'odoo':pool+'-odoo'},'odooRuntime':{},'cronRuntimes':[]} for pool in ('blue','green')},
                       'tenants': {'tenant_a': {**self.binding, 'host': 'tenant.example',
                           'roles': {'blue': 'runtime_blue', 'green': 'runtime_green'},
                           'probeSessionFile': str(self.root / 'session'),
                           'attachmentProbe':{'httpPath':'/api/v1/tasks/5/attachments/11/download','relativePath':'attachment','sha256':hashlib.sha256(b'existing-tenant-data').hexdigest()},
                           'filestorePath': str(self.root / 'filestore'),
                           'sessionPath': str(self.root / 'sessions'), 'migration': {}}}}
        for directory, filename in [('filestore', 'attachment'), ('sessions', 'existing_session')]:
            path = self.root / directory
            path.mkdir()
            (path / filename).write_bytes(b'existing-tenant-data')
        self.runtime = LocalRuntime(self.state,self.config,role_inspector=lambda container,expected,**kwargs:{'ready':True,'dbUser':expected['dbUser']},classifier=lambda *_:{'ready':True},inventory_inspector=lambda _:None)

    def target(self, *, readiness_status=200, asset_status=200, identity=None, user=None, attachment=b'existing-tenant-data', guard=None):
        requests = []

        def respond(path, headers):
            requests.append((path, dict(headers)))
            if guard and path == '/_liwan/release-status':
                return 200, guard()
            if path == '/_liwan/release-readiness':
                if headers.get('X-Liwan-Release-Probe') != 't' * 40:
                    return 403, {}
                return readiness_status, {**{k: self.manifest[k] for k in ('releaseId', 'assetsId', 'aiStateVersion')},
                                          'poolId': 'green', 'assets': ['/_nuxt/app.js','/_i18n/1234abcd/ar/messages.json','/_i18n/1234abcd/en/messages.json'], **(identity or {})}
            if path == '/_nuxt/app.js':
                return asset_status, b'export const release = "r2";'
            if path.startswith('/_i18n/'):
                return 200, {'messages':'verified'}
            if path == '/api/v1/tasks/5/attachments/11/download':
                return 200,attachment
            if path == '/api/v1/me':
                if headers.get('Cookie') != 'session_id=existing_session' or headers.get('Host') != self.binding['database']:
                    return 403, {}
                return 200, {'id': 41} if user is None else user
            return 404, {}
        return http_server(respond), requests

    def verify_target(self):
        # Only DB/Odoo process boundaries are isolated; prepare/HTTP/files remain real.
        with patch('deploy.releases.runtime.validate_runtime_role', return_value={'valid': True}), \
             patch('deploy.releases.runtime.verify_tenant', return_value={'readOnly': True}):
            return self.runtime.verify(self.binding, self.manifest, 'green')

    def test_running_target_requires_existing_session_and_real_assets(self):
        server, requests = self.target()
        with server as url:
            self.config['pools']['green'].update(webUrl=url, odooUrl=url)
            self.runtime.connector = lambda _: self.state.connection()
            inspected = []
            self.runtime.inspector = lambda pool, release: inspected.append((pool, release['releaseId'])) or {'ready': True}
            result = self.verify_target()
        self.assertTrue(result['ready'])
        self.assertEqual(inspected, [('green', 'r2')])
        self.assertEqual([path for path, _ in requests], ['/_liwan/release-readiness', '/_nuxt/app.js', '/_i18n/1234abcd/ar/messages.json','/_i18n/1234abcd/en/messages.json','/api/v1/me','/api/v1/tasks/5/attachments/11/download'])
        self.assertEqual((self.root / 'filestore' / 'attachment').read_bytes(), b'existing-tenant-data')

    def test_running_container_does_not_mask_502_missing_chunk_stale_identity_or_session(self):
        cases = [{'readiness_status': 502}, {'asset_status': 404},
                 {'identity': {'releaseId': 'r1'}}, {'identity': {'assets': []}},
                 {'identity':{'assets':['/_nuxt/app.js']}}, {'attachment':b'wrong attachment'},
                 {'user': {'userId': 41}}, {'user': {'id': 0}}]
        for case in cases:
            with self.subTest(case=case):
                server, _ = self.target(**case)
                with server as url:
                    self.config['pools']['green'].update(webUrl=url, odooUrl=url)
                    self.runtime.connector = lambda _: self.state.connection()
                    self.runtime.inspector = lambda *_: {'ready': True}
                    with self.assertRaises((HTTPError, ReleaseConflict)):
                        self.verify_target()
                self.assertEqual(self.state.route('tenant_a'), self.old)

    def test_missing_persistent_mount_is_rejected_without_creating_empty_replacement(self):
        for key in ('filestorePath', 'sessionPath'):
            with self.subTest(key=key):
                missing = self.root / ('missing_' + key)
                tenant = self.config['tenants']['tenant_a']
                original = tenant[key]
                tenant[key] = str(missing)
                server, _ = self.target()
                try:
                    with server as url:
                        self.config['pools']['green'].update(webUrl=url, odooUrl=url)
                        self.runtime.connector = lambda _: self.state.connection()
                        self.runtime.inspector = lambda *_: {'ready': True}
                        with self.assertRaises((ReleaseConflict, ValueError, FileNotFoundError)):
                            self.verify_target()
                    self.assertFalse(missing.exists())
                finally:
                    tenant[key] = original

    def lease(self, pool):
        path = self.state.routes / 'leases' / 'tenant_a' / 'writer.json'
        atomic_json(path, {'tenantId': 'tenant_a', 'poolId': pool})
        return path

    def test_quiesce_waits_for_pending_admission_then_fences_after_lease_release(self):
        self.state.maintenance('tenant_a', 1)
        lease = self.lease('pending')
        guard_seen, fenced = threading.Event(), threading.Event()
        outcome, errors = [], []

        def guard(path, headers):
            self.assertEqual(path, '/_liwan/release-status')
            self.assertEqual(headers.get('Host'), 'tenant.example')
            self.assertEqual(headers.get('X-Liwan-Proxy-Token'), 'p' * 40)
            guard_seen.set()
            return 200, {**self.old, 'maintenance': True}

        def fence(binding, old, new, connector, **kwargs):
            self.assertFalse(lease.exists())
            self.assertEqual(binding['transactionScope'], 'tenant')
            fenced.set()
            return {'fenced': True, 'fence': 1, 'activeTransactions': 0, 'oldConnections': 0}

        def quiesce():
            try:
                outcome.append(self.runtime.quiesce(self.binding, self.old))
            except (RuntimeError, ValueError, AssertionError, OSError) as error:
                errors.append(error)

        with http_server(guard) as url, patch('deploy.releases.runtime.fence_runtime', side_effect=fence):
            self.config['guardUrl'] = url
            thread = threading.Thread(target=quiesce)
            thread.start()
            try:
                self.assertTrue(guard_seen.wait(2))
                self.assertFalse(fenced.wait(.15), 'pending admission must hold the barrier')
            finally:
                lease.unlink()
                thread.join(3)
        self.assertFalse(thread.is_alive())
        self.assertEqual(errors, [])
        self.assertTrue(fenced.is_set())
        self.assertEqual(outcome[0]['admittedWriters'], 0)

    def test_retirement_ignores_new_generation_leases_and_publishes_tombstone_first(self):
        lease = self.lease('green')
        marker = self.state.routes / 'tenant_a.blue.1.retired'

        def fence(binding, old, new, connector, **kwargs):
            self.assertTrue(marker.is_file())
            self.assertEqual(binding['transactionScope'], 'old_role')
            self.assertEqual((old, new), ('runtime_blue', 'runtime_green'))
            return {'fenced': True}

        with patch('deploy.releases.runtime.fence_runtime', side_effect=fence):
            self.assertEqual(self.runtime.retire(self.binding, self.old, {}), {'drained': True})
        self.assertTrue(lease.exists())
        self.assertEqual(json.loads(marker.read_text())['fence'], 1)

    def test_old_generation_lease_keeps_retirement_pending_without_database_effect(self):
        self.lease('blue')
        with patch('deploy.releases.runtime.fence_runtime') as database:
            self.assertEqual(self.runtime.retire(self.binding, self.old, {}), {'drained': False})
            database.assert_not_called()
        self.assertTrue((self.state.routes / 'tenant_a.blue.1.retired').is_file())

    def configure_gateway(self):
        tenant = self.config['tenants']['tenant_a']
        tenant['gateway'] = {}
        for pool, release in [('blue', 'r1'), ('green', 'r2')]:
            path = self.root / (release + '.json')
            path.write_text(json.dumps(manifest(release)))
            self.config['pools'][pool]['operator'] = {'manifest': str(path), 'migration': {'liwanRoot': '/source/' + pool}}
            tenant['gateway'][pool] = {'dataDir': '/data/' + pool}

    def test_gateway_uses_serving_source_until_published_route_changes(self):
        self.configure_gateway()
        release, config = self.runtime.gateway_context(self.binding)
        self.assertEqual((release['releaseId'], config['liwanRoot'], config['dataDir']), ('r1', '/source/blue', '/data/blue'))
        self.state.maintenance('tenant_a', 1)
        gateway = OdooBookingGateway(self.state, self.runtime, self.manifest)
        with patch('deploy.releases.odoo_gateway._local') as launcher:
            with self.assertRaisesRegex(ReleaseConflict, 'booking_gateway_requires_migration_reconciliation'):
                gateway.due(datetime.now(timezone.utc))
            launcher.assert_not_called()
        self.state.resume('tenant_a', 1)
        self.state.publish({**self.old, 'routeRevision': 2, 'fence': 2, 'poolId': 'green', 'releaseId': 'r2'}, expected_revision=1)
        release, config = self.runtime.gateway_context(self.binding)
        self.assertEqual((release['releaseId'], config['liwanRoot']), ('r2', '/source/green'))
        self.config['pools']['green']['operator']['manifest'] = str(self.root / 'r1.json')
        with self.assertRaisesRegex(ReleaseConflict, 'gateway_release_mismatch'):
            self.runtime.gateway_context(self.binding)

    def test_scheduler_reads_existing_booking_using_serving_source_before_target_preflight(self):
        self.configure_gateway()
        now = datetime.now(timezone.utc)
        commands, sources = [], []
        record = {'id': 7, 'revision': 1, 'status': 'scheduled',
                  'scheduled_at': (now - timedelta(seconds=1)).isoformat(), 'duration_minutes': 60,
                  'notice': {'release_id': 'r2', 'deadline_at': (now + timedelta(hours=2)).isoformat(),
                             'estimated_seconds': 30, 'scope': 'tenant', 'status': 'supported'}}

        def local(binding, release, config):
            sources.append((release['releaseId'], config['liwanRoot']))
            return ['python', 'odoo_secure'], []

        def orm(argv, config, *, input):
            commands.append(input)
            value = [7] if 'result = records.search' in input else record
            return MARKER + json.dumps(value)

        self.runtime.connector = lambda _: self.state.connection()
        self.runtime.inspector = lambda *_: (_ for _ in ()).throw(ReleaseConflict('target_not_ready'))
        gateway = OdooBookingGateway(self.state, self.runtime, self.manifest)
        adapter = ReleaseEngineAdapter(ReleaseEngine(self.state, self.runtime),
                                      {'r2': ReleaseTarget(self.manifest, manifest_digest(self.manifest), 'green', 'online')})
        with patch('deploy.releases.odoo_gateway._local', side_effect=local), \
             patch('deploy.releases.odoo_gateway._run', side_effect=orm), \
             patch('deploy.releases.runtime.validate_runtime_role', return_value={'valid': True}):
            result = MaintenanceScheduler(gateway, adapter, clock=lambda: now).run_once()
        self.assertEqual(result[0]['reason'], 'preflight_failed')
        self.assertGreaterEqual(len(sources), 2)
        self.assertEqual(set(sources), {('r1', '/source/blue')})
        self.assertFalse(any('_liwan_transition' in command for command in commands))
        self.assertEqual(self.state.route('tenant_a'), self.old)
        self.assertFalse((self.state.routes / 'tenant_a.maintenance').exists())

    def test_bootstrap_crash_repairs_only_exact_missing_projection_without_overwriting(self):
        state = ReleaseState(self.root / 'bootstrap')
        with patch('deploy.releases.state.atomic_json', side_effect=OSError('disk_failed')):
            with self.assertRaises(OSError):
                state.register(self.binding, self.old)
        self.assertEqual(ReleaseState(state.root).route('tenant_a'), self.old)
        projection = state.routes / 'tenant_a.json'
        self.assertFalse(projection.exists())
        state.register(self.binding, self.old)
        self.assertEqual(json.loads(projection.read_text()), self.old)
        alien = {**self.old, 'releaseId': 'unexpected'}
        atomic_json(projection, alien)
        with self.assertRaisesRegex(ReleaseConflict, 'bootstrap_projection_conflict'):
            state.register(self.binding, self.old)
        self.assertEqual(json.loads(projection.read_text()), alien)

    def test_verified_request_retry_still_binds_exact_manifest_and_approval(self):
        request = {'requestId': 'exact_retry', 'manifestDigest': manifest_digest(self.manifest),
                   'approvedMode': 'online', 'tenantIds': ['tenant_a'], 'expectedRoutes': {'tenant_a': 1},
                   'targetPool': 'green'}
        self.state.request(request['requestId'], request)
        self.state.stage(request['requestId'], 'tenant_a', 'verified', 2)
        engine = ReleaseEngine(self.state, object())
        self.assertEqual(engine.apply(request, self.manifest)['stage'], 'verified')
        changed = {**self.manifest, 'assetsId': 'different_assets'}
        with self.assertRaisesRegex(ReleaseConflict, 'manifest_or_approval_mismatch'):
            engine.apply(request, changed)
        with self.assertRaisesRegex(ReleaseConflict, 'manifest_or_approval_mismatch'):
            engine.reconcile(request, changed)
        changed_request = {**request, 'manifestDigest': manifest_digest(changed)}
        with self.assertRaises(ReleaseConflict):
            engine.apply(changed_request, changed)

    def test_cross_tenant_restore_cannot_execute_commands_or_create_target_files(self):
        store = self.root / self.binding['database']
        store.mkdir()
        (store / 'attachment').write_bytes(b'owned-by-tenant-a')
        commands = []

        def runner(argv, **kwargs):
            commands.append(argv)
            if '--file' in argv:
                Path(argv[argv.index('--file') + 1]).write_bytes(b'real-dump-artifact')
            return subprocess.CompletedProcess(argv, 0, '', '')

        source = {**self.binding, 'fence': 1}
        proof = {**source, 'gateClosed': True, 'admittedWriters': 0, 'activeTransactions': 0, 'oldConnections': 0}
        config = {'mode': 'local', 'outputDir': str(self.root / 'backup'), 'filestorePath': str(store),
                  'pgDump': '/usr/bin/true', 'createdb': '/usr/bin/true', 'pgRestore': '/usr/bin/true',
                  'image': self.manifest['images']['odoo'], 'runner': runner}
        capture_tenant(source, proof, config)
        target = self.root / 'liwan_scratch_restore_b'
        with self.assertRaises(ValueError):
            restore_tenant(self.root / 'backup', {'tenantId': 'tenant_b', 'database': target.name, 'filestore': target.name},
                           {**config, 'restoreAllowed': True, 'writesResumed': False,
                            'targetFilestore': str(target), 'recoverySource': source})
        self.assertEqual(len(commands), 1)
        self.assertFalse(target.exists())

    def test_maintenance_release_drives_quiesce_capture_migrate_verify_to_verified(self):
        # The real ReleaseEngine and LocalRuntime: only PostgreSQL, the stock Odoo
        # process boundary and pg_dump are seams. Backup-only writer-window rules
        # must never reach this path (it failed before pg_dump on b4ad4a100).
        release = {**manifest(), 'mode': 'tenant_maintenance', 'upgradeModules': ['liwan_core'],
                   'moduleVersions': {'liwan_core': '19.0.1.0.0'}, 'affectedServices': ['odoo']}
        self.manifest = release
        store = self.root / self.binding['database']
        store.mkdir()
        (store / 'attachment').write_bytes(b'existing-tenant-data')
        tenant = self.config['tenants']['tenant_a']
        tenant['filestorePath'] = str(store)
        self.config['migration'] = {'expectedProfile': {'status': 'active'}, 'sourceIdentity': {'treeDigest': 'tree'}}
        statements, dumps = [], []

        def pg_dump(argv, **kwargs):
            dumps.append(argv)
            Path(argv[argv.index('--file') + 1]).write_bytes(b'release-dump')
            return subprocess.CompletedProcess(argv, 0, '', '')

        self.config['backup'] = {'image': release['images']['odoo'], 'pgDump': '/usr/bin/true', 'runner': pg_dump}

        class Cursor:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def execute(self, sql, args=()): self.sql = sql; statements.append(sql)
            def fetchone(self):
                if 'FROM pg_database WHERE' in self.sql: return (True,)
                if 'FROM pg_roles WHERE' in self.sql: return (True, False, False, False, False, False)
                if 'count(*)' in self.sql: return (0,)
                return (False,)
            def fetchall(self): return []

        class Connection:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def cursor(self): return Cursor()
            def commit(self): pass
            def rollback(self): pass
            def close(self): pass

        def odoo(argv, config, *, input=None, read_only=False):
            if input is None: return ''
            return OBSERVATION + json.dumps({'database': self.binding['database'], 'moduleStatesReady': True, 'readOnly': True,
                                             'moduleVersions': dict(release['moduleVersions']), 'profile': {'status': 'active'}})

        marker = self.state.routes / 'tenant_a.maintenance'
        server, _ = self.target(guard=lambda: {**self.state.route('tenant_a'), 'maintenance': marker.exists()})
        request = {'requestId': 'release_one', 'manifestDigest': manifest_digest(release), 'approvedMode': 'tenant_maintenance',
                   'tenantIds': ['tenant_a'], 'expectedRoutes': {'tenant_a': 1}, 'targetPool': 'green'}
        with server as url, patch('deploy.releases.migrate._local', return_value=(['odoo'], [])), \
                patch('deploy.releases.migrate._run', side_effect=odoo):
            self.config['guardUrl'] = url
            self.config['pools']['green'].update(webUrl=url, odooUrl=url)
            self.runtime.connector = lambda _: Connection()
            self.runtime.inspector = lambda *_: {'ready': True}
            receipt = ReleaseEngine(self.state, self.runtime).apply(request, release)
        self.assertEqual(receipt['stage'], 'verified')
        self.assertEqual(len(dumps), 1)
        backup = self.state.root / 'backups' / 'tenant_a' / '1'
        self.assertTrue(json.loads((backup / 'receipt.json').read_text())['hashes'])
        self.assertIn('GRANT CONNECT ON DATABASE "liwan_scratch_runtime_a" TO "runtime_green"', statements)
        self.assertEqual(self.state.route('tenant_a')['poolId'], 'green')
        self.assertFalse(marker.exists())

    def test_postgres_retirement_counts_only_old_role_while_maintenance_counts_all(self):
        class Connection:
            def __init__(self):
                self.commands = []

            def cursor(self):
                return Cursor(self)

            def commit(self):
                pass

            def rollback(self):
                pass

            def close(self):
                pass

        class Cursor:
            def __init__(self, connection):
                self.connection = connection

            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

            def execute(self, sql, args=()):
                self.sql, self.args = sql, args
                self.connection.commands.append((sql, args))

            def fetchone(self):
                if 'SELECT count(*) FROM pg_stat_activity' in self.sql:
                    # A healthy green transaction remains active throughout this test.
                    self.assert_scope()
                    return (1 if self.args[1] else 0,)
                raise AssertionError(self.sql)

            def assert_scope(self):
                if self.args[2] != 'runtime_blue' or self.args[5] != 'runtime_blue':
                    message = 'transaction/prepared-xact ownership widened'
                    raise AssertionError(message)

            def fetchall(self):
                return []

        for scope, expected in [('old_role', True), ('tenant', False)]:
            connection = Connection()
            with self.subTest(scope=scope), patch('deploy.releases.postgres.validate_runtime_role', return_value={'valid': True}):
                result = fence_runtime({**self.binding, 'fence': 1, 'gateClosed': True,
                                        'admittedWriters': 0, 'transactionScope': scope},
                                       'runtime_blue', 'runtime_green', lambda _: connection, deadline_seconds=0)
            self.assertEqual(result['fenced'], expected)
            sql = '\n'.join(command for command, _ in connection.commands)
            self.assertEqual('GRANT CONNECT' in sql, expected)
            self.assertNotIn('pg_terminate_backend', sql)

    def test_actual_h3_readiness_assets_and_retired_generation_admission(self):
        source = Path(os.environ.get('LIWAN_RUNTIME_REVIEW_SOURCE', Path(__file__).resolve().parents[2]))
        script = r'''
const { createJiti } = require(process.env.REVIEW_SOURCE + '/node_modules/jiti/lib/jiti.cjs');
const jiti = createJiti(process.env.REVIEW_SOURCE + '/runtime-review.cjs');
const { createApp, eventHandler, toNodeListener } = jiti('h3');
const { createServer } = require('node:http');
const fs = require('node:fs'); const path = require('node:path');
const { releaseReadiness } = jiti(process.env.REVIEW_SOURCE + '/apps/web/server/utils/releaseReadiness.ts');
const { installReleaseContext } = jiti(process.env.REVIEW_SOURCE + '/apps/web/server/utils/releaseRequest.ts');
const root = process.env.REVIEW_ROOT;
const assets = path.join(root, 'public', '_nuxt'); fs.mkdirSync(assets, { recursive: true });
fs.writeFileSync(path.join(assets, 'app.js'), 'export default "verified";');
for (const locale of ['ar','en']) { const folder=path.join(root,'public','_i18n','1234abcd',locale); fs.mkdirSync(folder,{recursive:true}); fs.writeFileSync(path.join(folder,'messages.json'),JSON.stringify({messages:'verified'})); }
Object.assign(process.env, { LIWAN_RELEASE_PUBLIC_DIR: path.join(root, 'public'), LIWAN_RELEASE_PROBE_TOKEN: 't'.repeat(40), LIWAN_RELEASE_ID: 'r2', LIWAN_RELEASE_POOL_ID: 'green', LIWAN_ASSETS_ID: 'assets_2', AI_STATE_VERSION: '1', LIWAN_TENANCY_MODE: 'shared', LIWAN_RELEASE_ROUTES_DIR: path.join(root, 'state', 'routes') });
const routeRoot = process.env.LIWAN_RELEASE_ROUTES_DIR;
const old = { poolId: 'blue', releaseId: 'r1', routeRevision: 1, fence: 1 };
fs.writeFileSync(path.join(routeRoot, 'tenant_a.json'), JSON.stringify({ schemaVersion: 1, tenantId: 'tenant_a', identityRevision: 1, state: 'serving', poolId: 'green', releaseId: 'r2', routeRevision: 2, fence: 2, draining: [old] }));
const pool = (poolId, releaseId) => ({ poolId, releaseId, odooUrl: 'http://127.0.0.1:1', webUrl: 'http://127.0.0.1:2', wsUrl: 'http://127.0.0.1:3' });
fs.writeFileSync(path.join(routeRoot, 'pools.json'), JSON.stringify({ schemaVersion: 1, pools: { blue: pool('blue', 'r1'), green: pool('green', 'r2') } }));
const app = createApp();
app.use(eventHandler(event => {
  if (event.path === '/_liwan/release-readiness') return releaseReadiness(event);
  event.context.tenant = { tenantId: 'tenant_a', registryRevision: 1 };
  installReleaseContext(event);
  return { pool: event.context.liwanRelease.poolId };
}));
(async () => {
 const server = createServer(toNodeListener(app)); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 const base = 'http://127.0.0.1:' + server.address().port;
 const headers = { 'X-Liwan-Release-Probe': 't'.repeat(40) };
 const pin = { 'X-Liwan-Release-Pool': 'blue', 'X-Liwan-Release-Revision': '1', 'X-Liwan-Release-Fence': '1' };
 try {
  const denied = await fetch(base + '/_liwan/release-readiness');
  const ready = await fetch(base + '/_liwan/release-readiness', { headers }); const payload = await ready.json();
  fs.unlinkSync(path.join(assets, 'app.js'));
  const missing = await fetch(base + '/_liwan/release-readiness', { headers });
  const before = await fetch(base + '/business', { headers: pin }); const admitted = await before.json();
  fs.writeFileSync(path.join(routeRoot, 'tenant_a.blue.1.retired'), '{}');
  const after = await fetch(base + '/business', { headers: pin });
  const current = await fetch(base + '/business', { headers: { 'X-Liwan-Release-Pool': 'green', 'X-Liwan-Release-Revision': '2', 'X-Liwan-Release-Fence': '2' } });
  process.stdout.write(JSON.stringify({ denied: denied.status, ready: ready.status, payload, missing: missing.status, before: before.status, admitted, after: after.status, current: current.status }));
 } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
'''
        process = subprocess.run(['node', '-e', script], cwd=source, capture_output=True, text=True,
                                 timeout=20, check=True,
                                 env={**os.environ, 'REVIEW_SOURCE': str(source), 'REVIEW_ROOT': str(self.root)})
        result = json.loads(process.stdout)
        self.assertEqual({key: result[key] for key in ('denied', 'ready', 'missing', 'before', 'after', 'current')},
                         {'denied': 403, 'ready': 200, 'missing': 503, 'before': 200, 'after': 503, 'current': 200})
        self.assertEqual(result['admitted'], {'pool': 'blue'})
        self.assertEqual(result['payload'], {'releaseId': 'r2', 'poolId': 'green', 'assetsId': 'assets_2',
                                             'aiStateVersion': '1', 'assets': ['/_nuxt/app.js','/_i18n/1234abcd/ar/messages.json','/_i18n/1234abcd/en/messages.json']})


if __name__ == '__main__':
    unittest.main()
