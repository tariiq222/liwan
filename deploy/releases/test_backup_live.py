"""Opt-in real PostgreSQL: the writer window refuses open admission and live work.

Runs only on a task-owned ``webvue_scratch_backup_*`` loopback database. The two
runtime roles are task-owned fixture principals: the test creates them when
absent and only revokes CONNECT at the end (roles and database are preserved for
the operator, never dropped here).
"""
import os
from pathlib import Path
import tempfile
import unittest
from urllib.parse import urlsplit
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
            self.runtime._recheck_window(self.binding)  # both runtime roles still hold CONNECT
        with self.admin.cursor() as cursor:
            for role in self.roles:
                cursor.execute(f'REVOKE CONNECT ON DATABASE "{self.database}" FROM "{role}"')
        proof = self.runtime._recheck_window(self.binding)
        self.assertTrue(proof['gateClosed'])
        self.assertEqual(proof['deniedWriters'], list(self.roles))
        self.assertEqual(proof['writerConnections'], 0)
        other = self.psycopg2.connect(os.environ['WEBVUE_BACKUP_TEST_DSN'])
        try:
            with other.cursor() as cursor:
                cursor.execute('SELECT 1')
            with self.assertRaises(ReleaseConflict):
                self.runtime._recheck_window(self.binding)
            other.rollback()
            self.assertTrue(self.runtime._recheck_window(self.binding)['gateClosed'])
        finally:
            other.close()
