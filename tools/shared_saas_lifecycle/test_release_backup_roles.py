"""The release backup route reads tenant tables as the owning role, never in an admin session (c1b rule 3), on a real server.

`capture_release_backup` reads the attachment inventory through `LocalRuntime.tenant_connector`. psycopg2 is replaced by a
thin adapter over the throwaway cluster's psql, so the real inventory code, the real writer fence (`fence_writers`) and the
real grant restore run against the real hostile-code fixture. The inventory is read after the fence, which revokes CONNECT
from every declared writer role and ends its sessions: the login that reads it must not be a declared writer, and the
route refuses before anything is fenced when it is.
"""
import json
import re
import subprocess
import sys
import types
import unittest
import uuid
from pathlib import Path
from unittest import mock

from deploy.releases.backup import Deadline
from deploy.releases.postgres import fence_writers
from deploy.releases.runtime import LocalRuntime
from tools.shared_saas_lifecycle import release_backup
from tools.shared_saas_lifecycle.odoo_effect import EffectError
from tools.shared_saas_lifecycle.test_tenant_drop_effect import (
    POSTGRES_AVAILABLE, PostgresCluster, assert_no_hostile_effect, hostile_effects, plant_hostile_code, reset_hostile_effects,
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


def literal(value):
    if value is None: return 'NULL'
    if isinstance(value, bool): return 'true' if value else 'false'
    if isinstance(value, int): return str(value)
    if isinstance(value, (list, tuple)): return 'ARRAY[' + ', '.join(literal(item) for item in value) + ']::text[]'
    return "'" + str(value).replace("'", "''") + "'"


def typed(text):
    """psql prints everything as text; give the values back the types the driver would."""
    if text in ('t', 'f'): return text == 't'
    if re.fullmatch(r'-?\d{1,9}', text): return int(text)
    if text.startswith('{') and text.endswith('}'): return json.loads(text)
    return text


class PsqlCursor:
    def __init__(self, cluster, database, role):
        self.cluster, self.database, self.role, self.rows = cluster, database, role, []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        if isinstance(params, dict):
            sql = sql % {key: literal(value) for key, value in params.items()}
        elif params is not None:
            sql = sql % tuple(literal(value) for value in params)
        out = self.cluster.sql(self.database, sql, role=self.role)
        self.rows = [tuple(typed(cell) for cell in line.split('|')) for line in out.splitlines() if line.strip()]

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

    def commit(self):
        pass

    def rollback(self):
        pass

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

    def planted_database(self, writer_role=None):
        """A tenant database closed to PUBLIC, with the hostile fixture planted and a partial-index predicate on the inventory's table."""
        database = 'liwan_scratch_' + uuid.uuid4().hex
        marker = Path('/tmp') / ('ldp-marker-' + uuid.uuid4().hex)
        self.addCleanup(reset_hostile_effects, self.cluster, marker)
        self.cluster.create_tenant_database(database, ';\n'.join(TABLES))
        plant_hostile_code(self.cluster, database, marker)
        # The planner evaluates the immutable predicate for any SELECT on the table, as whoever runs it.
        self.cluster.sql(database, "CREATE INDEX evil_inventory ON ir_attachment (id) WHERE public.evil_bool('inventory')", role='odoo')
        self.cluster.sql(database, 'DELETE FROM evil_log', role='odoo')
        self.cluster.sql('postgres', f'REVOKE CONNECT ON DATABASE "{database}" FROM PUBLIC')
        self.cluster.sql('postgres', f'GRANT CONNECT ON DATABASE "{database}" TO odoo')
        if writer_role:
            self.cluster.sql('postgres', f'CREATE ROLE "{writer_role}" LOGIN NOINHERIT')
            self.cluster.sql('postgres', f'GRANT CONNECT ON DATABASE "{database}" TO "{writer_role}"')
            self.cluster.sql(database, f'GRANT USAGE ON SCHEMA public TO "{writer_role}"; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "{writer_role}"', role='odoo')
        return database, marker

    def can_connect(self, role, database):
        return self.cluster.sql('postgres', f"SELECT has_database_privilege('{role}', '{database}', 'CONNECT')") == 't'

    def capture(self, database, roles, window=None, admin_reads=False):
        """Runs `capture_release_backup` with the real inventory reader; returns the (user, database) connections it opened.

        `window` replaces `backup_current` (the fence, the capture and the restore of the previous state); it must call
        the finalize step it is given. With `admin_reads` the inventory logs in as the admin role: the control run.
        """
        connections = []

        def connect(dbname=None, host=None, port=None, user=None, **options):
            connections.append((user, dbname))
            return PsqlConnection(self.cluster, dbname, user)

        binding = {'tenantId': 't', 'database': database}
        runner = mock.MagicMock(config={'releaseBackupConfig': 'x'}, request={'job': {'binding': binding}, 'businessKey': 'k', 'payloadDigest': 'd'},
                                base=[], backup_id='b', authority={'controlTenantId': 'c'}, artifact=Path('/nonexistent'))
        runner.command.return_value = self.cluster.sql('postgres', 'SELECT system_identifier::text FROM pg_control_system()')
        config = {'mode': 'local', 'postgres': {'host': '127.0.0.1', 'port': 1, 'adminUser': 'postgres'}, 'backup': {'image': 'img', 'allowedPrincipals': ['odoo']},
                  'tenants': {'t': {'database': database, 'filestore': database, 'filestorePath': '/nonexistent-store', 'roles': roles}}}
        state = mock.Mock()
        state.binding.return_value = binding
        patches = [mock.patch.dict(sys.modules, {'psycopg2': types.SimpleNamespace(connect=connect)}),
                   mock.patch.object(release_backup, 'document', return_value={'stateDir': '/x', 'runtime': config}),
                   mock.patch.object(release_backup, 'ReleaseState', return_value=state),
                   mock.patch.object(release_backup, 'permit'), mock.patch.object(release_backup, 'reserve'),
                   mock.patch.object(release_backup, 'sha256_file', return_value='0' * 64),
                   mock.patch.object(release_backup, 'subprocess', types.SimpleNamespace(run=lambda *args, **kwargs: types.SimpleNamespace(stdout='sha256:image\n'))),
                   mock.patch.object(release_backup, 'backup_current', window or (lambda state_, runtime, binding_, name, artifact, finalize: finalize({})))]
        if admin_reads:
            patches.append(mock.patch.object(LocalRuntime, 'tenant_connector', lambda self, database, **options: self.connector(database, **options)))
        for patch in patches: patch.start()
        try:
            release_backup.capture_release_backup(runner)
        finally:
            for patch in reversed(patches): patch.stop()
        return connections

    def real_window(self, fenced_roles, seen):
        """backup_current's window with the real fence and the real grant restore; `seen` collects what the inventory's connections were."""
        def window(state, runtime, binding, name, artifact, finalize):
            deadline = Deadline(60)
            proof = fence_writers({**binding, 'fence': 1, 'gateClosed': True, 'admittedWriters': 0, 'transactionScope': 'tenant'}, fenced_roles,
                                  runtime.connector, deadline=deadline, allowed_principals=runtime._allowed_principals(), drain_seconds=5)
            self.assertTrue(proof['fenced'], proof)
            seen['fenced'] = {role: self.can_connect(role, binding['database']) for role in fenced_roles}
            try:
                return finalize({})
            finally:
                previous = {'roles': list(fenced_roles), 'grants': {role: True for role in fenced_roles}, 'cron': {}}
                with mock.patch.object(LocalRuntime, '_recorded_cron_jobs', return_value={}), mock.patch.object(LocalRuntime, '_restore_previous_cron', return_value={}):
                    runtime._restore_previous(binding, {'poolId': 'blue'}, previous, deadline)
        return window

    def test_the_inventory_after_the_real_fence_runs_planted_code_only_as_the_non_superuser_owning_role(self):
        writer = 'rt_' + uuid.uuid4().hex[:8]
        database, marker = self.planted_database(writer)
        seen = {}
        connections = self.capture(database, {'blue': writer}, window=None)  # inventory without a fence first: the planted code is reached
        reached = assert_no_hostile_effect(self, self.cluster, marker, database)
        self.assertIn('inventory', reached, 'the inventory read never reached the planted predicate')
        self.assertIn(('odoo', database), connections)
        self.cluster.sql(database, 'DELETE FROM evil_log', role='odoo')

        connections = self.capture(database, {'blue': writer}, window=self.real_window((writer,), seen))
        self.assertEqual(seen['fenced'], {writer: False}, 'the fence did not close the declared writer')
        opened = [pair for pair in connections if pair[1] == database]
        self.assertIn(('odoo', database), opened)
        self.assertEqual(set(user for user, _ in opened), {'postgres', 'odoo'}, 'only the fence (admin, catalog statements) and the inventory (owner) log in')
        reached = assert_no_hostile_effect(self, self.cluster, marker, database)
        self.assertIn('inventory', reached, 'the inventory read never reached the planted predicate')
        self.assertTrue(self.can_connect(writer, database), 'CONNECT was not restored after the window')
        self.assertTrue(self.can_connect('odoo', database))

    def test_an_admin_session_would_be_exploited_by_the_same_inventory_read(self):
        database, marker = self.planted_database()
        self.capture(database, {'blue': 'rt_unused'}, admin_reads=True)
        effects = hostile_effects(self.cluster, marker)
        self.assertTrue(effects['newRoles'] or effects['superusers'] or effects['programRan'], 'the control run did not trigger the planted code')

    def test_a_declared_writer_that_is_the_inventory_login_is_refused_before_anything_is_fenced(self):
        database, marker = self.planted_database()
        window = mock.Mock()
        with self.assertRaisesRegex(EffectError, '^inventory_role_fenced$'):
            self.capture(database, {'blue': 'odoo'}, window=window)
        window.assert_not_called()
        self.assertTrue(self.can_connect('odoo', database))

    def test_the_real_fence_shuts_the_inventory_login_out_when_it_is_a_declared_writer(self):
        # The premise of the refusal above: with `odoo` declared, the window revokes its CONNECT, so a later read cannot log in.
        database, marker = self.planted_database()
        connector = LocalRuntime(mock.Mock(), {'mode': 'local', 'postgres': {'host': '127.0.0.1', 'port': 1, 'adminUser': 'postgres'}}, connector=lambda db, **options: PsqlConnection(self.cluster, db, 'postgres'))
        proof = fence_writers({'tenantId': 't', 'database': database, 'fence': 1, 'gateClosed': True, 'admittedWriters': 0}, ('odoo',), connector.connector, deadline=Deadline(60), allowed_principals=('postgres',), drain_seconds=5)
        self.assertTrue(proof['fenced'], proof)
        with self.assertRaises(subprocess.CalledProcessError):
            self.cluster.sql(database, 'SELECT 1', role='odoo')


if __name__ == '__main__':
    unittest.main()
