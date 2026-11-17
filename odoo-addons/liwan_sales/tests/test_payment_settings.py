# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The tenant's default way of asking a customer to pay, read and written through the Sales settings route."""
from odoo.tests import tagged

from .payment_common import SETTINGS, SalesPaymentsCase

PAYMENT_KEYS = {'payment_to_confirm', 'prepayment_percent'}


@tagged('post_install', '-at_install', 'liwan')
class TestPaymentSettings(SalesPaymentsCase):

    def patch(self, user, **payload):
        return self.api_as(user, 'PATCH', SETTINGS, payload)

    def revision(self):
        return self.api_as(self.manager, 'GET', SETTINGS).json()['revision']

    def test_the_settings_carry_the_default_off_and_a_percentage_of_fifty(self):
        for mode in ('saas', 'non_saas'):
            with self.subTest(mode=mode):
                self.set_mode(mode)
                body = self.api_as(self.agent, 'GET', SETTINGS).json()
                self.assertEqual((body['payment_to_confirm'], body['prepayment_percent']), ('off', 50))

    def test_a_settings_manager_writes_both_values_and_the_revision_advances(self):
        for mode in ('saas', 'non_saas'):
            with self.subTest(mode=mode):
                self.set_mode(mode)
                for payload in ({'payment_to_confirm': 'full'}, {'payment_to_confirm': 'percent', 'prepayment_percent': 30}, {'prepayment_percent': 100}, {'payment_to_confirm': 'off'}):
                    revision = self.revision()
                    response = self.patch(self.manager, revision=revision, **payload)
                    self.assertEqual(response.status_code, 200, response.text)
                    body = response.json()
                    self.assertEqual(body['revision'], revision + 1)
                    for key, value in payload.items():
                        self.assertEqual(body[key], value)

    def test_an_invalid_value_is_a_422_on_its_field(self):
        revision = self.revision()
        for key, value in (
            ('payment_to_confirm', 'deposit'), ('payment_to_confirm', None), ('payment_to_confirm', True),
            ('prepayment_percent', 0), ('prepayment_percent', 101), ('prepayment_percent', 12.5),
            ('prepayment_percent', '30'), ('prepayment_percent', True), ('prepayment_percent', None),
        ):
            with self.subTest(key=key, value=value):
                response = self.patch(self.manager, revision=revision, **{key: value})
                self.assertEqual((response.status_code, response.json()['code'], response.json()['field']), (422, 'invalid', key), response.text)
        self.assertEqual(self.revision(), revision)

    def test_only_the_settings_manager_writes_and_a_stale_read_is_a_conflict(self):
        revision = self.revision()
        self.assertEqual(self.patch(self.agent, revision=revision, payment_to_confirm='full').status_code, 403)
        first = self.patch(self.manager, revision=revision, payment_to_confirm='full')
        self.assertEqual(first.status_code, 200, first.text)
        stale = self.patch(self.manager, revision=revision, payment_to_confirm='off')
        self.assertEqual((stale.status_code, stale.json()['code']), (409, 'conflict'), stale.text)

    def test_a_tenant_without_online_payments_sees_no_payment_setting_and_cannot_set_one(self):
        self.payments(False)
        self.assertFalse(PAYMENT_KEYS & set(self.api_as(self.manager, 'GET', SETTINGS).json()))
        response = self.patch(self.manager, revision=self.revision(), payment_to_confirm='full')
        self.assertEqual((response.status_code, response.json()['code']), (403, 'feature_not_included'), response.text)
        self.assertEqual(self.env['liwan.sales.settings']._liwan_current().payment_to_confirm, 'off')
        self.payments(True)
        self.assertTrue(set(self.api_as(self.manager, 'GET', SETTINGS).json()) >= PAYMENT_KEYS)
