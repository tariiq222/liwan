# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A product's sale taxes (plan D21), the tax part of the price function (D6) and the elevated read (D24)."""
from odoo import Command
from odoo.exceptions import AccessError
from odoo.tests import tagged

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_core.models.protected_write import marked
from odoo.addons.liwan_products.models.product_template import PRODUCT_MARKER
from odoo.addons.liwan_products.tests.common import PRODUCTS
from odoo.addons.liwan_products_account.tests.common import ProductTaxesCase

TAX_CHOICES = f'{PRODUCTS}/taxes'


@tagged('post_install', '-at_install', 'liwan')
class TestProductTaxes(ProductTaxesCase):

    def test_a_branch_session_reads_the_roots_taxes_as_none_unelevated(self):
        """Section 9 of the plan: the fence hides the root's taxes from a branch session, so D24 elevates."""
        product = self.product()
        self.assertEqual(product.taxes_id, self.vat15)
        unelevated = product.with_user(self.a_staff).with_context(allowed_company_ids=self.branch_a.ids)
        self.env.invalidate_all()
        self.assertFalse(unelevated.taxes_id)

    def test_a_branch_session_cannot_store_its_roots_taxes_unelevated(self):
        """Section 9 of the plan: stock refuses a branch session's write of taxes it cannot read, so the write of a
        product's taxes joins the elevated case."""
        self.settings.sharing = 'branch'
        product = self.product(user=self.a_staff, company=self.branch_a)
        writer = product.with_user(self.a_staff).with_company(self.branch_a)
        with marked(self.env, {PRODUCT_MARKER: product.ids}), self.assertRaises(AccessError):
            writer.write({'taxes_id': [Command.set(self.vat5.ids)]})

    def test_a_new_product_takes_the_default_sale_tax(self):
        self.assertEqual(self.product().taxes_id, self.vat15)

    def test_a_branch_product_takes_the_establishments_default_and_can_change_it(self):
        self.settings.sharing = 'branch'
        service = self.service_as(self.a_staff, self.branch_a)
        product = service._liwan_create({'name': 'Branch taxed', 'type': 'goods', 'list_price': 115})
        self.assertEqual(product.company_id, self.branch_a)
        # Stock's default for the branch: its own default sale tax, else its root's (account/models/product.py:44).
        expected = self.branch_a.account_sale_tax_id or self.root_company.account_sale_tax_id
        self.assertTrue(expected)
        self.assertEqual(product.with_env(self.env).taxes_id, expected)
        service._liwan_update(product, {'taxes': [self.branch_tax.id]})
        self.assertEqual(product.with_env(self.env).taxes_id, self.branch_tax)
        service._liwan_update(product, {'taxes': [self.vat5.id]})
        self.assertEqual(product.with_env(self.env).taxes_id, self.vat5)
        self.assertEqual(self.amounts(product, company=self.branch_a, user=self.a_staff), (109.52, 5.48, 115.0))

    def test_a_holder_of_products_manage_changes_the_taxes(self):
        product = self.product()
        self.service_as(self.root_staff, self.root_company)._liwan_update(product, {'taxes': [self.vat5.id]})
        self.assertEqual(product.taxes_id, self.vat5)
        with self.assertRaisesRegex(LiwanAccessRule, 'forbidden'):
            self.service_as(self.root_pricer, self.root_company)._liwan_update(product, {'taxes': [self.vat15.id]})

    def test_no_tax_is_a_zero_rated_tax_and_picking_an_inactive_one_activates_it(self):
        product = self.product()
        service = self.service_as(self.root_staff, self.root_company)
        choices = {choice['id']: choice for choice in service._liwan_sale_tax_choices()}
        self.assertEqual(choices[self.zero_inactive.id]['active'], False)
        self.assertNotIn(self.archived_by_accountant.id, choices)
        service._liwan_update(product, {'taxes': [self.zero_inactive.id]})
        self.assertTrue(self.zero_inactive.active)
        self.assertEqual(product.taxes_id, self.zero_inactive)
        self.assertEqual(self.amounts(product), (115.0, 0.0, 115.0))

    def test_an_empty_or_foreign_tax_list_is_refused(self):
        product = self.product()
        service = self.service_as(self.root_staff, self.root_company)
        other_root = self.env['res.company'].create({
            'name': 'Products other establishment', 'country_id': self.env.ref('base.sa').id,
        })
        foreign_tax = self.sale_tax(other_root, 15.0, 'Other establishment VAT')
        purchase = self.sale_tax(self.root_company, 15.0, 'Products purchase VAT')
        purchase.type_tax_use = 'purchase'
        for value in ([], [foreign_tax.id], [purchase.id], 'all', [True]):
            with self.subTest(value=value), self.assertRaisesRegex(LiwanAccessRule, 'invalid'):
                service._liwan_update(product, {'taxes': value})
        self.assertEqual(product.taxes_id, self.vat15)

    def test_taxes_of_two_levels_are_refused_and_taxes_of_one_level_are_kept(self):
        """Stock puts on a sale the taxes of the first level that owns one: a mixed list would be priced with the
        branch's tax only, so it is refused (the choices still offer both levels to a branch)."""
        self.settings.sharing = 'branch'
        service = self.service_as(self.a_staff, self.branch_a)
        choices = {choice['id'] for choice in service._liwan_sale_tax_choices()}
        self.assertTrue({self.branch_tax.id, self.vat5.id} <= choices)
        mixed = [self.branch_tax.id, self.vat5.id]
        with self.assertRaisesRegex(LiwanAccessRule, 'one company'):
            service._liwan_create({'name': 'Mixed', 'type': 'goods', 'taxes': mixed})
        product = service._liwan_create({'name': 'Branch taxed', 'type': 'goods', 'list_price': 115})
        before = product.with_env(self.env).taxes_id
        with self.assertRaisesRegex(LiwanAccessRule, 'one company'):
            service._liwan_update(product, {'taxes': mixed})
        self.sign_in('pr_a_staff')
        response = self.api('PATCH', f'{PRODUCTS}/{product.id}', {'taxes': mixed})
        self.assertEqual((response.status_code, response.json()['field']), (422, 'taxes'))
        self.assertEqual(product.with_env(self.env).taxes_id, before)
        self.assertFalse(self.env['product.template'].search([('name', '=', 'Mixed')]))
        for taxes in (self.branch_tax, self.vat5 | self.vat15):
            service._liwan_update(product, {'taxes': taxes.ids})
            self.assertEqual(product.with_env(self.env).taxes_id, taxes)

    def test_two_taxes_are_accepted_and_combined(self):
        self.set_price_mode('tax_excluded')
        product = self.product(price=100.0, taxes=self.vat15 | self.vat5)
        self.assertEqual(product.taxes_id, self.vat15 | self.vat5)
        self.assertEqual(self.amounts(product), (100.0, 20.0, 120.0))
        self.sign_in('pr_root_staff')
        detail = self.api('GET', f'{PRODUCTS}/{product.id}').json()
        self.assertEqual({tax['id'] for tax in detail['taxes']}, {self.vat15.id, self.vat5.id})
        self.assertEqual(detail['price']['amount_tax'], 20.0)

    def test_the_three_amounts_follow_the_establishments_choice(self):
        product = self.product(price=115.0)
        for mode, one, three in (
            ('tax_included', (100.0, 15.0, 115.0), (300.0, 45.0, 345.0)),
            ('tax_excluded', (115.0, 17.25, 132.25), (345.0, 51.75, 396.75)),
        ):
            with self.subTest(mode=mode):
                self.set_price_mode(mode)
                self.assertEqual(self.amounts(product), one)
                self.assertEqual(self.amounts(product, quantity=3.0), three)
        self.root_company.liwan_vat_registered = False
        self.assertEqual(self.amounts(product), (115.0, 0.0, 115.0))
        self.assertEqual(self.amounts(product, quantity=3.0), (345.0, 0.0, 345.0))
        self.assertEqual(product.taxes_id, self.vat15)

    def test_a_customer_outside_saudi_arabia_gets_the_mapped_tax(self):
        self.set_price_mode('tax_excluded')
        product = self.product(price=100.0)
        abroad = self.env['res.partner'].create({'name': 'Abroad', 'country_id': self.env.ref('base.ae').id})
        home = self.env['res.partner'].create({'name': 'Home', 'country_id': self.env.ref('base.sa').id})
        self.assertEqual(self.amounts(product, customer=abroad), (100.0, 0.0, 100.0))
        self.assertEqual(self.amounts(product, customer=home), (100.0, 15.0, 115.0))

    def test_a_branch_session_prices_a_shared_product_with_the_establishments_tax(self):
        self.set_price_mode('tax_excluded')
        product = self.product(price=100.0)
        self.assertEqual(
            self.amounts(product, company=self.branch_a, user=self.picker), (100.0, 15.0, 115.0),
        )
        self.sign_in('pr_a_staff')
        detail = self.api('GET', f'{PRODUCTS}/{product.id}').json()
        self.assertEqual(detail['taxes'], [{'id': self.vat15.id, 'name': self.vat15.name, 'amount': 15.0}])
        self.assertEqual(detail['price']['amount_total'], 115.0)

    def test_an_unregistered_establishment_shows_no_tax_field(self):
        product = self.product()
        self.root_company.liwan_vat_registered = False
        self.sign_in('pr_root_staff')
        detail = self.api('GET', f'{PRODUCTS}/{product.id}').json()
        self.assertNotIn('taxes', detail)
        response = self.api('PATCH', f'{PRODUCTS}/{product.id}', {'taxes': [self.vat5.id]})
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()['field'], 'taxes')
        self.assertEqual(self.api('GET', TAX_CHOICES).json(), {'items': [], 'total': 0})

    def test_the_tax_choices_route(self):
        for mode in ('saas', 'non_saas'):
            with self.subTest(mode=mode), self.undone():
                self.set_mode(mode)
                self.sign_in('pr_root_staff')
                response = self.api('GET', TAX_CHOICES)
                self.assertEqual(response.status_code, 200, response.text)
                items = {item['id']: item for item in response.json()['items']}
                self.assertEqual(set(items[self.zero_inactive.id]), {'id', 'name', 'amount', 'active'})
                self.assertFalse(items[self.zero_inactive.id]['active'])
                self.assertIn(self.vat15.id, items)
                self.assertNotIn(self.branch_tax.id, items)
                self.sign_in('pr_root_pricer')
                self.assertEqual(self.api('GET', TAX_CHOICES).status_code, 403)

    def test_the_create_route_accepts_taxes(self):
        self.sign_in('pr_root_staff')
        response = self.api('POST', PRODUCTS, {
            'name': 'Route taxed', 'type': 'goods', 'list_price': 50, 'taxes': [self.vat5.id, self.vat15.id],
        })
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual({tax['id'] for tax in response.json()['taxes']}, {self.vat5.id, self.vat15.id})

    def test_a_zero_rated_product_line_carries_a_tax_for_zatca(self):
        """The ZATCA line check (l10n_sa_edi models/account_edi_format.py:403-404) refuses a product line without a
        tax: the line stock builds for a "no tax" product carries the zero-rated tax."""
        product = self.product()
        self.service_as(self.root_staff, self.root_company)._liwan_update(product, {'taxes': [self.zero_inactive.id]})
        customer = self.env['res.partner'].create({'name': 'Zatca buyer', 'country_id': self.env.ref('base.sa').id})
        move = self.env['account.move'].with_company(self.root_company).create({
            'move_type': 'out_invoice', 'partner_id': customer.id,
            'invoice_line_ids': [Command.create({'product_id': product.product_variant_id.id, 'quantity': 1})],
        })
        line = move.invoice_line_ids
        self.assertEqual(line.tax_ids, self.zero_inactive)
        self.assertTrue(all(
            line.tax_ids for line in move.invoice_line_ids.filtered(lambda line: line.display_type == 'product')
        ))

    def test_an_accountants_archived_tax_is_refused_and_stays_archived(self):
        product = self.product()
        with self.assertRaisesRegex(LiwanAccessRule, 'invalid'):
            self.service_as(self.root_staff, self.root_company)._liwan_update(
                product, {'taxes': [self.archived_by_accountant.id]},
            )
        self.assertFalse(self.archived_by_accountant.active)

    def test_a_chart_tax_that_documents_used_and_was_archived_is_refused(self):
        """A chart tax is switched on by a product only while no journal item ever carried it."""
        self.zero_inactive.active = True
        customer = self.env['res.partner'].create({'name': 'Products chart tax customer'})
        self.env['account.move'].with_company(self.root_company).create({
            'move_type': 'out_invoice', 'partner_id': customer.id,
            'invoice_line_ids': [Command.create({
                'name': 'used', 'quantity': 1, 'price_unit': 10, 'tax_ids': [Command.set(self.zero_inactive.ids)],
            })],
        })
        self.zero_inactive.active = False
        product = self.product()
        service = self.service_as(self.root_staff, self.root_company)
        self.assertNotIn(self.zero_inactive.id, {choice['id'] for choice in service._liwan_sale_tax_choices()})
        with self.assertRaisesRegex(LiwanAccessRule, 'invalid'):
            service._liwan_update(product, {'taxes': [self.zero_inactive.id]})
        self.assertFalse(self.zero_inactive.active)

    def test_the_capability_is_checked_before_the_taxes_are_read(self):
        """A caller without the right gets 403 for a taxes write, valid or not, never a 422 that reveals the choices."""
        product = self.product()
        for mode in ('saas', 'non_saas'):
            with self.subTest(mode=mode), self.undone():
                self.set_mode(mode)
                for login, value in (
                    ('pr_root_pricer', [self.vat5.id]), ('pr_root_pricer', [999999]),
                    ('pr_a_staff', [self.vat5.id]), ('pr_a_staff', [999999]),
                ):
                    self.sign_in(login)
                    response = self.api('PATCH', f'{PRODUCTS}/{product.id}', {'taxes': value})
                    self.assertEqual(response.status_code, 403, response.text)
                self.assertEqual(product.taxes_id, self.vat15)

    def abroad(self, name='Abroad', country='base.ae'):
        return self.env['res.partner'].create({'name': name, 'country_id': self.env.ref(country).id})

    def test_a_foreign_customer_of_a_price_included_establishment_pays_the_price_without_the_tax(self):
        """Stock drops the price-included tax a fiscal position unmaps before the line is computed: 115 with 15%
        included becomes 100 at 0%."""
        self.set_price_mode('tax_included')
        product = self.product(price=115.0)
        abroad = self.abroad('Abroad incl')
        self.assertEqual(self.amounts(product, customer=abroad), (100.0, 0.0, 100.0))
        self.assertEqual(self.amounts(product, quantity=3.0, customer=abroad), (300.0, 0.0, 300.0))
        self.assertEqual(self.amounts(product), (100.0, 15.0, 115.0))

    def test_a_branch_session_prices_the_roots_included_tax_for_a_foreign_customer(self):
        """The branch does not own the tax: the stock sale line adapts the price on the taxes of every company."""
        self.set_price_mode('tax_included')
        product = self.product(price=115.0)
        self.assertEqual(
            self.amounts(product, company=self.branch_a, user=self.picker, customer=self.abroad('Branch abroad')),
            (100.0, 0.0, 100.0),
        )

    def test_a_price_included_tax_mapped_to_another_included_tax_keeps_the_new_tax_in_the_price(self):
        self.set_price_mode('tax_included')
        product = self.product(price=115.0)
        egypt = self.env['account.fiscal.position'].create({
            'name': 'Products Egypt', 'company_id': self.root_company.id, 'auto_apply': True, 'sequence': -100,
            'country_id': self.env.ref('base.eg').id,
        })
        reduced = self.sale_tax(self.root_company, 5.0, 'Products reduced 5')
        reduced.write({'fiscal_position_ids': [Command.set(egypt.ids)], 'original_tax_ids': [Command.set(self.vat15.ids)]})
        customer = self.abroad('Egypt customer', 'base.eg')
        for company, user in ((self.root_company, self.root_staff), (self.branch_a, self.picker)):
            with self.subTest(company=company.name):
                self.assertEqual(self.amounts(product, company=company, user=user, customer=customer), (100.0, 5.0, 105.0))
        self.assertEqual(self.amounts(product, customer=customer, quantity=2.0), (200.0, 10.0, 210.0))

    def test_a_product_with_an_included_and_an_added_tax_keeps_its_price_as_typed(self):
        """Stock adapts the price only when every product tax is price-included."""
        self.set_price_mode('tax_excluded')
        self.vat15.price_include_override = 'tax_included'
        product = self.product(price=115.0, taxes=self.vat15 | self.vat5)
        self.assertEqual(self.amounts(product), (100.0, 20.0, 120.0))
        # The mapping drops the included 15% for export 0%, but with one added tax among them stock keeps the typed price.
        self.assertEqual(self.amounts(product, customer=self.abroad('Mixed abroad')), (115.0, 5.75, 120.75))

    def test_the_choices_and_the_detail_carry_no_record(self):
        product = self.product()
        choices = self.service_as(self.root_staff, self.root_company)._liwan_sale_tax_choices()
        self.assertTrue(choices)
        self.assertTrue(all(isinstance(choice, dict) for choice in choices))
        created = self.service_as(self.root_staff, self.root_company)._liwan_create(
            {'name': 'Env check', 'type': 'goods', 'taxes': [self.vat5.id]},
        )
        self.assertFalse(created.env.su)
        self.assertEqual(created.env.uid, self.root_staff.id)
        updated = self.service_as(self.root_staff, self.root_company)._liwan_update(product, {'taxes': [self.vat5.id]})
        self.assertFalse(updated.env.su)

    def test_adopt_gives_invalid_taxes_the_default_and_clears_purchase_taxes(self):
        other_root = self.env['res.company'].create({
            'name': 'Products adopt other', 'country_id': self.env.ref('base.sa').id,
        })
        foreign_tax = self.sale_tax(other_root, 15.0, 'Adopt foreign VAT')
        purchase = self.sale_tax(self.root_company, 15.0, 'Adopt purchase VAT')
        purchase.type_tax_use = 'purchase'
        legacy = self.env['product.template'].create({'name': 'Legacy taxed', 'taxes_id': [Command.set(foreign_tax.ids)],
                                                      'supplier_taxes_id': [Command.set(purchase.ids)]})
        kept = self.env['product.template'].create({'name': 'Legacy kept', 'taxes_id': [Command.set(self.vat5.ids)]})
        self.env['liwan.products.service']._liwan_adopt(legacy | kept)
        self.assertEqual(legacy.taxes_id, self.vat15)
        self.assertFalse(legacy.supplier_taxes_id)
        self.assertEqual(kept.taxes_id, self.vat5)

    def test_adopt_keeps_the_valid_taxes_and_the_default_takes_over_only_when_none_is_valid(self):
        other_root = self.env['res.company'].create({
            'name': 'Products adopt other kept', 'country_id': self.env.ref('base.sa').id,
        })
        foreign_tax = self.sale_tax(other_root, 15.0, 'Adopt kept foreign VAT')
        templates = self.env['product.template']
        mixed = templates.create({'name': 'Legacy mixed', 'taxes_id': [Command.set((self.vat5 | foreign_tax).ids)]})
        invalid = templates.create({'name': 'Legacy invalid', 'taxes_id': [Command.set(foreign_tax.ids)]})
        none = templates.create({'name': 'Legacy untaxed', 'taxes_id': [Command.clear()]})
        self.env['liwan.products.service']._liwan_adopt(mixed | invalid | none)
        self.assertEqual((mixed.taxes_id, invalid.taxes_id, none.taxes_id), (self.vat5, self.vat15, self.vat15))

    def test_adopt_activates_a_dormant_chart_tax_it_keeps(self):
        legacy = self.env['product.template'].create({
            'name': 'Legacy zero rated', 'taxes_id': [Command.set(self.zero_inactive.ids)],
        })
        self.assertFalse(self.zero_inactive.active)
        self.env['liwan.products.service']._liwan_adopt(legacy)
        self.assertEqual(legacy.with_context(active_test=False).taxes_id, self.zero_inactive)
        self.assertTrue(self.zero_inactive.active)

    def test_adopt_with_no_valid_tax_and_no_default_leaves_the_product_untaxed_and_says_so(self):
        self.root_company.account_sale_tax_id = False
        other_root = self.env['res.company'].create({
            'name': 'Adopt no default other', 'country_id': self.env.ref('base.sa').id,
        })
        foreign_tax = self.sale_tax(other_root, 15.0, 'Adopt nd VAT')
        legacy = self.env['product.template'].create({'name': 'Legacy no default', 'taxes_id': [Command.set(foreign_tax.ids)]})
        with self.assertLogs('odoo.addons.liwan_products_account.models.products_service', 'WARNING') as logs:
            self.env['liwan.products.service']._liwan_adopt(legacy)
        self.assertIn('Legacy no default', logs.output[0])
        self.assertFalse(legacy.taxes_id)

    def test_taxes_written_outside_the_service_are_refused(self):
        product = self.product()
        with self.assertRaisesRegex(AccessError, 'use_liwan_products_service'):
            product.with_user(self.root_admin).write({'taxes_id': [Command.set(self.vat5.ids)]})
        with self.assertRaisesRegex(AccessError, 'use_liwan_products_service'):
            product.product_variant_id.with_user(self.root_admin).write({'taxes_id': [Command.set(self.vat5.ids)]})
