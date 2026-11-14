# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.exceptions import ValidationError
from odoo.tests import tagged

from .common import (
    TAX_EXCLUDED,
    TAX_INCLUDED,
    LiwanOrderCase,
    branch_values,
    company_values,
)

SAUDI_VAT = '300000000000003'


@tagged('post_install', '-at_install', 'liwan')
class TestNoTaxWithoutVatRegistration(LiwanOrderCase):
    """An establishment that is not registered for VAT sells untaxed, whatever its products, prices or tax setting say.

    The registration is one decision, stored on the establishment's root company: a branch answers it through
    ``_liwan_vat_registered()``.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.vat = cls.env['account.tax'].create({
            'name': 'Order VAT 15%', 'amount': 15.0, 'amount_type': 'percent', 'type_tax_use': 'sale',
            'company_id': cls.env.company.id,
        })
        cls.service.taxes_id = [Command.set(cls.vat.ids)]

    def fresh_company(self, name, registered=True):
        """A company of its own, whose stock tax mode can still be chosen (it has no journal item)."""
        company = self.env['res.company'].create(company_values(
            name, price_mode=TAX_INCLUDED,
            country_id=self.env.ref('base.sa').id, currency_id=self.env.ref('base.SAR').id,
        ))
        if registered:
            company.write({'vat': SAUDI_VAT, 'liwan_vat_registered': True})
        return company

    def company_product(self, company, tax):
        """The 115 service sold by ``company``, carrying a sale tax ``company`` owns (stock filters by company)."""
        return self.env['product.product'].create({
            'name': f'{company.name} consultation', 'type': 'service', 'list_price': 115.0,
            'taxes_id': [Command.set(tax.ids)],
        })

    def company_tax(self, company):
        group = self.env['account.tax.group'].create({'name': f'{company.name} taxes', 'company_id': company.id})
        return self.env['account.tax'].create({
            'name': f'{company.name} VAT 15%', 'amount': 15.0, 'amount_type': 'percent', 'type_tax_use': 'sale',
            'company_id': company.id, 'tax_group_id': group.id,
        })

    def register(self, registered):
        """Switch the establishment's VAT registration, giving it a valid number when it registers."""
        self.env.company.write({'vat': SAUDI_VAT, 'liwan_vat_registered': registered})

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
        self.assertFalse(body['tax_applies'])

    def test_the_price_the_customer_pays_is_the_price_the_seller_set(self):
        # A price that would not survive an inclusive tax (an odd cent) is charged whole, with no tax line.
        self.service.list_price = 99.99
        self.customer.property_product_pricelist.item_ids.fixed_price = 99.99
        order = self.online_order()
        self.assertEqual((order.amount_total, order.amount_tax), (99.99, 0.0))
        self.assertEqual(self.payable(order)['amount_tax'], 0.0)

    def test_no_tax_is_charged_under_either_company_tax_mode(self):
        # The fixture company already posted an invoice, so stock locks its tax mode; a fresh unregistered one
        # can still hold either value, and both charge nothing.
        for mode in (TAX_INCLUDED, TAX_EXCLUDED):
            with self.subTest(mode=mode):
                company = self.fresh_company(f'Unregistered {mode}', registered=False)
                product = self.company_product(company, self.company_tax(company))
                self.set_price_mode(company, mode)
                order = self.online_order(company=company, product=product)
                self.assertEqual((order.order_line.tax_ids, order.amount_untaxed, order.amount_tax, order.amount_total),
                                 (self.env['account.tax'], 115.0, 0.0, 115.0))

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

    def test_the_settings_answer_carries_no_tax_choice_of_the_establishment(self):
        # Registration and price mode are the establishment's own tax choice (company settings), not payments settings.
        self.login_admin()
        for registered in (False, True):
            with self.subTest(registered=registered):
                self.register(registered)
                body = self.api('GET', '/api/v1/payments/settings').json()
                self.assertFalse({'vat_registered', 'tax_mode'} & set(body))

    def test_an_order_of_a_branch_of_an_unregistered_establishment_charges_no_tax_under_either_mode(self):
        country = {'country_id': self.env.ref('base.sa').id, 'currency_id': self.env.ref('base.SAR').id}
        root = self.fresh_company('Unregistered root', registered=False)
        branch = self.env['res.company'].create(branch_values('Unregistered branch', root, **country))
        # The old model let a branch row store a registration of its own; this one cannot express it (a branch row
        # that tried is refused), so the establishment's answer is the root's alone.
        with self.assertRaises(ValidationError), self.env.cr.savepoint():
            branch.write({'vat': SAUDI_VAT, 'liwan_vat_registered': True})
        self.assertEqual((branch.liwan_vat_registered, branch._liwan_vat_registered()), (False, False))
        branch_product = self.company_product(branch, self.company_tax(branch))
        root_product = self.company_product(root, self.company_tax(root))
        for mode in (TAX_INCLUDED, TAX_EXCLUDED):
            for label, product in (('branch-owned tax', branch_product), ('root-owned tax', root_product)):
                with self.subTest(mode=mode, tax=label):
                    self.set_price_mode(root, mode)
                    order = self.online_order(company=branch, product=product)
                    self.assertEqual(
                        (order.order_line.tax_ids, order.amount_untaxed, order.amount_tax, order.amount_total),
                        (self.env['account.tax'], 115.0, 0.0, 115.0),
                    )

    def test_every_line_added_to_an_unregistered_order_carries_no_tax(self):
        order = self.online_order()
        extra = self.env['liwan.payments.service']._liwan_add_line(order, self.service, quantity=3)
        self.assertEqual((extra.tax_ids, extra.price_total), (self.env['account.tax'], 345.0))
        self.assertEqual(order.amount_tax, 0.0)

    def test_the_credit_note_of_an_unregistered_order_carries_no_tax(self):
        order = self.online_order()
        self.pay(order, 115.0)
        invoices, _credit_notes = order._liwan_invoices_and_credit_notes()
        self.assertTrue(invoices, 'paying the order must have invoiced it')
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

    def test_the_pay_page_shows_tax_rows_for_a_registered_company_even_when_the_document_has_no_tax(self):
        self.register(True)
        self.service.taxes_id = [Command.clear()]
        order = self.online_order()
        self.assertEqual(order.amount_tax, 0.0)
        self.assertTrue(self.payable(order)['tax_applies'])

    def test_the_pay_page_shows_tax_rows_for_a_registered_company_with_a_taxed_document(self):
        self.register(True)
        order = self.online_order()
        self.assertEqual(order.amount_tax, 15.0)
        self.assertTrue(self.payable(order)['tax_applies'])

    def test_the_pay_page_keeps_the_tax_rows_of_a_taxed_document_after_the_company_deregisters(self):
        self.register(True)
        order = self.online_order()
        self.register(False)
        order.invalidate_recordset()
        self.assertEqual(order.amount_tax, 15.0)
        self.assertTrue(self.payable(order)['tax_applies'])

    def test_the_pay_page_shows_no_tax_rows_for_an_untaxed_document_of_an_unregistered_company(self):
        order = self.online_order()
        self.assertEqual((order.amount_tax, self.env.company._liwan_vat_registered()), (0.0, False))
        self.assertFalse(self.payable(order)['tax_applies'])

    def test_a_company_that_registers_later_charges_under_the_stock_tax_mode_it_kept(self):
        # The tax mode is stock's setting and is asked of an unregistered establishment too, so registering
        # later needs no change: the tax is added on top of the price it kept.
        company = self.fresh_company('Registers later', registered=False)
        product = self.company_product(company, self.company_tax(company))
        self.set_price_mode(company, TAX_EXCLUDED)
        company.write({'vat': SAUDI_VAT, 'liwan_vat_registered': True})
        order = self.online_order(company=company, product=product)
        self.assertEqual((order.amount_untaxed, order.amount_tax, order.amount_total), (115.0, 17.25, 132.25))
