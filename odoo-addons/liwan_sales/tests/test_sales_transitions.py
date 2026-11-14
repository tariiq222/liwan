# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The state table (D1), online orders, duplicate (D9), assign, the salespeople list and what stays silent."""
from odoo import Command, fields
from odoo.tests import new_test_user, tagged

from .common import SalesWriteCase

ORDERS = '/api/v1/sales/orders'
SALESPEOPLE = '/api/v1/sales/salespeople'


@tagged('post_install', '-at_install', 'liwan')
class TestSalesStateTable(SalesWriteCase):

    def created(self, user=None):
        return self.post(user or self.agent, self.body())['id']

    def test_every_row_moves_as_written_for_the_owner(self):
        for name, scope in self.scopes.items():
            with self.subTest(session=name):
                order_id = self.created(scope.agent)
                self.assertEqual(self.act(scope.agent, order_id, 'confirm')['state'], 'confirmed')
                self.assertTrue(self.act(scope.agent, order_id, 'lock')['locked'])
                self.assertFalse(self.act(scope.agent, order_id, 'unlock')['locked'])
                self.assertEqual(self.act(scope.agent, order_id, 'cancel')['state'], 'cancelled')
                self.assertEqual(self.act(scope.agent, order_id, 'reopen')['state'], 'draft')
                self.assertEqual(self.act(scope.agent, order_id, 'cancel')['state'], 'cancelled')

    def test_each_move_outside_the_table_is_transition_forbidden(self):
        draft = self.created()
        for action in ('reopen', 'lock', 'unlock'):
            with self.subTest(state='draft', action=action):
                self.act(self.agent, draft, action, expect=403)
        confirmed = self.created()
        self.act(self.agent, confirmed, 'confirm')
        for action in ('confirm', 'reopen', 'unlock'):
            with self.subTest(state='confirmed', action=action):
                body = self.act(self.agent, confirmed, action, expect=403)
                self.assertEqual(body['code'], 'transition_forbidden')
        patched = self.patch_order(self.agent, confirmed, {'terms': 'late'}, expect=403)
        self.assertEqual(patched['code'], 'transition_forbidden')
        self.act(self.agent, confirmed, 'lock')
        self.assertEqual(self.act(self.agent, confirmed, 'cancel', expect=403)['code'], 'transition_forbidden')
        self.act(self.agent, confirmed, 'unlock')
        self.act(self.agent, confirmed, 'cancel')
        for action in ('confirm', 'lock', 'unlock', 'cancel'):
            with self.subTest(state='cancelled', action=action):
                self.assertEqual(self.act(self.agent, confirmed, action, expect=403)['code'], 'transition_forbidden')

    def test_confirm_needs_a_product_line(self):
        order_id = self.post(self.agent, self.body({'kind': 'section', 'name': 'Only a title'}))['id']
        response = self.api_as(self.agent, 'POST', f'{ORDERS}/{order_id}/confirm')
        self.refused(response, 422, 'invalid', 'lines')

    def test_a_colleague_under_all_is_forbidden_and_the_assign_holder_may_do_all(self):
        self.set_visibility('all')
        order_id = self.created(self.agent2)
        for action in ('confirm', 'cancel', 'duplicate'):
            with self.subTest(action=action):
                expect = 200 if action == 'duplicate' else 403
                body = self.act(self.agent, order_id, action, expect=expect)
                if expect == 403:
                    self.assertEqual(body['code'], 'forbidden')
        self.refused(self.api_as(self.agent, 'PATCH', f'{ORDERS}/{order_id}', {'terms': 'x'}), 403, 'forbidden')
        self.set_visibility('own')
        self.assertEqual(self.api_as(self.agent, 'POST', f'{ORDERS}/{order_id}/confirm').status_code, 404)
        self.assertEqual(self.patch_order(self.manager, order_id, {'terms': 'Manager terms'})['terms'], 'Manager terms')
        for action, state in (('confirm', 'confirmed'), ('lock', 'confirmed'), ('unlock', 'confirmed'),
                              ('cancel', 'cancelled'), ('reopen', 'draft')):
            self.assertEqual(self.act(self.manager, order_id, action)['state'], state)

    def test_a_user_who_only_manages_quotations_cannot_cancel_a_confirmed_order(self):
        writer = self.custom_user('sales_writer_only', ['sales.read', 'sales.quotations.manage'])
        order_id = self.created(writer)
        self.env['sale.order'].browse(order_id).action_confirm()
        self.assertEqual(self.act(writer, order_id, 'cancel', expect=403)['code'], 'transition_forbidden')
        self.assertEqual(self.act(writer, order_id, 'confirm', expect=403)['code'], 'forbidden')

    def test_no_mail_leaves_and_the_customer_does_not_follow(self):
        mails = self.env['mail.mail'].search_count([])
        order_id = self.created()
        for action in ('confirm', 'cancel', 'reopen'):
            self.act(self.agent, order_id, action)
        self.assertEqual(self.env['mail.mail'].search_count([]), mails)
        order = self.env['sale.order'].browse(order_id)
        self.assertNotIn(self.customer, order.message_partner_ids)


