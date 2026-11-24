# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Database selection of the shared runtime role (`odoo-addons/liwan_shared_dbselect`).

The SQL and the function run against a real throwaway PostgreSQL server as a plain role (NOSUPERUSER NOCREATEDB) that holds
an explicit CONNECT grant on tenant databases it does not own, with Odoo stubbed. The hook wiring is tested with stub
modules. `RealOdooTests` runs the real `odoo.http.db_list` and `cron_database_list` and needs a Python that imports Odoo
(for example `/Users/tariq/code/odoo/.venv/bin/python`); it is skipped otherwise.
"""
import importlib.util
import os
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[2]
MODULE_PATH = REPO / 'odoo-addons' / 'liwan_shared_dbselect' / '__init__.py'
sys.path.insert(0, str(REPO))
from tools.shared_saas_lifecycle.test_tenant_drop_effect import (  # noqa: E402
    POSTGRES_AVAILABLE,
    PostgresCluster,
)

try:
    import odoo.http
    import odoo.service.server
    ODOO_AVAILABLE = True
except Exception:  # noqa: BLE001 - any import failure means this Python cannot run the Odoo tests
    ODOO_AVAILABLE = False


def load_module():
    spec = importlib.util.spec_from_file_location('liwan_shared_dbselect_under_test', MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def build_databases(cluster):
    cluster.sql('postgres', 'CREATE ROLE other_runtime LOGIN')
    for name in ('tenant_a', 'tenant_b', 'closed', 'granted_elsewhere'):
        cluster.sql('postgres', f'CREATE DATABASE {name}')
        cluster.sql('postgres', f'REVOKE CONNECT ON DATABASE {name} FROM PUBLIC')
    cluster.sql('postgres', 'GRANT CONNECT ON DATABASE tenant_a, tenant_b, closed TO odoo')
    cluster.sql('postgres', 'GRANT CONNECT ON DATABASE granted_elsewhere TO other_runtime')
    cluster.sql('postgres', 'ALTER DATABASE closed WITH ALLOW_CONNECTIONS false')
    cluster.sql('postgres', 'CREATE DATABASE other')  # default ACL: PUBLIC holds CONNECT, odoo holds no explicit grant
    # deploy/db/init-runtime-role.sh grants the runtime role an explicit CONNECT on `postgres`; only the name list keeps it out.
    cluster.sql('postgres', 'GRANT CONNECT ON DATABASE postgres TO odoo')
    cluster.sql('postgres', 'CREATE DATABASE tpl IS_TEMPLATE true')
    cluster.sql('postgres', 'GRANT CONNECT ON DATABASE tpl TO odoo')


class PsqlCursor:
    """Runs the module's statement as the plain runtime role over psql; stands in for the psycopg2 cursor."""

    def __init__(self, cluster, fail=False):
        self.cluster, self.fail, self.rows = cluster, fail, []

    def execute(self, statement, params):
        if self.fail:
            message = 'simulated'
            raise RuntimeError(message)
        literal = '(' + ', '.join("'%s'" % name for name in params[0]) + ')'
        output = self.cluster.sql('postgres', statement.replace('%s', literal), role='odoo')
        self.rows = [(name,) for name in output.splitlines() if name]

    def fetchall(self):
        return self.rows

    def close(self):
        pass


def stub_odoo(cluster, config, fail=False):
    class AccessDenied(Exception):
        pass

    connection = types.SimpleNamespace(cursor=lambda: PsqlCursor(cluster, fail))
    return types.SimpleNamespace(
        tools=types.SimpleNamespace(config=config),
        exceptions=types.SimpleNamespace(AccessDenied=AccessDenied),
        sql_db=types.SimpleNamespace(db_connect=lambda name: connection if name == 'postgres' else None))


