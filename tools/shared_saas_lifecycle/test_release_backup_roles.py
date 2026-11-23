"""The release backup route must not read tenant tables in an admin session (c1b rule 3), proven on a real server.

`capture_release_backup` reads the attachment inventory through `LocalRuntime.connector`, which logs in as
`postgres.adminUser`. psycopg2 is replaced by a thin adapter over the throwaway cluster's psql so the real code path
runs with the real hostile-code fixture; planted code that runs in a superuser session leaves a trace.
"""
import subprocess
import sys
import types
import unittest
import uuid
from pathlib import Path
from unittest import mock

from tools.shared_saas_lifecycle import release_backup
from tools.shared_saas_lifecycle.test_tenant_drop_effect import (
    POSTGRES_AVAILABLE, PostgresCluster, assert_no_hostile_effect, plant_hostile_code, reset_hostile_effects,
)

TABLES = (
    'CREATE TABLE ir_config_parameter (key text PRIMARY KEY, value text)',
    'CREATE TABLE ir_attachment (id serial PRIMARY KEY, store_fname text, checksum text, file_size integer, type text, db_datas bytea)',
    'CREATE TABLE project_project (id serial PRIMARY KEY)',
    'CREATE TABLE project_task (id serial PRIMARY KEY)',
    'CREATE TABLE ir_module_module (name text, latest_version text, state text)',
    'CREATE TABLE liwan_tenant_profile (id serial PRIMARY KEY, policy_revision integer)',
    'INSERT INTO liwan_tenant_profile (policy_revision) VALUES (1)',
)


class PsqlCursor:
    def __init__(self, cluster, database, role):
        self.cluster, self.database, self.role, self.rows = cluster, database, role, []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        assert not params
        out = self.cluster.sql(self.database, sql, role=self.role)
        self.rows = [tuple(line.split('|')) for line in out.splitlines() if line.strip()]

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0] if self.rows else None


class PsqlConnection:
    def __init__(self, cluster, database, role):
        self.cluster, self.database, self.role = cluster, database, role

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def set_session(self, **options):
        pass

    def cursor(self):
        return PsqlCursor(self.cluster, self.database, self.role)

    def close(self):
        pass


@unittest.skipUnless(POSTGRES_AVAILABLE, 'initdb, pg_ctl and psql are required for the real PostgreSQL tests')
class ReleaseBackupRoleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cluster = PostgresCluster()

    @classmethod
    def tearDownClass(cls):
        cls.cluster.stop()

    def test_the_inventory_of_a_release_backup_runs_no_tenant_code_in_a_superuser_session(self):
        database = 'liwan_scratch_' + uuid.uuid4().hex
        marker = Path('/tmp') / ('ldp-marker-' + uuid.uuid4().hex)
        self.addCleanup(reset_hostile_effects, self.cluster, marker)
        self.cluster.create_tenant_database(database, ';\n'.join(TABLES))
        plant_hostile_code(self.cluster, database, marker)
        # A partial-index predicate on the table the inventory reads first: the planner evaluates it for any SELECT.
        self.cluster.sql(database, "CREATE INDEX evil_inventory ON ir_attachment (id) WHERE public.evil_bool('inventory')", role='odoo')
        self.cluster.sql(database, 'DELETE FROM evil_log', role='odoo')
        connections = []

        def connect(dbname=None, host=None, port=None, user=None, **options):
            connections.append((user, dbname))
            return PsqlConnection(self.cluster, dbname, user)

        fake = types.SimpleNamespace(connect=connect)
        runner = mock.Mock(config={'releaseBackupConfig': 'x'}, request={'job': {'binding': {'tenantId': 't', 'database': database}}},
                           base=[], backup_id='b', authority={}, artifact=Path('/nonexistent'))
        runner.command.return_value = '1'
        config = {'mode': 'local', 'postgres': {'host': '127.0.0.1', 'port': 1, 'adminUser': 'postgres'}, 'tenants': {}}
        state = mock.Mock()
        state.binding.return_value = runner.request['job']['binding']
        cursor_rows = mock.Mock()

        def run_finalize(state_, runtime, binding, name, artifact, finalize):
            return finalize({})

        with mock.patch.dict(sys.modules, {'psycopg2': fake}), mock.patch.object(release_backup, 'document', return_value={'stateDir': '/x', 'runtime': config}), \
                mock.patch.object(release_backup, 'ReleaseState', return_value=state), mock.patch.object(release_backup, 'permit'), \
                mock.patch.object(release_backup, 'backup_current', run_finalize), \
                mock.patch.object(PsqlCursor, 'fetchone', side_effect=[('1',)] + [None] * 50):
            try:
                release_backup.capture_release_backup(runner)
            except Exception as error:  # the stubbed runner cannot finish the manifest; only the reads matter
                self.reads_stopped_at = repr(error)
        self.assertIn(database, [name for _, name in connections], 'the inventory never reached the tenant database: ' + getattr(self, 'reads_stopped_at', ''))
        assert_no_hostile_effect(self, self.cluster, marker)
        self.assertNotIn(('postgres', database), connections, 'a superuser session was opened inside a tenant database')


if __name__ == '__main__':
    unittest.main()
