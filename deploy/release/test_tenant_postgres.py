"""Infrastructure SQL guards never operate on Odoo business tables."""
import unittest

from deploy.release.tenant_postgres import (tenant_create_database_sql, tenant_isolation_sql, tenant_isolation_statements,
                                            POSTGRES_ADMIN_ROLE, ODOO_RUNTIME_ROLE, RUNTIME_ROLE_RULES,
                                            runtime_role_assertion_sql, tenant_bootstrap_sql, session_role, cluster_connect_grant_sql)


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

    def test_unsafe_database_names_are_rejected(self):
        for database in ('tenant"; DROP', 'Tenant', '1db', 'bad-name'):
            with self.assertRaises(ValueError):
                tenant_create_database_sql(database)


class RuntimeRoleTests(unittest.TestCase):
    def test_role_names_are_distinct_valid_identifiers(self):
        self.assertEqual(('postgres', 'odoo'), (POSTGRES_ADMIN_ROLE, ODOO_RUNTIME_ROLE))

    def test_grants_quote_the_role_and_reject_unsafe_names(self):
        self.assertEqual('GRANT CONNECT ON DATABASE "postgres" TO "odoo"', cluster_connect_grant_sql('odoo'))
        for build in (tenant_bootstrap_sql, cluster_connect_grant_sql, session_role):
            for role in ('odoo"; DROP', 'Odoo', 'odoo; x', ''):
                with self.assertRaises(ValueError):
                    build(role)

    def test_bootstrap_pins_the_path_then_creates_the_extension_then_grants(self):
        self.assertEqual('SET search_path = pg_catalog;\n'
                         'CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;\n'
                         'GRANT CREATE ON SCHEMA public TO "odoo";\n', tenant_bootstrap_sql('odoo'))

    def test_session_role_is_admin_only_in_the_postgres_database(self):
        self.assertEqual('postgres', session_role('postgres'))
        self.assertEqual('odoo', session_role('tenant_a'))
        for database in ('tenant"; DROP', 'Tenant', '', None):
            with self.assertRaises(ValueError):
                session_role(database)

    def test_rules_keep_their_order(self):
        self.assertEqual(['privileged_or_missing_role', 'role_membership_rejected', 'database_owner_rejected',
                          'database_create_granted'],
                         [reason for reason, _ in RUNTIME_ROLE_RULES])

    def test_assertion_raises_the_reason_of_every_rule(self):
        sql = runtime_role_assertion_sql('odoo', ['tenant_a', 'tenant_b'])
        self.assertTrue(sql.startswith('DO $$ BEGIN ') and sql.endswith(' END $$'))
        for reason, _ in RUNTIME_ROLE_RULES:
            self.assertIn(f"RAISE EXCEPTION '{reason}'", sql)
        self.assertEqual(len(RUNTIME_ROLE_RULES), sql.count('RAISE EXCEPTION'))
        for attribute in ('rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolreplication', 'rolbypassrls', 'rolcanlogin'):
            self.assertIn(attribute, sql)
        self.assertIn('pg_auth_members', sql)
        self.assertIn("a.privilege_type = 'CREATE' AND a.grantee <> d.datdba", sql)
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
