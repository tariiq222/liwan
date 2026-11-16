# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The settings of the bridge: whether a confirmed order may be invoiced in advance and who may invoice an order."""
from odoo.tests import tagged

from .common import SETTINGS, SalesFinanceCase


@tagged('post_install', '-at_install', 'liwan')
class TestInvoiceSettings(SalesFinanceCase):

    def read(self, user):
        response = self.api_as(user, 'GET', SETTINGS)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def patch(self, user, body, expect=200):
        revision = self.read(user)['revision']
        response = self.api_as(user, 'PATCH', SETTINGS, {**body, 'revision': revision})
        self.assertEqual(response.status_code, expect, response.text)
        return response.json()

    def test_the_default_allows_down_payments_and_a_manager_changes_it(self):
        for mode in ('saas', 'non_saas'):
            with self.subTest(mode=mode):
                self.set_mode(mode)
                self.assertEqual(self.read(self.boss)['invoice_down_payment'], 'allow')
                self.assertEqual(self.patch(self.boss, {'invoice_down_payment': 'refuse'})['invoice_down_payment'], 'refuse')
                self.assertEqual(self.read(self.biller)['invoice_down_payment'], 'refuse')
                self.assertEqual(self.patch(self.boss, {'invoice_down_payment': 'allow'})['invoice_down_payment'], 'allow')

    def test_only_a_settings_manager_changes_it_and_only_a_listed_value_is_taken(self):
        self.patch(self.biller, {'invoice_down_payment': 'refuse'}, expect=403)
        refused = self.patch(self.boss, {'invoice_down_payment': 'sometimes'}, expect=422)
        self.assertEqual((refused['code'], refused['field']), ('invalid', 'invoice_down_payment'))
        self.assertEqual(self.read(self.boss)['invoice_down_payment'], 'allow')

    def test_without_finance_the_setting_is_neither_shown_nor_written(self):
        self.feature('finance.enabled', False)
        self.assertNotIn('invoice_down_payment', self.read(self.boss))
        refused = self.patch(self.boss, {'invoice_down_payment': 'refuse'}, expect=403)
        self.assertEqual(refused['code'], 'feature_not_included')
        self.assertEqual(self.env['liwan.sales.settings']._liwan_current().invoice_down_payment, 'allow')

    def test_the_actor_defaults_to_the_owner_and_a_manager_changes_it(self):
        for mode in ('saas', 'non_saas'):
            with self.subTest(mode=mode):
                self.set_mode(mode)
                self.assertEqual(self.read(self.boss)['invoice_actor'], 'owner')
                self.assertEqual(self.patch(self.boss, {'invoice_actor': 'any_biller'})['invoice_actor'], 'any_biller')
                self.assertEqual(self.read(self.biller)['invoice_actor'], 'any_biller')
                self.assertEqual(self.patch(self.boss, {'invoice_actor': 'owner'})['invoice_actor'], 'owner')

    def test_only_a_settings_manager_changes_the_actor_and_only_a_listed_value_is_taken(self):
        self.patch(self.biller, {'invoice_actor': 'any_biller'}, expect=403)
        refused = self.patch(self.boss, {'invoice_actor': 'everyone'}, expect=422)
        self.assertEqual((refused['code'], refused['field']), ('invalid', 'invoice_actor'))
        self.assertEqual(self.read(self.boss)['invoice_actor'], 'owner')

    def test_without_finance_the_actor_is_neither_shown_nor_written(self):
        self.feature('finance.enabled', False)
        self.assertNotIn('invoice_actor', self.read(self.boss))
        self.assertEqual(self.patch(self.boss, {'invoice_actor': 'any_biller'}, expect=403)['code'], 'feature_not_included')
        self.assertEqual(self.env['liwan.sales.settings']._liwan_current().invoice_actor, 'owner')
