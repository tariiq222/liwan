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

from deploy.release.databases import snapshot_sql, swap_sql
from deploy.release.tenant_postgres import (
    ODOO_RUNTIME_ROLE, POSTGRES_ADMIN_ROLE, runtime_role_assertion_sql, tenant_bootstrap_sql, tenant_create_database_sql,
    tenant_isolation_sql,
)
from tools.shared_saas_lifecycle import odoo_backup
from tools.shared_saas_lifecycle.odoo_effect import AI_TENANT_SCHEMA
from tools.shared_saas_lifecycle.test_tenant_drop_effect import (
    POSTGRES, POSTGRES_AVAILABLE, PostgresCluster, assert_no_hostile_effect, hostile_effects, plant_hostile_code, postgres_binary,
    reset_hostile_effects,
)

INIT_SCRIPT = Path(__file__).resolve().parents[2] / 'deploy' / 'db' / 'init-runtime-role.sh'
PG_DUMP, PG_RESTORE = postgres_binary('pg_dump'), postgres_binary('pg_restore')
ENVIRONMENT = {'POSTGRES_PASSWORD': 'unused-under-trust-auth', 'ODOO_DB_PASSWORD': 'unused-under-trust-auth', 'AI_DB_PASSWORD': 'unused-under-trust-auth'}


def cluster_environment(cluster):
    binaries = str(Path(POSTGRES['psql']).parent)
    return {**os.environ, 'LC_ALL': 'C', 'LANG': 'C', 'PATH': binaries + os.pathsep + os.environ['PATH'],
            'PGHOST': str(cluster.socket), 'PGPORT': cluster.port, **ENVIRONMENT}


def create_tenant(cluster, database, *, ai_skeleton=True):
    """What the lifecycle tools run as the admin role: create, close to PUBLIC, bootstrap, then the AI schema skeleton."""
    cluster.sql('postgres', tenant_create_database_sql(database) + ';\n' + tenant_isolation_sql(database, ODOO_RUNTIME_ROLE))
    cluster.sql(database, tenant_bootstrap_sql(ODOO_RUNTIME_ROLE))
    if ai_skeleton:
        done = subprocess.run(cluster.argv[:-1] + ['postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'tenant_db=' + database, '-d', 'postgres',
                                                   '-f', str(AI_TENANT_SCHEMA)], capture_output=True, check=False)
        assert done.returncode == 0, done.stderr


def run_stage(cluster, script, target, dump):
    """One restore stage, with the restore-db host replaced by the throwaway cluster."""
    script = script.replace('-h restore-db', f'-h {cluster.socket} -p {cluster.port}')
    assert 'restore-db' not in script
    return subprocess.run(['sh', '-c', script, 'liwan-backup', target], input=dump, capture_output=True, check=False, env=cluster_environment(cluster))


def restore_stages(cluster, dump, target):
    """The real stages of BackupRunner._restore_operation, in order; returns the completed processes."""
    return [run_stage(cluster, script, target, dump) for script in (odoo_backup.create_database_script(target), odoo_backup.restore_database_script(target), odoo_backup.restore_ai_script())]