@tagged('post_install', '-at_install', 'liwan')
class TestSalesOnlineAndDuplicate(SalesWriteCase):

    def online_order(self, product=None):
        return self.env['sale.order'].with_company(self.company).create({
            'partner_id': self.customer.id, 'company_id': self.company.id, 'user_id': False,
            'order_line': [Command.create({'product_id': (product or self.taxed).product_variant_id.id,
                                           'product_uom_qty': 2, 'price_unit': 70.0})],
        })

    def test_an_online_order_is_listed_and_every_write_route_refuses_it(self):
        order = self.online_order()
        listed = self.api_as(self.agent, 'GET', f'{ORDERS}?source=online&limit=200').json()
        self.assertIn(order.id, {item['id'] for item in listed['items']})
        for user in (self.agent, self.manager):
            for action in ('confirm', 'cancel', 'reopen', 'lock', 'unlock'):
                with self.subTest(user=user.login, action=action):
                    self.refused(self.api_as(user, 'POST', f'{ORDERS}/{order.id}/{action}'), 403, 'forbidden')
            self.refused(self.api_as(user, 'PATCH', f'{ORDERS}/{order.id}', {'terms': 'x'}), 403, 'forbidden')
        assign = self.api_as(self.manager, 'POST', f'{ORDERS}/{order.id}/assign', {'salesperson_id': self.agent.id})
        self.refused(assign, 403, 'forbidden')
        copy = self.act(self.agent, order.id, 'duplicate')
        self.assertEqual((copy['source'], copy['state'], copy['salesperson']['id']), ('staff', 'draft', self.agent.id))
        self.assertEqual(copy['lines'][0]['unit_price'], 100.0)

    def test_the_copy_is_a_fresh_draft_of_the_caller(self):
        self.set_visibility('all')
        source = self.post(self.agent2, self.body(
            {'kind': 'section', 'name': 'Head'}, self.product_line(self.plain, 2, discount_percent=5, name='Kept name'),
        ))
        self.act(self.agent2, source['id'], 'confirm')
        self.products_service()._liwan_update(self.plain, {'list_price': 60.0})
        copy = self.act(self.agent, source['id'], 'duplicate')
        self.assertNotEqual(copy['id'], source['id'])
        self.assertEqual((copy['state'], copy['salesperson']['id'], copy['customer']['id']),
                         ('draft', self.agent.id, self.customer.id))
        section, line = copy['lines']
        self.assertEqual((section['kind'], section['name']), ('section', 'Head'))
        self.assertEqual((line['name'], line['quantity'], line['discount_percent'], line['unit_price']),
                         ('Kept name', 2.0, 5.0, 60.0))

    def test_the_copy_takes_the_tax_of_today(self):
        self.register(False)
        untaxed = self.post(self.agent, self.body())
        self.assertEqual(untaxed['amount_total'], 100.0)
        self.register(True)
        self.assertEqual(self.act(self.agent, untaxed['id'], 'duplicate')['amount_total'], 115.0)
        taxed = self.post(self.agent, self.body())
        self.register(False)
        self.assertEqual(self.act(self.agent, taxed['id'], 'duplicate')['amount_total'], 100.0)

    def test_a_product_that_can_no_longer_be_picked_is_refused(self):
        gone = self.service_product('Retired service', 10.0)
        source = self.post(self.agent, self.body(self.product_line(self.plain), self.product_line(gone)))
        gone.active = False
        response = self.api_as(self.agent, 'POST', f'{ORDERS}/{source["id"]}/duplicate')
        self.refused(response, 422, 'invalid', 'lines.1.product_id')


