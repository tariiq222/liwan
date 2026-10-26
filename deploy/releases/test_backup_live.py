"""Opt-in real PostgreSQL: writer fence, window recheck, capture and scratch restore.

Runs only on a task-owned ``webvue_scratch_backup_*`` loopback database. The two
runtime roles are task-owned fixture principals: the test creates them when
absent and only revokes CONNECT at the end (roles and database are preserved for
the operator, never dropped here).
"""
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from urllib.parse import urlsplit
from .backup import capture_tenant, restore_tenant, validate_backup
from .postgres import fence_writers, writer_grants
from .runtime import LocalRuntime
from .state import ReleaseState, ReleaseConflict


@unittest.skipUnless(os.environ.get('WEBVUE_BACKUP_TEST_DSN'),'isolated PostgreSQL opt-in required')
class BackupLiveTests(unittest.TestCase):
    roles = ('webvue_backup_live_blue', 'webvue_backup_live_green')

    def setUp(self):
        import psycopg2
        self.psycopg2 = psycopg2
        dsn = os.environ['WEBVUE_BACKUP_TEST_DSN']; url = urlsplit(dsn)
        if url.hostname not in ('localhost', '127.0.0.1') or not url.path.startswith('/webvue_scratch_backup_'):
            raise ValueError('scratch_required')
        self.database = url.path[1:]
        self.admin = psycopg2.connect(dsn); self.admin.autocommit = True
        with self.admin.cursor() as cursor:
            cursor.execute(f'REVOKE CONNECT ON DATABASE "{self.database}" FROM PUBLIC')  # as provisioned in production
            for role in self.roles:
                cursor.execute('SELECT 1 FROM pg_roles WHERE rolname=%s', (role,))
                if not cursor.fetchone():
                    cursor.execute(f'CREATE ROLE "{role}" LOGIN NOINHERIT NOSUPERUSER')
                cursor.execute(f'GRANT CONNECT ON DATABASE "{self.database}" TO "{role}"')
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.addCleanup(self.admin.close)
        state = ReleaseState(Path(self.temp.name).resolve() / 'state')
        self.binding = {'tenantId':'tenant_a','database':self.database,'filestore':self.database,'registryRevision':1}
        route = {'schemaVersion':1,'tenantId':'tenant_a','identityRevision':1,'routeRevision':1,'releaseId':'r1','poolId':'blue','fence':1,'state':'serving'}
        state.register(self.binding, route); state.maintenance('tenant_a', 1)
        config = {'mode':'local','postgres':{'host':'127.0.0.1'},
                  'tenants':{'tenant_a':{**self.binding,'roles':{'blue':self.roles[0],'green':self.roles[1]}}}}
        self.runtime = LocalRuntime(state, config, connector=lambda _: psycopg2.connect(dsn))

    def tearDown(self):
        with self.admin.cursor() as cursor:
            for role in self.roles:
                cursor.execute(f'REVOKE CONNECT ON DATABASE "{self.database}" FROM "{role}"')

    def test_window_recheck_refuses_open_admission_live_work_and_reports_the_denied_set(self):
        with self.assertRaises(ReleaseConflict):
            self.runtime._recheck_window(self.binding, 5)  # both runtime roles still hold CONNECT
        with self.admin.cursor() as cursor:
            for role in self.roles:
                cursor.execute(f'REVOKE CONNECT ON DATABASE "{self.database}" FROM "{role}"')
        proof = self.runtime._recheck_window(self.binding, 5)
        self.assertTrue(proof['gateClosed'])
        self.assertEqual(proof['deniedWriters'], list(self.roles))
        self.assertEqual(proof['writerConnections'], 0)
        other = self.psycopg2.connect(os.environ['WEBVUE_BACKUP_TEST_DSN'])
        try:
            with other.cursor() as cursor:
                cursor.execute('SELECT 1')
            with self.assertRaises(ReleaseConflict):
                self.runtime._recheck_window(self.binding, 5)
            other.rollback()
            self.assertTrue(self.runtime._recheck_window(self.binding, 5)['gateClosed'])
        finally:
            other.close()

    def test_fence_capture_and_restore_against_real_postgres(self):
        dsn = os.environ['WEBVUE_BACKUP_TEST_DSN']
        restored = 'webvue_scratch_backup_restored'
        postgres_dsn = dsn.rsplit('/', 1)[0] + '/postgres'
        def drop_restored():
            conn = self.psycopg2.connect(postgres_dsn); conn.autocommit = True
            with conn.cursor() as cursor: cursor.execute(f'DROP DATABASE IF EXISTS "{restored}"')
            conn.close()
        drop_restored(); self.addCleanup(drop_restored)
        with self.admin.cursor() as cursor:
            cursor.execute('CREATE TABLE IF NOT EXISTS backup_live_rows(id serial PRIMARY KEY, value text)')
            cursor.execute('DELETE FROM backup_live_rows'); cursor.execute("INSERT INTO backup_live_rows(value) VALUES ('seed')")
            cursor.execute('SELECT current_user'); admin_user = cursor.fetchone()[0]
        idle = self.psycopg2.connect(dsn.replace('//', f'//{self.roles[0]}@', 1)); idle.autocommit = True
        self.addCleanup(lambda: idle.closed or idle.close())
        with idle.cursor() as cursor: cursor.execute('SELECT 1')
        binding = {**self.binding, 'fence': 1, 'gateClosed': True, 'admittedWriters': 0}
        result = fence_writers(binding, list(self.roles), lambda _: self.psycopg2.connect(dsn),
                               allowed_principals=(admin_user,), deadline_seconds=10)
        self.assertTrue(result['fenced'], result)
        self.assertEqual(result['deniedWriters'], list(self.roles))
        with self.admin.cursor() as cursor:
            self.assertEqual(writer_grants(self.admin, self.roles, self.database), {role: False for role in self.roles})
        with self.assertRaises(self.psycopg2.OperationalError):  # idle session retired, reconnect refused
            self.psycopg2.connect(dsn.replace('//', f'//{self.roles[1]}@', 1))
        with self.assertRaises(self.psycopg2.Error):
            with idle.cursor() as cursor: cursor.execute('SELECT 1')
        # An unlisted principal with write authority must refuse the window.
        with self.admin.cursor() as cursor:
            cursor.execute('SELECT 1 FROM pg_roles WHERE rolname=%s', ('webvue_backup_live_rogue',))
            if not cursor.fetchone(): cursor.execute('CREATE ROLE webvue_backup_live_rogue LOGIN')
            cursor.execute(f'GRANT CONNECT ON DATABASE "{self.database}" TO webvue_backup_live_rogue')
        rogue = fence_writers(binding, list(self.roles), lambda _: self.psycopg2.connect(dsn),
                              allowed_principals=(admin_user,), deadline_seconds=10)
        self.assertEqual(rogue['reason'], 'unsupported_writer_principal')
        with self.admin.cursor() as cursor:
            cursor.execute(f'REVOKE CONNECT ON DATABASE "{self.database}" FROM webvue_backup_live_rogue')
        store = Path(self.temp.name).resolve() / 'filestore' / self.database
        store.mkdir(parents=True); (store / 'attachment').write_bytes(b'live-attachment')
        pg = Path(shutil.which('pg_dump') or '').parent
        config = {'mode': 'local', 'outputDir': str(Path(self.temp.name).resolve() / 'backup'), 'filestorePath': str(store),
                  'pgDump': str(pg / 'pg_dump'), 'createdb': str(pg / 'createdb'), 'pgRestore': str(pg / 'pg_restore'),
                  'image': 'webvue/odoo@sha256:' + 'a' * 64, 'writerWindow': True, 'recheck': self.runtime._recheck_window,
                  'totalDeadlineSeconds': 120, 'timeoutSeconds': 60}
        proof = {**self.binding, 'fence': 1, 'gateClosed': True, 'admittedWriters': 0, 'activeTransactions': 0,
                 'oldConnections': 0, 'writerConnections': 0, 'deniedWriters': list(self.roles)}
        receipt = capture_tenant({**self.binding, 'fence': 1}, proof, config)
        self.assertFalse(receipt['restoreVerified'])
        self.assertTrue(validate_backup(config['outputDir'])['valid'])
        target = {'tenantId': 'tenant_a', 'database': restored, 'filestore': restored}
        source = {key: receipt[key] for key in ('tenantId', 'database', 'filestore', 'fence')}
        restore_tenant(config['outputDir'], target, {**config, 'restoreAllowed': True, 'writesResumed': False,
            'targetFilestore': str(Path(self.temp.name).resolve() / 'restored' / restored), 'recoverySource': source})
        check = self.psycopg2.connect(dsn.rsplit('/', 1)[0] + '/' + restored)
        try:
            with check.cursor() as cursor:
                cursor.execute('SELECT value FROM backup_live_rows'); self.assertEqual(cursor.fetchall(), [('seed',)])
        finally: check.close()
        self.assertEqual((Path(self.temp.name).resolve() / 'restored' / restored / 'attachment').read_bytes(), b'live-attachment')