@unittest.skipUnless(POSTGRES_AVAILABLE and PG_DUMP and PG_RESTORE, 'initdb, pg_ctl, psql, pg_dump and pg_restore are required for the real PostgreSQL tests')
class RuntimeRoleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cluster = PostgresCluster()
        # The shared harness creates a plain `odoo` login role; replace it with the one the init script makes.
        cls.cluster.sql('postgres', 'DROP ROLE odoo; CREATE ROLE liwan_ai LOGIN')
        cls.environment = cluster_environment(cls.cluster)
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

    def create_tenant(self, database, **options):
        create_tenant(self.cluster, database, **options)

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
        """The real restore stages, pointed at the throwaway cluster instead of the restore-db service."""
        for stage in restore_stages(self.cluster, dump, target):
            self.assertEqual(stage.returncode, 0, stage.stderr)

    def source_with_ai_table(self):
        """Rows, an AI table owned by liwan_ai that odoo may insert into (the outbox grant), then the hostile fixture."""
        self.as_runtime(self.database, "CREATE TABLE ir_config_parameter (key text PRIMARY KEY, value text); "
                                       "INSERT INTO ir_config_parameter VALUES ('a', '1'), ('b', '2'); "
                                       "CREATE TABLE res_partner (id serial PRIMARY KEY, name text); INSERT INTO res_partner (name) VALUES ('ahmad')").check_returncode()
        self.cluster.sql(self.database, 'CREATE TABLE liwan_ai.ai_outbox (id serial PRIMARY KEY, body text); '
                                        'GRANT INSERT ON liwan_ai.ai_outbox TO odoo; GRANT USAGE ON SEQUENCE liwan_ai.ai_outbox_id_seq TO odoo; '
                                        "INSERT INTO liwan_ai.ai_outbox (body) VALUES ('queued')", role='liwan_ai')

    def marker(self):
        directory = tempfile.mkdtemp(prefix='ldp-marker-')
        self.addCleanup(shutil.rmtree, directory, True)
        return Path(directory) / 'program-ran'

    def target(self):
        target = 'liwan_scratch_' + uuid.uuid4().hex
        self.addCleanup(self.drop, target)
        return target

    def test_a_backup_and_restore_round_trip_returns_the_tables_to_their_owning_roles(self):
        self.source_with_ai_table()
        # pg_dump --no-owner is ignored for an archive, so the dump with and without it restores the same owners.
        for options in ((), ('--no-owner',)):
            with self.subTest(dump_options=options):
                target = self.target()
                self.restore(self.dump(*options), target)
                self.assertEqual(self.cluster.sql(target, 'SELECT name FROM res_partner'), 'ahmad')
                self.assertEqual(self.cluster.sql(target, 'SELECT body FROM liwan_ai.ai_outbox', role='liwan_ai'), 'queued')
                self.assertEqual(self.owners(target), ['ir_config_parameter:odoo', 'res_partner:odoo', 'res_partner_id_seq:odoo'])
                self.assertEqual(self.cluster.sql(target, "SELECT relname || ':' || pg_get_userbyid(relowner) FROM pg_class WHERE relnamespace = 'liwan_ai'::regnamespace "
                                                          "AND relkind IN ('r', 'S') ORDER BY 1"), 'ai_outbox:liwan_ai\nai_outbox_id_seq:liwan_ai')
                self.assertEqual(self.cluster.sql(target, "SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'liwan_ai'"), 'liwan_ai')
                self.assertEqual(self.cluster.sql(target, "SELECT string_agg(extname || ':' || pg_get_userbyid(extowner), ',' ORDER BY extname) FROM pg_extension WHERE extname <> 'plpgsql'"),
                                 'pg_trgm:postgres,pgcrypto:postgres,vector:postgres')
                self.assertEqual(self.cluster.sql('postgres', f"SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = '{target}'"), POSTGRES_ADMIN_ROLE)
                self.cluster.sql('postgres', runtime_role_assertion_sql(ODOO_RUNTIME_ROLE, [target]))
                # Odoo keeps its AI queue grants: the schema USAGE from the skeleton and the table grants the liwan_ai pass restored.
                done = self.as_runtime(target, "INSERT INTO liwan_ai.ai_outbox (body) VALUES ('again'); INSERT INTO res_partner (name) VALUES ('sara'); CREATE TABLE after_restore (id int)")
                self.assertEqual(done.returncode, 0, done.stderr)

    def test_planted_code_runs_only_as_the_owning_non_superuser_role_through_a_whole_restore(self):
        self.source_with_ai_table()
        marker = self.marker()
        plant_hostile_code(self.cluster, self.database, marker)
        assert_no_hostile_effect(self, self.cluster, marker)
        target = self.target()
        self.restore(self.dump(), target)
        # The fixture was reached by the restore (CHECK, both index builds and the materialized view refresh; triggers are created after the data), every time as plain `odoo`.
        tags = assert_no_hostile_effect(self, self.cluster, marker, target)
        self.assertTrue({'check', 'index', 'predicate', 'view'} <= tags, tags)
        self.assertEqual(hostile_effects(self.cluster, marker), {'newRoles': [], 'superusers': [], 'programRan': False})
        self.assertEqual(self.owners(target)[:2], ['evil_log:odoo', 'ir_config_parameter:odoo'])
        self.assertEqual(self.cluster.sql(target, "SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND pg_get_userbyid(relowner) <> 'odoo' "
                                                  "AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = pg_class.oid AND d.deptype = 'e')"), '0')
        self.cluster.sql('postgres', runtime_role_assertion_sql(ODOO_RUNTIME_ROLE, [target]))

    def test_the_old_superuser_restore_would_have_been_exploited_by_the_same_fixture(self):
        """Control: the fixture bites. The pre-change restore (admin session, dumped owners) lets planted code reach superuser power."""
        self.source_with_ai_table()
        marker = self.marker()
        plant_hostile_code(self.cluster, self.database, marker)
        target = self.target()
        self.cluster.sql('postgres', f'CREATE DATABASE "{target}"')
        self.addCleanup(reset_hostile_effects, self.cluster, marker)
        subprocess.run([PG_RESTORE, '-h', str(self.cluster.socket), '-p', self.cluster.port, '-U', POSTGRES_ADMIN_ROLE, '--exit-on-error',
                        '--single-transaction', '-d', target], input=self.dump(), capture_output=True, check=False, env=self.environment)
        effects = hostile_effects(self.cluster, marker)
        self.assertTrue(effects['newRoles'] or effects['superusers'] or effects['programRan'], effects)

    def test_the_fixed_admin_scripts_leave_no_trace_on_a_database_full_of_planted_code(self):
        self.source_with_ai_table()
        marker = self.marker()
        plant_hostile_code(self.cluster, self.database, marker)
        self.cluster.sql(self.database, tenant_bootstrap_sql(ODOO_RUNTIME_ROLE))
        done = subprocess.run(self.cluster.argv[:-1] + ['postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'tenant_db=' + self.database, '-d', 'postgres',
                                                        '-f', str(AI_TENANT_SCHEMA)], capture_output=True, check=False)
        self.assertEqual(done.returncode, 0, done.stderr)
        # Nothing ran at all: the admin scripts read no tenant table and call nothing outside pg_catalog.
        self.assertEqual(assert_no_hostile_effect(self, self.cluster, marker, self.database), set())

    def test_a_snapshot_and_rename_of_a_restored_database_keeps_the_runtime_role_create_on_public(self):
        """deploy/release/databases.py: CREATE DATABASE .. TEMPLATE .. STRATEGY FILE_COPY, then the swap rename."""
        self.source_with_ai_table()
        target = self.target()
        self.restore(self.dump(), target)
        self.cluster.sql('postgres', snapshot_sql(target))
        self.cluster.sql('postgres', swap_sql(target, live=True))
        self.cluster.sql('postgres', f'ALTER DATABASE "{target}" ALLOW_CONNECTIONS true')
        self.assertEqual(self.cluster.sql(target, "SELECT has_schema_privilege('odoo', 'public', 'CREATE')"), 't')
        self.assertEqual(self.cluster.sql(target, "SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'liwan_ai'"), 'liwan_ai')
        self.assertEqual(self.cluster.sql(target, "SELECT has_schema_privilege('odoo', 'liwan_ai', 'USAGE')"), 't')
        done = self.as_runtime(target, 'CREATE TABLE after_swap (id int)')
        self.assertEqual(done.returncode, 0, done.stderr)

    def test_a_failed_odoo_phase_is_dropped_whole_by_the_drop_stage(self):
        target = self.target()
        script = odoo_backup.restore_database_script(target)
        self.assertEqual(run_stage(self.cluster, odoo_backup.create_database_script(target), target, b'').returncode, 0)
        failed = run_stage(self.cluster, script, target, b'this is not a dump archive')
        self.assertNotEqual(failed.returncode, 0)
        # The admin prepared the target before the archive was read, so it exists half-built until the drop stage runs.
        self.assertTrue(self.cluster.exists(target))
        dropped = run_stage(self.cluster, odoo_backup.drop_target_script(target), target, b'')
        self.assertEqual(dropped.returncode, 0, dropped.stderr)
        self.assertFalse(self.cluster.exists(target))
        # Dropping an absent database is not an error: the stage also covers a failure before the create.
        self.assertEqual(run_stage(self.cluster, odoo_backup.drop_target_script(target), target, b'').returncode, 0)

    def test_the_liwan_ai_phase_without_an_ai_password_fails_when_the_cluster_has_the_ai_role(self):
        self.source_with_ai_table()
        target = self.target()
        dump = self.dump()
        for script in (odoo_backup.create_database_script(target), odoo_backup.restore_database_script(target)):
            self.assertEqual(run_stage(self.cluster, script, target, dump).returncode, 0)
        script = odoo_backup.restore_ai_script().replace('-h restore-db', f'-h {self.cluster.socket} -p {self.cluster.port}')
        refused = subprocess.run(['sh', '-c', script, 'liwan-backup', target], input=dump, capture_output=True, check=False,
                                 env={**self.environment, 'AI_DB_PASSWORD': ''})
        self.assertEqual(refused.returncode, 1)
        self.assertIn(b'ai_password_missing', refused.stderr)
        self.assertEqual(self.cluster.sql(target, "SELECT count(*) FROM pg_class WHERE relnamespace = 'liwan_ai'::regnamespace AND relkind = 'r'"), '0')

    def test_a_dump_without_the_ai_schema_restores_with_an_empty_ai_phase(self):
        self.drop(self.database)
        self.create_tenant(self.database, ai_skeleton=False)
        self.as_runtime(self.database, 'CREATE TABLE res_partner (id serial PRIMARY KEY, name text); INSERT INTO res_partner (name) VALUES (\'ahmad\')').check_returncode()
        target = self.target()
        self.restore(self.dump(), target)
        self.assertEqual(self.cluster.sql(target, 'SELECT name FROM res_partner'), 'ahmad')
        self.assertEqual(self.cluster.sql(target, "SELECT count(*) FROM pg_class WHERE relnamespace = 'liwan_ai'::regnamespace AND relkind = 'r'"), '0')

    def test_the_restored_database_is_closed_to_public(self):
        target = self.target()
        self.restore(self.dump(), target)
        self.assertEqual(self.public_connect(target), '0')


