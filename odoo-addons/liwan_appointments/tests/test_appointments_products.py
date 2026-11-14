# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import LiwanAppointmentsCase

PRODUCT_CAPABILITIES = ('products.read', 'products.manage', 'products.prices.manage')
PRODUCTS = '/api/v1/products'
SOURCES = {'saas': 'control_plane', 'non_saas': 'local_policy'}


@tagged('post_install', '-at_install', 'liwan')
class TestAppointmentsProductsRegistration(LiwanAppointmentsCase):
    """Appointments registers on liwan.products.service and grants its manager the product capabilities (plan D4)."""

    def test_the_application_registers_its_feature_and_pick_capability(self):
        service = self.env['liwan.products.service']
        self.assertIn('appointments.enabled', service._liwan_products_feature_keys())
        self.assertIn('appointments.bookings.manage', service._liwan_products_pick_capabilities())

    def test_the_built_in_manager_role_holds_the_product_capabilities(self):
        role = self.env.ref('liwan_appointments.role_appointments_manager')
        self.assertTrue(set(PRODUCT_CAPABILITIES) <= set(role.permission_ids.mapped('key')))
        self.assertNotIn('products.settings.manage', role.permission_ids.mapped('key'))
        access = self.env['liwan.access.service']
        for key in PRODUCT_CAPABILITIES:
            self.assertTrue(access._liwan_has_capability(self.manager, key))
            self.assertFalse(access._liwan_has_capability(self.booker, key))

    def test_the_built_in_manager_reads_the_product_list_and_detail_in_both_modes(self):
        product = self.env['product.template'].create({'name': 'Sold by a booking type', 'liwan_product': True})
        profile = self.env.ref('liwan_platform.tenant_profile')
        for mode, source in SOURCES.items():
            with self.subTest(mode=mode):
                self.env.cr.execute(
                    'UPDATE liwan_tenant_profile SET commercial_mode=%s, entitlement_source=%s, valid_until=NULL WHERE id=%s',
                    [mode, source, profile.id],
                )
                profile.invalidate_recordset()
                self.authenticate(self.manager.login, f'{self.manager.login}_pass_123')
                listed = self.api('GET', PRODUCTS)
                self.assertEqual(listed.status_code, 200, listed.text)
                self.assertIn(product.id, [item['id'] for item in listed.json()['items']])
                detail = self.api('GET', f'{PRODUCTS}/{product.id}')
                self.assertEqual(detail.status_code, 200, detail.text)

    def test_only_a_manager_may_pick_a_product(self):
        service = self.env['liwan.products.service']
        self.assertTrue(service.with_user(self.manager)._liwan_can_pick())
        self.assertFalse(service.with_user(self.booker)._liwan_can_pick())
