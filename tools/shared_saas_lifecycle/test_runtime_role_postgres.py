# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The runtime role of the shared stack against a real throwaway PostgreSQL server.

The cluster is the one test_tenant_drop_effect starts (unix socket, temporary directory, nothing else is
contacted). Role `odoo` is created by running deploy/db/init-runtime-role.sh itself, and tenant databases are
created from the same statements the lifecycle tools run, so the proof covers the recipe, not a copy of it.
"""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import uuid

from deploy.releases.postgres import (
    ODOO_RUNTIME_ROLE, POSTGRES_ADMIN_ROLE, TENANT_EXTENSION_SQL, runtime_role_assertion_sql, tenant_create_database_sql,
    tenant_isolation_sql, tenant_schema_grant_sql,
)
from tools.shared_saas_lifecycle import odoo_backup
from tools.shared_saas_lifecycle.test_tenant_drop_effect import POSTGRES, POSTGRES_AVAILABLE, PostgresCluster, postgres_binary

INIT_SCRIPT = Path(__file__).resolve().parents[2] / 'deploy' / 'db' / 'init-runtime-role.sh'
PG_DUMP, PG_RESTORE = postgres_binary('pg_dump'), postgres_binary('pg_restore')


@unittest.skipUnless(POSTGRES_AVAILABLE and PG_DUMP and PG_RESTORE, 'initdb, pg_ctl, psql, pg_dump and pg_restore are required for the real PostgreSQL tests')
class RuntimeRoleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cluster = PostgresCluster()
        # The shared harness creates a plain `odoo` login role; replace it with the one the init script makes.
        cls.cluster.sql('postgres', 'DROP ROLE odoo; CREATE ROLE liwan_ai NOLOGIN')
        binaries = str(Path(POSTGRES['psql']).parent)
        cls.environment = {**os.environ, 'LC_ALL': 'C', 'LANG': 'C', 'PATH': binaries + os.pathsep + os.environ['PATH'],
                           'PGHOST': str(cls.cluster.socket), 'PGPORT': cls.cluster.port, 'POSTGRES_PASSWORD': 'unused-under-trust-auth'}
        subprocess.run(['sh', str(INIT_SCRIPT)], check=True, capture_output=True, env={
            **cls.environment, 'POSTGRES_USER': POSTGRES_ADMIN_ROLE, 'ODOO_DB_PASSWORD': 'test-only-password'})

    @classmethod
    def tearDownClass(cls):
        cls.cluster.stop()

    def setUp(self):
        self.database = 'liwan_role_test_' + uuid.uuid4().hex[:12]
        self.addCleanup(self.drop, self.database)
        self.create_tenant(self.database)

    def drop(self, database):
        self.cluster.sql('postgres', f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE)')

    def create_tenant(self, database):
        """What Runner.create_isolated_database runs, as the admin role."""
        self.cluster.sql('postgres', tenant_create_database_sql(database) + ';\n' + tenant_isolation_sql(database, ODOO_RUNTIME_ROLE))
        self.cluster.sql(database, TENANT_EXTENSION_SQL + ';\n' + tenant_schema_grant_sql(ODOO_RUNTIME_ROLE) + ';\n')

    def as_runtime(self, database, statement):
        return subprocess.run(self.cluster.argv[:-1] + [ODOO_RUNTIME_ROLE, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', database],
                              input=statement.encode(), capture_output=True, check=False)

    def assertRefused(self, database, statement):
        done = self.as_runtime(database, statement)
        self.assertNotEqual(done.returncode, 0, statement)
        self.assertRegex(done.stderr.decode(), 'permission denied|must be (owner|superuser)|must have', statement)

    def public_connect(self, database):
        return self.cluster.sql('postgres', "SELECT count(*) FROM pg_database d, LATERAL aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a "
                                            f"WHERE d.datname = '{database}' AND a.grantee = 0 AND a.privilege_type = 'CONNECT'")

    def owners(self, database):
        return self.cluster.sql(database, "SELECT relname || ':' || pg_get_userbyid(relowner) FROM pg_class "
                                          "WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'S') ORDER BY 1").split()

    def test_the_init_script_creates_a_plain_login_role_that_reaches_the_postgres_database(self):
        flags = self.cluster.sql('postgres', "SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls "
                                             "FROM pg_roles WHERE rolname = 'odoo'")
        self.assertEqual(flags, 't|f|f|f|f|f')
        done = self.as_runtime('postgres', 'SELECT 1')
        self.assertEqual((done.returncode, done.stdout.decode().strip()), (0, '1'), done.stderr)

    def test_the_runtime_role_works_inside_a_tenant_database_the_admin_created(self):
        self.assertEqual(self.cluster.sql('postgres', f"SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = '{self.database}'"), POSTGRES_ADMIN_ROLE)
        done = self.as_runtime(self.database, 'CREATE TABLE ir_module_module (id serial PRIMARY KEY, name text); INSERT INTO ir_module_module (name) VALUES (\'base\')')
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(self.owners(self.database), ['ir_module_module:odoo', 'ir_module_module_id_seq:odoo'])

    def test_the_runtime_role_cannot_create_databases_or_roles_or_run_programs(self):
        self.assertRefused('postgres', 'CREATE DATABASE liwan_role_test_rogue')
        self.assertRefused('postgres', 'CREATE ROLE rogue LOGIN')
        self.assertRefused(self.database, "COPY (SELECT 1) TO PROGRAM 'true'")
        self.assertRefused(self.database, 'CREATE TABLE t (c text); COPY t FROM PROGRAM \'echo x\'')

    def test_the_runtime_role_cannot_drop_or_alter_the_tenant_database(self):
        self.assertRefused('postgres', f'DROP DATABASE "{self.database}"')
        self.assertRefused('postgres', f'ALTER DATABASE "{self.database}" RENAME TO liwan_role_test_renamed')
        self.assertRefused('postgres', f'ALTER DATABASE "{self.database}" OWNER TO odoo')
        # A GRANT by a non-owner only warns; the database must still be closed to PUBLIC afterwards.
        self.as_runtime('postgres', f'GRANT CONNECT ON DATABASE "{self.database}" TO PUBLIC')
        self.assertEqual(self.public_connect(self.database), '0')
        self.assertTrue(self.cluster.exists(self.database))

    def test_a_tenant_database_is_closed_to_other_roles(self):
        self.cluster.sql('postgres', 'CREATE ROLE stranger LOGIN')
        self.addCleanup(self.cluster.sql, 'postgres', 'DROP ROLE stranger')
        done = subprocess.run(self.cluster.argv[:-1] + ['stranger', '-d', self.database, '-c', 'SELECT 1'], capture_output=True, check=False)
        self.assertNotEqual(done.returncode, 0)

    def test_the_assertion_passes_for_the_runtime_role_and_fails_once_it_gains_a_privilege(self):
        assertion = runtime_role_assertion_sql(ODOO_RUNTIME_ROLE, [self.database])
        self.cluster.sql('postgres', assertion)
        self.cluster.sql('postgres', 'ALTER ROLE odoo CREATEDB')
        try:
            with self.assertRaises(subprocess.CalledProcessError) as raised:
                self.cluster.sql('postgres', assertion)
            self.assertIn('privileged_or_missing_role', raised.exception.stderr.decode())
        finally:
            self.cluster.sql('postgres', 'ALTER ROLE odoo NOCREATEDB')
        self.cluster.sql('postgres', assertion)

    def test_the_assertion_fails_when_the_runtime_role_owns_a_tenant_database(self):
        self.cluster.sql('postgres', f'ALTER DATABASE "{self.database}" OWNER TO odoo')
        with self.assertRaises(subprocess.CalledProcessError) as raised:
            self.cluster.sql('postgres', runtime_role_assertion_sql(ODOO_RUNTIME_ROLE, [self.database]))
        self.assertIn('database_owner_rejected', raised.exception.stderr.decode())

    def dump(self, *options):
        done = subprocess.run([PG_DUMP, '-h', str(self.cluster.socket), '-p', self.cluster.port, '-U', POSTGRES_ADMIN_ROLE,
                               '--format=custom', *options, self.database], capture_output=True, check=True, env=self.environment)
        return done.stdout

    def restore(self, dump, target):
        """The real restore_database_script, pointed at the throwaway cluster instead of the restore-db service."""
        script = odoo_backup.restore_database_script(target).replace(
            '-h restore-db', f'-h {self.cluster.socket} -p {self.cluster.port}')
        self.assertNotIn('restore-db', script)
        done = subprocess.run(['sh', '-c', script, 'liwan-backup', target], input=dump, capture_output=True, check=False, env=self.environment)
        self.assertEqual(done.returncode, 0, done.stderr)

    def test_a_backup_and_restore_round_trip_returns_the_tables_to_the_runtime_role(self):
        self.as_runtime(self.database, 'CREATE TABLE res_partner (id serial PRIMARY KEY, name text); INSERT INTO res_partner (name) VALUES (\'ahmad\')')
        self.cluster.sql(self.database, 'CREATE SCHEMA liwan_ai AUTHORIZATION liwan_ai')
        # pg_dump --no-owner is ignored for an archive, so the dump with and without it restores the same owners.
        for options in ((), ('--no-owner',)):
            with self.subTest(dump_options=options):
                target = 'liwan_scratch_' + uuid.uuid4().hex
                self.addCleanup(self.drop, target)
                self.restore(self.dump(*options), target)
                self.assertEqual(self.cluster.sql(target, 'SELECT name FROM res_partner'), 'ahmad')
                self.assertEqual(self.owners(target), ['res_partner:odoo', 'res_partner_id_seq:odoo'])
                self.assertEqual(self.cluster.sql(target, "SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'liwan_ai'"), 'liwan_ai')
                self.assertEqual(self.cluster.sql('postgres', f"SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = '{target}'"), POSTGRES_ADMIN_ROLE)
                self.cluster.sql('postgres', runtime_role_assertion_sql(ODOO_RUNTIME_ROLE, [target]))
                done = self.as_runtime(target, 'INSERT INTO res_partner (name) VALUES (\'sara\'); CREATE TABLE after_restore (id int)')
                self.assertEqual(done.returncode, 0, done.stderr)

    def test_the_restored_database_is_closed_to_public(self):
        target = 'liwan_scratch_' + uuid.uuid4().hex
        self.addCleanup(self.drop, target)
        self.restore(self.dump(), target)
        self.assertEqual(self.public_connect(target), '0')


AI_INIT_SCRIPT = INIT_SCRIPT.parents[1] / 'ai' / 'init-db.sh'


@unittest.skipUnless(POSTGRES_AVAILABLE, 'initdb, pg_ctl and psql are required for the real PostgreSQL tests')
class InitScriptOrderTests(unittest.TestCase):
    """The image runs 10-liwan-runtime-role.sh and then 20-liwan-ai.sh on a fresh volume, both as the postgres role."""

    def test_the_runtime_role_still_reaches_the_postgres_database_after_the_ai_init_script(self):
        cluster = PostgresCluster()
        self.addCleanup(cluster.stop)
        cluster.sql('postgres', 'DROP ROLE odoo')
        binaries = str(Path(POSTGRES['psql']).parent)
        environment = {**os.environ, 'LC_ALL': 'C', 'LANG': 'C', 'PATH': binaries + os.pathsep + os.environ['PATH'],
                       'PGHOST': str(cluster.socket), 'PGPORT': cluster.port, 'POSTGRES_USER': POSTGRES_ADMIN_ROLE,
                       'ODOO_DB_PASSWORD': 'test-only-password', 'AI_DB_PASSWORD': 'test-only-ai-password'}
        for script in (INIT_SCRIPT, AI_INIT_SCRIPT):
            done = subprocess.run(['sh', str(script)], capture_output=True, check=False, env=environment)
            self.assertEqual(done.returncode, 0, (script.name, done.stderr))
        done = subprocess.run(cluster.argv[:-1] + [ODOO_RUNTIME_ROLE, '-X', '-At', '-d', 'postgres', '-c', 'SELECT 1'],
                              capture_output=True, check=False)
        self.assertEqual((done.returncode, done.stdout.decode().strip()), (0, '1'), done.stderr)
        # The AI role stays confined: it cannot reach the postgres database the runtime role may.
        done = subprocess.run(cluster.argv[:-1] + ['liwan_ai', '-X', '-At', '-d', 'postgres', '-c', 'SELECT 1'],
                              capture_output=True, check=False)
        self.assertNotEqual(done.returncode, 0)


if __name__ == '__main__':
    unittest.main()
