# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import fields

from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_payments.tests.common import LiwanOrderCase
from odoo.addons.liwan_sales.tests.common import QuotationCase, png_base64

SETTINGS = '/api/v1/sales/settings'
ORDERS = '/api/v1/sales/orders'
PUBLIC = '/api/v1/public/sales/quotations'
PAYMENTS = 'payments.enabled'
TOTAL = 90.0


class SalesPaymentsCase(LiwanOrderCase, QuotationCase):
    """Sales users and quotations, with a live gateway: a quotation of 90 SAR (two units of 50 with a 10% discount)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # The payments fixture sells in SAR through the price list of its customer; quotations and the staff buyer use it too.
        cls.sar_pricelist = cls.customer.property_product_pricelist
        cls.buyer = cls.party('Payment buyer')
        cls.buyer.property_product_pricelist = cls.sar_pricelist

    @classmethod
    def set_default(cls, mode='off', percent=50):
        cls.env['liwan.sales.settings']._liwan_current().write({'payment_to_confirm': mode, 'prepayment_percent': percent})

    def payments(self, enabled):
        set_probe_feature(self, key=PAYMENTS, enabled=enabled)

    def payable(self, mode='full', percent=None, answer='accept', signature_methods='draw_or_type', **values):
        """A quotation of 90 SAR sent under the answer mode ``answer``, which asks to be paid in ``mode`` ('percent' takes
        ``percent``). Returned in the superuser environment."""
        values.setdefault('pricelist_id', self.sar_pricelist.id)
        if mode != 'off':
            values.update(require_payment=True, prepayment_percent=1.0 if mode == 'full' else percent / 100)
        return self.sent(answer, signature_methods=signature_methods, **values)

    def lapse(self, order):
        """Let the validity date of ``order`` pass."""
        order.validity_date = fields.Date.today() - timedelta(days=1)

    def order_body(self, **extra):
        return {'customer_id': self.buyer.id, 'lines': [self.product_line(self.plain)], **extra}

    def anon(self, method, path, json=None):
        self.authenticate(None, None)
        return self.api(method, path, json=json)

    def public(self, order, suffix='', token=None):
        return self.anon('GET', f'{PUBLIC}/{order.id}{suffix}?access_token={token or order.access_token}')

    def accept(self, order, body=None):
        return self.anon('POST', f'{PUBLIC}/{order.id}/accept', {'access_token': order.access_token, **(body or {})})

    @staticmethod
    def sign_body():
        return {'signed_by': 'Mona', 'signature': png_base64(), 'signature_method': 'drawn'}
