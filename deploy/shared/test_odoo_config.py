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
db_user = synthetic-user
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
        self.root = Path(tempfile.mkdtemp(prefix="nasq-config-fixture-"))
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
        with patch.dict(os.environ, {"NASQ_TENANCY_MODE": "shared"}), patch("sys.argv", ["launch"]), patch.object(launch_odoo, "validate_config") as validate, patch.object(launch_odoo.os, "execv") as execute:
            launch_odoo.main()
            validate.assert_called_once_with("/etc/odoo/odoo.conf")
            execute.assert_called_once_with("/usr/local/bin/nasq-odoo", ["nasq-odoo"])

    def test_launch_rejects_overrides_and_bad_config_without_exec(self):
        for argv in (["launch", "--db-filter=.*"], ["launch"]):
            output = io.StringIO()
            with patch.dict(os.environ, {"NASQ_TENANCY_MODE": "shared"}), patch("sys.argv", argv), patch.object(launch_odoo, "validate_config", side_effect=ConfigRejected()), patch.object(launch_odoo.os, "execv") as execute, contextlib.redirect_stderr(output):
                self.assertEqual(launch_odoo.main(), 1)
                execute.assert_not_called()
            self.assertEqual(output.getvalue(), "shared_config_rejected\n")


if __name__ == "__main__":
    unittest.main()
