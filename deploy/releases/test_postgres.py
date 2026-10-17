"""Infrastructure SQL guards never operate on Odoo business tables."""
import unittest
from .postgres import validate_runtime_role, fence_runtime, runtime_role_fixture


class Cursor:
    def __init__(self, connection): self.connection = connection
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def execute(self, sql, args=()):
        self.connection.commands.append((sql, args))
        self.sql = sql
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
        if 'pg_stat_activity' in self.sql: return list(self.connection.idle)
        return []


class Connection:
    def __init__(self, flags=(True, False, False, False, False, False), active=0, idle=()):
        self.flags, self.active, self.idle, self.commands = flags, active, idle, []
        self.public = self.owner = self.member = False
        self.database_exists = True
    def cursor(self): return Cursor(self)
    def commit(self): pass
    def rollback(self): pass
    def close(self): pass


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


if __name__ == '__main__': unittest.main()
