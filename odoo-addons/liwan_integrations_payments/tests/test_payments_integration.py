# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_payments.tests.common import (
    PAYMOB_CREDENTIALS,
    LiwanPaymentsCase,
    company_values,
)

BASE = '/api/v1/integrations'
PASSWORD = 'integrations_payments_pass_123'


@tagged('post_install', '-at_install', 'liwan')
class TestPaymentsIntegration(LiwanPaymentsCase):
    """The tenant's payment gateway on the integrations page, derived from its payment.provider row."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.reader = new_test_user(
            cls.env, login='payments_integrations_reader', password=PASSWORD, name='Integrations reader',
            groups='liwan_core.group_employee',
        )
        role = cls.env['liwan.access.role'].create({
            'key': 'payments_integrations_reader', 'name_ar': 'قارئ الربط', 'name_en': 'Integrations reader',
            'type': 'custom',
            'permission_ids': [Command.set(cls.env['liwan.access.permission'].search([('key', '=', 'integrations.read')]).ids)],
        })
        cls.env['liwan.access.service']._liwan_replace_assignments(
            cls.reader, [{'role_id': role.id, 'company_id': cls.env.company.id}],
        )

    def configure(self, state, provider=None, credentials=PAYMOB_CREDENTIALS):
        """Store the gateway keys (and the account country stock requires with them) and set its state."""
        (provider or self.paymob).sudo().write({
            **credentials, 'paymob_account_country_id': self.env.ref('base.sa').id, 'state': state,
        })

    def status(self, company=None):
        return self.env['liwan.integration.registry']._liwan_external_status('paymob', company or self.env.company)

    def listed(self):
        items = self.api('GET', f'{BASE}/connections').json()['items']
        return next((item for item in items if item['provider'] == 'paymob'), None)

    def test_the_gateway_is_not_configured_without_every_credential(self):
        self.assertEqual(self.status(), {'state': 'not_configured', 'status_message': '', 'last_checked': None})
        partial = {key: value for key, value in PAYMOB_CREDENTIALS.items() if key != 'paymob_api_key'}
        self.configure('disabled', credentials=partial)
        self.assertEqual(self.status()['state'], 'not_configured')

    def test_the_gateway_is_pending_with_keys_while_disabled(self):
        self.configure('disabled')
        self.assertEqual(self.status()['state'], 'pending')

    def test_the_gateway_is_connected_in_test_and_live_mode(self):
        self.configure('test')
        self.assertEqual(self.status()['state'], 'connected')
        self.configure('enabled')
        self.assertEqual(self.status()['state'], 'connected')

    def test_no_key_material_is_in_the_status_and_nothing_is_stored(self):
        self.configure('enabled')
        self.assertFalse(any(value in str(self.status()) for value in PAYMOB_CREDENTIALS.values()))
        self.assertFalse(self.env['liwan.integration.connection'].search([('provider', '=', 'paymob')]))

    def test_it_is_listed_only_while_payments_is_open(self):
        self.configure('enabled')
        self.authenticate('payments_admin', 'payments_admin_pass_123')
        item = self.listed()
        self.assertEqual(
            (item['ref'], item['auth'], item['state'], item['used_by'], item['settings_path']),
            ('external:paymob', 'external', 'connected', ['payments.gateway.paymob'], '/settings/apps/payments#providers'),
        )
        providers = {row['code'] for row in self.api('GET', f'{BASE}/providers').json()['items']}
        self.assertIn('paymob', providers)
        set_probe_feature(self, key='payments.enabled', enabled=False)
        self.assertIsNone(self.listed())
        providers = {row['code'] for row in self.api('GET', f'{BASE}/providers').json()['items']}
        self.assertNotIn('paymob', providers)

    def test_another_companys_gateway_does_not_leak(self):
        other = self.env['res.company'].create(company_values('Other payments company'))
        other_gateway = self.env['payment.provider'].sudo().search([('code', '=', 'paymob'), ('company_id', '=', other.id)], limit=1)
        self.assertTrue(other_gateway)
        self.configure('enabled', provider=other_gateway)
        self.assertEqual(self.status(other)['state'], 'connected')
        self.assertEqual(self.status()['state'], 'not_configured')

    def test_a_reader_without_payments_access_sees_the_true_state(self):
        self.configure('test')
        self.authenticate('payments_integrations_reader', PASSWORD)
        item = self.listed()
        self.assertEqual(item['state'], 'connected')
        self.assertNotIn('never_returned', str(item))
