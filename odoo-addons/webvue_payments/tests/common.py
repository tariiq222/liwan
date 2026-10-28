# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user

from odoo.addons.webvue_api.tests.common import WebVueApiCase

PAYMOB_CREDENTIALS = {
    'paymob_public_key': 'egy_pk_test_spike',
    'paymob_secret_key': 'egy_sk_test_never_returned',
    'paymob_hmac_key': 'hmac_never_returned',
    'paymob_api_key': 'api_never_returned',
}


class WebVuePaymentsCase(WebVueApiCase):
    """The shared webvue_api fixture plus a system administrator and the company's stock Paymob provider."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(
            cls.env, login='payments_admin', password='payments_admin_pass_123',
            name='Payments administrator', groups='webvue_core.group_employee',
        )
        cls.env['webvue.access.service']._webvue_replace_assignments(cls.admin, [{
            'role_id': cls.env.ref('webvue_core.role_system_admin').id,
            'company_id': cls.env.company.id,
        }])
        cls.paymob = cls.env['payment.provider'].search([
            ('code', '=', 'paymob'), ('company_id', '=', cls.env.company.id),
        ], limit=1)

    def login_admin(self):
        self.authenticate('payments_admin', 'payments_admin_pass_123')
