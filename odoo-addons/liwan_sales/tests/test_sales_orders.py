# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import tagged

from .common import LiwanSalesCase

ORDERS = '/api/v1/sales/orders'
ITEM_KEYS = {
    'id', 'number', 'state', 'locked', 'source', 'customer', 'salesperson', 'validity_date', 'date', 'terms',
    'currency', 'amount_untaxed', 'amount_tax', 'amount_total',
}
LINE_KEYS = {
    'id', 'kind', 'product', 'name', 'quantity', 'unit', 'unit_price', 'discount_percent', 'amount_untaxed',
    'amount_tax', 'amount_total',
}
ACTION_KEYS = {'edit', 'confirm', 'cancel', 'reopen', 'lock', 'unlock', 'duplicate', 'assign'}
NO_ACTIONS = dict.fromkeys(ACTION_KEYS, False)


@tagged('post_install', '-at_install', 'liwan')
class TestSalesOrdersShape(LiwanSalesCase):

    def detail(self, user, order):
        response = self.api_as(user, 'GET', f'{ORDERS}/{order.id}')
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def actions(self, user, order):
        return self.detail(user, order)['actions']

    def test_the_list_item_and_the_detail_have_exactly_the_specified_keys(self):
        order = self.make_order(self.agent, validity_date='2027-01-31', note='<p>Pay <b>soon</b></p>')
        listed = self.api_as(self.agent, 'GET', ORDERS).json()
        item = next(row for row in listed['items'] if row['id'] == order.id)
        self.assertEqual(set(item), ITEM_KEYS)
        detail = self.detail(self.agent, order)
        self.assertEqual(set(detail), ITEM_KEYS | {'lines', 'actions'})
        self.assertEqual(set(detail['actions']), ACTION_KEYS)
        self.assertEqual(set(detail['lines'][0]), LINE_KEYS)
        self.assertEqual(detail['number'], order.name)
        self.assertEqual(detail['customer'], {'id': order.partner_id.id, 'name': 'Customer'})
        self.assertEqual(detail['salesperson'], {'id': self.agent.id, 'name': self.agent.name, 'user_id': self.agent.id})
        self.assertEqual(detail['validity_date'], '2027-01-31')
        self.assertTrue(detail['date'].endswith('Z'))
        self.assertIn('Pay', detail['terms'])
        self.assertNotIn('<', detail['terms'])
        currency = order.currency_id
        self.assertEqual(detail['currency'], {'id': currency.id, 'name': currency.name, 'symbol': currency.symbol})
        self.assertEqual(
            (detail['amount_untaxed'], detail['amount_tax'], detail['amount_total']), (90.0, 0.0, 90.0),
        )

    def test_the_unset_values_of_an_online_order(self):
        order = self.make_order(None, staff=False)
        detail = self.detail(self.agent, order)
        self.assertEqual((detail['source'], detail['salesperson'], detail['terms']), ('online', None, ''))

    def test_the_four_stock_states_map_to_the_wire_states(self):
        orders = {state: self.make_order(self.agent) for state in ('draft', 'sent', 'sale', 'cancel')}
        for state, order in orders.items():
            order.state = state
        orders['sale'].locked = True
        wire = {'draft': 'draft', 'sent': 'sent', 'sale': 'confirmed', 'cancel': 'cancelled'}
        for state, expected in wire.items():
            with self.subTest(state=state):
                detail = self.detail(self.agent, orders[state])
                self.assertEqual(detail['state'], expected)
                self.assertEqual(detail['locked'], state == 'sale')
                listed = self.api_as(self.agent, 'GET', f'{ORDERS}?state={expected}&limit=200').json()
                self.assertIn(orders[state].id, {row['id'] for row in listed['items']})
        self.assertEqual(self.api_as(self.agent, 'GET', f'{ORDERS}?state=sale').status_code, 422)

    def test_lines_carry_the_kind_the_product_and_the_stored_amounts(self):
        order = self.make_order(self.agent, lines=[
            Command.create({'display_type': 'line_section', 'name': 'Part one'}),
            Command.create({'product_id': self.product.id, 'product_uom_qty': 3, 'price_unit': 20.0}),
            Command.create({'display_type': 'line_note', 'name': 'A note'}),
        ])
        lines = self.detail(self.agent, order)['lines']
        self.assertEqual([line['kind'] for line in lines], ['section', 'product', 'note'])
        section, product, note = lines
        self.assertEqual((section['product'], section['name']), (None, 'Part one'))
        self.assertEqual((note['product'], note['unit'], note['name']), (None, None, 'A note'))
        template = self.product.product_tmpl_id
        self.assertEqual(product['product'], {'id': template.id, 'name': template.name})
        self.assertEqual(
            (product['quantity'], product['unit'], product['unit_price'], product['discount_percent']),
            (3.0, self.product.uom_id.name, 20.0, 0.0),
        )
        self.assertEqual((product['amount_untaxed'], product['amount_tax'], product['amount_total']), (60.0, 0.0, 60.0))

    def test_the_list_is_filtered_by_q_and_ordered_by_date_then_id(self):
        first = self.make_order(self.agent, customer='Zaid Trading', date_order='2026-01-01 10:00:00')
        second = self.make_order(self.agent, customer='Other', date_order='2026-02-01 10:00:00')
        third = self.make_order(self.agent, customer='Other', date_order='2026-02-01 10:00:00')
        body = self.api_as(self.agent, 'GET', f'{ORDERS}?limit=200').json()
        ids = [row['id'] for row in body['items']]
        self.assertEqual([i for i in ids if i in (first.id, second.id, third.id)], [third.id, second.id, first.id])
        found = self.api_as(self.agent, 'GET', f'{ORDERS}?q=zaid').json()
        self.assertEqual([row['id'] for row in found['items']], [first.id])
        by_number = self.api_as(self.agent, 'GET', f'{ORDERS}?q={second.name}').json()
        self.assertEqual([row['id'] for row in by_number['items']], [second.id])
        page = self.api_as(self.agent, 'GET', f'{ORDERS}?limit=1&offset=1').json()
        self.assertEqual((len(page['items']), page['total']), (1, body['total']))

    def test_a_bad_filter_is_a_422(self):
        for query in ('source=other', 'mine=yes', 'limit=-1'):
            self.assertEqual(self.api_as(self.agent, 'GET', f'{ORDERS}?{query}').status_code, 422, query)

    def test_actions_of_the_owner_of_a_draft(self):
        order = self.make_order(self.agent)
        self.assertEqual(
            self.actions(self.agent, order),
            {**NO_ACTIONS, 'edit': True, 'confirm': True, 'cancel': True, 'duplicate': True},
        )

    def test_actions_follow_the_state_table(self):
        order = self.make_order(self.agent)
        expected = {
            'sale': {'cancel': True, 'lock': True, 'duplicate': True},
            'locked': {'unlock': True, 'duplicate': True},
            'cancel': {'reopen': True, 'duplicate': True},
            'sent': {'duplicate': True},
        }
        for label, flags in expected.items():
            with self.subTest(state=label):
                order.write({'state': 'sale' if label == 'locked' else label, 'locked': label == 'locked'})
                self.assertEqual(self.actions(self.agent, order), {**NO_ACTIONS, **flags})

    def test_a_colleague_under_all_reads_but_may_do_nothing_except_duplicate(self):
        self.set_visibility('all')
        order = self.make_order(self.agent2)
        self.assertEqual(self.actions(self.agent, order), {**NO_ACTIONS, 'duplicate': True})

    def test_the_assign_holder_acts_on_any_staff_document(self):
        order = self.make_order(self.agent)
        self.assertEqual(
            self.actions(self.manager, order),
            {**NO_ACTIONS, 'edit': True, 'confirm': True, 'cancel': True, 'duplicate': True, 'assign': True},
        )

    def test_an_online_order_only_offers_duplicate(self):
        order = self.make_order(None, staff=False)
        self.assertEqual(self.actions(self.agent, order), {**NO_ACTIONS, 'duplicate': True})
        self.assertEqual(self.actions(self.manager, order), {**NO_ACTIONS, 'duplicate': True})

    def test_a_reader_without_the_write_capabilities_has_no_actions(self):
        reader = self.custom_user('sales_reader_two', ['sales.read'])
        order = self.make_order(reader)
        self.assertEqual(self.actions(reader, order), NO_ACTIONS)

    def test_a_branch_session_reads_a_branch_order(self):
        scope = self.in_branch
        order = self.make_order(scope.agent, scope.company)
        detail = self.detail(scope.agent, order)
        self.assertEqual(detail['actions']['edit'], True)
        self.assertEqual(detail['amount_total'], 90.0)
