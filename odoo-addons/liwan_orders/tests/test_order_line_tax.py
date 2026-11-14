# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import tagged

from .common import PRICE, TAX_EXCLUDED, TAX_INCLUDED, LiwanOrdersCase

NO_TAX = 0.0
HALF = 50.0
TAX_ADDED_TOTAL = 132.25


@tagged('post_install', '-at_install', 'liwan')
class TestOrderLineTax(LiwanOrdersCase):
    """An order line of an establishment that is not registered for VAT carries no tax, whatever stock computes."""

    def untaxed(self, line):
        self.assertEqual((line.tax_ids, line.price_tax, line.price_total), (self.env['account.tax'], NO_TAX, PRICE))

    def test_an_unregistered_line_carries_no_tax_under_either_tax_mode(self):
        for mode in (TAX_INCLUDED, TAX_EXCLUDED):
            with self.subTest(mode=mode):
                company = self.company(f'Unregistered {mode}', price_mode=mode)
                order = self.order(company, [self.product(self.tax(company))])
                self.untaxed(order.order_line)
                self.assertEqual((order.amount_tax, order.amount_total), (NO_TAX, PRICE))

    def test_an_unregistered_line_keeps_no_tax_when_it_is_edited(self):
        company = self.company('Unregistered edited')
        tax = self.tax(company)
        order = self.order(company, [self.product(tax)])
        line = order.order_line
        line.product_id = self.product(tax, name='Other consultation')
        self.untaxed(line)
        line.product_uom_qty = 3
        self.assertEqual((line.tax_ids, line.price_tax), (self.env['account.tax'], NO_TAX))
        position = self.env['account.fiscal.position'].create({'name': 'Position', 'company_id': company.id})
        order.fiscal_position_id = position
        order.action_update_taxes()
        self.assertEqual((line.tax_ids, order.amount_tax), (self.env['account.tax'], NO_TAX))

    def test_a_line_of_a_branch_of_an_unregistered_establishment_carries_no_tax(self):
        root = self.company('Unregistered root')
        branch = self.company('Unregistered branch', parent=root)
        for label, owner in (('branch-owned tax', branch), ('root-owned tax', root)):
            with self.subTest(tax=label):
                order = self.order(branch, [self.product(self.tax(owner))])
                self.untaxed(order.order_line)

    def test_a_registered_line_carries_the_stock_taxes(self):
        for mode, total in ((TAX_INCLUDED, PRICE), (TAX_EXCLUDED, TAX_ADDED_TOTAL)):
            with self.subTest(mode=mode):
                company = self.company(f'Registered {mode}', registered=True, price_mode=mode)
                tax = self.tax(company)
                line = self.order(company, [self.product(tax)]).order_line
                self.assertEqual((line.tax_ids, line.price_total), (tax, total))

    def test_a_registration_reaches_the_lines_made_after_it_only(self):
        company = self.company('Registers')
        tax = self.tax(company)
        product = self.product(tax)
        order = self.order(company, [product])
        before = order.order_line
        self.register(company, True)
        after = self.line(order, product)
        self.assertEqual((before.tax_ids, after.tax_ids), (self.env['account.tax'], tax))
        # D3: a line whose product is edited after the change follows the new answer.
        before.product_id = self.product(tax, name='Edited consultation')
        self.assertEqual(before.tax_ids, tax)

    def test_a_deregistration_reaches_the_lines_made_after_it_only(self):
        company = self.company('Deregisters', registered=True)
        tax = self.tax(company)
        product = self.product(tax)
        order = self.order(company, [product])
        before = order.order_line
        self.register(company, False)
        after = self.line(order, product)
        self.assertEqual((before.tax_ids, after.tax_ids), (tax, self.env['account.tax']))
        before.product_id = self.product(tax, name='Edited consultation')
        self.assertEqual(before.tax_ids, self.env['account.tax'])

    def test_a_combo_line_and_a_section_line_carry_no_tax_in_a_registered_establishment(self):
        company = self.company('Registered combo', registered=True)
        tax = self.tax(company)
        combo = self.env['product.combo'].create({
            'name': 'Combo',
            'combo_item_ids': [Command.create({'product_id': self.product(tax).id})],
        })
        combo_product = self.env['product.product'].create({
            'name': 'Combo product', 'type': 'combo', 'list_price': PRICE,
            'taxes_id': [Command.set(tax.ids)], 'combo_ids': [Command.set(combo.ids)],
        })
        order = self.order(company)
        combo_line = self.line(order, combo_product)
        section = self.env['sale.order.line'].create({
            'order_id': order.id, 'display_type': 'line_section', 'name': 'Section',
        })
        self.assertEqual((combo_line.tax_ids, section.tax_ids), (self.env['account.tax'], self.env['account.tax']))

    def test_the_invoice_of_an_unregistered_order_carries_no_tax(self):
        company = self.env.company
        self.register(company, False)
        order = self.order(company, [self.product(self.tax(company))])
        order.action_confirm()
        invoice = order._create_invoices()
        self.assertEqual((invoice.amount_tax, invoice.amount_total), (NO_TAX, PRICE))

    def test_the_module_installs_itself_with_liwan_api_and_sale(self):
        module = self.env['ir.module.module'].search([('name', '=', 'liwan_orders')])
        self.assertEqual(module.state, 'installed')
        triggers = module.dependencies_id.filtered('auto_install_required').mapped('name')
        self.assertCountEqual(triggers, ['liwan_api', 'sale'])

    def test_the_rule_holds_in_both_commercial_modes(self):
        profile = self.env.ref('liwan_platform.tenant_profile')
        for mode in ('saas', 'non_saas'):
            with self.subTest(mode=mode):
                # Fixture-only conversion, as the platform tests do: the ORM refuses to change the mode.
                source = 'control_plane' if mode == 'saas' else 'local_policy'
                self.env.cr.execute(
                    "UPDATE liwan_tenant_profile SET commercial_mode=%s, entitlement_source=%s, valid_until=NULL WHERE id=%s",
                    [mode, source, profile.id],
                )
                profile.invalidate_recordset()
                unregistered = self.company(f'Unregistered {mode}')
                registered = self.company(f'Registered {mode}', registered=True)
                self.untaxed(self.order(unregistered, [self.product(self.tax(unregistered))]).order_line)
                tax = self.tax(registered)
                self.assertEqual(self.order(registered, [self.product(tax)]).order_line.tax_ids, tax)

    def test_a_line_without_a_company_does_not_crash_the_compute(self):
        product = self.product(self.tax(self.env.company))
        line = self.env['sale.order.line'].new({'product_id': product.id})
        line._compute_tax_ids()
        self.assertFalse(line.company_id)

    def test_the_down_payment_of_an_unregistered_order_carries_no_tax(self):
        company = self.env.company
        self.register(company, False)
        order = self.order(company, [self.product(self.tax(company))])
        order.action_confirm()
        wizard = self.env['sale.advance.payment.inv'].with_context(active_ids=order.ids).create({
            'advance_payment_method': 'percentage', 'amount': HALF,
        })
        wizard.create_invoices()
        down_payment = order.order_line.filtered(lambda line: line.is_downpayment and not line.display_type)
        invoice = order.invoice_ids
        self.assertEqual((down_payment.tax_ids, invoice.amount_tax), (self.env['account.tax'], NO_TAX))
        self.assertEqual(invoice.amount_total, PRICE * HALF / 100)
