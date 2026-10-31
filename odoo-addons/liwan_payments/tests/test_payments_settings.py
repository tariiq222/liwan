# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import fields
from odoo.tests import new_test_user, tagged

from .common import LiwanOrderCase
from odoo.addons.liwan_api.tests.common import set_probe_feature

SETTINGS = '/api/v1/payments/settings'
AUTOMATIC_INVOICE = 'sale.automatic_invoice'


@tagged('post_install', '-at_install', 'liwan')
class TestPaymentsSettings(LiwanOrderCase):
    """The unpaid-order expiry of the current company and the tenant's invoice-when-paid choice."""

    def patch(self, **body):
        return self.api('PATCH', SETTINGS, json=body)

    def test_the_defaults_are_read_until_a_company_saves_its_own(self):
        self.login_admin()
        self.assertEqual(self.api('GET', SETTINGS).json(), {
            'unpaid_order_expiry_minutes': 60, 'invoice_when_paid': True, 'refund_policy': 'full', 'refund_amounts': 'due',
            'tax_mode': 'included', 'revision': 0,
        })
        saved = self.patch(
            revision=0, unpaid_order_expiry_minutes=30, invoice_when_paid=False, refund_policy='none', refund_amounts='any',
        )
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json(), {
            'unpaid_order_expiry_minutes': 30, 'invoice_when_paid': False, 'refund_policy': 'none', 'refund_amounts': 'any',
            'tax_mode': 'included', 'revision': 1,
        })
        self.assertEqual(self.env['ir.config_parameter'].sudo().get_param(AUTOMATIC_INVOICE), 'False')
        before = fields.Datetime.now()
        order = self.online_order()
        self.assertLess(order.liwan_payment_deadline, before + timedelta(minutes=31))

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
            ({'revision': 1, 'refund_policy': 'notice'}, 'refund_policy'),
            ({'revision': 1, 'refund_policy': ['full']}, 'refund_policy'),
            ({'revision': 1, 'refund_amounts': 'some'}, 'refund_amounts'),
            ({'revision': 1, 'company_id': 1}, 'company_id'),
            ({'unpaid_order_expiry_minutes': 30}, 'revision'),
        ):
            with self.subTest(field=field):
                response = self.patch(**body)
                self.assertEqual((response.status_code, response.json()['field']), (422, field))

    def test_a_revision_alone_changes_nothing_and_is_refused(self):
        self.login_admin()
        before = self.api('GET', SETTINGS).json()['revision']
        response = self.patch(revision=before)
        self.assertEqual((response.status_code, response.json()['code']), (422, 'invalid'))
        self.assertEqual(response.json()['message'], 'at least one field is required')
        self.assertEqual(self.api('GET', SETTINGS).json()['revision'], before)

    def test_only_a_settings_manager_reads_or_changes_them(self):
        new_test_user(
            self.env, login='payments_employee', password='payments_employee_pass_123',
            groups='liwan_core.group_employee',
        )
        self.authenticate('payments_employee', 'payments_employee_pass_123')
        self.assertEqual(self.api('GET', SETTINGS).status_code, 403)
        self.assertEqual(self.patch(revision=0, invoice_when_paid=False).status_code, 403)
        self.assertEqual(self.env['ir.config_parameter'].sudo().get_param(AUTOMATIC_INVOICE), 'True')

    def test_only_a_manager_of_the_root_company_changes_invoicing_for_the_whole_tenant(self):
        root = self.env['liwan.entitlement.service']._liwan_profile().root_company_id
        other = self.env['res.company'].create({'name': 'Second payments company'})
        user = new_test_user(
            self.env, login='payments_other', password='payments_other_pass_123', groups='liwan_core.group_employee',
            company_ids=[(6, 0, [root.id, other.id])], company_id=other.id,
        )
        self.env['liwan.access.service']._liwan_replace_assignments(user, [{
            'role_id': self.env.ref('liwan_core.role_system_admin').id, 'company_id': other.id,
        }])
        self.authenticate('payments_other', 'payments_other_pass_123')
        refused = self.patch(revision=0, invoice_when_paid=False)
        self.assertEqual(refused.status_code, 403)
        self.assertEqual(self.env['ir.config_parameter'].sudo().get_param(AUTOMATIC_INVOICE), 'True')
        own = self.patch(revision=0, unpaid_order_expiry_minutes=20)
        self.assertEqual((own.status_code, own.json()['unpaid_order_expiry_minutes']), (200, 20))
        self.assertEqual(self.env['liwan.payments.settings']._liwan_for(other).unpaid_order_expiry_minutes, 20)
        self.assertFalse(self.env['liwan.payments.settings']._liwan_for(root))

    def test_a_closed_feature_refuses_the_settings_routes(self):
        self.login_admin()
        set_probe_feature(self, key='payments.enabled', enabled=False)
        self.assertEqual(self.api('GET', SETTINGS).status_code, 403)
        self.assertEqual(self.patch(revision=0, unpaid_order_expiry_minutes=30).status_code, 403)