@tagged('post_install', '-at_install', 'liwan')
class TestSalesAssign(SalesWriteCase):

    def test_the_assign_holder_changes_the_salesperson_in_any_state(self):
        order_id = self.post(self.agent, self.body())['id']
        self.act(self.agent, order_id, 'confirm')
        moved = self.act(self.manager, order_id, 'assign', {'salesperson_id': self.agent2.id})
        self.assertEqual(moved['salesperson']['id'], self.agent2.id)
        refused = self.api_as(self.manager, 'POST', f'{ORDERS}/{order_id}/assign', {'salesperson_id': self.outsider.id})
        self.refused(refused, 422, 'invalid', 'salesperson_id')
        branch = self.api_as(self.manager, 'POST', f'{ORDERS}/{order_id}/assign',
                             {'salesperson_id': self.in_branch.agent.id})
        self.refused(branch, 422, 'invalid', 'salesperson_id')
        self.refused(self.api_as(self.agent, 'POST', f'{ORDERS}/{order_id}/assign', {'salesperson_id': self.agent.id}),
                     403, 'forbidden')

    def test_the_salespeople_of_the_working_company(self):
        body = self.api_as(self.manager, 'GET', f'{SALESPEOPLE}?limit=200').json()
        ids = {item['id'] for item in body['items']}
        self.assertTrue({self.agent.id, self.agent2.id, self.manager.id} <= ids)
        self.assertFalse(ids & {self.outsider.id, self.in_branch.agent.id})
        self.assertEqual(body['total'], len(ids))
        item = next(item for item in body['items'] if item['id'] == self.agent.id)
        self.assertEqual(item, {'id': self.agent.id, 'name': self.agent.name, 'user_id': self.agent.id})
        found = self.api_as(self.manager, 'GET', f'{SALESPEOPLE}?q=sales_agent2').json()
        self.assertEqual([item['id'] for item in found['items']], [self.agent2.id])
        self.assertEqual(self.api_as(self.agent, 'GET', SALESPEOPLE).status_code, 403)


@tagged('post_install', '-at_install', 'liwan')
class TestSalesFences(SalesWriteCase):

    def test_a_role_in_company_a_finds_no_order_of_company_b_through_the_orm(self):
        own = self.make_order(None, self.other_company, staff=False)
        staff = self.make_order(self.agent2, self.other_company)
        visitor = new_test_user(
            self.env, login='sales_fence_visitor', password='sales_fence_visitor_pass_123', name='Fence visitor',
            groups='liwan_core.group_employee', company_id=self.company.id,
            company_ids=[Command.set([self.company.id, self.other_company.id])],
        )
        self.env['liwan.access.assignment'].create({
            'user_id': visitor.id, 'role_id': self.env.ref('liwan_sales.role_sales_agent').id,
            'company_id': self.company.id,
        })
        orders = self.env['sale.order'].with_user(visitor).with_context(allowed_company_ids=[self.other_company.id])
        self.assertEqual(orders.search([('id', 'in', (own | staff).ids)]).ids, [])

    def test_the_payments_list_and_its_cron_never_see_a_staff_order(self):
        if 'liwan.payments.service' not in self.env:
            self.skipTest('liwan_payments is not installed in this run: no payments list or expiry cron exists')
        order = self.env['sale.order'].browse(self.post(self.agent, self.body())['id'])
        payments = self.env['liwan.payments.service']
        found, _total = payments._liwan_company_orders(self.company)
        self.assertNotIn(order, found)
        order.date_order = fields.Datetime.subtract(fields.Datetime.now(), days=400)
        self.patch(type(self.env['ir.cron']), '_commit_progress', lambda cron, processed=0, **_: float('inf'))
        self.env['sale.order']._liwan_cron_expire_unpaid()
        self.assertEqual(order.state, 'draft')
