# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""GET /api/v1/customers/pick: the picker of a pick holder, minimal and scoped to what the caller may see."""
from odoo.tests import tagged

from odoo.addons.liwan_customers.tests.common import (
    PHONE_LOCAL,
    PICK,
    CustomersCase,
)


@tagged('post_install', '-at_install', 'liwan')
class TestCustomersPick(CustomersCase):

    def create(self, name, **values):
        return self.env['liwan.customers.service']._liwan_create({'name': name, **values})

    def picked(self, query=''):
        response = self.api('GET', f'{PICK}?{query}' if query else PICK)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_a_pick_holder_gets_the_minimal_shape_without_customers_read(self):
        customer = self.create('Pick shape', phone=PHONE_LOCAL, email='shape@example.test', is_company=True)
        self.sign_in('cu_picker')
        self.assertEqual(self.picked('q=Pick shape'), {
            'items': [{'id': customer.id, 'name': 'Pick shape', 'is_company': True, 'phone_last4': '4567'}], 'total': 1,
        })

    def test_a_party_without_a_phone_has_a_null_last_digits(self):
        customer = self.create('No phone')
        self.sign_in('cu_picker')
        self.assertEqual(self.picked('q=No phone')['items'], [
            {'id': customer.id, 'name': 'No phone', 'is_company': False, 'phone_last4': None},
        ])

    def test_a_reader_may_pick_too(self):
        customer = self.create('Reader pick')
        self.sign_in('cu_a_staff')
        self.assertEqual([item['id'] for item in self.picked('q=Reader')['items']], [customer.id])

    def test_a_caller_with_neither_customers_read_nor_a_pick_capability_is_refused(self):
        self.sign_in('cu_nobody')
        response = self.api('GET', PICK)
        self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'))

    def test_the_route_is_closed_without_a_registered_feature(self):
        self.patch(type(self.env['liwan.customers.service']), '_liwan_customers_feature_keys', lambda model: ())
        self.sign_in('wc_root_admin')
        response = self.api('GET', PICK)
        self.assertEqual((response.status_code, response.json()['code']), (403, 'feature_not_included'))

    def test_the_query_matches_the_name_only(self):
        wanted = self.create('Zainab Pick', phone=PHONE_LOCAL, email='other@example.test')
        self.create('Somebody Else')
        self.sign_in('cu_picker')
        self.assertEqual([item['id'] for item in self.picked('q=zain')['items']], [wanted.id])
        self.assertEqual(self.picked('q=other@example.test')['items'], [])
        self.assertEqual(self.picked(f'q={PHONE_LOCAL}')['items'], [])

    def test_an_archived_party_is_absent(self):
        customer = self.create('Archived pick')
        customer.active = False
        self.sign_in('cu_picker')
        self.assertEqual(self.picked('q=Archived pick'), {'items': [], 'total': 0})

    def test_a_party_of_another_branch_is_absent(self):
        self.settings.sharing = 'branch'
        self.sign_in('cu_b_staff')
        mine = self.created({'name': 'Branch pick'})
        self.sign_in('cu_picker')
        self.assertNotIn(mine['id'], [item['id'] for item in self.picked('q=Branch pick')['items']])

    def test_the_phone_is_never_longer_than_four_digits(self):
        self.create('Long phone', phone=PHONE_LOCAL)
        self.sign_in('cu_picker')
        for item in self.picked()['items']:
            self.assertEqual(set(item), {'id', 'name', 'is_company', 'phone_last4'})
            self.assertLessEqual(len(item['phone_last4'] or ''), 4)

    def test_limit_offset_and_total(self):
        ids = [self.create(f'Page {index}').id for index in range(3)]
        self.sign_in('cu_picker')
        first = self.picked('q=Page&limit=2')
        self.assertEqual(([item['id'] for item in first['items']], first['total']), (ids[:2], 3))
        second = self.picked('q=Page&limit=2&offset=2')
        self.assertEqual(([item['id'] for item in second['items']], second['total']), (ids[2:], 3))
