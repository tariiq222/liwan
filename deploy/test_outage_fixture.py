import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ENSURE_MASTER_PASSWORD = ROOT / 'deploy/control-plane-outage/ensure_master_password.py'


class OutageFixtureMasterPasswordTests(unittest.TestCase):
    def test_adds_random_master_password_to_existing_private_secrets_without_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            secrets_file = Path(temporary) / 'secrets.env'
            original = 'FIXTURE_PG_PASSWORD=pg-fixture-secret\nWEBVUE_FIXTURE_ADMIN_LOGIN=outage_fixture_admin\n'
            secrets_file.write_text(original, encoding='ascii')
            secrets_file.chmod(0o600)

            result = subprocess.run(
                [sys.executable, str(ENSURE_MASTER_PASSWORD), str(secrets_file)],
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout, '')
            self.assertEqual(result.stderr, '')
            values = dict(line.split('=', 1) for line in secrets_file.read_text(encoding='ascii').splitlines())
            self.assertEqual(values['FIXTURE_PG_PASSWORD'], 'pg-fixture-secret')
            self.assertEqual(values['WEBVUE_FIXTURE_ADMIN_LOGIN'], 'outage_fixture_admin')
            self.assertRegex(values['FIXTURE_ODOO_MASTER_PASSWORD'], re.compile(r'^[A-Za-z0-9_-]{40,}$'))
            self.assertEqual(os.stat(secrets_file).st_mode & 0o777, 0o600)

    def test_reuses_the_same_master_password_on_later_starts(self):
        with tempfile.TemporaryDirectory() as temporary:
            secrets_file = Path(temporary) / 'secrets.env'
            secrets_file.write_text('FIXTURE_PG_PASSWORD=pg-fixture-secret\n', encoding='ascii')
            secrets_file.chmod(0o600)

            for _ in range(2):
                result = subprocess.run(
                    [sys.executable, str(ENSURE_MASTER_PASSWORD), str(secrets_file)],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, '')
                self.assertEqual(result.stderr, '')
                values = dict(line.split('=', 1) for line in secrets_file.read_text(encoding='ascii').splitlines())
                if _ == 0:
                    original_password = values['FIXTURE_ODOO_MASTER_PASSWORD']
                else:
                    self.assertEqual(values['FIXTURE_ODOO_MASTER_PASSWORD'], original_password)

    def test_refuses_secrets_file_that_is_readable_by_group_or_other(self):
        with tempfile.TemporaryDirectory() as temporary:
            secrets_file = Path(temporary) / 'secrets.env'
            secrets_file.write_text('FIXTURE_PG_PASSWORD=pg-fixture-secret\n', encoding='ascii')
            secrets_file.chmod(0o644)
            before = secrets_file.read_bytes()

            result = subprocess.run(
                [sys.executable, str(ENSURE_MASTER_PASSWORD), str(secrets_file)],
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn('pg-fixture-secret', result.stderr)
            self.assertEqual(secrets_file.read_bytes(), before)

    def test_fixture_renders_the_generated_master_password_and_migrates_before_start(self):
        fixture = (ROOT / 'deploy/control-plane-outage/outage-fixture').read_text(encoding='utf-8')
        self.assertNotIn('local-fixture-unused', fixture)
        self.assertIn('admin_passwd = ${FIXTURE_ODOO_MASTER_PASSWORD}', fixture)
        self.assertIn('ensure_master_password.py', fixture)
        self.assertEqual(fixture.count('ensure_master_password.py'), 1)
        self.assertEqual(fixture.count('load_fixture_secrets'), 5)

    def test_restart_refreshes_private_master_password_before_stopping_odoo(self):
        restart = (ROOT / 'deploy/control-plane-outage/restart-odoo').read_text(encoding='utf-8')
        self.assertIn('"$FIXTURE/outage-fixture" refresh-config', restart)
        self.assertLess(restart.index('"$FIXTURE/outage-fixture" refresh-config'), restart.index('kill -TERM "$pid"'))
        fixture = (ROOT / 'deploy/control-plane-outage/outage-fixture').read_text(encoding='utf-8')
        self.assertIn('refresh-config)', fixture)
        self.assertIn('check_identity; load_fixture_secrets ;;', fixture)

    def test_prepare_guards_the_actual_compose_volume_and_inspected_image_id(self):
        fixture = (ROOT / 'deploy/control-plane-outage/outage-fixture').read_text(encoding='utf-8')
        compose = (ROOT / 'deploy/control-plane-outage/compose.yml').read_text(encoding='utf-8')
        self.assertIn('name: webvue-saas-outage-fixture_outage_pg', compose)
        self.assertIn('webvue-saas-outage-fixture_outage_pg', fixture)
        self.assertIn("docker image inspect \"$POSTGRES_IMAGE\" --format '{{.Id}}'", fixture)
        self.assertIn('== "$expected_id"', fixture)

    def test_stop_checks_recorded_odoo_child_contract_without_quoted_glob_case(self):
        fixture = (ROOT / 'deploy/control-plane-outage/outage-fixture').read_text(encoding='utf-8')
        self.assertIn('"$command" == *"$ODOO_BIN"*', fixture)
        self.assertIn('"$command" == *"-d $DB"*', fixture)
        self.assertNotIn('"$ROOT/deploy/check_isolated.py runtime" && "$command"', fixture)
        self.assertNotIn('case "$name:$command" in', fixture)
        self.assertNotIn('case "$launcher:$parent" in', fixture)

    def test_stop_accepts_only_esrch_proven_absent_launchers(self):
        fixture = (ROOT / 'deploy/control-plane-outage/outage-fixture').read_text(encoding='utf-8')
        self.assertIn('deploy/control-plane/pid_probe.py', fixture)
        self.assertIn('launcher process identity is uncertain', fixture)

    def test_restart_records_the_new_odoo_launcher_starttime(self):
        restart = (ROOT / 'deploy/control-plane-outage/restart-odoo').read_text(encoding='utf-8')
        pid_write = restart.index('printf \'%s\\n\' "$launcher" > "$STATE/odoo-launcher.pid"')
        start_write = restart.index('ps -p "$launcher" -o lstart= | xargs > "$STATE/odoo-launcher.starttime"')
        self.assertLess(pid_write, start_write)
        self.assertIn('chmod 600 "$STATE/odoo-launcher.pid" "$STATE/odoo-launcher.starttime"', restart)


if __name__ == '__main__':
    unittest.main()
