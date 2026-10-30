# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Synthetic config only: no Odoo import, Docker, network or database access."""
import contextlib
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import launch_odoo
from validate_odoo_config import ConfigRejected, main, validate_config

FIXTURE = """[options]
db_host = synthetic-db
db_user = synthetic_user
db_password = SYNTHETIC_PASSWORD_MUST_NOT_APPEAR
admin_passwd = SYNTHETIC_ADMIN_MUST_NOT_APPEAR
dbfilter = ^%h$
list_db = False
proxy_mode = False
data_dir = /var/lib/odoo
workers = 2
"""


class SharedConfigTest(unittest.TestCase):
    def setUp(self):
        # Retain synthetic artifacts rather than deleting any resources.
        self.root = Path(tempfile.mkdtemp(prefix="liwan-config-fixture-"))
        self.path = self.root / "synthetic.conf"

    def fixture(self, content=FIXTURE, mode=0o400):
        if self.path.exists():
            self.path.chmod(0o600)
        self.path.write_text(content)
        self.path.chmod(mode)
        return self.path

    def test_valid_complete_config_and_reference_rejected(self):
        validate_config(self.fixture())
        with self.assertRaises(ConfigRejected):
            validate_config(Path(__file__).with_name("odoo.conf"))

    def test_missing_credentials_and_invariants(self):
        for key in ("db_host", "db_user", "db_password", "admin_passwd"):
            with self.subTest(key=key):
                value = "\n".join(line for line in FIXTURE.splitlines() if not line.startswith(key + " ="))
                with self.assertRaises(ConfigRejected):
                    validate_config(self.fixture(value))
        for old, new in (("^%h$", ".*"), ("list_db = False", "list_db = True"),
                         ("proxy_mode = False", "proxy_mode = True"), ("workers = 2", "workers = 0"),
                         ("/var/lib/odoo", "/tmp")):
            with self.subTest(old=old), self.assertRaises(ConfigRejected):
                validate_config(self.fixture(FIXTURE.replace(old, new)))
        for suffix in ("db_name = foreign\n", "db_name = False\n", "dbfilter = .*\n"):
            with self.assertRaises(ConfigRejected):
                validate_config(self.fixture(FIXTURE + suffix))

    def test_permission_placeholder_missing_and_parse_failure(self):
        for mode in (0o644, 0o600, 0o666):
            with self.assertRaises(ConfigRejected):
                validate_config(self.fixture(mode=mode))
        for text in ("SYNTHETIC_PASSWORD_MUST_NOT_APPEAR", FIXTURE.replace("SYNTHETIC_PASSWORD_MUST_NOT_APPEAR", "${DB_PASSWORD}")):
            with self.assertRaises(ConfigRejected):
                validate_config(self.fixture(text))
        with self.assertRaises(ConfigRejected):
            validate_config(self.root / "missing")

    def test_public_error_never_echoes_parser_content(self):
        self.fixture("SYNTHETIC_PASSWORD_MUST_NOT_APPEAR")
        output = io.StringIO()
        with patch("sys.argv", ["validate", str(self.path)]), contextlib.redirect_stderr(output):
            self.assertEqual(main(), 1)
        self.assertEqual(output.getvalue(), "shared_config_rejected\n")

    def test_launch_delegates_secure_entrypoint_only_after_validation(self):
        with patch.dict(os.environ, {"LIWAN_TENANCY_MODE": "shared"}), patch("sys.argv", ["launch"]), patch.object(launch_odoo, "validate_config") as validate, patch.object(launch_odoo.os, "execv") as execute:
            launch_odoo.main()
            validate.assert_called_once_with("/etc/odoo/odoo.conf")
            execute.assert_called_once_with("/usr/local/bin/liwan-odoo", ["liwan-odoo"])

    def test_launch_rejects_overrides_and_bad_config_without_exec(self):
        for argv in (["launch", "--db-filter=.*"], ["launch"]):
            output = io.StringIO()
            with patch.dict(os.environ, {"LIWAN_TENANCY_MODE": "shared"}), patch("sys.argv", argv), patch.object(launch_odoo, "validate_config", side_effect=ConfigRejected()), patch.object(launch_odoo.os, "execv") as execute, contextlib.redirect_stderr(output):
                self.assertEqual(launch_odoo.main(), 1)
                execute.assert_not_called()
            self.assertEqual(output.getvalue(), "shared_config_rejected\n")


