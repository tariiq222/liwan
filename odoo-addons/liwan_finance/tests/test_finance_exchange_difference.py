# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .write_common import INVOICES, PAYMENTS, LiwanFinanceWriteCase


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceExchangeDifference(LiwanFinanceWriteCase):
    """A USD invoice booked at 3.75 SAR and paid at 3.80 SAR leaves a 50 SAR exchange gain."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        usd = cls.env.ref('base.USD')
        usd.active = True
        for day, rate in (('2026-10-01', 3.75), ('2026-10-20', 3.80), ('2026-10-25', 3.70)):
            cls.env['res.currency.rate'].create({
                'currency_id': usd.id, 'name': day, 'rate': 1 / rate, 'company_id': cls.company.id,
            })

    def usd_invoice(self, kind='out_invoice'):
        body = self.invoice_body(move_type=kind, currency='USD', invoice_date='2026-10-01', lines=[
            {'name': 'Export service', 'quantity': 1, 'price_unit': 1000, 'tax_ids': []},
        ])
        if kind == 'in_invoice':
            body['partner_id'] = self.vendor.id
        return self.posted_invoice(body)

    def pay(self, invoice, day):
        result = self.api('POST', PAYMENTS, json=self.pay_body([invoice], payment_date=day))
        self.assertEqual(result.status_code, 201, result.text)
        return result.json()

    def test_a_dearer_dollar_on_a_sale_is_an_exchange_gain(self):
        invoice = self.usd_invoice()
        payment = self.pay(invoice, '2026-10-20')
        self.assertEqual(self.api('GET', f'{INVOICES}/{invoice["id"]}').json()['payment_state'], 'paid')
        self.assertEqual(payment['exchange_difference'], 50)

    def test_a_cheaper_dollar_on_a_sale_is_an_exchange_loss(self):
        payment = self.pay(self.usd_invoice(), '2026-10-25')
        self.assertEqual(payment['exchange_difference'], -50)

    def test_a_payment_in_the_company_currency_has_none(self):
        payment = self.pay(self.posted_invoice(), '2026-10-19')
        self.assertEqual(payment['exchange_difference'], 0)

    def test_a_dearer_dollar_on_a_bill_is_an_exchange_loss(self):
        payment = self.pay(self.usd_invoice('in_invoice'), '2026-10-20')
        self.assertEqual(payment['exchange_difference'], -50)
