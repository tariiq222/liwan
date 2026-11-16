# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The two settings the bridge adds to the Sales settings: when an order wins its opportunity and for what amount."""
from odoo.tests import tagged

from .common import SETTINGS, SalesCrmCase


@tagged('post_install', '-at_install', 'liwan')
class TestOpportunitySettings(SalesCrmCase):

    def read(self, user=None):
        response = self.api_as(user or self.manager, 'GET', SETTINGS)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def patch(self, body, user=None):
        return self.api_as(user or self.manager, 'PATCH', SETTINGS, {'revision': self.read()['revision'], **body})

    def test_the_defaults_are_the_order_confirmed_win_for_the_untaxed_total(self):
        body = self.read()
        self.assertEqual((body['opportunity_win'], body['opportunity_win_amount']), ('order_confirmed', 'untaxed'))

    def test_a_manager_writes_both_and_the_revision_advances(self):
        before = self.read()['revision']
        response = self.patch({'opportunity_win': 'manual', 'opportunity_win_amount': 'total'})
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual((body['opportunity_win'], body['opportunity_win_amount'], body['revision']), ('manual', 'total', before + 1))

    def test_a_value_outside_the_choices_is_a_422_on_its_field(self):
        for key in ('opportunity_win', 'opportunity_win_amount'):
            for value in ('nope', 1, None, True):
                with self.subTest(key=key, value=value):
                    self.refused(self.patch({key: value}), 422, 'invalid', key)

    def test_only_the_settings_manager_writes(self):
        self.assertEqual(self.patch({'opportunity_win': 'manual'}, self.seller).status_code, 403)

    def test_a_tenant_without_crm_sees_neither_setting_and_cannot_set_one(self):
        self.feature('crm.enabled', False)
        body = self.read()
        self.assertNotIn('opportunity_win', body)
        self.assertNotIn('opportunity_win_amount', body)
        refused = self.patch({'opportunity_win': 'manual'})
        self.assertEqual((refused.status_code, refused.json()['code']), (403, 'feature_not_included'))