@unittest.skipUnless(POSTGRES_AVAILABLE and PG_DUMP and PG_RESTORE, 'initdb, pg_ctl, psql, pg_dump and pg_restore are required for the real PostgreSQL tests')
class RestoreWithoutAiRoleTests(unittest.TestCase):
    """A deployment without AI: the cluster has no liwan_ai role, so the skeleton is a no-op and the AI phase drains."""

    def test_the_two_stages_restore_a_tenant_when_the_cluster_has_no_ai_role(self):
        cluster = PostgresCluster()
        self.addCleanup(cluster.stop)
        source, target = 'liwan_role_noai_src', 'liwan_scratch_' + uuid.uuid4().hex
        create_tenant(cluster, source)
        cluster.sql(source, 'CREATE TABLE res_partner (id serial PRIMARY KEY, name text); INSERT INTO res_partner (name) VALUES (\'ahmad\')', role='odoo')
        dump = subprocess.run([PG_DUMP, '-h', str(cluster.socket), '-p', cluster.port, '-U', POSTGRES_ADMIN_ROLE, '--format=custom', source],
                              capture_output=True, check=True, env=cluster_environment(cluster)).stdout
        stages = [run_stage(cluster, odoo_backup.create_database_script(target), target, dump),
                  run_stage(cluster, odoo_backup.restore_database_script(target), target, dump)]
        script = odoo_backup.restore_ai_script().replace('-h restore-db', f'-h {cluster.socket} -p {cluster.port}')
        stages.append(subprocess.run(['sh', '-c', script, 'liwan-backup', target], input=dump, capture_output=True, check=False,
                                     env={**cluster_environment(cluster), 'AI_DB_PASSWORD': ''}))
        self.assertEqual([stage.returncode for stage in stages], [0, 0, 0], [stage.stderr for stage in stages])
        self.assertEqual(cluster.sql(target, 'SELECT name FROM res_partner'), 'ahmad')
        self.assertEqual(cluster.sql(target, "SELECT count(*) FROM pg_namespace WHERE nspname = 'liwan_ai'"), '0')


    def test_a_dump_with_ai_data_is_refused_when_the_cluster_has_no_ai_role(self):
        cluster = PostgresCluster()
        self.addCleanup(cluster.stop)
        source, target = 'liwan_role_aidata_src', 'liwan_scratch_' + uuid.uuid4().hex
        create_tenant(cluster, source, ai_skeleton=False)
        cluster.sql(source, "CREATE TABLE res_partner (id serial PRIMARY KEY, name text); CREATE SCHEMA liwan_ai; CREATE TABLE liwan_ai.chunks (id integer); INSERT INTO liwan_ai.chunks VALUES (1)")
        dump = subprocess.run([PG_DUMP, '-h', str(cluster.socket), '-p', cluster.port, '-U', POSTGRES_ADMIN_ROLE, '--format=custom', source],
                              capture_output=True, check=True, env=cluster_environment(cluster)).stdout
        for script in (odoo_backup.create_database_script(target), odoo_backup.restore_database_script(target)):
            self.assertEqual(run_stage(cluster, script, target, dump).returncode, 0)
        script = odoo_backup.restore_ai_script().replace('-h restore-db', f'-h {cluster.socket} -p {cluster.port}')
        refused = subprocess.run(['sh', '-c', script, 'liwan-backup', target], input=dump, capture_output=True, check=False,
                                 env={**cluster_environment(cluster), 'AI_DB_PASSWORD': ''})
        self.assertEqual(refused.returncode, 1)
        self.assertIn(b'ai_data_without_role', refused.stderr)
        # The runner drops the fresh target on any failed stage; the drop stage itself removes it here.
        self.assertEqual(run_stage(cluster, odoo_backup.drop_target_script(target), target, b'').returncode, 0)
        self.assertFalse(cluster.exists(target))


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
