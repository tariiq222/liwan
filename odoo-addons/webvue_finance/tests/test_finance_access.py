# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, new_test_user, tagged

from .common import (
    MANAGER_LOGIN,
    MANAGER_PASSWORD,
    OUTSIDER_LOGIN,
    OUTSIDER_PASSWORD,
    WebVueFinanceCase,
)
from odoo.addons.webvue_finance.models.access_service import FINANCE_PERMISSIONS

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

    def test_the_routes_are_read_only(self):
        self.authenticate(MANAGER_LOGIN, MANAGER_PASSWORD)
        for method in ('POST', 'PATCH', 'DELETE'):
            with self.subTest(method=method):
                self.assertNotEqual(self.api(method, ROUTES[0], json={}).status_code, 200)
