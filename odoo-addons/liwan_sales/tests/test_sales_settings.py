# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import LiwanSalesCase

SETTINGS = '/api/v1/sales/settings'
KEYS = {
    'visibility', 'validity_days', 'discount_limit_percent', 'default_terms', 'customer_answer', 'acceptance_confirms',
    'can_manage', 'revision',
}


@tagged('post_install', '-at_install', 'liwan')
class TestSalesSettings(LiwanSalesCase):

    def patch(self, user, **payload):
        return self.api_as(user, 'PATCH', SETTINGS, payload)

    def assert_invalid(self, response, field):
        self.assertEqual((response.status_code, response.json()['code']), (422, 'invalid'), response.text)
        self.assertEqual(response.json().get('field'), field)

    def test_a_reader_and_a_manager_read_the_defaults(self):
        reader = self.api_as(self.agent, 'GET', SETTINGS)
        self.assertEqual(reader.status_code, 200, reader.text)
        self.assertEqual(set(reader.json()), KEYS)
        self.assertEqual(
            reader.json(),
            {
                'visibility': 'own', 'validity_days': 30, 'discount_limit_percent': 0, 'default_terms': '',
                'customer_answer': 'accept', 'acceptance_confirms': False, 'can_manage': False, 'revision': 1,
            },
        )
        manager = self.api_as(self.manager, 'GET', SETTINGS).json()
        self.assertTrue(manager['can_manage'])

    def test_a_settings_manager_without_read_reads_the_settings(self):
        user = self.custom_user('sales_settings_only', ['sales.settings.manage'])
        self.assertEqual(self.api_as(user, 'GET', SETTINGS).status_code, 200)

    def test_each_field_is_written_and_the_revision_advances(self):
        revision = 1
        for payload in (
            {'visibility': 'all'}, {'validity_days': 0}, {'validity_days': 3650}, {'discount_limit_percent': 100},
            {'default_terms': 'Payment within 30 days'}, {'default_terms': ''}, {'customer_answer': 'none'},
            {'customer_answer': 'accept_and_sign'}, {'acceptance_confirms': True}, {'acceptance_confirms': False},
        ):
            with self.subTest(payload=payload):
                response = self.patch(self.manager, revision=revision, **payload)
                self.assertEqual(response.status_code, 200, response.text)
                revision += 1
                body = response.json()
                self.assertEqual(body['revision'], revision)
                for key, value in payload.items():
                    self.assertEqual(body[key], value)

    def test_invalid_values_are_a_422_on_their_field(self):
        for field, value in (
            ('visibility', 'team'), ('validity_days', -1), ('validity_days', 3651), ('validity_days', True),
            ('validity_days', '5'), ('discount_limit_percent', 101), ('discount_limit_percent', -1),
            ('default_terms', 5), ('revision', 0), ('customer_answer', 'sign'), ('customer_answer', None),
            ('acceptance_confirms', 'yes'), ('acceptance_confirms', 1),
        ):
            with self.subTest(field=field, value=value):
                payload = {'revision': 1, 'validity_days': 10} if field == 'revision' else {'revision': 1}
                payload[field] = value
                self.assert_invalid(self.patch(self.manager, **payload), field)

    def test_an_unknown_field_is_a_422(self):
        self.assert_invalid(self.patch(self.manager, revision=1, currency='SAR'), 'currency')

    def test_a_missing_revision_or_nothing_to_change_is_a_422(self):
        self.assert_invalid(self.patch(self.manager, validity_days=10), 'revision')
        response = self.patch(self.manager, revision=1)
        self.assertEqual((response.status_code, response.json()['code']), (422, 'invalid'))

    def test_a_stale_revision_is_a_409(self):
        self.assertEqual(self.patch(self.manager, revision=1, validity_days=10).status_code, 200)
        stale = self.patch(self.manager, revision=1, validity_days=20)
        self.assertEqual((stale.status_code, stale.json()['code']), (409, 'conflict'))
        self.assertEqual(self.api_as(self.manager, 'GET', SETTINGS).json()['validity_days'], 10)

    def test_a_branch_manager_reads_but_cannot_write(self):
        manager = self.in_branch.manager
        read = self.api_as(manager, 'GET', SETTINGS)
        self.assertEqual(read.status_code, 200, read.text)
        self.assertFalse(read.json()['can_manage'])
        refused = self.patch(manager, revision=1, validity_days=10)
        self.assertEqual((refused.status_code, refused.json()['code']), (403, 'forbidden'))
        self.assertEqual(self.api_as(self.manager, 'GET', SETTINGS).json()['validity_days'], 30)