@unittest.skipUnless(POSTGRES_AVAILABLE, 'initdb, pg_ctl and psql are required for the real PostgreSQL tests')
class ConnectableDatabasesTests(unittest.TestCase):
    CONFIG = {'list_db': False, 'dbfilter': '^%h$', 'db_name': False, 'db_template': 'template0'}

    @classmethod
    def setUpClass(cls):
        cls.cluster = PostgresCluster()
        build_databases(cls.cluster)
        cls.module = load_module()

    @classmethod
    def tearDownClass(cls):
        cls.cluster.stop()

    def test_the_runtime_role_is_plain_and_owns_no_database(self):
        self.assertEqual(self.cluster.sql('postgres', "SELECT rolsuper OR rolcreatedb FROM pg_roles WHERE rolname = 'odoo'"), 'f')
        self.assertEqual(self.cluster.sql('postgres', "SELECT count(*) FROM pg_database WHERE pg_get_userbyid(datdba) = 'odoo'"), '0')

    def test_only_explicitly_granted_connectable_non_template_databases_are_listed(self):
        with patch.dict(sys.modules, {'odoo': stub_odoo(self.cluster, dict(self.CONFIG))}):
            self.assertEqual(self.module.list_connectable_dbs(True), ['tenant_a', 'tenant_b'])

    def test_the_postgres_database_is_excluded_by_the_name_list_not_by_its_grant(self):
        grant = self.cluster.sql('postgres', "SELECT count(*) FROM pg_database d, LATERAL aclexplode(d.datacl) a WHERE d.datname = 'postgres' "
                                 "AND a.privilege_type = 'CONNECT' AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'odoo')")
        self.assertEqual(grant, '1')  # the runtime role holds the explicit CONNECT the init script gives it
        sql = self.module.CONNECTABLE_DATABASES_SQL
        without_the_name = self.cluster.sql('postgres', sql.replace('%s', "('template0')"), role='odoo').splitlines()
        self.assertIn('postgres', without_the_name)  # not a template, allows connections, explicit grant: only `NOT IN` excludes it
        with patch.dict(sys.modules, {'odoo': stub_odoo(self.cluster, dict(self.CONFIG))}):
            self.assertNotIn('postgres', self.module.list_connectable_dbs(True))

    def test_the_listing_follows_the_role_that_asks(self):
        output = self.cluster.sql('postgres', self.module.CONNECTABLE_DATABASES_SQL.replace('%s', "('postgres', 'template0')"), role='other_runtime')
        self.assertEqual(output.splitlines(), ['granted_elsewhere'])

    def test_list_db_false_without_force_is_denied(self):
        stub = stub_odoo(self.cluster, dict(self.CONFIG))
        with patch.dict(sys.modules, {'odoo': stub}), self.assertRaises(stub.exceptions.AccessDenied):
            self.module.list_connectable_dbs()

    def test_list_db_true_without_force_lists(self):
        with patch.dict(sys.modules, {'odoo': stub_odoo(self.cluster, {**self.CONFIG, 'list_db': True})}):
            self.assertEqual(self.module.list_connectable_dbs(), ['tenant_a', 'tenant_b'])

    def test_db_name_without_dbfilter_keeps_the_stock_answer_and_asks_no_server(self):
        config = {**self.CONFIG, 'dbfilter': '', 'db_name': ['zeta', 'alpha']}
        with patch.dict(sys.modules, {'odoo': stub_odoo(self.cluster, config, fail=True)}):
            self.assertEqual(self.module.list_connectable_dbs(True), ['alpha', 'zeta'])

    def test_a_failing_query_lists_nothing(self):
        with patch.dict(sys.modules, {'odoo': stub_odoo(self.cluster, dict(self.CONFIG), fail=True)}):
            with self.assertLogs(self.module._logger, 'ERROR'):
                self.assertEqual(self.module.list_connectable_dbs(True), [])


class HookWiringTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()
        self.stock = lambda force=False: ['stock']
        self.db = types.ModuleType('odoo.service.db')
        self.server = types.ModuleType('odoo.service.server')
        self.db.list_dbs = self.server.list_dbs = self.stock
        service = types.ModuleType('odoo.service')
        service.db, service.server = self.db, self.server
        root = types.ModuleType('odoo')
        root.service = service
        patcher = patch.dict(sys.modules, {'odoo': root, 'odoo.service': service, 'odoo.service.db': self.db,
                                           'odoo.service.server': self.server})
        patcher.start()
        self.addCleanup(patcher.stop)

    def run_hook(self, **environment):
        with patch.dict(os.environ, environment, clear=False):
            if 'LIWAN_TENANCY_MODE' not in environment:
                os.environ.pop('LIWAN_TENANCY_MODE', None)
            self.module.post_load()

    def test_shared_mode_replaces_both_bindings(self):
        self.run_hook(LIWAN_TENANCY_MODE='shared')
        self.assertIs(self.db.list_dbs, self.module.list_connectable_dbs)
        self.assertIs(self.server.list_dbs, self.module.list_connectable_dbs)

    def test_inert_when_the_mode_is_unset_dedicated_or_other(self):
        self.run_hook()
        for value in ('dedicated', '', 'Shared', 'shared '):
            with self.subTest(value=value):
                self.run_hook(LIWAN_TENANCY_MODE=value)
        self.assertIs(self.db.list_dbs, self.stock)
        self.assertIs(self.server.list_dbs, self.stock)

    def test_the_module_is_a_server_wide_only_addon(self):
        manifest = __import__('ast').literal_eval((MODULE_PATH.parent / '__manifest__.py').read_text())
        self.assertEqual((manifest['post_load'], manifest['installable'], manifest['depends']), ('post_load', False, []))


