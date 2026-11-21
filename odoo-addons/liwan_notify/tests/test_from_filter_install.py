# Part of Odoo. See LICENSE file for full copyright and licensing details.
import importlib.util
from unittest import mock

from odoo.tests import TransactionCase, tagged
from odoo.tools import file_path

from odoo.addons.liwan_notify import hooks
from odoo.addons.liwan_notify.models import mail_domain
from odoo.addons.liwan_notify.models.mail_domain import FROM_FILTER_PARAM

PLATFORM_SENDER = 'no-reply@liwanos.example'


@tagged('post_install', '-at_install', 'liwan')
class TestFromFilterFromInstallation(TransactionCase):
    """A database whose tenant never configured a domain still limits the sender to the platform domain."""

    def setUp(self):
        super().setUp()
        params = self.env['ir.config_parameter'].sudo()
        params.set_param('mail.default.from', PLATFORM_SENDER)
        params.set_param(FROM_FILTER_PARAM, False)
        self.assertFalse(self.env['liwan.mail.domain'].sudo().search_count([]))

    def _migrate(self, version):
        path = file_path('liwan_notify/migrations/19.0.1.3.0/post-from_filter.py')
        spec = importlib.util.spec_from_file_location('liwan_notify_from_filter_migration', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.migrate(self.env.cr, version)

    def _filter(self):
        return self.env['ir.config_parameter'].sudo().get_param(FROM_FILTER_PARAM)

    def test_install_hook_writes_the_platform_domain(self):
        hooks.post_init_hook(self.env)
        self.assertEqual(self._filter(), 'liwanos.example')

    def test_upgrade_carries_the_filter_into_an_existing_database(self):
        self._migrate('19.0.1.2.0')
        self.assertEqual(self._filter(), 'liwanos.example')

    def test_a_fresh_install_has_no_migration_to_run(self):
        self._migrate(None)
        self.assertFalse(self._filter())

    def test_a_sender_configured_after_the_install_reaches_the_filter_on_the_next_cron_run(self):
        params = self.env['ir.config_parameter'].sudo()
        params.set_param('mail.default.from', False)
        with mock.patch('odoo.addons.liwan_core.models.outbound_mail.config', {}):
            hooks.post_init_hook(self.env)
            self.assertFalse(self._filter())
        params.set_param('mail.default.from', PLATFORM_SENDER)
        self.env['liwan.mail.domain']._liwan_cron_verify()
        self.assertEqual(self._filter(), 'liwanos.example')

    def test_a_failing_filter_write_is_logged_and_the_domain_check_still_runs(self):
        domains = self.env['liwan.mail.domain']
        domain = domains.create({
            'company_id': self.env.company.id, 'domain': 'acme.example', 'from_local_part': 'info', 'state': 'verified',
        })
        checked = []
        with (
            mock.patch.object(type(domains), '_liwan_write_from_filter', side_effect=RuntimeError('row locked')),
            mock.patch.object(type(domains), '_liwan_check', autospec=True, side_effect=checked.append),
            self.assertLogs(mail_domain.__name__, 'ERROR') as logs,
        ):
            domains._liwan_cron_verify()
        self.assertEqual(checked, [domain])
        self.assertIn('From filter refresh failed', logs.output[0])
