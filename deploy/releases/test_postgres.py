"""Infrastructure SQL guards never operate on Odoo business tables."""
import unittest
from .backup import Deadline
from .postgres import (validate_runtime_role, fence_runtime, fence_writers, writer_grants, runtime_role_fixture,
                       tenant_create_database_sql, tenant_isolation_sql, tenant_isolation_statements,
                       TENANT_EXTENSION_SQL, POSTGRES_ADMIN_ROLE, ODOO_RUNTIME_ROLE, RUNTIME_ROLE_RULES,
                       runtime_role_assertion_sql, tenant_schema_grant_sql, cluster_connect_grant_sql)


class Cursor:
    def __init__(self, connection): self.connection = connection
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def execute(self, sql, args=()):
        self.connection.commands.append((sql, args))
        self.sql, self.args = sql, args
        if 'pg_terminate_backend' in sql: self.connection.idle = []
    def fetchone(self):
        if 'pg_stat_activity' in self.sql:  # session counts and pg_terminate_backend
            return (self.connection.active,) if 'count(*)' in self.sql else (True,)
        if 'SELECT EXISTS (SELECT 1 FROM pg_database WHERE' in self.sql: return (self.connection.database_exists,)
        if 'FROM pg_roles WHERE' in self.sql:
            flags = self.connection.flags
            return (not (flags and len(flags) == 6 and flags[0] is True and not any(flags[1:])),)
        if 'aclexplode' in self.sql: return (self.connection.public,)
        if 'pg_database' in self.sql and 'datdba' in self.sql: return (self.connection.owner,)
        if 'pg_auth_members' in self.sql: return (self.connection.member,)
        if 'count(*)' in self.sql: return (self.connection.active,)
        return (True,)
    def fetchall(self):
        if 'has_database_privilege' in self.sql:
            return [(role, self.connection.grants[role]) for role in self.args[1] if role in self.connection.grants]
        if 'pg_stat_activity' in self.sql: return list(self.connection.idle)
        if 'pg_auth_members' in self.sql:  # transitive members of the authorized principals
            found, pending = [], [(role, role) for role in self.args[0]]
            while pending:
                role, via = pending.pop()
                for member in self.connection.members.get(role, []):
                    found.append((member, 'member_of:' + via)); pending.append((member, via))
            return found
        if 'aclexplode' in self.sql and 'pg_database' in self.sql:
            return [(role, 'connect') for role in self.connection.connect_principals]
        if 'datdba' in self.sql: return [(role, 'owner') for role in self.connection.owner_principals]
        if 'pg_class' in self.sql: return [(role, 'write') for role in self.connection.write_principals]
        return []


class Connection:
    def __init__(self, flags=(True, False, False, False, False, False), active=0, idle=()):
        self.flags, self.active, self.idle, self.commands = flags, active, idle, []
        self.public = self.owner = self.member = False
        self.database_exists = True
        self.grants = {'pool_old': True, 'pool_new': True}
        self.connect_principals = ['pool_old', 'pool_new', 'admin_role']
        self.write_principals = ['pool_old', 'pool_new']
        self.owner_principals = []
        self.members = {}
    def cursor(self): return Cursor(self)
    def commit(self): pass
    def rollback(self): pass
    def close(self): pass


def backup_binding(**overrides):
    return {'tenantId': 'a', 'database': 'tenant_a', 'fence': 2, 'gateClosed': True,
            'admittedWriters': 0, **overrides}


class TenantIsolationTests(unittest.TestCase):
    def test_public_connect_is_revoked_before_the_application_role_is_granted(self):
        sql = tenant_isolation_statements('tenant_a', 'odoo')
        self.assertEqual('REVOKE CONNECT ON DATABASE "tenant_a" FROM PUBLIC', sql[0])
        self.assertEqual('GRANT CONNECT ON DATABASE "tenant_a" TO "odoo"', sql[1])
        self.assertIn("a.grantee = 0 AND a.privilege_type = 'CONNECT'", sql[2])
        self.assertEqual(3, len(sql))

    def test_unsafe_identifiers_are_rejected_before_any_sql_is_built(self):
        for database, role in (('tenant"; DROP', 'odoo'), ('tenant_a', 'odoo; x'), ('Tenant', 'odoo')):
            with self.assertRaises(ValueError):
                tenant_isolation_sql(database, role)

    def test_shell_script_carries_the_same_statements_in_order(self):
        script = tenant_isolation_sql('tenant_a', 'odoo')
        self.assertLess(script.index('REVOKE CONNECT'), script.index('GRANT CONNECT'))
        self.assertLess(script.index('GRANT CONNECT'), script.index('public_connect_not_revoked'))
        self.assertTrue(script.endswith(';\n'))


