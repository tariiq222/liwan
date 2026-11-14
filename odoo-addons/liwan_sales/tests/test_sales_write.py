# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Create and edit of a staff quotation: header, lines, price (D6), tax (D8, D17) and discount (D7)."""
from datetime import timedelta

from odoo import fields
from odoo.tests import tagged

from .common import SalesWriteCase

ORDERS = '/api/v1/sales/orders'


@tagged('post_install', '-at_install', 'liwan')
class TestSalesCreate(SalesWriteCase):

    def test_a_created_quotation_in_each_session(self):
        self.env['liwan.sales.settings']._liwan_current().default_terms = 'Pay within 30 days'
        today = fields.Date.context_today(self.env['sale.order'])
        for name, scope in self.scopes.items():
            with self.subTest(session=name):
                body = self.post(scope.agent, self.body())
                order = self.env['sale.order'].browse(body['id'])
                self.assertEqual((order.state, order.company_id), ('draft', scope.company))
                self.assertTrue(order.liwan_staff_document)
                self.assertEqual(order.user_id, scope.agent)
                self.assertEqual(order.validity_date, today + timedelta(days=30))
                self.assertEqual(body['terms'], 'Pay within 30 days')
                self.assertEqual((order.require_signature, order.require_payment), (False, False))
                self.assertEqual((body['source'], body['state']), ('staff', 'draft'))
                self.assertTrue(body['actions']['edit'])

    def test_a_validity_of_zero_days_gives_no_date_and_given_values_win(self):
        self.env['liwan.sales.settings']._liwan_current().validity_days = 0
        self.assertIsNone(self.post(self.agent, self.body())['validity_date'])
        given = self.post(self.agent, self.body(validity_date='2099-01-31', terms='Own terms'))
        self.assertEqual((given['validity_date'], given['terms']), ('2099-01-31', 'Own terms'))
        self.assertIsNone(self.post(self.agent, self.body(validity_date=None))['validity_date'])
        past = self.api_as(self.agent, 'POST', ORDERS, self.body(validity_date='2001-01-01'))
        self.refused(past, 422, 'invalid', 'validity_date')
        empty = self.post(self.agent, self.body(terms=''))
        self.assertEqual(self.env['sale.order'].browse(empty['id']).note or '', '')

    def test_unknown_keys_price_and_tax_keys_are_refused(self):
        cases = (
            ({'unit_price': 1}, 'unit_price'),
            ({'tax_ids': []}, 'tax_ids'),
            ({'company_id_x': 1}, 'company_id_x'),
        )
        for extra, field in cases:
            with self.subTest(field=field):
                self.refused(self.api_as(self.agent, 'POST', ORDERS, self.body(**extra)), 422, 'invalid', field)
        for key in ('price_unit', 'unit_price', 'taxes', 'tax_ids'):
            with self.subTest(line_key=key):
                line = self.product_line(self.taxed, **{key: 5})
                response = self.api_as(self.agent, 'POST', ORDERS, self.body(line))
                self.refused(response, 422, 'invalid', f'lines.0.{key}')
        self.refused(self.api_as(self.agent, 'POST', ORDERS, {'lines': []}), 422, 'invalid', 'customer_id')

    def test_an_agent_may_not_name_another_salesperson_and_a_manager_may(self):
        response = self.api_as(self.agent, 'POST', ORDERS, self.body(salesperson_id=self.agent2.id))
        self.refused(response, 403, 'forbidden', 'salesperson_id')
        self.assertEqual(self.post(self.agent, self.body(salesperson_id=self.agent.id))['salesperson']['id'], self.agent.id)
        body = self.post(self.manager, self.body(salesperson_id=self.agent2.id))
        self.assertEqual(body['salesperson']['id'], self.agent2.id)
        response = self.api_as(self.manager, 'POST', ORDERS, self.body(salesperson_id=self.outsider.id))
        self.refused(response, 422, 'invalid', 'salesperson_id')

    def test_the_customer_and_the_product_must_be_usable_here(self):
        archived = self.party('Archived party')
        archived.active = False
        branch_party = self.party('Branch party', self.branch)
        plain_partner = self.env['res.partner'].create({'name': 'Not a party'})
        for customer in (archived, branch_party, plain_partner):
            with self.subTest(customer=customer.name):
                body = {**self.body(), 'customer_id': customer.id}
                self.refused(self.api_as(self.agent, 'POST', ORDERS, body), 422, 'invalid', 'customer_id')
        old = self.service_product('Archived service', 10.0)
        old.active = False
        branch_user = self.custom_user('sales_b_catalog', ('products.read', 'products.manage', 'products.prices.manage'),
                                       company=self.branch)
        self.env['liwan.products.settings']._liwan_current().sharing = 'branch'
        branch_product = self.service_product('Branch service', 10.0, user=branch_user, company=self.branch)
        self.env['liwan.products.settings']._liwan_current().sharing = 'establishment'
        foreign = self.product.product_tmpl_id
        for product in (old, branch_product, foreign):
            with self.subTest(product=product.name):
                body = self.body(self.product_line(self.plain), self.product_line(product))
                self.refused(self.api_as(self.agent, 'POST', ORDERS, body), 422, 'invalid', 'lines.1.product_id')

    def test_a_line_is_checked_field_by_field(self):
        cases = (
            (self.product_line(self.taxed, quantity=0), 'lines.0.quantity'),
            (self.product_line(self.taxed, quantity=10_000_001), 'lines.0.quantity'),
            (self.product_line(self.taxed, quantity='2'), 'lines.0.quantity'),
            (self.product_line(self.taxed, discount_percent=101), 'lines.0.discount_percent'),
            (self.product_line(self.taxed, discount_percent=-1), 'lines.0.discount_percent'),
            ({'kind': 'product', 'quantity': 1}, 'lines.0.product_id'),
            ({'kind': 'section'}, 'lines.0.name'),
            ({'kind': 'section', 'name': '  '}, 'lines.0.name'),
            ({'kind': 'note', 'name': 'n', 'quantity': 1}, 'lines.0.quantity'),
            ({'kind': 'other', 'name': 'n'}, 'lines.0.kind'),
            (self.product_line(self.taxed, discount_percent='5'), 'lines.0.discount_percent'),
            (self.product_line(self.taxed, name='x' * 2001), 'lines.0.name'),
            ({'kind': 'note', 'name': 'x' * 2001}, 'lines.0.name'),
        )
        for line, field in cases:
            with self.subTest(field=field, line=line):
                self.refused(self.api_as(self.agent, 'POST', ORDERS, self.body(line)), 422, 'invalid', field)
        self.refused(self.api_as(self.agent, 'POST', ORDERS, {**self.body(), 'lines': {}}), 422, 'invalid', 'lines')
        long_terms = self.api_as(self.agent, 'POST', ORDERS, self.body(terms='x' * 10_001))
        self.refused(long_terms, 422, 'invalid', 'terms')
        edge = self.post(self.agent, self.body(self.product_line(self.taxed, name='x' * 2000), terms='x' * 10_000))
        self.assertEqual(len(edge['lines'][0]['name']), 2000)

    def test_sections_and_notes_keep_their_order_and_carry_no_amount(self):
        body = self.post(self.agent, self.body(
            {'kind': 'section', 'name': 'Part one'},
            self.product_line(self.taxed, 2),
            {'kind': 'note', 'name': 'Read me'},
            self.product_line(self.taxed, 1, name='Own wording'),
        ))
        kinds = [(line['kind'], line['name']) for line in body['lines']]
        self.assertEqual(kinds[0], ('section', 'Part one'))
        self.assertEqual(kinds[2], ('note', 'Read me'))
        self.assertEqual(kinds[3], ('product', 'Own wording'))
        for line in (body['lines'][0], body['lines'][2]):
            self.assertEqual((line['amount_untaxed'], line['amount_total'], line['product']), (0.0, 0.0, None))
        self.assertEqual(body['amount_untaxed'], 300.0)


