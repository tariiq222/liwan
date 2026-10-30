# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.exceptions import AccessError
from odoo.tests import tagged

from .common import MANAGER_LOGIN, MANAGER_PASSWORD, OUTSIDER_LOGIN, OUTSIDER_PASSWORD
from .oca_common import ASSETS, BANK, BANK_LINES, REPORTS, LiwanFinanceOcaCase
from .write_common import PASSWORD
from odoo.addons.liwan_api.tests.common import set_probe_feature

PERIOD = '?date_from=2026-01-01&date_to=2026-12-31'
END = '?date_to=2026-12-31'


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceOcaAccess(LiwanFinanceOcaCase):
    """Each new capability opens only its own routes: the stock groups they imply are broader (see the README)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        asset = cls.env['account.asset'].with_company(cls.company).create({
            'name': 'Desk', 'profile_id': cls.asset_profile(cls.company).id, 'purchase_value': 1000, 'date_start': '2026-01-01',
        })
        statement = cls.env['account.bank.statement'].with_company(cls.company).create({
            'date': '2026-10-31',
            'line_ids': [Command.create({'journal_id': cls.bank.id, 'date': '2026-10-31', 'payment_ref': 'Deposit', 'amount': 50})],
        })
        line = statement.line_ids
        partner = cls.partner.id
        # capability -> GET routes it opens
        cls.reads = {
            'finance.statements.read': (
                f'{REPORTS}/trial-balance{PERIOD}', f'{REPORTS}/general-ledger{PERIOD}',
                f'{REPORTS}/aged-partner-balance{END}', f'{REPORTS}/partner-statement{PERIOD}&partner_id={partner}',
                f'{REPORTS}/profit-loss{PERIOD}', f'{REPORTS}/balance-sheet{END}',
            ),
            'finance.zakat.read': (f'{REPORTS}/zakat-base{END}',),
            'finance.assets.read': ('/api/v1/finance/asset-profiles', ASSETS, f'{ASSETS}/{asset.id}'),
            'finance.bank.read': (BANK, f'{BANK}/{statement.id}', f'{BANK_LINES}/{line.id}/reconcile-proposals'),
        }
        # capability -> (method, route, body) it opens (answers other than 403 once allowed)
        cls.writes = {
            'finance.assets.manage': (
                ('POST', ASSETS, {}), ('POST', f'{ASSETS}/{asset.id}/validate', {}),
                ('POST', f'{ASSETS}/compute-depreciation', {}),
            ),
            'finance.bank.manage': (
                ('POST', BANK, {}), ('POST', f'{BANK_LINES}/{line.id}/reconcile', {}),
            ),
        }
        cls.single = {}
        for key in (*cls.reads, *cls.writes):
            login = 'finance_oca_' + key.split('.', 1)[1].replace('.', '_')
            keys = [key, key.replace('.manage', '.read')] if key.endswith('.manage') else [key]
            cls.single[key] = login
            cls.user_with(login, keys)

    def _status(self, method, route, body=None):
        return self.api(method, route, json=body).status_code

    def test_a_single_capability_opens_only_its_own_get_routes(self):
        every = [route for routes in self.reads.values() for route in routes]
        for key, routes in self.reads.items():
            self.authenticate(self.single[key], PASSWORD)
            for route in every:
                with self.subTest(capability=key, route=route):
                    result = self.api('GET', route)
                    if route in routes:
                        self.assertEqual(result.status_code, 200, result.text)
                    else:
                        self.assertRefused(result, 403, 'forbidden')

    def test_a_read_capability_cannot_write(self):
        for key, login in (('finance.assets.read', self.single['finance.assets.read']), ('finance.bank.read', self.single['finance.bank.read'])):
            self.authenticate(login, PASSWORD)
            for routes in self.writes.values():
                for method, route, body in routes:
                    with self.subTest(capability=key, route=route):
                        self.assertRefused(self.api(method, route, json=body), 403, 'forbidden')

    def test_a_manage_capability_opens_its_writes_only(self):
        for key, routes in self.writes.items():
            self.authenticate(self.single[key], PASSWORD)
            for other_key, other_routes in self.writes.items():
                for method, route, body in other_routes:
                    with self.subTest(capability=key, route=route):
                        if other_key == key:
                            self.assertNotEqual(self._status(method, route, body), 403)
                        else:
                            self.assertRefused(self.api(method, route, json=body), 403, 'forbidden')

    def test_a_user_without_capabilities_is_refused_everywhere(self):
        self.authenticate(OUTSIDER_LOGIN, OUTSIDER_PASSWORD)
        for routes in self.reads.values():
            for route in routes:
                with self.subTest(route=route):
                    self.assertRefused(self.api('GET', route), 403, 'forbidden')
        for routes in self.writes.values():
            for method, route, body in routes:
                with self.subTest(route=route):
                    self.assertRefused(self.api(method, route, json=body), 403, 'forbidden')

    def test_the_manager_role_reads_every_route(self):
        self.authenticate(MANAGER_LOGIN, MANAGER_PASSWORD)
        for routes in self.reads.values():
            for route in routes:
                with self.subTest(route=route):
                    self.assertEqual(self.api('GET', route).status_code, 200)

    def test_a_closed_feature_refuses_every_route(self):
        set_probe_feature(self, key='finance.enabled', enabled=False)
        self.authenticate(MANAGER_LOGIN, MANAGER_PASSWORD)
        for routes in self.reads.values():
            for route in routes:
                with self.subTest(route=route):
                    self.assertEqual(self.api('GET', route).status_code, 403)
        for routes in self.writes.values():
            for method, route, body in routes:
                with self.subTest(route=route):
                    self.assertEqual(self.api(method, route, json=body).status_code, 403)

    def test_manage_capabilities_need_their_read_capability(self):
        dependencies = self.env['liwan.access.service']._liwan_permission_dependencies()
        self.assertEqual(dependencies['finance.assets.manage'], {'finance.assets.read'})
        self.assertEqual(dependencies['finance.bank.manage'], {'finance.bank.read'})

    def test_the_assets_read_capability_is_read_only_in_the_orm(self):
        user = self.env['res.users'].search([('login', '=', self.single['finance.assets.read'])])
        asset = self.env['account.asset'].with_company(self.company).search([('name', '=', 'Desk')])
        as_user = asset.with_user(user)
        self.assertEqual(as_user.name, 'Desk')
        self.assertTrue(self.env['account.asset.profile'].with_user(user).with_company(self.company).search([]))
        with self.assertRaises(AccessError):
            as_user.write({'name': 'Renamed'})
        with self.assertRaises(AccessError):
            self.env['account.asset'].with_user(user).with_company(self.company).create({
                'name': 'New', 'profile_id': asset.profile_id.id, 'purchase_value': 1, 'date_start': '2026-01-01',
            })
        with self.assertRaises(AccessError):
            self.env['account.move'].with_user(user).with_company(self.company).create({'move_type': 'entry'})