class TenantCreationTests(unittest.TestCase):
    def test_create_statement_is_odoos_empty_database_recipe(self):
        self.assertEqual("CREATE DATABASE \"tenant_a\" ENCODING 'unicode' LC_COLLATE 'C' TEMPLATE template0",
                         tenant_create_database_sql('tenant_a'))
        self.assertEqual('CREATE EXTENSION IF NOT EXISTS pg_trgm', TENANT_EXTENSION_SQL)

    def test_unsafe_database_names_are_rejected(self):
        for database in ('tenant"; DROP', 'Tenant', '1db', 'bad-name'):
            with self.assertRaises(ValueError):
                tenant_create_database_sql(database)


class RuntimeRoleTests(unittest.TestCase):
    def test_role_names_are_distinct_valid_identifiers(self):
        self.assertEqual(('postgres', 'odoo'), (POSTGRES_ADMIN_ROLE, ODOO_RUNTIME_ROLE))

    def test_grants_quote_the_role_and_reject_unsafe_names(self):
        self.assertEqual('GRANT CREATE ON SCHEMA public TO "odoo"', tenant_schema_grant_sql('odoo'))
        self.assertEqual('GRANT CONNECT ON DATABASE "postgres" TO "odoo"', cluster_connect_grant_sql('odoo'))
        for build in (tenant_schema_grant_sql, cluster_connect_grant_sql):
            for role in ('odoo"; DROP', 'Odoo', 'odoo; x', ''):
                with self.assertRaises(ValueError):
                    build(role)

    def test_validate_keeps_its_reasons_per_rule(self):
        cases = {'privileged_or_missing_role': {'flags': None},
                 'role_membership_rejected': {'member': True},
                 'database_owner_rejected': {'owner': True},
                 'public_connect_rejected': {'public': True},
                 'database_missing': {'database_exists': False}}
        for reason, attributes in cases.items():
            connection = Connection()
            for name, value in attributes.items(): setattr(connection, name, value)
            self.assertEqual([reason], validate_runtime_role(connection, 'odoo', 'tenant_a')['reasons'])
        self.assertEqual(['privileged_or_missing_role', 'role_membership_rejected', 'database_owner_rejected'],
                         [reason for reason, _ in RUNTIME_ROLE_RULES])

    def test_validate_runs_each_rule_with_role_and_database_parameters(self):
        connection = Connection()
        validate_runtime_role(connection, 'odoo', 'tenant_a')
        rule_calls = [args for sql, args in connection.commands if isinstance(args, dict)]
        self.assertEqual(3, len(rule_calls))
        self.assertTrue(all(args == {'role': 'odoo', 'databases': ['tenant_a']} for args in rule_calls))

    def test_assertion_raises_the_reason_of_every_rule(self):
        sql = runtime_role_assertion_sql('odoo', ['tenant_a', 'tenant_b'])
        self.assertTrue(sql.startswith('DO $$ BEGIN ') and sql.endswith(' END $$'))
        for reason, _ in RUNTIME_ROLE_RULES:
            self.assertIn(f"RAISE EXCEPTION '{reason}'", sql)
        self.assertEqual(len(RUNTIME_ROLE_RULES), sql.count('RAISE EXCEPTION'))
        for attribute in ('rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolreplication', 'rolbypassrls', 'rolcanlogin'):
            self.assertIn(attribute, sql)
        self.assertIn('pg_auth_members', sql)
        self.assertIn("d.datname = ANY(ARRAY['tenant_a', 'tenant_b']::text[])", sql)
        self.assertIn("rolname = 'odoo'", sql)
        self.assertNotIn('%(', sql)

    def test_assertion_accepts_no_databases_and_rejects_unsafe_input(self):
        self.assertIn('ARRAY[]::text[]', runtime_role_assertion_sql('odoo', []))
        for role, databases in (('odoo"; x', []), ("od'oo", []), ('odoo', ['tenant"; DROP']), ('odoo', ["a'b"]),
                                ('odoo', ['Tenant']), ('Odoo', [])):
            with self.assertRaises(ValueError):
                runtime_role_assertion_sql(role, databases)
        with self.assertRaises(ValueError):
            runtime_role_assertion_sql('odoo', 'tenant_a')