@tagged('post_install', '-at_install', 'liwan')
class TestSalesLinePriceAndTax(SalesWriteCase):

    @staticmethod
    def amounts(row):
        return tuple(row[key] for key in ('amount_untaxed', 'amount_tax', 'amount_total'))

    def test_the_price_is_the_price_function_and_a_quantity_change_keeps_it(self):
        body = self.post(self.agent, self.body(self.product_line(self.plain, 3)))
        line = body['lines'][0]
        self.assertEqual(line['unit_price'], self.price_of(self.plain, 3))
        self.products_service()._liwan_update(self.plain, {'list_price': 55.0})
        kept = self.patch_order(self.agent, body['id'], {'lines': [{**self.product_line(self.plain, 5), 'id': line['id']}]})
        self.assertEqual((kept['lines'][0]['unit_price'], kept['lines'][0]['quantity']), (40.0, 5.0))
        swapped = self.patch_order(self.agent, body['id'], {'lines': [{**self.product_line(self.taxed, 5), 'id': line['id']}]})
        self.assertEqual(swapped['lines'][0]['unit_price'], self.price_of(self.taxed, 5))
        self.assertEqual(swapped['lines'][0]['id'], line['id'])

    def test_registered_amounts_in_each_session(self):
        for name, scope in self.scopes.items():
            with self.subTest(session=name):
                body = self.post(scope.agent, self.body(self.product_line(self.taxed), self.product_line(self.included)))
                added, included = body['lines']
                self.assertEqual(self.amounts(added), (100.0, 15.0, 115.0))
                self.assertEqual(self.amounts(included), (86.96, 13.04, 100.0))
                quantity = self.patch_order(scope.agent, body['id'], {'lines': [
                    {**self.product_line(self.taxed, 2), 'id': added['id']},
                    {**self.product_line(self.included), 'id': included['id']},
                ]})
                self.assertEqual(quantity['lines'][0]['amount_total'], 230.0)
                swapped = self.patch_order(scope.agent, body['id'], {'lines': [
                    {**self.product_line(self.included, 2), 'id': added['id']},
                    {**self.product_line(self.taxed), 'id': included['id']},
                ]})
                self.assertEqual([line['amount_total'] for line in swapped['lines']], [200.0, 115.0])
                self.assertEqual(self.amounts(swapped)[1:], (41.09, 315.0))
                order = self.env['sale.order'].browse(body['id'])
                self.assertEqual(order.order_line.mapped('tax_ids'), self.tax_added | self.tax_included)

    def test_not_registered_means_no_tax_in_each_session(self):
        self.register(False)
        for name, scope in self.scopes.items():
            with self.subTest(session=name):
                body = self.post(scope.agent, self.body(self.product_line(self.taxed), self.product_line(self.included)))
                self.assertEqual([line['amount_total'] for line in body['lines']], [100.0, 100.0])
                self.assertEqual(body['amount_tax'], 0.0)
                self.assertFalse(self.env['sale.order'].browse(body['id']).order_line.tax_ids)

    def test_a_branch_agent_never_writes_a_line_of_a_document_they_may_not_edit(self):
        scope = self.in_branch
        mate = self.post(scope.agent2, self.body())
        root_order = self.post(self.agent, self.body())
        line = {**self.product_line(self.taxed, 4), 'id': mate['lines'][0]['id']}
        response = self.api_as(scope.agent, 'PATCH', f'{ORDERS}/{mate["id"]}', {'lines': [line]})
        self.assertIn(response.status_code, (403, 404), response.text)
        foreign = self.api_as(scope.agent, 'PATCH', f'{ORDERS}/{root_order["id"]}', {'lines': [self.product_line(self.taxed, 4)]})
        self.assertEqual(foreign.status_code, 404, foreign.text)
        self.set_visibility('all')
        response = self.api_as(scope.agent, 'PATCH', f'{ORDERS}/{mate["id"]}', {'lines': [line]})
        self.refused(response, 403, 'forbidden')
        self.assertEqual(self.env['sale.order'].browse(mate['id']).order_line.product_uom_qty, 1.0)

    def test_a_changed_customer_recomputes_the_taxes(self):
        body = self.post(self.in_branch.agent, self.body())
        other = self.party('Second customer')
        changed = self.patch_order(self.in_branch.agent, body['id'], {'customer_id': other.id})
        self.assertEqual((changed['customer']['id'], changed['amount_total']), (other.id, 115.0))


