# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import new_test_user, tagged

from .common import (
    MANAGER_LOGIN,
    MANAGER_PASSWORD,
    OUTSIDER_LOGIN,
    OUTSIDER_PASSWORD,
    WebVueFinanceCase,
)
from odoo.addons.webvue_api.tests.common import set_probe_feature

# Capability -> the routes it opens. Each capability implies stock
# account.group_account_readonly on purpose (the routes read without sudo), so the
# routes are the only per-capability gate; these tests pin that gate.
CAPABILITY_ROUTES = {
    'finance.invoices.read': ('/api/v1/finance/invoices', '/api/v1/finance/invoices/{invoice_id}'),
    'finance.payments.read': ('/api/v1/finance/payments',),
    'finance.accounts.read': ('/api/v1/finance/accounts',),
    'finance.journals.read': ('/api/v1/finance/journals',),
}
PASSWORD = 'finance_single_pass_123'


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceCapabilityIsolation(WebVueFinanceCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.single_users = {}
        for key in CAPABILITY_ROUTES:
            login = 'finance_only_' + key.split('.')[1]
            user = new_test_user(
                cls.env, login=login, password=PASSWORD, name=login,
                groups='webvue_core.group_employee', company_id=cls.company.id,
                company_ids=[Command.set(cls.company.ids)],
            )
            role = cls.env['webvue.access.role'].with_company(cls.company).create({
                'key': login, 'name_ar': login, 'name_en': login, 'type': 'custom',
                'permission_ids': [Command.set(cls.env['webvue.access.permission'].search([('key', '=', key)]).ids)],
            })
            cls.env['webvue.access.service']._webvue_replace_assignments(
                user, [{'role_id': role.id, 'company_id': cls.company.id}],
            )
            cls.single_users[key] = login

    def _routes(self, key):
        return tuple(route.format(invoice_id=self.invoice.id) for route in CAPABILITY_ROUTES[key])

    def _all_routes(self):
        return tuple(route for key in CAPABILITY_ROUTES for route in self._routes(key))

    def test_a_single_capability_opens_only_its_own_routes(self):
        for key, login in self.single_users.items():
            self.authenticate(login, PASSWORD)
            own = self._routes(key)
            for route in self._all_routes():
                with self.subTest(capability=key, route=route):
                    result = self.api('GET', route)
                    if route in own:
                        self.assertEqual(result.status_code, 200)
                    else:
                        self.assertEqual((result.status_code, result.json()['code']), (403, 'forbidden'))

    def test_no_capability_gets_403_on_every_route(self):
        self.authenticate(OUTSIDER_LOGIN, OUTSIDER_PASSWORD)
        for route in self._all_routes():
            with self.subTest(route=route):
                result = self.api('GET', route)
                self.assertEqual((result.status_code, result.json()['code']), (403, 'forbidden'))

    def test_a_closed_feature_refuses_every_route(self):
        set_probe_feature(self, key='finance.enabled', enabled=False)
        self.authenticate(MANAGER_LOGIN, MANAGER_PASSWORD)
        for route in self._all_routes():
            with self.subTest(route=route):
                self.assertEqual(self.api('GET', route).status_code, 403)
