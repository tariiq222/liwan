# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import TransactionCase, new_test_user, tagged

from .common import (
    MANAGER_LOGIN,
    MANAGER_PASSWORD,
    OUTSIDER_LOGIN,
    OUTSIDER_PASSWORD,
    WebVueFinanceCase,
)
from .write_common import WebVueFinanceWriteCase
from odoo.addons.webvue_finance.models.access_service import (
    FINANCE_ACCOUNTANT_PERMISSIONS,
    FINANCE_AUDITOR_PERMISSIONS,
    FINANCE_PERMISSIONS,
)

ROUTES = (
    '/api/v1/finance/invoices',
    '/api/v1/finance/payments',
    '/api/v1/finance/accounts',
    '/api/v1/finance/journals',
)


@tagged('post_install', '-at_install', 'webvue', 'webvue_access')
class TestFinanceAccessComposition(TransactionCase):
    """webvue_finance owns its capabilities, groups and role (spec R2) and runs at install."""

    def test_owns_its_capabilities_and_their_groups(self):
        catalog = self.env['webvue.access.service']._webvue_capability_map()
        self.assertEqual(
            {key for key, item in catalog.items() if item['owner'] == 'webvue_finance'},
            set(FINANCE_PERMISSIONS),
        )
        permissions = self.env['webvue.access.permission'].search([('key', 'in', sorted(FINANCE_PERMISSIONS))])
        self.assertEqual(len(permissions), len(FINANCE_PERMISSIONS))
        for permission in permissions:
            self.assertTrue(permission.group_xmlid.startswith('webvue_finance.group_cap_finance_'), permission.key)
            self.assertTrue(self.env.ref(permission.group_xmlid, raise_if_not_found=False), permission.key)

    def test_the_manager_role_is_unique_and_granted_to_support_but_not_to_employees(self):
        role = self.env.ref('webvue_finance.role_finance_manager')
        self.assertEqual((role.key, role.type, role.protected), ('finance_manager', 'built_in', True))
        self.assertEqual(self.env['webvue.access.role'].search_count([('key', '=', 'finance_manager')]), 1)
        self.assertEqual(set(role.permission_ids.mapped('key')), set(FINANCE_PERMISSIONS))
        support = set(self.env.ref('webvue_core.role_vendor_support').permission_ids.mapped('key'))
        employee = set(self.env.ref('webvue_core.role_employee').permission_ids.mapped('key'))
        self.assertTrue(support >= FINANCE_PERMISSIONS)
        self.assertFalse(employee & FINANCE_PERMISSIONS)

    def test_the_legacy_group_still_grants_the_capabilities(self):
        manager = new_test_user(self.env, login='finance_comp_manager', groups='webvue_finance.group_finance_manager')
        employee = new_test_user(self.env, login='finance_comp_employee', groups='webvue_core.group_employee')
        service = self.env['webvue.access.service']
        self.assertTrue(service._webvue_capability_keys(manager) >= FINANCE_PERMISSIONS)
        self.assertFalse(service._webvue_capability_keys(employee) & FINANCE_PERMISSIONS)


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceRouteAccess(WebVueFinanceCase):

    def test_a_user_without_the_capability_gets_403_forbidden_on_every_route(self):
        self.authenticate(OUTSIDER_LOGIN, OUTSIDER_PASSWORD)
        for route in (*ROUTES, f'{ROUTES[0]}/{self.invoice.id}'):
            with self.subTest(route=route):
                result = self.api('GET', route)
                self.assertEqual((result.status_code, result.json()['code']), (403, 'forbidden'))

    def test_the_finance_manager_reads_every_route(self):
        self.authenticate(MANAGER_LOGIN, MANAGER_PASSWORD)
        for route in (*ROUTES, f'{ROUTES[0]}/{self.invoice.id}'):
            with self.subTest(route=route):
                self.assertEqual(self.api('GET', route).status_code, 200)

    def test_the_collection_routes_have_no_patch_or_delete(self):
        self.authenticate(MANAGER_LOGIN, MANAGER_PASSWORD)
        for route in ROUTES:
            for method in ('PATCH', 'DELETE'):
                with self.subTest(route=route, method=method):
                    self.assertNotEqual(self.api(method, route, json={}).status_code, 200)