@tagged('post_install', '-at_install', 'liwan')
class TestSalesLines(SalesWriteCase):

    def test_replacing_the_list_deletes_missing_lines_and_reorders(self):
        body = self.post(self.agent, self.body(
            self.product_line(self.plain), {'kind': 'note', 'name': 'Gone'}, self.product_line(self.taxed),
        ))
        first, note, last = body['lines']
        replaced = self.patch_order(self.agent, body['id'], {'lines': [
            {**self.product_line(self.taxed), 'id': last['id']},
            {'kind': 'section', 'name': 'New'},
            {**self.product_line(self.plain), 'id': first['id']},
        ]})
        self.assertEqual([line['id'] for line in replaced['lines']][::2], [last['id'], first['id']])
        self.assertEqual(replaced['lines'][1]['kind'], 'section')
        self.assertFalse(self.env['sale.order.line'].browse(note['id']).exists())

    def test_a_foreign_line_id_and_a_changed_kind_are_refused(self):
        body = self.post(self.agent, self.body(self.product_line(self.plain), {'kind': 'note', 'name': 'N'}))
        other = self.post(self.agent, self.body())
        foreign = {**self.product_line(self.plain), 'id': other['lines'][0]['id']}
        self.refused(self.api_as(self.agent, 'PATCH', f'{ORDERS}/{body["id"]}', {'lines': [foreign]}),
                     422, 'invalid', 'lines.0.id')
        changed = {'kind': 'section', 'name': 'N', 'id': body['lines'][1]['id']}
        self.refused(self.api_as(self.agent, 'PATCH', f'{ORDERS}/{body["id"]}', {'lines': [changed]}),
                     422, 'invalid', 'lines.0.kind')


