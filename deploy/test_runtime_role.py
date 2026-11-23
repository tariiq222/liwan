"""The cluster bootstraps as the admin role `postgres`; Odoo runs as the NOSUPERUSER role `odoo`.

Static checks of the compose files and the init script, plus a run of the script against a stub `psql`:
no Docker, PostgreSQL or network access.
"""
import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

from deploy.releases.postgres import ODOO_RUNTIME_ROLE, POSTGRES_ADMIN_ROLE
from deploy.test_container_hardening import services

DEPLOY = Path(__file__).resolve().parent
COMPOSE_FILES = ('docker-compose.yml', 'docker-compose.shared.yml')
DATABASE_SERVICES = {'docker-compose.yml': 'db', 'docker-compose.shared.yml': 'restore-db'}
INIT_SCRIPT = DEPLOY / 'db' / 'init-runtime-role.sh'
STUB_PSQL = '#!/bin/sh\necho "$@" > "$STUB_DIR/args"\ncat > "$STUB_DIR/sql"\n'


class ComposeBootstrapTest(unittest.TestCase):
    def blocks(self, name):
        return services((DEPLOY / name).read_text())

    def test_the_database_services_bootstrap_as_the_admin_role(self):
        for name, service in DATABASE_SERVICES.items():
            with self.subTest(file=name):
                block = self.blocks(name)[service]
                self.assertIn(f'POSTGRES_USER: {POSTGRES_ADMIN_ROLE}\n', block + '\n')
                self.assertIn('POSTGRES_PASSWORD: "${DB_ADMIN_PASSWORD:?', block)
                self.assertIn('ODOO_DB_PASSWORD: "${DB_PASSWORD:?', block)
                self.assertNotIn(f'POSTGRES_USER: {ODOO_RUNTIME_ROLE}', block)

    def test_the_runtime_role_script_is_mounted_before_the_ai_script(self):
        for name, service in DATABASE_SERVICES.items():
            with self.subTest(file=name):
                mounts = re.findall(r'\./([\w/.-]+):/docker-entrypoint-initdb\.d/([\w.-]+):ro', self.blocks(name)[service])
                self.assertEqual([('db/init-runtime-role.sh', '10-liwan-runtime-role.sh'),
                                  ('ai/init-db.sh', '20-liwan-ai.sh')], mounts)

    def test_the_admin_password_reaches_only_the_database_services(self):
        for path in DEPLOY.rglob('*.yml'):
            if 'node_modules' in path.parts:
                continue
            for service, block in services(path.read_text()).items():
                if 'DB_ADMIN_PASSWORD' in block:
                    with self.subTest(file=path.name, service=service):
                        self.assertEqual(DATABASE_SERVICES.get(path.name), service)

    def test_the_healthchecks_stay_on_the_runtime_role(self):
        for name, service in DATABASE_SERVICES.items():
            with self.subTest(file=name):
                self.assertIn(f'pg_isready -U {ODOO_RUNTIME_ROLE}', self.blocks(name)[service])


class InitScriptTest(unittest.TestCase):
    def run_script(self, password):
        with tempfile.TemporaryDirectory() as tmp:
            stub = Path(tmp) / 'psql'
            stub.write_text(STUB_PSQL)
            stub.chmod(0o755)
            env = {'PATH': f'{tmp}:{os.environ["PATH"]}', 'STUB_DIR': tmp, 'POSTGRES_USER': POSTGRES_ADMIN_ROLE}
            if password is not None:
                env['ODOO_DB_PASSWORD'] = password
            done = subprocess.run(['sh', str(INIT_SCRIPT)], env=env, capture_output=True, text=True, timeout=30)
            sql = Path(tmp, 'sql')
            return done, sql.read_text() if sql.exists() else None, Path(tmp, 'args').read_text() if sql.exists() else None

    def test_an_empty_or_missing_password_aborts_before_psql_runs(self):
        for password in ('', None):
            with self.subTest(password=password):
                done, sql, _ = self.run_script(password)
                self.assertNotEqual(0, done.returncode)
                self.assertIsNone(sql)

    def test_the_role_is_created_with_the_five_no_flags_and_the_postgres_connect_grant(self):
        done, sql, args = self.run_script('secret-value-for-test')
        self.assertEqual(0, done.returncode, done.stderr)
        for flag in ('LOGIN', 'NOSUPERUSER', 'NOCREATEDB', 'NOCREATEROLE', 'NOREPLICATION', 'NOBYPASSRLS'):
            self.assertRegex(sql, rf'\b{flag}\b')
        self.assertIn(f'CREATE ROLE {ODOO_RUNTIME_ROLE} ', sql)
        self.assertIn(f'GRANT CONNECT ON DATABASE postgres TO {ODOO_RUNTIME_ROLE}', sql)

    def test_the_password_is_quoted_by_postgres_and_never_leaves_the_environment(self):
        done, sql, args = self.run_script("pa'ss; DROP ROLE x")
        self.assertIn("format('CREATE ROLE", sql)
        self.assertIn(":'odoo_password'", sql)
        self.assertIn('\\getenv odoo_password ODOO_DB_PASSWORD', sql)
        for text in (sql, args, done.stdout, done.stderr):
            self.assertNotIn("DROP ROLE x", text)

    def test_the_script_runs_with_errors_fatal_and_as_the_bootstrap_user(self):
        _, _, args = self.run_script('secret-value-for-test')
        self.assertIn('ON_ERROR_STOP=1', args)
        self.assertIn(f'--username {POSTGRES_ADMIN_ROLE}', args)


class HarnessSuppliesAdminPasswordTest(unittest.TestCase):
    """The db service interpolates DB_ADMIN_PASSWORD with `:?`, so every harness that renders or tears down the
    shared stack must supply it, or `docker compose config|ps|down` fails before anything runs."""

    HARNESSES = (
        'tools/shared_acceptance_live/probe.mjs',
        'tools/shared_acceptance_live/down.sh',
        'tools/foundation_acceptance/provision_two_tenants.mjs',
        'apps/control-plane/src/__tests__/shared-topology.test.ts',
    )

    def test_every_compose_harness_names_the_admin_password(self):
        root = DEPLOY.parent
        for relative in self.HARNESSES:
            with self.subTest(harness=relative):
                self.assertIn('DB_ADMIN_PASSWORD', (root / relative).read_text())


if __name__ == '__main__':
    unittest.main()