class ReleaseConfigTest(unittest.TestCase):
    """Use real secret-free files and exercise public launcher without exec."""
    setUp = SharedConfigTest.setUp
    fixture = SharedConfigTest.fixture
    def release_env(self, role='http', **extra):
        return {'LIWAN_TENANCY_MODE': 'shared', 'LIWAN_RELEASE_POOL_ID': 'green',
                'LIWAN_RELEASE_DB_USER':'synthetic_user','LIWAN_RELEASE_ROLE': role, **extra}

    def launch(self, args, env, content=FIXTURE):
        path = self.fixture(content)
        executions = []
        with patch.dict(os.environ, env, clear=True), patch('sys.argv', ['launch', *args]), \
                patch.object(launch_odoo, 'validate_config', lambda unused: validate_config(path)), \
                patch.object(launch_odoo.os, 'execv', lambda executable, argv: executions.append((executable, argv))):
            result = launch_odoo.main()
        return result, executions

    def test_http_release_forwards_only_exact_public_cron_disable(self):
        result, executions = self.launch(['--max-cron-threads=0'], self.release_env())
        self.assertIsNone(result)
        self.assertEqual(executions, [('/usr/local/bin/liwan-odoo', ['liwan-odoo', '--max-cron-threads=0'])])

    def test_cron_release_requires_exact_explicit_database_membership(self):
        env = self.release_env('cron', LIWAN_RELEASE_DATABASES='tenant_b,tenant_a')
        argv = ['--no-http', '--max-cron-threads=1', '--database=tenant_a,tenant_b']
        _, executions = self.launch(argv, env, FIXTURE + 'db_name = tenant_b,tenant_a\n')
        self.assertEqual(executions[0][1], ['liwan-odoo', *argv])
        for args in ([], argv[:-1], [*argv, '--db-filter=.*'],
                     ['--no-http', '--max-cron-threads=1', '--database=tenant_a']):
            with self.subTest(args=args), contextlib.redirect_stderr(io.StringIO()):
                result, calls = self.launch(args, env)
                self.assertEqual(result, 1); self.assertFalse(calls)

    def test_release_profiles_do_not_weaken_http_or_secret_config(self):
        cases = [(self.release_env(), FIXTURE + 'db_name = tenant_a\n', ['--max-cron-threads=0']),
                 (self.release_env('cron', LIWAN_RELEASE_DATABASES='tenant_a'), FIXTURE + 'db_name = tenant_b\n', ['--no-http', '--max-cron-threads=1', '--database=tenant_a']),
                 (self.release_env(), FIXTURE.replace('^%h$', '.*'), ['--max-cron-threads=0'])]
        for env, content, args in cases:
            with self.subTest(env=env), contextlib.redirect_stderr(io.StringIO()):
                result, calls = self.launch(args, env, content)
                self.assertEqual(result, 1); self.assertFalse(calls)

    def test_missing_profile_forged_pool_and_protected_db_refuse_before_exec(self):
        envs = [self.release_env(LIWAN_RELEASE_POOL_ID='../escape'),
                {'LIWAN_TENANCY_MODE': 'shared', 'LIWAN_RELEASE_POOL_ID': 'green'},
                self.release_env('cron', LIWAN_RELEASE_DATABASES='odoo19'),
                self.release_env('cron', LIWAN_RELEASE_DATABASES='tenant_a,tenant_a'),
                self.release_env('cron', LIWAN_RELEASE_DATABASES='tenant_a;DROP')]
        for env in envs:
            with self.subTest(env=env), contextlib.redirect_stderr(io.StringIO()):
                result, calls = self.launch(['--max-cron-threads=0'], env)
                self.assertEqual(result, 1); self.assertFalse(calls)


if __name__ == "__main__":
    unittest.main()
