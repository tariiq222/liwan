"""The runtime's own PostgreSQL logins: admin sessions are pinned to pg_catalog, tenant tables are read as the owning role."""
import sys
import types
import unittest
from unittest import mock

from deploy.releases.runtime import LocalRuntime

CONFIG = {'mode': 'local', 'postgres': {'host': '127.0.0.1', 'port': 5432, 'adminUser': 'postgres', 'passfile': '/etc/liwan/pgpass'}}


class ConnectTests(unittest.TestCase):
    def connect(self, method, database, **options):
        calls = []
        fake = types.SimpleNamespace(connect=lambda **kwargs: calls.append(kwargs))
        runtime = LocalRuntime(mock.Mock(), CONFIG)
        with mock.patch.dict(sys.modules, {'psycopg2': fake}):
            getattr(runtime, method)(database, **options)
        return calls[0]

    def test_an_admin_session_is_pinned_to_pg_catalog(self):
        login = self.connect('connector', 'liwan_scratch_a', connect_timeout=5)
        self.assertEqual((login['user'], login['options'], login['connect_timeout']), ('postgres', '-c search_path=pg_catalog', 5))
        self.assertEqual(login['passfile'], '/etc/liwan/pgpass')

    def test_a_tenant_session_logs_in_as_the_owning_role_and_keeps_the_default_path(self):
        login = self.connect('tenant_connector', 'liwan_scratch_a')
        self.assertEqual(login['user'], 'odoo')
        self.assertNotIn('options', login)

    def test_a_tenant_session_in_database_postgres_is_the_admin_role(self):
        self.assertEqual(self.connect('tenant_connector', 'postgres')['user'], 'postgres')

    def test_a_malformed_database_name_is_refused_before_any_login(self):
        with self.assertRaisesRegex(ValueError, '^database_identifier_rejected$'):
            self.connect('tenant_connector', 'x"; --')


if __name__ == '__main__':
    unittest.main()