class PostgresTests(unittest.TestCase):
    def test_unsafe_runtime_roles_are_rejected(self):
        for index in range(1, 6):
            flags = [True, False, False, False, False, False]; flags[index] = True
            result = validate_runtime_role(Connection(tuple(flags)), 'pool_old', 'tenant_a')
            self.assertFalse(result['valid'])
        self.assertTrue(validate_runtime_role(Connection(), 'pool_old', 'tenant_a')['valid'])

    def test_nonexistent_database_cannot_receive_a_valid_role_receipt(self):
        connection = Connection(); connection.database_exists = False
        self.assertFalse(validate_runtime_role(connection, 'pool_old', 'tenant_missing')['valid'])

    def test_owner_membership_and_public_connect_each_block_fencing(self):
        for attribute in ('owner', 'member', 'public'):
            connection = Connection(); setattr(connection, attribute, True)
            result = validate_runtime_role(connection, 'pool_old', 'tenant_a')
            self.assertFalse(result['valid'])

    def test_active_business_work_is_not_killed_or_new_role_granted(self):
        connection = Connection(active=1, idle=[(12,)])
        result = fence_runtime({'tenantId': 'a', 'database': 'tenant_a', 'fence': 2, 'gateClosed': True, 'admittedWriters': 0},
                               'pool_old', 'pool_new', lambda db: connection, deadline_seconds=0)
        self.assertFalse(result['fenced'])
        sql = '\n'.join(command for command, _ in connection.commands)
        self.assertIn('REVOKE CONNECT', sql)
        self.assertNotIn('pg_terminate_backend', sql)
        self.assertNotIn('GRANT CONNECT', sql)

    def test_idle_old_connections_are_removed_only_after_transaction_check(self):
        connection = Connection(idle=[(12,)])
        result = fence_runtime({'tenantId': 'a', 'database': 'tenant_a', 'fence': 2, 'gateClosed': True, 'admittedWriters': 0},
                               'pool_old', 'pool_new', lambda db: connection, deadline_seconds=0)
        self.assertTrue(result['fenced'])
        commands = [command for command, _ in connection.commands]
        self.assertLess(next(i for i, cmd in enumerate(commands) if 'count(*)' in cmd),
                        next(i for i, cmd in enumerate(commands) if 'pg_terminate_backend' in cmd))
        self.assertIn('GRANT CONNECT', commands[-1])

    def test_missing_admission_barrier_refuses_before_database_effects(self):
        connection = Connection()
        with self.assertRaises(ValueError):
            fence_runtime({'database': 'tenant_a', 'fence': 2}, 'pool_old', 'pool_new', lambda db: connection)
        self.assertFalse(connection.commands)

    def test_identifiers_cannot_inject_and_fixture_separates_owner(self):
        with self.assertRaises(ValueError):
            runtime_role_fixture('tenant_a; DROP DATABASE postgres', 'bootstrap', ['pool_old'])
        statements = runtime_role_fixture('tenant_a', 'bootstrap', ['pool_old', 'pool_new'])
        sql = '\n'.join(statements)
        self.assertIn('REVOKE CONNECT ON DATABASE "tenant_a" FROM PUBLIC', sql)
        self.assertIn('NOCREATEDB', sql)
        self.assertIn('ON ALL SEQUENCES IN SCHEMA public', sql)
        self.assertNotIn('SUPERUSER LOGIN', sql)

    def test_release_swap_grants_candidate_and_backup_window_denies_every_writer(self):
        # The release fence legitimately admits the candidate generation; the
        # backup window must deny both, so a candidate cannot write during the dump.
        connection = Connection()
        swapped = fence_runtime(backup_binding(), 'pool_old', 'pool_new', lambda db: connection, deadline_seconds=0)
        self.assertTrue(swapped['fenced'])
        self.assertIn('GRANT CONNECT', connection.commands[-1][0])
        connection.commands.clear()
        window = fence_writers(backup_binding(), ('pool_old', 'pool_new'), lambda db, **_: connection,
                               allowed_principals=('admin_role',), deadline=Deadline(30), drain_seconds=0)
        self.assertTrue(window['fenced'])
        self.assertEqual(window['deniedWriters'], ['pool_old', 'pool_new'])
        self.assertEqual(window['writerConnections'], 0)
        sql = '\n'.join(command for command, _ in connection.commands)
        self.assertIn('REVOKE CONNECT ON DATABASE "tenant_a" FROM "pool_old"', sql)
        self.assertIn('REVOKE CONNECT ON DATABASE "tenant_a" FROM "pool_new"', sql)
        self.assertNotIn('GRANT CONNECT', sql)

    def test_unsupported_writer_principal_refuses_before_any_effect(self):
        connection = Connection(); connection.connect_principals = ['pool_old', 'pool_new', 'stray_writer']
        result = fence_writers(backup_binding(), ('pool_old', 'pool_new'), lambda db, **_: connection,
                               allowed_principals=('admin_role',), deadline=Deadline(30), drain_seconds=0)
        self.assertFalse(result['fenced'])
        self.assertEqual(result['reason'], 'unsupported_writer_principal')
        self.assertEqual(result['principals'], ['stray_writer'])
        effects = [command for command, _ in connection.commands if command.startswith(('REVOKE', 'GRANT')) or 'pg_terminate_backend' in command]
        self.assertFalse(effects)

    def test_login_inheriting_a_declared_writer_refuses_the_window(self):
        # An undeclared login that is a member of a declared writer keeps the
        # inherited table privileges after the CONNECT revocation; its idle
        # session must never be accepted as fenced.
        connection = Connection(idle=[(21,)])
        connection.members = {'pool_old': ['stray_group'], 'stray_group': ['stray_login']}
        result = fence_writers(backup_binding(), ('pool_old', 'pool_new'), lambda db, **_: connection,
                               allowed_principals=('admin_role',), deadline=Deadline(30), drain_seconds=0)
        self.assertFalse(result['fenced'])
        self.assertEqual(result['reason'], 'unsupported_writer_principal')
        self.assertEqual(result['principals'], ['stray_group', 'stray_login'])
        effects = [command for command, _ in connection.commands if command.startswith(('REVOKE', 'GRANT')) or 'pg_terminate_backend' in command]
        self.assertFalse(effects)

    def test_writer_sessions_include_logins_that_are_members_of_a_writer(self):
        connection = Connection(idle=[(12,)])
        fence_writers(backup_binding(), ('pool_old', 'pool_new'), lambda db, **_: connection,
                      allowed_principals=('admin_role',), deadline=Deadline(30), drain_seconds=0)
        session_queries = [command for command, _ in connection.commands if 'pg_stat_activity' in command and 'usename' in command]
        self.assertTrue(session_queries)
        for command in session_queries:
            self.assertIn('pg_auth_members', command)
            self.assertNotIn('usename = ANY', command)

    def test_unverifiable_writer_authority_refuses_the_window(self):
        connection = Connection()
        original = Cursor.fetchall
        def broken(self):
            if 'aclexplode' in self.sql: raise RuntimeError('catalog unavailable')
            return original(self)
        Cursor.fetchall = broken
        try:
            result = fence_writers(backup_binding(), ('pool_old', 'pool_new'), lambda db, **_: connection, deadline=Deadline(30), drain_seconds=0)
        finally:
            Cursor.fetchall = original
        self.assertFalse(result['fenced'])
        self.assertEqual(result['reason'], 'writer_authority_unverifiable')

    def test_active_writer_transaction_is_waited_for_and_never_killed(self):
        connection = Connection(active=1, idle=[(12,)])
        result = fence_writers(backup_binding(), ('pool_old', 'pool_new'), lambda db, **_: connection,
                               allowed_principals=('admin_role',), deadline=Deadline(30), drain_seconds=0)
        self.assertFalse(result['fenced'])
        self.assertEqual(result['reason'], 'active_transactions')
        sql = '\n'.join(command for command, _ in connection.commands)
        self.assertIn('REVOKE CONNECT ON DATABASE "tenant_a" FROM "pool_new"', sql)
        self.assertNotIn('pg_terminate_backend', sql)
        self.assertNotIn('GRANT CONNECT', sql)

    def test_idle_sessions_of_every_writer_role_are_retired(self):
        connection = Connection(idle=[(12,), (13,)])
        result = fence_writers(backup_binding(), ('pool_old', 'pool_new'), lambda db, **_: connection,
                               allowed_principals=('admin_role',), deadline=Deadline(30), drain_seconds=0)
        self.assertTrue(result['fenced'])
        terminate = [args for command, args in connection.commands if 'pg_terminate_backend' in command]
        self.assertEqual(len(terminate), 2)
        for _, database, roles in terminate:
            self.assertEqual(database, 'tenant_a')
            self.assertEqual(roles, ['pool_old', 'pool_new'])

    def test_writer_roles_must_be_a_closed_unique_identifier_set(self):
        connection = Connection()
        for roles in [(), ('pool_old', 'pool_old'), ('pool_old', 'bad role'), 'pool_old']:
            with self.subTest(roles=roles), self.assertRaises(ValueError):
                fence_writers(backup_binding(), roles, lambda db, **_: connection, deadline=Deadline(30))
        self.assertFalse(connection.commands)

    def test_writer_grants_reports_durable_admission_per_role(self):
        connection = Connection(); connection.grants = {'pool_old': True, 'pool_new': False}
        self.assertEqual(writer_grants(connection, ('pool_old', 'pool_new'), 'tenant_a'),
                         {'pool_old': True, 'pool_new': False})
        connection.grants = {}
        with self.assertRaises(ValueError): writer_grants(connection, ('pool_old',), 'tenant_a')


if __name__ == '__main__': unittest.main()
