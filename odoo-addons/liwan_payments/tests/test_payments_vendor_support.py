# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import new_test_user, tagged

from .common import LiwanPaymentsCase
from odoo.addons.liwan_payments.models.access_service import PERMISSIONS
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

SUPPORT_PASSWORD = 'payments_support_pass_123'


@tagged('post_install', '-at_install', 'liwan')
class TestPaymentsVendorSupport(LiwanPaymentsCase):
    """Vendor support holds no payments permission: it reads no order and changes no gateway."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.env.ref('liwan_platform.tenant_profile').with_context(**{OPERATOR_CONTEXT: True}).write({
            'support_access_enabled': True,
        })
        cls.support = new_test_user(
            cls.env, login='payments_support_live', password=SUPPORT_PASSWORD,
            groups='liwan_core.group_vendor_support', company_id=cls.env.company.id,
            company_ids=[Command.set(cls.env.company.ids)],
        )

    def test_support_holds_no_payments_permission(self):
        effective = self.env['liwan.access.service'].with_user(self.support).with_company(self.env.company)
        self.assertFalse(effective._liwan_capability_keys() & set(PERMISSIONS))

    def test_support_cannot_list_orders(self):
        self.authenticate(self.support.login, SUPPORT_PASSWORD)
        response = self.api('GET', '/api/v1/payments/orders')
        self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'), response.text)

    def test_support_cannot_change_a_gateway(self):
        self.authenticate(self.support.login, SUPPORT_PASSWORD)
        response = self.api('PATCH', f'/api/v1/payments/providers/{self.paymob.id}', json={})
        self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'), response.text)