@unittest.skipUnless(POSTGRES_AVAILABLE and ODOO_AVAILABLE, 'needs a throwaway PostgreSQL and a Python that imports Odoo')
class RealOdooTests(unittest.TestCase):
    """Real Odoo functions against the same cluster, as the plain role that owns nothing."""

    @classmethod
    def setUpClass(cls):
        cls.cluster = PostgresCluster()
        build_databases(cls.cluster)
        cls.config = odoo.tools.config
        cls.saved = {key: cls.config[key] for key in ('db_host', 'db_port', 'db_user', 'db_password', 'db_name', 'dbfilter', 'list_db')}
        cls.saved_functions = (odoo.service.db.list_dbs, odoo.service.server.list_dbs)
        cls.set_config({'db_host': str(cls.cluster.socket), 'db_port': int(cls.cluster.port), 'db_user': 'odoo',
                        'db_password': False, 'db_name': False, 'dbfilter': '^%h$', 'list_db': False})

    @classmethod
    def set_config(cls, values):
        for key, value in values.items():
            cls.config[key] = value

    @classmethod
    def tearDownClass(cls):
        odoo.sql_db.close_all()
        odoo.service.db.list_dbs, odoo.service.server.list_dbs = cls.saved_functions
        cls.set_config(cls.saved)
        cls.cluster.stop()

    def wire(self):
        odoo.service.db.list_dbs, odoo.service.server.list_dbs = self.saved_functions
        with patch.dict(os.environ, {'LIWAN_TENANCY_MODE': 'shared'}):
            load_module().post_load()

    def test_stock_odoo_finds_nothing_for_a_role_that_owns_no_database(self):
        odoo.service.db.list_dbs, odoo.service.server.list_dbs = self.saved_functions
        self.assertEqual(odoo.http.db_list(True, host='tenant_a'), [])

    def test_a_host_selects_exactly_its_own_tenant_never_a_neighbour(self):
        self.wire()
        self.assertEqual(odoo.http.db_list(True, host='tenant_b'), ['tenant_b'])
        self.assertEqual(odoo.http.db_list(True, host='tenant_a'), ['tenant_a'])
        self.assertEqual(odoo.http.db_filter(['tenant_a', 'tenant_b'], host='tenant_b'), ['tenant_b'])
        self.assertNotIn('tenant_b', odoo.http.db_list(True, host='tenant_a'))
        # `^%h$` is anchored and the host is escaped: no prefix, suffix, case change, pattern or port tail reaches a neighbour.
        for host in ('tenant', 'tenant_', 'enant_a', 'tenant_a_', 'xtenant_b', 'TENANT_A', 'tenant_.', 'tenant_a|tenant_b',
                     '.*', 'tenant_[ab]', ''):
            with self.subTest(host=host):
                self.assertEqual(odoo.http.db_list(True, host=host), [])
        self.assertEqual(odoo.http.db_list(True, host='tenant_b:8069'), ['tenant_b'])  # Odoo drops the port, as the guard's Host has none

    def test_the_postgres_database_is_never_listed_although_the_role_may_connect_to_it(self):
        self.wire()
        self.assertNotIn('postgres', odoo.service.db.list_dbs(True))
        self.assertNotIn('postgres', odoo.service.server.cron_database_list())
        self.assertEqual(odoo.http.db_list(True, host='postgres'), [])

    def test_host_selection_cron_list_and_db_list(self):
        self.wire()
        self.assertEqual(odoo.service.db.list_dbs(True), ['tenant_a', 'tenant_b'])
        self.assertEqual(odoo.http.db_list(True, host='tenant_a'), ['tenant_a'])
        self.assertEqual(odoo.http.db_list(True, host='tenant_b'), ['tenant_b'])
        for host in ('unknown', 'other', 'closed', 'tpl', 'granted_elsewhere', 'postgres', 'tenant_a.example'):
            with self.subTest(host=host):
                self.assertEqual(odoo.http.db_list(True, host=host), [])
        self.assertEqual(odoo.service.server.cron_database_list(), ['tenant_a', 'tenant_b'])
        with self.assertRaises(odoo.exceptions.AccessDenied):
            odoo.http.db_list(False, host='tenant_a')


if __name__ == '__main__':
    unittest.main()