@tagged('post_install', '-at_install', 'liwan')
class TestSalesDiscount(SalesWriteCase):

    def test_a_discount_above_the_limit_needs_the_approval(self):
        self.set_discount_limit(10)
        line = self.product_line(self.plain, discount_percent=15)
        body = self.refused(self.api_as(self.agent, 'POST', ORDERS, self.body(line)),
                            403, 'forbidden', 'lines.0.discount_percent')
        self.assertEqual(body['details'], {'reason': 'discount_above_limit'})
        self.assertEqual(self.post(self.agent, self.body(self.product_line(self.plain, discount_percent=10)))['lines'][0]
                         ['discount_percent'], 10.0)
        saved = self.post(self.manager, self.body(line))
        self.assertEqual(saved['lines'][0]['discount_percent'], 15.0)

    def test_a_limit_of_zero_lets_any_discount_through(self):
        self.set_discount_limit(0)
        body = self.post(self.agent, self.body(self.product_line(self.plain, discount_percent=100)))
        self.assertEqual((body['lines'][0]['discount_percent'], body['amount_total']), (100.0, 0.0))

    def test_a_stored_discount_survives_a_lowered_limit_until_it_is_raised(self):
        body = self.post(self.agent, self.body(self.product_line(self.plain, discount_percent=30)))
        self.set_discount_limit(10)
        line_id = body['lines'][0]['id']
        kept = self.patch_order(self.agent, body['id'], {'lines': [
            {**self.product_line(self.plain, 4, discount_percent=30), 'id': line_id},
        ]})
        self.assertEqual(kept['lines'][0]['discount_percent'], 30.0)
        raised = self.api_as(self.agent, 'PATCH', f'{ORDERS}/{body["id"]}', {'lines': [
            {**self.product_line(self.plain, 4, discount_percent=35), 'id': line_id},
        ]})
        self.refused(raised, 403, 'forbidden', 'lines.0.discount_percent')