@tagged('post_install', '-at_install', 'webvue', 'webvue_access')
class TestFinanceBuiltinRoles(TransactionCase):

    def _role(self, xmlid, key):
        role = self.env.ref(xmlid)
        self.assertEqual((role.key, role.type, role.protected, role.assignable), (key, 'built_in', True, True))
        self.assertEqual(self.env['webvue.access.role'].search_count([('key', '=', key)]), 1)
        return role

    def _assert_closed_under_dependencies(self, keys):
        dependencies = self.env['webvue.access.service']._webvue_permission_dependencies()
        for key in keys:
            self.assertLessEqual(dependencies.get(key, set()), keys, key)

    def test_the_accountant_role(self):
        role = self._role('webvue_finance.role_finance_accountant', 'finance_accountant')
        self.assertEqual(set(role.permission_ids.mapped('key')), FINANCE_ACCOUNTANT_PERMISSIONS)
        self.assertLessEqual(FINANCE_ACCOUNTANT_PERMISSIONS, FINANCE_PERMISSIONS)
        self._assert_closed_under_dependencies(FINANCE_ACCOUNTANT_PERMISSIONS)
        for key in (
            'finance.invoices.post', 'finance.entries.post', 'finance.closing.manage', 'finance.closing.read',
            'finance.setup.manage', 'finance.zatca.manage', 'finance.budgets.manage', 'finance.assets.manage',
            'finance.analytic.manage', 'finance.accounts.manage', 'finance.audit.read', 'finance.zakat.read',
        ):
            self.assertNotIn(key, FINANCE_ACCOUNTANT_PERMISSIONS)

    def test_the_auditor_role_is_read_only(self):
        role = self._role('webvue_finance.role_finance_auditor', 'finance_auditor')
        self.assertEqual(set(role.permission_ids.mapped('key')), FINANCE_AUDITOR_PERMISSIONS)
        self.assertLessEqual(FINANCE_AUDITOR_PERMISSIONS, FINANCE_PERMISSIONS)
        self._assert_closed_under_dependencies(FINANCE_AUDITOR_PERMISSIONS)
        self.assertEqual(len(FINANCE_AUDITOR_PERMISSIONS), 17)
        self.assertTrue(all(key.endswith('.read') for key in FINANCE_AUDITOR_PERMISSIONS))


