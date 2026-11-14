# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from .common import LiwanSalesCase

ORDERS = '/api/v1/sales/orders'
SETTINGS = '/api/v1/sales/settings'


class SalesVisibilityCase(LiwanSalesCase):
    """Per scope (the root and a branch): an order of each agent and an online order, then both modes."""

    MODE = None

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.books = {}
        for name, scope in cls.scopes.items():
            cls.books[name] = {
                'own': cls.make_order(scope.agent, scope.company, customer='Own'),
                'mate': cls.make_order(scope.agent2, scope.company, customer='Mate'),
                'online': cls.make_order(None, scope.company, staff=False, customer='Online'),
            }
        cls.fixture = cls.env['sale.order'].concat(*[o for book in cls.books.values() for o in book.values()])
        cls.set_visibility(cls.MODE)

    def listed(self, user, query=''):
        body = self.api_as(user, 'GET', f'{ORDERS}?limit=200{query}').json()
        return {item['id'] for item in body['items']} & set(self.fixture.ids)

    def orm_visible(self, user, company):
        orders = self.env['sale.order'].with_user(user).with_context(allowed_company_ids=[company.id])
        return set(orders.search([('company_id', '=', company.id)]).ids) & set(self.fixture.ids)


class VisibilityChecks:
    """The checks both modes share; each mode class supplies ``expected``."""

    def test_the_list_and_the_orm_agree_for_every_user(self):
        for name, scope in self.scopes.items():
            for key in ('agent', 'agent2', 'manager'):
                user = getattr(scope, key)
                with self.subTest(scope=name, user=key):
                    expected = {order.id for order in self.expected(name, key)}
                    self.assertEqual(self.listed(user), expected)
                    self.assertEqual(self.orm_visible(user, scope.company), expected)

    def test_the_detail_answers_404_for_what_the_list_hides(self):
        for name, scope in self.scopes.items():
            for key in ('agent', 'agent2', 'manager'):
                user = getattr(scope, key)
                visible = self.expected(name, key)
                for order in self.books[name].values():
                    with self.subTest(scope=name, user=key, order=order.partner_id.name):
                        status = self.api_as(user, 'GET', f'{ORDERS}/{order.id}').status_code
                        self.assertEqual(status, 200 if order in visible else 404)

    def test_another_scope_is_never_visible(self):
        for name, scope in self.scopes.items():
            other = self.books['branch' if name == 'root' else 'root']
            for order in other.values():
                self.assertEqual(self.api_as(scope.manager, 'GET', f'{ORDERS}/{order.id}').status_code, 404)

    def test_the_source_and_mine_filters(self):
        agent = self.root.agent
        book = self.books['root']
        online = self.listed(agent, '&source=online')
        self.assertEqual(online, {book['online'].id})
        staff = self.listed(agent, '&source=staff')
        self.assertTrue(staff <= {book['own'].id, book['mate'].id})
        self.assertIn(book['own'].id, staff)
        self.assertEqual(self.listed(agent, '&mine=true'), {book['own'].id})
        self.assertEqual(self.listed(agent, '&mine=false') & {book['own'].id}, {book['own'].id})

    def test_a_non_owner_cannot_write_through_the_orm_even_where_all_is_visible(self):
        mate = self.books['root']['mate'].with_user(self.agent).with_context(allowed_company_ids=[self.company.id])
        with self.assertRaises(AccessError):
            mate.write({'note': 'not mine'})


@tagged('post_install', '-at_install', 'liwan')
class TestSalesVisibilityOwn(VisibilityChecks, SalesVisibilityCase):
    MODE = 'own'

    def expected(self, scope_name, user_key):
        book = self.books[scope_name]
        return {
            'agent': book['own'] | book['online'],
            'agent2': book['mate'] | book['online'],
            'manager': book['own'] | book['mate'] | book['online'],
        }[user_key]


@tagged('post_install', '-at_install', 'liwan')
class TestSalesVisibilityAll(VisibilityChecks, SalesVisibilityCase):
    MODE = 'all'

    def expected(self, scope_name, user_key):
        book = self.books[scope_name]
        return book['own'] | book['mate'] | book['online']


@tagged('post_install', '-at_install', 'liwan')
class TestSalesVisibilityChanges(LiwanSalesCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.mate = cls.make_order(cls.agent2, cls.company)

    def ids(self, user):
        body = self.api_as(user, 'GET', f'{ORDERS}?limit=200').json()
        return {item['id'] for item in body['items']}

    def test_the_setting_applies_on_the_next_request(self):
        self.set_visibility('own')
        self.assertNotIn(self.mate.id, self.ids(self.agent))
        patched = self.api_as(self.manager, 'PATCH', SETTINGS, {'revision': 1, 'visibility': 'all'})
        self.assertEqual(patched.status_code, 200, patched.text)
        self.assertIn(self.mate.id, self.ids(self.agent))
        self.assertEqual(self.api_as(self.agent, 'GET', f'{ORDERS}/{self.mate.id}').status_code, 200)
        back = self.api_as(self.manager, 'PATCH', SETTINGS, {'revision': 2, 'visibility': 'own'})
        self.assertEqual(back.status_code, 200, back.text)
        self.assertNotIn(self.mate.id, self.ids(self.agent))
        self.assertEqual(self.api_as(self.agent, 'GET', f'{ORDERS}/{self.mate.id}').status_code, 404)

    def test_granting_and_revoking_assign_applies_on_the_next_request(self):
        self.set_visibility('own')
        user = self.custom_user('sales_reader_only', ['sales.read'])
        self.assertNotIn(self.mate.id, self.ids(user))
        self.give_custom_role(user, ['sales.read', 'sales.documents.assign'])
        self.assertIn(self.mate.id, self.ids(user))
        self.give_custom_role(user, ['sales.read'])
        self.assertNotIn(self.mate.id, self.ids(user))
        self.assertEqual(self.api_as(user, 'GET', f'{ORDERS}/{self.mate.id}').status_code, 404)

    def test_a_role_in_one_company_gives_nothing_in_another(self):
        elsewhere = self.make_order(None, self.other_company, staff=False)
        foreign = self.make_order(self.agent2, self.other_company)
        visitor = new_test_user(
            self.env, login='sales_visitor', password='sales_visitor_pass_123', name='Visitor',
            groups='liwan_core.group_employee', company_id=self.other_company.id,
            company_ids=[(6, 0, [self.company.id, self.other_company.id])],
        )
        self.env['liwan.access.assignment'].create({
            'user_id': visitor.id, 'role_id': self.env.ref('liwan_sales.role_sales_manager').id,
            'company_id': self.company.id,
        })
        visible = self.api_as(visitor, 'GET', ORDERS)
        self.assertEqual(visible.status_code, 403, visible.text)
        self.assertEqual(self.api_as(visitor, 'GET', f'{ORDERS}/{elsewhere.id}').status_code, 403)
        orders = self.env['sale.order'].with_user(visitor).with_context(allowed_company_ids=[self.other_company.id])
        self.assertEqual(set(orders.search([('id', '=', foreign.id)]).ids), set())

    def test_a_stock_invoicing_user_keeps_reading_through_the_orm(self):
        accountant = new_test_user(
            self.env, login='sales_accountant', name='Accountant',
            groups='liwan_core.group_employee,account.group_account_invoice',
        )
        order = self.mate.with_user(accountant)
        self.assertEqual(order.read(['name'])[0]['name'], self.mate.name)
