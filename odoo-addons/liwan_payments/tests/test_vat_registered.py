# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import tagged

from .common import LiwanOrderCase

SAUDI_VAT = '300000000000003'


@tagged('post_install', '-at_install', 'liwan')
class TestNoTaxWithoutVatRegistration(LiwanOrderCase):
    """A company that is not registered for VAT sells untaxed, whatever its products, prices or tax setting say."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.vat = cls.env['account.tax'].create({
            'name': 'Order VAT 15%', 'amount': 15.0, 'amount_type': 'percent', 'type_tax_use': 'sale',
            'company_id': cls.env.company.id,
        })
        cls.service.taxes_id = [Command.set(cls.vat.ids)]

    def register(self, registered):
        """Switch the company's VAT registration, giving it a valid number when it registers."""
        self.env.company.write({'vat': SAUDI_VAT, 'liwan_vat_registered': registered})

    def set_tax_mode(self, mode):
        self.env['liwan.payments.settings'].search([('company_id', '=', self.env.company.id)]).unlink()
        self.env['liwan.payments.settings'].create({'company_id': self.env.company.id, 'tax_mode': mode})

    def payable(self, order):
        response = self.api('GET', f'/api/v1/public/payments/orders/{order.id}?access_token={order._portal_ensure_token()}')
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_the_product_tax_never_reaches_an_unregistered_company_order(self):
        order = self.online_order()
        self.assertEqual((order.order_line.tax_ids, order.amount_tax), (self.env['account.tax'], 0.0))
        self.assertEqual((order.amount_untaxed, order.amount_total), (115.0, 115.0))
        body = self.payable(order)
        self.assertEqual((body['amount_untaxed'], body['amount_tax'], body['amount_total']), (115.0, 0.0, 115.0))
        self.assertEqual(body['amount_due'], 115.0)

    def test_the_price_the_customer_pays_is_the_price_the_seller_set(self):
        # A price that would not survive an inclusive tax (an odd cent) is charged whole, with no tax line.
        self.service.list_price = 99.99
        self.customer.property_product_pricelist.item_ids.fixed_price = 99.99
        order = self.online_order()
        self.assertEqual((order.amount_total, order.amount_tax), (99.99, 0.0))
        self.assertEqual(self.payable(order)['amount_tax'], 0.0)

    def test_the_tax_mode_setting_is_ignored_even_when_it_says_the_tax_is_added(self):
        self.set_tax_mode('added')
        order = self.online_order()
        self.assertEqual((order.amount_untaxed, order.amount_tax, order.amount_total), (115.0, 0.0, 115.0))

    def test_a_company_that_turns_registration_on_charges_the_tax_again_on_new_orders(self):
        self.register(True)
        order = self.online_order()
        self.assertEqual((order.amount_untaxed, order.amount_tax, order.amount_total), (100.0, 15.0, 115.0))
        self.assertEqual(self.payable(order)['amount_tax'], 15.0)

    def test_an_order_issued_before_registration_keeps_what_it_was_issued_with(self):
        order = self.online_order()
        self.register(True)
        order.invalidate_recordset()
        self.assertEqual((order.amount_untaxed, order.amount_tax, order.amount_total), (115.0, 0.0, 115.0))
        self.assertEqual(self.payable(order)['amount_tax'], 0.0)

    def test_the_settings_report_whether_the_company_is_registered(self):
        self.login_admin()
        body = self.api('GET', '/api/v1/payments/settings').json()
        self.assertFalse(body['vat_registered'])
        self.assertEqual(body['tax_mode'], 'included')
        self.register(True)
        self.assertTrue(self.api('GET', '/api/v1/payments/settings').json()['vat_registered'])

    def test_every_line_added_to_an_unregistered_order_carries_no_tax(self):
        order = self.online_order()
        extra = self.env['liwan.payments.service']._liwan_add_line(order, self.service, quantity=3)
        self.assertEqual((extra.tax_ids, extra.price_total), (self.env['account.tax'], 345.0))
        self.assertEqual(order.amount_tax, 0.0)

    def test_the_credit_note_of_an_unregistered_order_carries_no_tax(self):
        self.env['liwan.payments.settings'].create({'company_id': self.env.company.id, 'tax_mode': 'added'})
        order = self.online_order()
        self.pay(order, 115.0)
        invoices, _credit_notes = order._liwan_invoices_and_credit_notes()
        if not invoices:
            self.skipTest('invoicing on payment is off in this fixture')
        self.assertEqual((invoices.amount_tax, invoices.amount_total), (0.0, 115.0))
        credit_notes = order._liwan_credit_notes(115.0)
        self.assertEqual((credit_notes.amount_tax, credit_notes.amount_total), (0.0, 115.0))

    def test_a_registered_company_gets_its_tax_back_when_it_turns_registration_off(self):
        self.register(True)
        taxed = self.online_order()
        self.assertEqual(taxed.amount_tax, 15.0)
        self.register(False)
        untaxed = self.online_order()
        self.assertEqual(untaxed.amount_tax, 0.0)
