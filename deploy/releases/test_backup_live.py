"""Opt-in real PostgreSQL: writer fence, window recheck, capture and scratch restore.

Runs only on a task-owned ``webvue_scratch_backup_*`` loopback database. The two
runtime roles are fixture principals: the test refuses to run if one already
exists, creates them, and drops at the end only the roles it created. The source
database belongs to the operator and is never dropped here. The restore target is a fresh
``webvue_scratch_backup_restore_<random>`` name per run; an existing name is
refused, and only a database this run itself created is dropped.
"""
import os
import secrets
from pathlib import Path
import shutil
import tempfile
import unittest
from urllib.parse import urlsplit
from .backup import Deadline, capture_window, restore_tenant, validate_backup
from . import backup
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
        self.addCleanup(self.admin.close)  # cleanups run LIFO: roles are dropped before this closes
        self.created_roles = []
        self.addCleanup(self.drop_created_roles)
        with self.admin.cursor() as cursor:
            cursor.execute(f'REVOKE CONNECT ON DATABASE "{self.database}" FROM PUBLIC')  # as provisioned in production
            for role in self.roles:
                self.create_role(cursor, role)
                cursor.execute(f'GRANT CONNECT ON DATABASE "{self.database}" TO "{role}"')
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        state = ReleaseState(Path(self.temp.name).resolve() / 'state')
        self.binding = {'tenantId':'tenant_a','database':self.database,'filestore':self.database,'registryRevision':1}
        route = {'schemaVersion':1,'tenantId':'tenant_a','identityRevision':1,'routeRevision':1,'releaseId':'r1','poolId':'blue','fence':1,'state':'serving'}
        state.register(self.binding, route); state.maintenance('tenant_a', 1)
        config = {'mode':'local','postgres':{'host':'127.0.0.1'},
                  'tenants':{'tenant_a':{**self.binding,'roles':{'blue':self.roles[0],'green':self.roles[1]}}}}
        self.runtime = LocalRuntime(state, config, connector=lambda _database, **options: psycopg2.connect(dsn, **options))

    def create_role(self, cursor, role):
        cursor.execute('SELECT 1 FROM pg_roles WHERE rolname=%s', (role,))
        if cursor.fetchone(): self.fail(f'{role} already exists; refusing to reuse a principal this run did not create')
        cursor.execute(f'CREATE ROLE "{role}" LOGIN NOINHERIT NOSUPERUSER')
        self.created_roles.append(role)

    def drop_created_roles(self):
        with self.admin.cursor() as cursor:
            for role in reversed(self.created_roles):
                cursor.execute(f'REVOKE CONNECT ON DATABASE "{self.database}" FROM "{role}"')
                cursor.execute(f'DROP ROLE "{role}"')

    def test_window_recheck_refuses_open_admission_live_work_and_reports_the_denied_set(self):
        with self.assertRaises(ReleaseConflict):
            self.runtime._recheck_window(self.binding, Deadline(5))  # both runtime roles still hold CONNECT
        with self.admin.cursor() as cursor:
            for role in self.roles:
                cursor.execute(f'REVOKE CONNECT ON DATABASE "{self.database}" FROM "{role}"')
        proof = self.runtime._recheck_window(self.binding, Deadline(5))
        self.assertTrue(proof['gateClosed'])
        self.assertEqual(proof['deniedWriters'], list(self.roles))
        self.assertEqual(proof['writerConnections'], 0)
        other = self.psycopg2.connect(os.environ['WEBVUE_BACKUP_TEST_DSN'])
        try:
            with other.cursor() as cursor:
                cursor.execute('SELECT 1')
            with self.assertRaises(ReleaseConflict):
                self.runtime._recheck_window(self.binding, Deadline(5))
            other.rollback()
            self.assertTrue(self.runtime._recheck_window(self.binding, Deadline(5))['gateClosed'])
        finally:
            other.close()

    def test_fence_capture_and_restore_against_real_postgres(self):
        dsn = os.environ['WEBVUE_BACKUP_TEST_DSN']
        restored = 'webvue_scratch_backup_restore_' + secrets.token_hex(6)
        with self.admin.cursor() as cursor:
            cursor.execute('SELECT 1 FROM pg_database WHERE datname=%s', (restored,))
            if cursor.fetchone(): self.fail('restore target already exists; refusing to reuse or drop it')
        created = []
        postgres_dsn = dsn.rsplit('/', 1)[0] + '/postgres'
        def drop_created():
            if not created: return  # never drop a database this run did not create
            conn = self.psycopg2.connect(postgres_dsn); conn.autocommit = True
            try:
                with conn.cursor() as cursor: cursor.execute(f'DROP DATABASE "{restored}"')
            finally: conn.close()
        self.addCleanup(drop_created)
        with self.admin.cursor() as cursor:
            cursor.execute('CREATE TABLE IF NOT EXISTS backup_live_rows(id serial PRIMARY KEY, value text)')
            cursor.execute('DELETE FROM backup_live_rows'); cursor.execute("INSERT INTO backup_live_rows(value) VALUES ('seed')")
            cursor.execute('SELECT current_user'); admin_user = cursor.fetchone()[0]
        idle = self.psycopg2.connect(dsn.replace('//', f'//{self.roles[0]}@', 1)); idle.autocommit = True
        self.addCleanup(lambda: idle.closed or idle.close())
        with idle.cursor() as cursor: cursor.execute('SELECT 1')
        binding = {**self.binding, 'fence': 1, 'gateClosed': True, 'admittedWriters': 0}
        connect = lambda _database, **options: self.psycopg2.connect(dsn, **options)
        result = fence_writers(binding, list(self.roles), connect, deadline=Deadline(30),
                               allowed_principals=(admin_user,), drain_seconds=10)
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
            self.create_role(cursor, 'webvue_backup_live_rogue')
            cursor.execute(f'GRANT CONNECT ON DATABASE "{self.database}" TO webvue_backup_live_rogue')
        rogue = fence_writers(binding, list(self.roles), connect, deadline=Deadline(30),
                              allowed_principals=(admin_user,), drain_seconds=10)
        self.assertEqual(rogue['reason'], 'unsupported_writer_principal')
        with self.admin.cursor() as cursor:
            cursor.execute(f'REVOKE CONNECT ON DATABASE "{self.database}" FROM webvue_backup_live_rogue')
        store = Path(self.temp.name).resolve() / 'filestore' / self.database
        store.mkdir(parents=True); (store / 'attachment').write_bytes(b'live-attachment')
        pg = Path(shutil.which('pg_dump') or '').parent
        config = {'mode': 'local', 'outputDir': str(Path(self.temp.name).resolve() / 'backup'), 'filestorePath': str(store),
                  'pgDump': str(pg / 'pg_dump'), 'createdb': str(pg / 'createdb'), 'pgRestore': str(pg / 'pg_restore'),
                  'image': 'webvue/odoo@sha256:' + 'a' * 64, 'recheck': self.runtime._recheck_window, 'timeoutSeconds': 60}
        proof = {**self.binding, 'fence': 1, 'gateClosed': True, 'admittedWriters': 0, 'activeTransactions': 0,
                 'oldConnections': 0, 'writerConnections': 0, 'deniedWriters': list(self.roles)}
        receipt = capture_window({**self.binding, 'fence': 1}, proof, config, Deadline(120))
        self.assertFalse(receipt['restoreVerified'])
        self.assertTrue(validate_backup(config['outputDir'])['valid'])
        target = {'tenantId': 'tenant_a', 'database': restored, 'filestore': restored}
        source = {key: receipt[key] for key in ('tenantId', 'database', 'filestore', 'fence')}
        restore_config = {**config, 'restoreAllowed': True, 'writesResumed': False,
            'targetFilestore': str(Path(self.temp.name).resolve() / 'restored' / restored), 'recoverySource': source}
        # createdb fails on an existing name, so a successful restore means this run created it.
        def created_by_this_run(argv, **kwargs):
            result = backup.subprocess.run(argv, **kwargs)
            if argv[0].endswith('createdb') and result.returncode == 0: created.append(restored)
            return result
        restore_tenant(config['outputDir'], target, {**restore_config, 'runner': created_by_this_run})
        check = self.psycopg2.connect(dsn.rsplit('/', 1)[0] + '/' + restored)
        try:
            with check.cursor() as cursor:
                cursor.execute('SELECT value FROM backup_live_rows'); self.assertEqual(cursor.fetchall(), [('seed',)])
        finally: check.close()
        self.assertEqual((Path(self.temp.name).resolve() / 'restored' / restored / 'attachment').read_bytes(), b'live-attachment')
