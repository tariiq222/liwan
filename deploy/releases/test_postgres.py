"""Infrastructure SQL guards never operate on Odoo business tables."""
import unittest
from .backup import Deadline
from .postgres import validate_runtime_role, fence_runtime, fence_writers, writer_grants, runtime_role_fixture


class Cursor:
    def __init__(self, connection): self.connection = connection
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def execute(self, sql, args=()):
        self.connection.commands.append((sql, args))
        self.sql, self.args = sql, args
        if 'pg_terminate_backend' in sql: self.connection.idle = []
    def fetchone(self):
        if 'SELECT EXISTS (SELECT 1 FROM pg_database WHERE' in self.sql: return (self.connection.database_exists,)
        if 'FROM pg_roles WHERE' in self.sql: return self.connection.flags
        if 'aclexplode' in self.sql: return (self.connection.public,)
        if 'pg_database' in self.sql and 'datdba' in self.sql: return (self.connection.owner,)
        if 'pg_auth_members' in self.sql: return (self.connection.member,)
        if 'count(*)' in self.sql: return (self.connection.active,)
        return (True,)
    def fetchall(self):
        if 'has_database_privilege' in self.sql:
            return [(role, self.connection.grants[role]) for role in self.args[1] if role in self.connection.grants]
        if 'pg_stat_activity' in self.sql: return list(self.connection.idle)
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
    def cursor(self): return Cursor(self)
    def commit(self): pass
    def rollback(self): pass
    def close(self): pass


def backup_binding(**overrides):
    return {'tenantId': 'a', 'database': 'tenant_a', 'fence': 2, 'gateClosed': True,
            'admittedWriters': 0, **overrides}


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
