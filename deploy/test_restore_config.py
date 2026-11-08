# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The restore Odoo config: a recovered database runs no scheduled job.

`restore-odoo` opens a copy of a customer backup. Any cron the backup held is overdue on the copy, so letting it run
would mutate or prune recovered data before an operator inspects it — and `liwan_inbox`'s maintenance cron deletes
conversations and attachments, which also breaks `BackupRunner.verify_restore()` against the backup inventory.
"""
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Optional
from unittest import mock

sys.path.insert(0, str(Path(__file__).with_name('shared')))
import validate_odoo_config

COMPLETE = (
    '[options]\n'
    'data_dir = /var/lib/odoo\n'
    'db_host = restore-db\n'
    'db_user = odoo\n'
    'db_password = scratch-restore-password\n'
    'admin_passwd = scratch-restore-admin\n'
    'dbfilter = ^%h$\n'
    'list_db = False\n'
    'proxy_mode = False\n'
    'workers = 2\n'
)


class TestRestoreRole(unittest.TestCase):
    def setUp(self):
        # The role marker is read per call, so every case starts from a known environment. `clear` stays off: the
        # module under test reads several environment variables, and dropping them all would hide the marker itself.
        os.environ.pop('LIWAN_RESTORE_ROLE', None)
        self.addCleanup(os.environ.pop, 'LIWAN_RESTORE_ROLE', None)

    def _config(self, extra: str = '', role: Optional[str] = '1') -> Path:
        directory = tempfile.mkdtemp()
        path = Path(directory) / 'odoo.conf'
        path.write_text(COMPLETE + extra, encoding='utf-8')
        path.chmod(stat.S_IRUSR)
        self.addCleanup(path.unlink)
        if role is not None:
            os.environ['LIWAN_RESTORE_ROLE'] = role
        return path

    def test_a_restore_config_must_run_with_zero_cron_threads(self):
        self._config()
        self.assertEqual(validate_odoo_config.validate_launch_arguments(['--max-cron-threads=0']),
                         ['--max-cron-threads=0'])
        for arguments in ([], ['--max-cron-threads=1'], ['--no-http'], ['--max-cron-threads=2']):
            with self.subTest(arguments=arguments):
                with self.assertRaises(validate_odoo_config.ConfigRejected):
                    validate_odoo_config.validate_launch_arguments(arguments)

    def test_a_restore_config_that_enables_cron_is_refused(self):
        validate_odoo_config.validate_config(self._config('max_cron_threads = 0\n'))
        for value in ('1', '2', '4'):
            with self.subTest(max_cron_threads=value):
                with self.assertRaises(validate_odoo_config.ConfigRejected):
                    validate_odoo_config.validate_config(self._config(f'max_cron_threads = {value}\n'))

    def test_the_shipped_reference_disables_cron(self):
        reference = Path(__file__).with_name('shared') / 'odoo.restore.conf'
        options = {}
        for line in reference.read_text(encoding='utf-8').splitlines():
            if line.startswith(';') or '=' not in line:
                continue
            name, _, value = line.partition('=')
            options[name.strip()] = value.strip()
        self.assertEqual(options.get('max_cron_threads'), '0',
                         'the reference restore config must show the operator zero cron threads')

    def test_a_tenant_config_is_not_given_the_restore_rules(self):
        """The role marker alone selects the restore rules; a tenant config keeps its own job policy."""
        path = self._config(role=None)
        with self.assertRaises(validate_odoo_config.ConfigRejected):
            validate_odoo_config.validate_launch_arguments(['--max-cron-threads=0'])
        del path


if __name__ == '__main__':
    unittest.main()