ACCOUNTANT_LOGIN = 'finance_accountant'
ACCOUNTANT_PASSWORD = 'finance_accountant_pass_123'
AUDITOR_LOGIN = 'finance_auditor'
AUDITOR_PASSWORD = 'finance_auditor_pass_123'
FINANCE = '/api/v1/finance'
PERIOD = '?date_from=2026-01-01&date_to=2026-12-31'
END = '?date_to=2026-12-31'


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceBuiltinRoleRoutes(WebVueFinanceWriteCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        for login, password, role in (
            (ACCOUNTANT_LOGIN, ACCOUNTANT_PASSWORD, 'role_finance_accountant'),
            (AUDITOR_LOGIN, AUDITOR_PASSWORD, 'role_finance_auditor'),
        ):
            user = new_test_user(
                cls.env, login=login, password=password, name=login,
                groups='webvue_core.group_employee', company_id=cls.company.id, company_ids=[Command.set(cls.company.ids)],
            )
            cls.env['webvue.access.service']._webvue_replace_assignments(user, [{
                'role_id': cls.env.ref(f'webvue_finance.{role}').id, 'company_id': cls.company.id,
            }])
        cls.general = cls._journal(cls.company, 'general')
        accounts = cls.env['account.account'].with_company(cls.company)
        cls.expense = accounts.search([('company_ids', 'in', cls.company.id), ('account_type', '=', 'expense')], limit=1)
        cls.income = accounts.search([('company_ids', 'in', cls.company.id), ('account_type', '=', 'income')], limit=1)
        cls.draft_entry = cls.env['account.move'].with_company(cls.company).create({
            'move_type': 'entry', 'journal_id': cls.general.id, 'date': '2026-10-18',
            'line_ids': [
                Command.create({'account_id': cls.expense.id, 'name': 'Rent', 'debit': 500}),
                Command.create({'account_id': cls.income.id, 'name': 'Rent', 'credit': 500}),
            ],
        })
        cls.draft_invoice = cls._draft_sale_invoice(cls.company, cls.partner)

    def entry_body(self):
        return {
            'journal_id': self.general.id, 'date': '2026-10-18', 'ref': 'ACC-1',
            'lines': [
                {'account_id': self.expense.id, 'name': 'Rent', 'debit': 500},
                {'account_id': self.income.id, 'name': 'Rent', 'credit': 500},
            ],
        }

    def assertForbidden(self, method, route, body=None):
        result = self.api(method, route, json=body if body is not None else {})
        self.assertEqual((result.status_code, result.json().get('code')), (403, 'forbidden'), f'{method} {route}')

    def test_the_auditor_reads_every_area(self):
        self.authenticate(AUDITOR_LOGIN, AUDITOR_PASSWORD)
        for route in (
            f'{FINANCE}/invoices', f'{FINANCE}/payments', f'{FINANCE}/partners', f'{FINANCE}/accounts',
            f'{FINANCE}/journals', f'{FINANCE}/entries', f'{FINANCE}/bank-statements',
            f'{FINANCE}/reports/trial-balance{PERIOD}', f'{FINANCE}/reports/zakat-base{END}',
            f'{FINANCE}/audit-events', f'{FINANCE}/budgets', f'{FINANCE}/assets',
            f'{FINANCE}/analytic-accounts', f'{FINANCE}/fiscal-years', f'{FINANCE}/setup', f'{FINANCE}/zatca/status',
        ):
            with self.subTest(route=route):
                self.assertEqual(self.api('GET', route).status_code, 200, route)

    def test_the_auditor_cannot_write_in_any_area(self):
        self.authenticate(AUDITOR_LOGIN, AUDITOR_PASSWORD)
        for method, route in (
            ('POST', f'{FINANCE}/invoices'), ('POST', f'{FINANCE}/payments'), ('POST', f'{FINANCE}/partners'),
            ('POST', f'{FINANCE}/entries'), ('POST', f'{FINANCE}/bank-statements'), ('POST', f'{FINANCE}/budgets'),
            ('POST', f'{FINANCE}/assets'), ('POST', f'{FINANCE}/analytic-accounts'),
            ('POST', f'{FINANCE}/fiscal-years/2026/close'), ('PATCH', f'{FINANCE}/setup/fiscal'),
            ('POST', f'{FINANCE}/zatca/journals/{self.bank.id}/onboard'),
            ('POST', f'{FINANCE}/invoices/{self.draft_invoice.id}/post'),
            ('POST', f'{FINANCE}/entries/{self.draft_entry.id}/post'),
        ):
            with self.subTest(method=method, route=route):
                self.assertForbidden(method, route)

    def test_the_accountant_reads_and_writes_day_to_day_records(self):
        self.authenticate(ACCOUNTANT_LOGIN, ACCOUNTANT_PASSWORD)
        for route in (f'{FINANCE}/invoices', f'{FINANCE}/payments', f'{FINANCE}/bank-statements', f'{FINANCE}/reports/trial-balance{PERIOD}'):
            with self.subTest(route=route):
                self.assertEqual(self.api('GET', route).status_code, 200, route)
        result = self.api('POST', f'{FINANCE}/entries', json=self.entry_body())
        self.assertEqual(result.status_code, 201, result.text)

    def test_the_accountant_cannot_post_close_set_up_onboard_or_read_audit_and_zakat(self):
        self.authenticate(ACCOUNTANT_LOGIN, ACCOUNTANT_PASSWORD)
        for method, route in (
            ('POST', f'{FINANCE}/entries/{self.draft_entry.id}/post'),
            ('POST', f'{FINANCE}/invoices/{self.draft_invoice.id}/post'),
            ('POST', f'{FINANCE}/zatca/journals/{self.bank.id}/onboard'),
            ('POST', f'{FINANCE}/fiscal-years/2026/close'),
            ('PATCH', f'{FINANCE}/setup/fiscal'),
            ('GET', f'{FINANCE}/audit-events'),
            ('GET', f'{FINANCE}/reports/zakat-base{END}'),
        ):
            with self.subTest(method=method, route=route):
                self.assertForbidden(method, route)
