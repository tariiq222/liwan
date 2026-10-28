# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import fields
from odoo.tests import new_test_user, tagged

from .common import WebVueOrderCase
from odoo.addons.webvue_api.tests.common import set_probe_feature

SETTINGS = '/api/v1/payments/settings'
AUTOMATIC_INVOICE = 'sale.automatic_invoice'


@tagged('post_install', '-at_install', 'webvue')
class TestPaymentsSettings(WebVueOrderCase):
    """The unpaid-order expiry of the current company and the tenant's invoice-when-paid choice."""

    def patch(self, **body):
        return self.api('PATCH', SETTINGS, json=body)

    def test_the_defaults_are_read_until_a_company_saves_its_own(self):
        self.login_admin()
        self.assertEqual(self.api('GET', SETTINGS).json(), {
            'unpaid_order_expiry_minutes': 60, 'invoice_when_paid': True, 'revision': 0,
        })
        saved = self.patch(revision=0, unpaid_order_expiry_minutes=30, invoice_when_paid=False)
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json(), {'unpaid_order_expiry_minutes': 30, 'invoice_when_paid': False, 'revision': 1})
        self.assertEqual(self.env['ir.config_parameter'].sudo().get_param(AUTOMATIC_INVOICE), 'False')
        before = fields.Datetime.now()
        order = self.online_order()
        self.assertLess(order.webvue_payment_deadline, before + timedelta(minutes=31))

    def test_a_stale_or_invalid_change_is_refused(self):
        self.login_admin()
        self.assertEqual(self.patch(revision=0, unpaid_order_expiry_minutes=30).status_code, 200)
        stale = self.patch(revision=0, unpaid_order_expiry_minutes=45)
        self.assertEqual((stale.status_code, stale.json()['code']), (409, 'conflict'))
        for body, field in (
            ({'revision': 1, 'unpaid_order_expiry_minutes': 4}, 'unpaid_order_expiry_minutes'),
            ({'revision': 1, 'unpaid_order_expiry_minutes': 1441}, 'unpaid_order_expiry_minutes'),
            ({'revision': 1, 'unpaid_order_expiry_minutes': '30'}, 'unpaid_order_expiry_minutes'),
            ({'revision': 1, 'invoice_when_paid': 'yes'}, 'invoice_when_paid'),
            ({'revision': 1, 'company_id': 1}, 'company_id'),
            ({'unpaid_order_expiry_minutes': 30}, 'revision'),
        ):
            with self.subTest(field=field):
                response = self.patch(**body)
                self.assertEqual((response.status_code, response.json()['field']), (422, field))

    def test_only_a_settings_manager_reads_or_changes_them(self):
        new_test_user(
            self.env, login='payments_employee', password='payments_employee_pass_123',
            groups='webvue_core.group_employee',
        )
        self.authenticate('payments_employee', 'payments_employee_pass_123')
        self.assertEqual(self.api('GET', SETTINGS).status_code, 403)
        self.assertEqual(self.patch(revision=0, invoice_when_paid=False).status_code, 403)
        self.assertEqual(self.env['ir.config_parameter'].sudo().get_param(AUTOMATIC_INVOICE), 'True')

    def test_a_closed_feature_refuses_the_settings_routes(self):
        self.login_admin()
        set_probe_feature(self, key='payments.enabled', enabled=False)
        self.assertEqual(self.api('GET', SETTINGS).status_code, 403)
        self.assertEqual(self.patch(revision=0, unpaid_order_expiry_minutes=30).status_code, 403)
